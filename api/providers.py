"""Provedores de modelo do agente: Gemini (Interactions API) e APIs compatíveis com OpenAI (ChatGPT e NVIDIA).

Cada provedor expõe uma sessão com a mesma interface: step() devolve as chamadas de ferramenta
do modelo, add_results() devolve os resultados, nudge() acrescenta uma instrução.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PROVIDERS: dict[str, dict[str, str]] = {
    "gemini": {"label": "Gemini", "env": "GEMINI_API_KEY", "site": "gemini.google.com", "keys_url": "https://aistudio.google.com/apikey"},
    "openai": {"label": "ChatGPT", "env": "OPENAI_API_KEY", "site": "openai.com", "keys_url": "https://platform.openai.com/api-keys"},
    "nvidia": {"label": "NVIDIA", "env": "NVIDIA_API_KEY", "site": "nvidia.com", "keys_url": "https://build.nvidia.com/settings/api-keys"},
}

CHAT_BASES = {
    "openai": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
    "nvidia": os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1").rstrip("/"),
}


# ---------------------------------------------------------------- configurações locais

_settings_lock = threading.Lock()


def settings_path() -> Path:
    default = Path(__file__).resolve().parents[1] / "data" / "settings.json"
    return Path(os.getenv("ASTER_SETTINGS", str(default)))


def load_settings() -> dict:
    path = settings_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_settings(data: dict) -> None:
    path = settings_path()
    with _settings_lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)


def mask(key: str) -> str:
    return f"••••{key[-4:]}" if len(key) >= 8 else "••••"


# ---------------------------------------------------------------- tipos comuns

@dataclass(frozen=True)
class ModelSpec:
    provider: str
    model: str

    @property
    def label(self) -> str:
        return self.model

    def public(self) -> dict:
        return {"provider": self.provider, "model": self.model}


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class ModelTurn:
    thoughts: list[str]
    calls: list[ToolCall]
    text: str
    raw_steps: list[dict]


class ProviderHTTPError(Exception):
    """Erro HTTP de um provedor compatível com OpenAI, com o código de status."""

    def __init__(self, code: int, message: str = ""):
        super().__init__(message or f"HTTP {code}")
        self.code = code


def _post_json(url: str, body: dict, key: str, timeout: float) -> dict:
    request = Request(url, data=json.dumps(body).encode("utf-8"), method="POST", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise ProviderHTTPError(error.code) from None
    except URLError as error:
        raise ConnectionError(str(error.reason)) from None


def _get_json(url: str, key: str, timeout: float = 15) -> dict:
    request = Request(url, headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise ProviderHTTPError(error.code) from None
    except URLError as error:
        raise ConnectionError(str(error.reason)) from None


# ---------------------------------------------------------------- Gemini

_no_thinking: set[str] = set()
# níveis de raciocínio que um modelo recusou (o gemini-4 não aceita "minimal", por exemplo)
_bad_levels: set[tuple[str, str]] = set()


def _thinking_refused(error: Exception) -> bool:
    """400 dizendo que o nível de raciocínio não vale para o modelo. A API de interações lança outra classe
    de erro que não é genai_errors.APIError, então olhamos o código e a mensagem de qualquer exceção."""
    code = getattr(error, "code", None) or getattr(error, "status_code", None)
    return str(code) == "400" and "thinking" in str(error).lower()


class GeminiSession:
    provider = "gemini"

    def __init__(self, spec: ModelSpec, key: str, system: str, tools: list[dict], user_text: str, thinking: str = "low"):
        self.spec = spec
        self.key = key
        self.system = system
        self.tools = tools
        self.thinking = thinking
        self.history: list[dict] = [{"type": "user_input", "content": [{"type": "text", "text": user_text}]}]

    def step(self, force_final: bool = False, final_tools: tuple[str, ...] = ()) -> ModelTurn:
        from google import genai
        from google.genai import errors as genai_errors

        client = genai.Client(api_key=self.key, http_options={"retry_options": {"attempts": 1}})
        tool_choice: Any = {"allowed_tools": {"mode": "any", "tools": list(final_tools)}} if force_final and final_tools else "any"
        config: dict[str, Any] = {"tool_choice": tool_choice}
        if self.spec.model not in _no_thinking:
            level = "low" if (self.spec.model, self.thinking) in _bad_levels else self.thinking
            config.update({"thinking_level": level, "thinking_summaries": "auto"})

        def create(generation_config: dict):
            return client.interactions.create(model=self.spec.model, input=self.history, tools=self.tools, system_instruction=self.system, store=False, timeout=25.0, generation_config=generation_config)

        try:
            interaction = create(config)
        except Exception as error:
            if "thinking_level" not in config or not (_thinking_refused(error) or (isinstance(error, genai_errors.APIError) and error.code == 400)):
                raise
            if config["thinking_level"] != "low":
                # o nível pedido não vale para este modelo: tenta o padrão, que todos os modelos com raciocínio aceitam
                _bad_levels.add((self.spec.model, self.thinking))
                try:
                    interaction = create({**config, "thinking_level": "low"})
                except Exception as retry:
                    if not _thinking_refused(retry):
                        raise
                    _no_thinking.add(self.spec.model)
                    interaction = create({"tool_choice": tool_choice})
            else:
                # alguns modelos (Gemma, por exemplo) não aceitam opção de raciocínio nenhuma
                _no_thinking.add(self.spec.model)
                interaction = create({"tool_choice": tool_choice})
        thoughts: list[str] = []
        calls: list[ToolCall] = []
        raw: list[dict] = []
        for step in interaction.steps or []:
            if step.type == "user_input":
                continue
            raw.append(step.model_dump(exclude_none=True))
            if step.type == "thought":
                for part in getattr(step, "summary", None) or []:
                    text = getattr(part, "text", None)
                    if text:
                        thoughts.append(text.strip())
            elif step.type == "function_call":
                calls.append(ToolCall(step.id, step.name, dict(step.arguments or {})))
        self.history.extend(raw)
        return ModelTurn(thoughts, calls, interaction.output_text or "", raw)

    def add_results(self, results: list[tuple[ToolCall, dict]]) -> None:
        for call, payload in results:
            self.history.append({"type": "function_result", "name": call.name, "call_id": call.id, "result": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}]})

    def nudge(self, text: str) -> None:
        self.history.append({"type": "user_input", "content": [{"type": "text", "text": text}]})


# ---------------------------------------------------------------- ChatGPT e NVIDIA (formato OpenAI)

class ChatSession:
    def __init__(self, spec: ModelSpec, key: str, system: str, tools: list[dict], user_text: str):
        self.spec = spec
        self.provider = spec.provider
        self.key = key
        self.base = CHAT_BASES[spec.provider]
        self.tools = [{"type": "function", "function": {"name": tool["name"], "description": tool["description"], "parameters": tool["parameters"]}} for tool in tools]
        self.messages: list[dict] = [{"role": "system", "content": system}, {"role": "user", "content": user_text}]
        self.finalizing = False

    def step(self, force_final: bool = False, final_tools: tuple[str, ...] = ()) -> ModelTurn:
        if force_final and not self.finalizing:
            self.finalizing = True
            self.messages.append({"role": "user", "content": f"Finalize agora chamando uma destas ferramentas: {', '.join(final_tools) or 'responder'}."})
        body = {
            "model": self.spec.model,
            "messages": self.messages,
            "tools": self.tools,
            # a OpenAI aceita exigir ferramenta; nos modelos da NVIDIA o suporte varia
            "tool_choice": "required" if self.provider == "openai" else "auto",
        }
        data = _post_json(f"{self.base}/chat/completions", body, self.key, timeout=45)
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        stored = {"role": "assistant", "content": message.get("content") or ""}
        tool_calls = message.get("tool_calls") or []
        if tool_calls:
            stored["tool_calls"] = tool_calls
        self.messages.append(stored)
        calls: list[ToolCall] = []
        for index, item in enumerate(tool_calls):
            function = item.get("function") or {}
            try:
                arguments = json.loads(function.get("arguments") or "{}")
            except ValueError:
                arguments = {}
            calls.append(ToolCall(item.get("id") or f"call-{len(self.messages)}-{index}", function.get("name", ""), arguments if isinstance(arguments, dict) else {}))
        thoughts = []
        reasoning = message.get("reasoning_content") or message.get("reasoning")
        if isinstance(reasoning, str) and reasoning.strip():
            thoughts.append(reasoning.strip()[:700])
        return ModelTurn(thoughts, calls, message.get("content") or "", [])

    def add_results(self, results: list[tuple[ToolCall, dict]]) -> None:
        for call, payload in results:
            self.messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(payload, ensure_ascii=False)})

    def nudge(self, text: str) -> None:
        self.messages.append({"role": "user", "content": text})


def make_session(spec: ModelSpec, key: str, system: str, tools: list[dict], user_text: str, thinking: str = "low"):
    if spec.provider == "gemini":
        return GeminiSession(spec, key, system, tools, user_text, thinking)
    if spec.provider in CHAT_BASES:
        return ChatSession(spec, key, system, tools, user_text)
    raise ValueError(f"Provedor desconhecido: {spec.provider}")


# ---------------------------------------------------------------- catálogo de modelos

GEMINI_SKIP = re.compile(r"image|embedding|antigravity|deep-research|omni|nano-banana|tts|live|transcribe|^gemini-2\.|^gemini-1\.")
OPENAI_KEEP = re.compile(r"^(gpt-|o\d|chatgpt-)")
OPENAI_SKIP = re.compile(r"audio|realtime|tts|transcribe|image|search|embedding|moderation|instruct|dall-e|whisper|codex")
NVIDIA_SKIP = re.compile(r"embed|rerank|guard|clip|parse|retriever|reward|safety|vila|neva|paligemma|kosmos|fuyu|deplot|nvclip|riva|asr|tts|ocr|detector|segformer|bge|e5-|cosmos|flux|sdxl|stable-diffusion|vlm|vision")


def list_models(provider: str, key: str) -> list[dict]:
    if provider == "gemini":
        from google import genai

        client = genai.Client(api_key=key, http_options={"retry_options": {"attempts": 1}, "timeout": 15000})
        models = []
        for item in client.models.list():
            name = (item.name or "").removeprefix("models/")
            actions = item.supported_actions or []
            if "generateContent" not in actions or GEMINI_SKIP.search(name):
                continue
            models.append({"id": name, "name": item.display_name or name, "context": item.input_token_limit})
        return sorted(models, key=lambda entry: entry["id"], reverse=True)
    if provider in CHAT_BASES:
        data = _get_json(f"{CHAT_BASES[provider]}/models", key)
        models = []
        for item in data.get("data", []):
            name = str(item.get("id", ""))
            if provider == "openai" and (not OPENAI_KEEP.search(name) or OPENAI_SKIP.search(name)):
                continue
            if provider == "nvidia" and NVIDIA_SKIP.search(name.lower()):
                continue
            models.append({"id": name, "name": name, "context": None, "owner": item.get("owned_by")})
        return sorted(models, key=lambda entry: entry["id"])
    raise ValueError(f"Provedor desconhecido: {provider}")


PING_TOOL = {
    "type": "function",
    "name": "confirmar",
    "description": "Confirma que a mensagem de teste chegou.",
    "parameters": {"type": "object", "properties": {"texto": {"type": "string"}}, "required": ["texto"]},
}


def test_model(spec: ModelSpec, key: str) -> dict:
    """Uma chamada curta pedindo uma ferramenta: mede o tempo e confirma o suporte a ferramentas."""
    session = make_session(spec, key, "Isto é um teste de conexão. Chame a ferramenta confirmar com o texto ok.", [PING_TOOL], "Teste: chame confirmar.", thinking="minimal")
    started = time.perf_counter()
    turn = session.step()
    latency = round((time.perf_counter() - started) * 1000)
    tools = any(call.name == "confirmar" for call in turn.calls)
    return {"ok": True, "latency_ms": latency, "tools": tools, "reply": (turn.text or "")[:160]}
