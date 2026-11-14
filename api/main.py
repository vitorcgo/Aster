from __future__ import annotations

import asyncio
import json
import math
import os
import re
import threading
import time
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, AsyncIterator
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
import pymupdf
from dotenv import load_dotenv
from google.genai import errors as genai_errors


ROOT = Path(__file__).resolve().parents[1]
PRIVATE_MATERIALS = ROOT / "data" / "materials"
load_dotenv(ROOT / ".env", override=False)

MAX_AGENT_STEPS = 8
SEARCH_LIMIT = 6


# ---------------------------------------------------------------- configuração

def gemini_api_key() -> str:
    return os.getenv("GEMINI_API_KEY", "").strip()


def gemini_models() -> tuple[str, ...]:
    primary = os.getenv("GEMINI_MODEL", "").strip() or "gemini-4-hydrogen"
    fallback = os.getenv("GEMINI_FALLBACK_MODEL", "").strip() or "gemini-3.8-flash"
    return tuple(dict.fromkeys((primary, fallback)))


# Modelo que entra por último, se o principal e o reserva falharem. Vazio desliga.
def last_resort_model() -> str:
    return os.getenv("GEMINI_LAST_RESORT", "gemini-3.5-flash-lite").strip()


_model_blocked_until: dict[str, float] = {}


def agent_models() -> tuple[str, ...]:
    """Cadeia de modelos do agente, pulando os que bateram limite de uso há pouco."""
    chain = tuple(dict.fromkeys(model for model in (*gemini_models(), last_resort_model()) if model))
    now = time.time()
    ready = tuple(model for model in chain if _model_blocked_until.get(model, 0) <= now)
    return ready or chain


def block_model(model: str, minutes: float = 10) -> None:
    _model_blocked_until[model] = time.time() + minutes * 60


def thinking_level() -> str:
    value = os.getenv("GEMINI_THINKING", "").strip().lower()
    return value if value in {"minimal", "low", "medium", "high"} else "low"


# ---------------------------------------------------------------- erros

class InvalidAnswerError(ValueError):
    pass


@dataclass(frozen=True)
class GenerationFailure:
    code: str
    message: str
    try_fallback: bool


def classify_generation_error(error: Exception) -> GenerationFailure:
    if isinstance(error, genai_errors.APIError):
        status = error.code
        if status == 401:
            return GenerationFailure("invalid_key", "A chave do Gemini foi recusada. Verifique GEMINI_API_KEY no servidor.", False)
        if status == 402:
            return GenerationFailure("billing_required", "O projeto do Gemini está sem créditos. Verifique a cobrança da conta.", False)
        if status == 403:
            return GenerationFailure("access_denied", "A chave não tem acesso ao Gemini. Verifique as permissões do projeto.", False)
        if status == 404:
            return GenerationFailure("model_unavailable", "O modelo configurado não está disponível para esta chave.", True)
        if status == 429:
            return GenerationFailure("rate_limited", "Os modelos atingiram um limite de uso. Aguarde e tente novamente.", True)
        if status in (408, 500, 502, 503, 504) or isinstance(status, int) and status >= 500:
            return GenerationFailure("service_unavailable", "O serviço de modelos está indisponível no momento. Tente novamente.", True)
        if status in (400, 416, 422):
            return GenerationFailure("invalid_request", "O Gemini rejeitou a configuração da consulta. Verifique o modelo configurado.", False)
        return GenerationFailure("model_error", "Não foi possível consultar o Gemini. Tente novamente.", True)
    if isinstance(error, InvalidAnswerError):
        return GenerationFailure("invalid_answer", "O modelo não conseguiu montar uma resposta com fontes válidas. Reformule a pergunta.", True)
    if isinstance(error, (TimeoutError, ConnectionError, OSError)):
        return GenerationFailure("connection_error", "A conexão com o Gemini falhou. Tente novamente.", True)
    return GenerationFailure("model_error", "Não foi possível concluir a consulta ao Gemini. Tente novamente.", True)


# ---------------------------------------------------------------- acervo

@dataclass(frozen=True)
class Evidence:
    id: str
    document_id: str
    title: str
    page: int
    quote: str
    heading: str

    def public(self) -> dict:
        return {
            "kind": "aula",
            "id": self.id,
            "document_id": self.document_id,
            "title": self.title,
            "page": self.page,
            "quote": self.quote,
            "pdf_url": f"/api/materials/{self.document_id}/pdf",
        }


@dataclass(frozen=True)
class PageText:
    document_id: str
    page: int
    heading: str
    text: str


@dataclass(frozen=True)
class Library:
    passages: tuple[Evidence, ...]
    pages: dict[tuple[str, int], PageText]
    documents: tuple[dict, ...]
    by_id: dict[str, Evidence] = field(default_factory=dict)
    quote_terms: dict[str, frozenset[str]] = field(default_factory=dict)
    heading_terms: dict[str, frozenset[str]] = field(default_factory=dict)


# Algumas aulas foram exportadas com fontes que trocam ligaduras e acentos por
# caracteres de outros alfabetos. Corrigimos antes de indexar e de exibir.
GLYPH_FIXES = str.maketrans({"ő": "fi", "Ő": "Fi", "Ą": "fi", "ą": "fl", "Ÿ": "ê", "Ů": "—", "Ű": "–", "Ş": "“", "Ť": "”", "Ð": "—", "ł": "“", "ž": "”", "ś": "—"})


def clean_pdf_text(value: str) -> str:
    return " ".join(value.translate(GLYPH_FIXES).split()).strip(" •")


STOPWORDS = {"qual", "quais", "como", "para", "uma", "uns", "umas", "que", "dos", "das", "com", "sobre", "papel", "aula", "aulas", "isso", "esse", "essa", "este", "esta", "por", "pela", "pelo", "nos", "nas", "the", "and", "sao", "ser", "tem", "mais", "entre", "quando", "onde", "porque", "explique", "explica", "diferenca", "funciona", "serve"}


def stem(word: str) -> str:
    if len(word) > 4 and word.endswith("s"):
        word = word[:-1]
    for suffix in ("coes", "cao", "mente", "idade", "agem", "ismo"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            word = word[: -len(suffix)]
            break
    return word[:7]


def terms(value: str) -> set[str]:
    normalized = unicodedata.normalize("NFKD", value.translate(GLYPH_FIXES).lower())
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return {stem(word) for word in re.findall(r"[a-z0-9]{3,}", normalized) if word not in STOPWORDS}


def material_paths() -> dict[str, Path]:
    paths: dict[str, Path] = {}
    numbered = [(int(match.group()), path) for path in ROOT.glob("Aula *.pdf") if (match := re.search(r"\d+", path.stem))]
    for number, path in sorted(numbered):
        paths[f"aula-{number}"] = path
    if PRIVATE_MATERIALS.exists():
        for path in sorted(PRIVATE_MATERIALS.glob("*.pdf")):
            slug = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", path.stem.lower()).encode("ascii", "ignore").decode()).strip("-")
            paths[slug] = path
    return paths


def document_subject(document: pymupdf.Document) -> str:
    for block in document[0].get_text("blocks", sort=True):
        text = clean_pdf_text(block[4])
        if 12 <= len(text) <= 110 and "Prof." not in text:
            return text
    return ""


@lru_cache(maxsize=2)
def _build_library(signature: tuple[tuple[str, str, int, int], ...]) -> Library:
    passages: list[Evidence] = []
    pages: dict[tuple[str, int], PageText] = {}
    documents: list[dict] = []
    for document_id, path_text, _, _ in signature:
        path = Path(path_text)
        try:
            with pymupdf.open(path) as document:
                subject = document_subject(document)
                title = f"{path.stem} · {subject}" if subject else path.stem
                documents.append({"id": document_id, "title": path.stem, "subject": subject, "pages": document.page_count})
                for page_number, page in enumerate(document, start=1):
                    blocks = page.get_text("blocks", sort=True)
                    heading = clean_pdf_text(blocks[0][4])[:120] if blocks else ""
                    body = [clean_pdf_text(block[4]) for block in blocks if block[4] and "Prof. MSc." not in block[4]]
                    pages[(document_id, page_number)] = PageText(document_id, page_number, heading, "\n".join(line for line in body if line))
                    index = 0
                    for block in blocks:
                        raw = block[4]
                        if not raw or "Prof. MSc." in raw:
                            continue
                        for paragraph in re.split(r"\n\s*•\s*", raw):
                            content = clean_pdf_text(paragraph)
                            for sentence in re.split(r"(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9])", content):
                                sentence = sentence.strip()
                                if len(sentence) < 40 or len(sentence) > 600:
                                    continue
                                passages.append(Evidence(f"{document_id}-p{page_number}-s{index}", document_id, title, page_number, sentence, heading))
                                index += 1
        except Exception:
            continue
    return Library(
        tuple(passages), pages, tuple(documents), {item.id: item for item in passages},
        {item.id: frozenset(terms(item.quote)) for item in passages},
        {item.id: frozenset(terms(item.heading)) for item in passages},
    )


_library_lock = threading.Lock()


def library() -> Library:
    signature = tuple((document_id, str(path), path.stat().st_mtime_ns, path.stat().st_size) for document_id, path in material_paths().items())
    with _library_lock:
        return _build_library(signature)


def evidence_index() -> tuple[Evidence, ...]:
    return library().passages


def search(query: str, document_id: str | None = None, limit: int = SEARCH_LIMIT) -> list[Evidence]:
    wanted = terms(query)
    if not wanted:
        return []
    ranked = []
    lib = library()
    for item in lib.passages:
        if document_id and item.document_id != document_id:
            continue
        item_terms = lib.quote_terms[item.id]
        content = wanted & item_terms
        heading = wanted & lib.heading_terms[item.id]
        if not content and not heading:
            continue
        coverage = len(content | heading) / len(wanted)
        score = 2.4 * len(content) / math.sqrt(max(4, len(item_terms))) + 1.2 * len(heading) / len(wanted) + coverage
        if re.match(r"^\d+\s", item.quote):
            score -= .3
        ranked.append((score, item))
    ranked.sort(key=lambda row: row[0], reverse=True)
    result: list[Evidence] = []
    per_page: dict[tuple[str, int], int] = {}
    for _, item in ranked:
        key = (item.document_id, item.page)
        if per_page.get(key, 0) >= 2:
            continue
        per_page[key] = per_page.get(key, 0) + 1
        result.append(item)
        if len(result) >= limit:
            break
    return result


# Mantido para quem chama a busca simples (modo local e simulados).
def retrieve(question: str, limit: int = 3) -> list[Evidence]:
    return search(question, limit=limit)


def page_passages(document_id: str, page: int) -> list[Evidence]:
    return [item for item in evidence_index() if item.document_id == document_id and item.page == page]


def page_payload(document_id: str, page: int) -> dict:
    lib = library()
    text = lib.pages.get((document_id, page))
    passages = page_passages(document_id, page)
    title = passages[0].title if passages else next((f"{doc['title']} · {doc['subject']}" for doc in lib.documents if doc["id"] == document_id), document_id)
    return {
        "document_id": document_id,
        "title": title,
        "page": page,
        "heading": text.heading if text else "",
        "pdf_url": f"/api/materials/{document_id}/pdf",
        "passages": [item.public() for item in passages],
    }


# ---------------------------------------------------------------- internet

WEB_USER_AGENT = "Aster-estudos/0.2 (ferramenta educacional)"
_google_blocked_until = 0.0


@dataclass(frozen=True)
class WebSource:
    id: str
    title: str
    url: str
    domain: str
    snippet: str
    provider: str

    def public(self) -> dict:
        return {"kind": "web", "id": self.id, "title": self.title, "url": self.url, "domain": self.domain, "snippet": self.snippet, "provider": self.provider}


def _domain(url: str) -> str:
    from urllib.parse import urlparse

    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def _http_json(url: str, timeout: float = 8.0) -> Any:
    from urllib.request import Request, urlopen

    with urlopen(Request(url, headers={"User-Agent": WEB_USER_AGENT, "Accept": "application/json"}), timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def google_web_search(query: str) -> list[dict]:
    """Pesquisa com o Google Search do Gemini e devolve as fontes citadas."""
    from google import genai

    client = genai.Client(api_key=gemini_api_key(), http_options={"retry_options": {"attempts": 1}, "timeout": 25000})
    interaction = client.interactions.create(
        model=agent_models()[0],
        input=f"Pesquise na web e resuma em até 4 frases, em português, informações confiáveis sobre: {query}",
        tools=[{"type": "google_search"}],
        store=False,
        generation_config={"thinking_level": "minimal"},
    )
    found: dict[str, dict] = {}
    for step in interaction.steps or []:
        if step.type != "model_output":
            continue
        for content in getattr(step, "content", None) or []:
            text = getattr(content, "text", "") or ""
            for annotation in getattr(content, "annotations", None) or []:
                if getattr(annotation, "type", "") != "url_citation" or not getattr(annotation, "url", None):
                    continue
                url = annotation.url
                title = getattr(annotation, "title", None) or _domain(url)
                start, end = getattr(annotation, "start_index", None), getattr(annotation, "end_index", None)
                snippet = text[start:end].strip() if isinstance(start, int) and isinstance(end, int) else ""
                entry = found.setdefault(url, {"title": title, "url": url, "domain": title if "." in title and " " not in title else _domain(url), "snippet": ""})
                if snippet and len(entry["snippet"]) < 400:
                    entry["snippet"] = (entry["snippet"] + " " + snippet).strip()
    return list(found.values())[:4]


def wikipedia_search(query: str, language: str = "pt") -> list[dict]:
    from urllib.parse import quote

    data = _http_json(f"https://{language}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=3&srsearch={quote(query)}")
    results = []
    for item in data.get("query", {}).get("search", [])[:3]:
        title = item.get("title", "")
        try:
            summary = _http_json(f"https://{language}.wikipedia.org/api/rest_v1/page/summary/{quote(title.replace(' ', '_'))}")
        except Exception:
            continue
        extract = " ".join(str(summary.get("extract", "")).split())
        url = summary.get("content_urls", {}).get("desktop", {}).get("page") or f"https://{language}.wikipedia.org/wiki/{quote(title.replace(' ', '_'))}"
        if extract:
            results.append({"title": f"{title} — Wikipédia", "url": url, "domain": f"{language}.wikipedia.org", "snippet": extract[:600]})
    return results


def web_search(query: str) -> tuple[str, list[dict]]:
    global _google_blocked_until
    if gemini_api_key() and time.time() >= _google_blocked_until and os.getenv("ASTER_WEB_GOOGLE", "1") != "0":
        try:
            results = google_web_search(query)
            if results:
                return "google", results
        except Exception as error:
            if isinstance(error, genai_errors.APIError) and error.code in (403, 429) or "429" in str(error):
                _google_blocked_until = time.time() + 15 * 60
    try:
        results = wikipedia_search(query, "pt") or wikipedia_search(query, "en")
        return "wikipedia", results
    except Exception:
        return "wikipedia", []


# ---------------------------------------------------------------- agente

SYSTEM_INSTRUCTION = """Você é o Aster, um agente de estudos simpático da disciplina de Inteligência Artificial do professor Daniel Cavalcante (SENAC). Seu mascote é uma florzinha verde. Você ajuda alunos a entender a matéria, pesquisando nas aulas e na internet, e mostra de onde tirou cada informação.

Como agir, conforme a mensagem:
- Conversa (cumprimento, agradecimento, "quem é você?", "o que você faz?", pedido de dica de estudo): chame conversar e responda de forma breve e calorosa, sem pesquisar.
- Dúvida sobre a matéria: comece pelas aulas. Use buscar_nas_aulas com termos técnicos que provavelmente aparecem nos slides; se vier pouco, reformule com sinônimos ou siglas, ou restrinja a uma aula. Abra a página mais promissora com ler_pagina antes de citar. Depois, se ajudar, complemente com pesquisar_na_web (um exemplo atual, uma explicação mais clara, um contexto que o slide não traz).
- Assunto que não está nas aulas (outro tema de tecnologia, curiosidade, notícia, algo da faculdade): pesquise rapidamente nas aulas para conferir e, se não houver nada, use pesquisar_na_web e responda com base nas fontes da web, deixando claro no texto que isso vai além do material da disciplina.
- sem_base: só quando nem as aulas nem a web sustentarem uma resposta, ou o pedido for inadequado.

Ao chamar responder: escreva em português claro, como um bom monitor explicaria a um colega, em 1 a 3 blocos curtos. Cada bloco cita os ids que o sustentam (trechos das aulas ou web-N), somente ids que você recebeu das ferramentas nesta conversa. Quando misturar fontes, deixe explícito o que vem de fora das aulas (por exemplo, "Fora das aulas, ..."). Não invente fatos.

Seja eficiente: normalmente 1 a 2 buscas nas aulas, 1 leitura de página e 1 pesquisa na web bastam. Pense em português.

Aulas disponíveis:
{catalog}"""

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "buscar_nas_aulas",
        "description": "Busca por palavras-chave nos trechos dos slides das aulas. Retorna até 6 trechos com id, aula, página e texto.",
        "parameters": {
            "type": "object",
            "properties": {
                "intencao": {"type": "string", "description": "Uma frase curta em português, em primeira pessoa, dizendo ao aluno por que você está fazendo isso. Ex.: Vou procurar onde a Aula 6 define embeddings."},
                "consulta": {"type": "string", "description": "Termos de busca, de preferência como aparecem nos slides."},
                "aula": {"type": "string", "description": "Opcional. Id da aula para restringir a busca, por exemplo aula-6."},
            },
            "required": ["consulta", "intencao"],
        },
    },
    {
        "type": "function",
        "name": "ler_pagina",
        "description": "Abre uma página de uma aula e devolve o texto completo e os ids dos trechos citáveis dessa página.",
        "parameters": {
            "type": "object",
            "properties": {
                "intencao": {"type": "string", "description": "Uma frase curta em português, em primeira pessoa, dizendo ao aluno por que você está fazendo isso. Ex.: Vou procurar onde a Aula 6 define embeddings."},
                "aula": {"type": "string", "description": "Id da aula, por exemplo aula-6."},
                "pagina": {"type": "integer", "description": "Número da página no PDF."},
            },
            "required": ["aula", "pagina", "intencao"],
        },
    },
    {
        "type": "function",
        "name": "pesquisar_na_web",
        "description": "Pesquisa na internet para complementar as aulas. Retorna fontes com id web-N, título, site, link e trecho.",
        "parameters": {
            "type": "object",
            "properties": {
                "intencao": {"type": "string", "description": "Uma frase curta em português, em primeira pessoa, dizendo ao aluno por que você está fazendo isso. Ex.: Vou procurar onde a Aula 6 define embeddings."},"consulta": {"type": "string", "description": "O que pesquisar, em poucas palavras."}},
            "required": ["consulta", "intencao"],
        },
    },
    {
        "type": "function",
        "name": "responder",
        "description": "Entrega a resposta final ao aluno, com citações.",
        "parameters": {
            "type": "object",
            "properties": {
                "blocos": {
                    "type": "array",
                    "description": "De 1 a 3 blocos curtos.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "texto": {"type": "string"},
                            "citacoes": {"type": "array", "items": {"type": "string"}, "description": "Ids dos trechos que sustentam o bloco."},
                        },
                        "required": ["texto", "citacoes"],
                    },
                },
            },
            "required": ["blocos"],
        },
    },
    {
        "type": "function",
        "name": "conversar",
        "description": "Responde diretamente, sem pesquisa, a cumprimentos, perguntas sobre o próprio Aster e conversas rápidas.",
        "parameters": {"type": "object", "properties": {"texto": {"type": "string", "description": "Resposta curta e simpática, em português."}}, "required": ["texto"]},
    },
    {
        "type": "function",
        "name": "sem_base",
        "description": "Informa que nem as aulas nem a web sustentam uma resposta.",
        "parameters": {"type": "object", "properties": {"motivo": {"type": "string"}}, "required": ["motivo"]},
    },
]


def catalog_text() -> str:
    return "\n".join(f"- {doc['id']}: {doc['subject'] or doc['title']} ({doc['pages']} páginas)" for doc in library().documents)


class AnswerBlock(BaseModel):
    text: str
    citation_ids: list[str]


class GeneratedAnswer(BaseModel):
    blocks: list[AnswerBlock]


def validate_answer(answer: GeneratedAnswer, allowed_ids: set[str] | list[Evidence]) -> None:
    allowed = {item.id for item in allowed_ids} if isinstance(allowed_ids, list) else set(allowed_ids)
    if not 1 <= len(answer.blocks) <= 3 or sum(len(block.text) for block in answer.blocks) > 1800:
        raise InvalidAnswerError("A resposta precisa ter de 1 a 3 blocos e no máximo 1800 caracteres.")
    for block in answer.blocks:
        if not 1 <= len(block.text.strip()) <= 900:
            raise InvalidAnswerError("Há um bloco vazio ou longo demais.")
        if not block.citation_ids:
            raise InvalidAnswerError("Todo bloco precisa citar pelo menos um trecho.")
        if len(set(block.citation_ids)) != len(block.citation_ids):
            raise InvalidAnswerError("Um bloco repete a mesma citação.")
        unknown = [citation for citation in block.citation_ids if citation not in allowed]
        if unknown:
            raise InvalidAnswerError(f"Os ids {', '.join(unknown[:3])} não vieram das ferramentas nesta consulta.")


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


def call_model(model: str, history: list[dict], force_final: bool = False) -> ModelTurn:
    from google import genai

    client = genai.Client(api_key=gemini_api_key(), http_options={"retry_options": {"attempts": 1}})
    tool_choice: Any = {"allowed_tools": {"mode": "any", "tools": ["responder", "conversar", "sem_base"]}} if force_final else "any"
    interaction = client.interactions.create(
        model=model,
        input=history,
        tools=TOOLS,
        system_instruction=SYSTEM_INSTRUCTION.format(catalog=catalog_text()),
        store=False,
        timeout=25.0,
        generation_config={"tool_choice": tool_choice, "thinking_level": thinking_level(), "thinking_summaries": "auto"},
    )
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
    return ModelTurn(thoughts, calls, interaction.output_text or "", raw)


def tool_result(call: ToolCall, payload: dict) -> dict:
    return {"type": "function_result", "name": call.name, "call_id": call.id, "result": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}]}


def clean_thought(text: str) -> str:
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text).strip()
    return text[:700]


class ConversationTurn(BaseModel):
    question: str = Field(max_length=500)
    answer: str = Field(max_length=2000)


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=500)
    context: list[ConversationTurn] = Field(default_factory=list, max_length=3)

    @field_validator("question")
    @classmethod
    def clean_question(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("A pergunta precisa ter pelo menos 3 caracteres.")
        return value


def user_prompt(request: AskRequest) -> str:
    if not request.context:
        return request.question
    previous = "\n".join(f"Aluno: {turn.question}\nAster: {turn.answer}" for turn in request.context)
    return f"Conversa anterior (apenas contexto):\n{previous}\n\nNova pergunta do aluno: {request.question}"


class Agent:
    """Executa as ferramentas pedidas pelo modelo e registra o que foi visto."""

    def __init__(self) -> None:
        self.seen: dict[str, Evidence | WebSource] = {}
        self.pages_read: set[tuple[str, int]] = set()
        self.web_count = 0

    def run_tool(self, call: ToolCall) -> tuple[dict, list[tuple[str, dict]]]:
        """Devolve (resultado para o modelo, eventos para a interface)."""
        args = call.arguments
        if call.name == "buscar_nas_aulas":
            query = str(args.get("consulta", "")).strip()[:200]
            document_id = str(args.get("aula") or "").strip() or None
            if document_id and document_id not in material_paths():
                document_id = None
            hits = search(query, document_id)
            for item in hits:
                self.seen[item.id] = item
            payload = {"trechos": [{"id": item.id, "aula": item.document_id, "pagina": item.page, "titulo_slide": item.heading, "texto": item.quote} for item in hits]}
            if not hits:
                payload["aviso"] = "Nenhum trecho encontrado. Tente outros termos."
            return payload, [("search_results", {"call_id": call.id, "query": query, "document_id": document_id, "hits": [item.public() for item in hits]})]
        if call.name == "ler_pagina":
            document_id = str(args.get("aula", "")).strip()
            try:
                page = int(args.get("pagina", 0))
            except (TypeError, ValueError):
                page = 0
            text = library().pages.get((document_id, page))
            if text is None:
                return {"erro": "Página inexistente. Confira o id da aula e o número da página."}, [("tool_error", {"call_id": call.id, "message": "Página inexistente"})]
            passages = page_passages(document_id, page)
            for item in passages:
                self.seen[item.id] = item
            self.pages_read.add((document_id, page))
            payload = {"aula": document_id, "pagina": page, "titulo_slide": text.heading, "texto_completo": text.text[:3500], "trechos_citaveis": [{"id": item.id, "texto": item.quote} for item in passages]}
            return payload, [("page_read", {"call_id": call.id, **page_payload(document_id, page)})]
        if call.name == "pesquisar_na_web":
            query = str(args.get("consulta", "")).strip()[:200]
            provider, results = web_search(query)
            sources: list[WebSource] = []
            for item in results:
                self.web_count += 1
                source = WebSource(f"web-{self.web_count}", item["title"][:160], item["url"], item["domain"], item["snippet"][:600], provider)
                self.seen[source.id] = source
                sources.append(source)
            payload = {"fontes": [{"id": source.id, "titulo": source.title, "site": source.domain, "trecho": source.snippet} for source in sources]}
            if not sources:
                payload["aviso"] = "A pesquisa na web não trouxe resultados. Responda com as aulas."
            return payload, [("web_results", {"call_id": call.id, "query": query, "provider": provider, "results": [source.public() for source in sources]})]
        return {"erro": f"Ferramenta desconhecida: {call.name}"}, []


async def run_agent(request: AskRequest, emit) -> AsyncIterator[str]:
    models = agent_models()
    primary = gemini_models()[0]
    for model_index, model in enumerate(models):
        if model_index:
            yield emit("model_fallback", {"model": model, "message": "O modelo anterior falhou. O Aster recomeçou com o reserva."})
        elif model != primary:
            yield emit("model_fallback", {"model": model, "message": "O modelo principal está sem cota no momento. O Aster está usando o reserva."})
        agent = Agent()
        history: list[dict] = [{"type": "user_input", "content": [{"type": "text", "text": user_prompt(request)}]}]
        corrections = 0
        failure: GenerationFailure | None = None
        for step in range(MAX_AGENT_STEPS):
            force_final = step == MAX_AGENT_STEPS - 1
            yield emit("agent_thinking", {"step": step + 1, "model": model})
            try:
                turn = await asyncio.to_thread(call_model, model, history, force_final)
            except Exception as error:
                failure = classify_generation_error(error)
                # modelo sem cota, fora do ar ou lento demais: pula nas próximas perguntas
                if failure.try_fallback and failure.code != "invalid_answer":
                    block_model(model)
                break
            for thought in turn.thoughts:
                yield emit("agent_thought", {"text": clean_thought(thought)})
            history.extend(turn.raw_steps)
            if not turn.calls:
                history.append({"type": "user_input", "content": [{"type": "text", "text": "Use uma das ferramentas. Para terminar, chame responder ou sem_base."}]})
                continue
            results: list[dict] = []
            for call in turn.calls:
                yield emit("tool_call", {"call_id": call.id, "tool": call.name, "args": {key: value for key, value in call.arguments.items() if key != "blocos"}})
                if call.name == "responder":
                    try:
                        raw_blocks = call.arguments.get("blocos") or []
                        answer = GeneratedAnswer(blocks=[AnswerBlock(text=str(block.get("texto", "")).strip(), citation_ids=[str(item) for item in block.get("citacoes", [])]) for block in raw_blocks if isinstance(block, dict)])
                        validate_answer(answer, set(agent.seen))
                    except InvalidAnswerError as problem:
                        corrections += 1
                        yield emit("answer_check", {"call_id": call.id, "ok": False, "message": str(problem)})
                        if corrections > 2:
                            failure = classify_generation_error(problem)
                            break
                        results.append(tool_result(call, {"erro": f"Resposta recusada pela verificação: {problem} Corrija e chame responder de novo."}))
                        continue
                    cited_ids = list(dict.fromkeys(citation for block in answer.blocks for citation in block.citation_ids))
                    yield emit("answer_check", {"call_id": call.id, "ok": True, "message": f"{len(cited_ids)} citações conferidas no acervo"})
                    yield emit("answer_ready", {
                        "blocks": [block.model_dump() for block in answer.blocks],
                        "sources": [agent.seen[citation].public() for citation in cited_ids],
                        "mode": "gemini",
                        "model": model,
                        "used_fallback": model != primary,
                        "steps": step + 1,
                    })
                    return
                if call.name == "conversar":
                    text = str(call.arguments.get("texto", "")).strip()[:900]
                    if text:
                        yield emit("answer_ready", {"blocks": [{"text": text, "citation_ids": []}], "sources": [], "mode": "gemini", "model": model, "used_fallback": model != primary, "steps": step + 1, "kind": "chat"})
                        return
                    results.append(tool_result(call, {"erro": "Texto vazio."}))
                    continue
                if call.name == "sem_base":
                    reason = str(call.arguments.get("motivo", "")).strip()[:300]
                    yield emit("insufficient_evidence", {"message": "Não encontrei base para responder nas aulas disponíveis.", "reason": reason})
                    return
                payload, events = await asyncio.to_thread(agent.run_tool, call)
                for kind, data in events:
                    yield emit(kind, data)
                results.append(tool_result(call, payload))
            if failure:
                break
            history.extend(results)
        else:
            failure = GenerationFailure("too_many_steps", "O Aster não conseguiu concluir a pesquisa a tempo. Tente uma pergunta mais direta.", True)
        if failure and (not failure.try_fallback or model_index + 1 >= len(models)):
            yield emit("run_failed", {"code": failure.code, "message": failure.message})
            return


async def run_local(request: AskRequest, emit) -> AsyncIterator[str]:
    """Sem chave: o mesmo caminho de ferramentas, executado por regra fixa e sem IA."""
    agent = Agent()
    yield emit("agent_thinking", {"step": 1, "model": None})
    search_call = ToolCall("local-1", "buscar_nas_aulas", {"consulta": request.question})
    yield emit("tool_call", {"call_id": search_call.id, "tool": search_call.name, "args": search_call.arguments})
    payload, events = await asyncio.to_thread(agent.run_tool, search_call)
    for kind, data in events:
        yield emit(kind, data)
    hits = [agent.seen[item["id"]] for item in payload.get("trechos", [])]
    if not hits:
        yield emit("insufficient_evidence", {"message": "Não encontrei base para responder nas aulas disponíveis."})
        return
    top = hits[0]
    read_call = ToolCall("local-2", "ler_pagina", {"aula": top.document_id, "pagina": top.page})
    yield emit("tool_call", {"call_id": read_call.id, "tool": read_call.name, "args": read_call.arguments})
    _, events = await asyncio.to_thread(agent.run_tool, read_call)
    for kind, data in events:
        yield emit(kind, data)
    answer = GeneratedAnswer(blocks=[AnswerBlock(text=item.quote, citation_ids=[item.id]) for item in hits[:2]])
    validate_answer(answer, set(agent.seen))
    yield emit("answer_check", {"call_id": "local-3", "ok": True, "message": "Trechos copiados das aulas, sem redação de IA"})
    yield emit("answer_ready", {"blocks": [block.model_dump() for block in answer.blocks], "sources": [item.public() for item in hits[:2]], "mode": "local", "model": None, "used_fallback": False, "steps": 2})


# ---------------------------------------------------------------- rotas

app = FastAPI(title="Aster API")


@app.on_event("startup")
def warm_library() -> None:
    # Ler os PDFs leva alguns segundos; fazemos isso antes da primeira pergunta.
    threading.Thread(target=library, name="aster-index", daemon=True).start()


@app.get("/api/health")
def health():
    lib = library()
    return {"status": "ok", "mode": "gemini" if gemini_api_key() else "local", "materials": len(lib.documents), "passages": len(lib.passages), "pages": len(lib.pages), "model": agent_models()[0] if gemini_api_key() else None}


@app.get("/api/materials")
def list_materials():
    return list(library().documents)


@app.get("/api/materials/{document_id}/pdf")
def get_pdf(document_id: str):
    path = material_paths().get(document_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Material não encontrado")
    return FileResponse(path, media_type="application/pdf", filename=path.name, content_disposition_type="inline")


@app.get("/api/materials/{document_id}/pages/{page}")
def get_page(document_id: str, page: int, query: str = ""):
    if (document_id, page) not in library().pages:
        raise HTTPException(status_code=404, detail="Página não encontrada")
    payload = page_payload(document_id, page)
    wanted = terms(query)
    payload["passages"].sort(key=lambda entry: len(wanted & terms(entry["quote"])), reverse=True)
    return payload


async def with_heartbeat(source: AsyncIterator[str], interval: float = 6.0) -> AsyncIterator[str]:
    """Envia um comentário SSE enquanto o modelo pensa, para proxies não fecharem a conexão."""
    iterator = source.__aiter__()
    pending = asyncio.ensure_future(iterator.__anext__())
    try:
        while True:
            done, _ = await asyncio.wait({pending}, timeout=interval)
            if not done:
                yield ": ping\n\n"
                continue
            try:
                chunk = pending.result()
            except StopAsyncIteration:
                return
            yield chunk
            pending = asyncio.ensure_future(iterator.__anext__())
    finally:
        pending.cancel()


@app.post("/api/tutor/runs")
async def run_tutor(request: AskRequest):
    run_id = str(uuid4())
    started = time.perf_counter()

    async def events():
        seq = 0

        def emit(kind: str, data: dict | None = None) -> str:
            nonlocal seq
            seq += 1
            elapsed = round((time.perf_counter() - started) * 1000)
            return f"data: {json.dumps({'run_id': run_id, 'seq': seq, 't': elapsed, 'type': kind, 'data': data or {}}, ensure_ascii=False)}\n\n"

        mode = "gemini" if gemini_api_key() else "local"
        yield emit("run_started", {"question": request.question, "mode": mode, "model": gemini_models()[0] if mode == "gemini" else None})
        if not material_paths():
            yield emit("run_failed", {"code": "no_materials", "message": "Nenhuma aula foi encontrada no acervo."})
            return
        runner = run_agent(request, emit) if mode == "gemini" else run_local(request, emit)
        try:
            async for chunk in runner:
                yield chunk
        except Exception:
            yield emit("run_failed", {"code": "internal_error", "message": "Algo falhou ao processar a pergunta. Tente novamente."})

    return StreamingResponse(with_heartbeat(events()), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
