"""Administração pelo navegador: senha de administrador, sessão, chaves cifradas e configurações.

Tudo o que antes vinha do .env pode ser definido aqui. O .env continua aceito como reserva, mas não é necessário.

Como fica seguro num deploy público:
- só o administrador (com senha) vê e muda chaves, fila de modelos e limites;
- na primeira vez, criar a senha exige o código de uso único impresso no terminal da API (e gravado em
  data/codigo-de-configuracao.txt). Não existe modo "local sem senha": atrás do Next, um visitante consegue
  forjar o X-Forwarded-For e se passar por 127.0.0.1;
- a senha é guardada com scrypt; a sessão é um cookie HttpOnly e SameSite=Strict, com o hash guardado no servidor;
- pedidos que mudam algo exigem um cabeçalho próprio e origem igual à do site (proteção contra CSRF);
- tentativas de login são limitadas por IP;
- as chaves de IA ficam cifradas em disco (Fernet), com a chave de cifra num arquivo separado.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from api import security
from api.providers import load_settings, save_settings, settings_path

router = APIRouter(prefix="/api/admin")

COOKIE = "aster_admin"
SESSION_HOURS = 12
HEADER = "x-aster-admin"
MIN_PASSWORD = 10

# ---------------------------------------------------------------- configurações editáveis pelo navegador

# nome: (tipo, padrão, mínimo, máximo, variável de ambiente aceita como reserva, rótulo)
CONFIG: dict[str, tuple[str, Any, Any, Any, str | None, str]] = {
    "perguntas_por_minuto": ("int", 12, 0, 120, "ASTER_PERGUNTAS_POR_MINUTO", "Perguntas por minuto, por visitante (0 desliga)"),
    "perguntas_por_dia": ("int", 80, 0, 5000, "ASTER_PERGUNTAS_POR_DIA", "Perguntas por dia, por visitante (0 desliga)"),
    "perguntas_por_dia_total": ("int", 1500, 0, 100000, "ASTER_PERGUNTAS_POR_DIA_TOTAL", "Perguntas por dia, somando todos (0 desliga)"),
    "tempo_maximo": ("int", 90, 20, 300, "ASTER_TEMPO_MAXIMO", "Tempo máximo de uma pergunta, em segundos"),
    "raciocinio": ("choice", "low", ("minimal", "low", "medium", "high"), None, "GEMINI_THINKING", "Nível de raciocínio do modelo"),
    "web_google": ("bool", True, None, None, "ASTER_WEB_GOOGLE", "Pesquisa pelo Google do Gemini"),
    "web_duckduckgo": ("bool", True, None, None, "ASTER_WEB_DUCKDUCKGO", "Pesquisa pelo DuckDuckGo"),
}


def _coerce(name: str, value: Any) -> Any:
    kind, default, low, high, _env, _label = CONFIG[name]
    try:
        if kind == "int":
            number = int(float(value))
            return max(low, min(high, number))
        if kind == "bool":
            return value if isinstance(value, bool) else str(value).strip().lower() not in ("0", "false", "nao", "não", "off", "")
        if kind == "choice":
            text = str(value).strip().lower()
            return text if text in low else default
    except (TypeError, ValueError):
        pass
    return default


def config(name: str) -> Any:
    """Valor de uma configuração: o salvo pelo painel, depois a variável de ambiente, depois o padrão."""
    saved = load_settings().get("config", {})
    if isinstance(saved, dict) and name in saved:
        return _coerce(name, saved[name])
    env = CONFIG[name][4]
    if env and os.getenv(env, "").strip():
        return _coerce(name, os.getenv(env, "").strip())
    return CONFIG[name][1]


def config_view() -> list[dict]:
    saved = load_settings().get("config", {}) or {}
    rows = []
    for name, (kind, default, low, high, env, label) in CONFIG.items():
        source = "painel" if name in saved else ("env" if env and os.getenv(env, "").strip() else "padrão")
        row = {"name": name, "kind": kind, "label": label, "value": config(name), "default": default, "source": source}
        if kind == "int":
            row.update({"min": low, "max": high})
        if kind == "choice":
            row["options"] = list(low)
        rows.append(row)
    return rows


# ---------------------------------------------------------------- chaves de IA cifradas em disco

_cipher_lock = threading.Lock()


def _secret_path() -> Path:
    return settings_path().with_name("secret.key")


def _cipher() -> Fernet:
    """A chave de cifra vem de ASTER_SECRET (se o servidor quiser) ou de um arquivo criado na primeira vez."""
    env = os.getenv("ASTER_SECRET", "").strip()
    if env:
        return Fernet(base64.urlsafe_b64encode(hashlib.sha256(env.encode()).digest()))
    path = _secret_path()
    with _cipher_lock:
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(Fernet.generate_key())
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
        return Fernet(path.read_bytes().strip())


def seal(value: str) -> str:
    return "enc:" + _cipher().encrypt(value.encode()).decode()


def unseal(value: str) -> str:
    if not value.startswith("enc:"):
        return value  # chave antiga, salva antes da cifra; é cifrada na próxima gravação
    try:
        return _cipher().decrypt(value[4:].encode()).decode()
    except (InvalidToken, ValueError):
        return ""


def stored_key(provider: str) -> str:
    return unseal(str((load_settings().get("keys") or {}).get(provider, "")).strip())


def store_key(provider: str, key: str | None) -> None:
    data = load_settings()
    keys = data.setdefault("keys", {})
    if key:
        keys[provider] = seal(key)
    else:
        keys.pop(provider, None)
    save_settings(data)


def migrate_plain_keys() -> int:
    """Cifra chaves que ficaram em texto puro de versões anteriores."""
    data = load_settings()
    keys = data.get("keys") or {}
    plain = [provider for provider, value in keys.items() if isinstance(value, str) and value and not value.startswith("enc:")]
    for provider in plain:
        keys[provider] = seal(keys[provider])
    if plain:
        save_settings(data)
    return len(plain)


# ---------------------------------------------------------------- senha e sessão

def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32).hex()


def has_admin() -> bool:
    admin = load_settings().get("admin") or {}
    return bool(admin.get("hash") and admin.get("salt"))


def _check_password(password: str) -> bool:
    admin = load_settings().get("admin") or {}
    if not admin.get("hash"):
        return False
    expected = admin["hash"]
    return hmac.compare_digest(_hash_password(password, bytes.fromhex(admin["salt"])), expected)


def _set_password(password: str) -> None:
    salt = secrets.token_bytes(16)
    data = load_settings()
    data["admin"] = {"salt": salt.hex(), "hash": _hash_password(password, salt), "updated": int(time.time())}
    # trocar a senha encerra todas as sessões abertas
    data["sessions"] = {}
    save_settings(data)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _new_session() -> str:
    token = secrets.token_urlsafe(32)
    data = load_settings()
    now = time.time()
    sessions = {key: until for key, until in (data.get("sessions") or {}).items() if float(until) > now}
    sessions[_token_hash(token)] = now + SESSION_HOURS * 3600
    data["sessions"] = sessions
    save_settings(data)
    return token


def _end_session(token: str) -> None:
    data = load_settings()
    sessions = data.get("sessions") or {}
    if sessions.pop(_token_hash(token), None) is not None:
        data["sessions"] = sessions
        save_settings(data)


def session_valid(request: Request) -> bool:
    token = request.cookies.get(COOKIE, "")
    if not token:
        return False
    until = (load_settings().get("sessions") or {}).get(_token_hash(token))
    return bool(until) and float(until) > time.time()


def _is_https(request: Request) -> bool:
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"


def _set_cookie(response: Response, request: Request, token: str | None) -> None:
    if token is None:
        response.delete_cookie(COOKIE, path="/")
        return
    response.set_cookie(COOKIE, token, max_age=SESSION_HOURS * 3600, httponly=True, samesite="strict", secure=_is_https(request), path="/")


def _same_origin(request: Request) -> bool:
    """Navegadores mandam Origin em pedidos que mudam algo; ele precisa ser o próprio site."""
    origin = request.headers.get("origin")
    if not origin:
        return True
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    return origin.split("://", 1)[-1].rstrip("/") == host.split(",")[0].strip()


def require_admin(request: Request) -> None:
    """Administrador logado. Sem senha criada ainda, ninguém configura nada: primeiro a senha."""
    if request.method not in ("GET", "HEAD") and (request.headers.get(HEADER) != "1" or not _same_origin(request)):
        raise HTTPException(status_code=403, detail={"code": "csrf", "message": "Pedido recusado: ele não veio do painel do Aster."})
    if not has_admin():
        raise HTTPException(status_code=401, detail={"code": "setup_required", "message": "Crie a senha de administrador antes de configurar o Aster."})
    if not session_valid(request):
        raise HTTPException(status_code=401, detail={"code": "login_required", "message": "Entre com a senha de administrador para mudar isso."})


# ---------------------------------------------------------------- código de configuração inicial

_setup_code: str | None = None


def _code_file() -> Path:
    return settings_path().with_name("codigo-de-configuracao.txt")


def setup_code() -> str | None:
    """Sem senha criada, um código de uso único prova que quem cria a senha tem acesso ao servidor.
    Ele aparece no terminal da API e num arquivo dentro de data/, que é apagado quando a senha é criada."""
    global _setup_code
    if has_admin():
        _setup_code = None
        try:
            _code_file().unlink(missing_ok=True)
        except OSError:
            pass
        return None
    if not _setup_code:
        _setup_code = "-".join(secrets.token_hex(2).upper() for _ in range(3))
        print(f"[aster] Nenhuma senha de administrador. Código para criar a senha pelo navegador: {_setup_code}")
        try:
            _code_file().parent.mkdir(parents=True, exist_ok=True)
            _code_file().write_text(f"{_setup_code}\n", encoding="utf-8")
        except OSError:
            pass
    return _setup_code


# ---------------------------------------------------------------- rotas

login_limiter = security.RateLimiter(5, window=15 * 60)


class LoginBody(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class SetupBody(BaseModel):
    password: str = Field(min_length=MIN_PASSWORD, max_length=200)
    code: str = Field(default="", max_length=40)


class PasswordBody(BaseModel):
    current: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=MIN_PASSWORD, max_length=200)


class ConfigBody(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)


def _guard_change(request: Request) -> None:
    if request.headers.get(HEADER) != "1" or not _same_origin(request):
        raise HTTPException(status_code=403, detail={"code": "csrf", "message": "Pedido recusado: ele não veio do painel do Aster."})


def _limit_login(request: Request) -> None:
    wait = login_limiter.check(security.client_ip(request))
    if wait is not None:
        raise HTTPException(status_code=429, detail={"code": "too_many_attempts", "message": f"Muitas tentativas. Espere {max(1, wait // 60)} min e tente de novo."}, headers={"Retry-After": str(wait)})


def _strong(password: str) -> None:
    if len(set(password)) < 5 or password.lower() in ("aster12345", "senha12345", "1234567890", "administrador"):
        raise HTTPException(status_code=400, detail={"code": "weak_password", "message": "Senha fraca demais. Use uma frase ou misture letras, números e símbolos."})


@router.get("/status")
def status(request: Request):
    configured = has_admin()
    if not configured:
        setup_code()
    return {"configured": configured, "logged_in": configured and session_valid(request), "needs_code": not configured}


@router.post("/setup")
def setup(body: SetupBody, request: Request, response: Response):
    _guard_change(request)
    _limit_login(request)
    if has_admin():
        raise HTTPException(status_code=409, detail={"code": "already_configured", "message": "A senha de administrador já existe. Entre com ela."})
    code = setup_code() or ""
    if not hmac.compare_digest(body.code.strip().upper(), code):
        raise HTTPException(status_code=403, detail={"code": "bad_setup_code", "message": "Código de configuração errado. Ele aparece no terminal da API e em data/codigo-de-configuracao.txt."})
    _strong(body.password)
    _set_password(body.password)
    migrate_plain_keys()
    setup_code()  # apaga o código usado
    _set_cookie(response, request, _new_session())
    return {"ok": True}


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response):
    _guard_change(request)
    _limit_login(request)
    if not has_admin() or not _check_password(body.password):
        time.sleep(0.4)  # resposta igual e lenta para senha errada
        raise HTTPException(status_code=401, detail={"code": "bad_password", "message": "Senha incorreta."})
    _set_cookie(response, request, _new_session())
    return {"ok": True}


@router.post("/logout")
def logout(request: Request, response: Response):
    _guard_change(request)
    token = request.cookies.get(COOKIE, "")
    if token:
        _end_session(token)
    _set_cookie(response, request, None)
    return {"ok": True}


@router.post("/password")
def change_password(body: PasswordBody, request: Request, response: Response):
    require_admin(request)
    _limit_login(request)
    if not _check_password(body.current):
        raise HTTPException(status_code=401, detail={"code": "bad_password", "message": "A senha atual está errada."})
    _strong(body.password)
    _set_password(body.password)
    _set_cookie(response, request, _new_session())
    return {"ok": True}


@router.get("/config")
def get_config(request: Request):
    require_admin(request)
    return {"config": config_view()}


@router.put("/config")
def put_config(body: ConfigBody, request: Request):
    require_admin(request)
    data = load_settings()
    saved = data.get("config") or {}
    for name, value in body.values.items():
        if name not in CONFIG:
            continue
        if value is None:
            saved.pop(name, None)
        else:
            saved[name] = _coerce(name, value)
    data["config"] = saved
    save_settings(data)
    security.apply_limits()
    return {"config": config_view()}
