"""Proteções da API: limite de perguntas por IP, tamanho da requisição, dados pessoais e erros legíveis."""

from __future__ import annotations

import os
import re
import threading
import time
from collections import deque

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

MAX_BODY_BYTES = 64 * 1024
LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}


def client_ip(request: Request) -> str:
    """IP de quem perguntou.
    Só confia no X-Forwarded-For quando quem repassa é o próprio servidor (o Next na mesma máquina), e usa a
    última entrada: é a que o proxy acrescentou. As anteriores vêm do visitante e podem ser inventadas."""
    direct = request.client.host if request.client else "desconhecido"
    if direct in LOOPBACK or direct.startswith("127.") or direct.startswith("::ffff:127."):
        hops = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
        if hops:
            return hops[-1]
    return direct


class RateLimiter:
    """Janela deslizante por chave (normalmente o IP)."""

    def __init__(self, limit: int, window: float = 60) -> None:
        self.limit = limit
        self.window = window
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    # nome antigo, mantido para quem ajusta o limite por minuto
    @property
    def per_minute(self) -> int:
        return self.limit

    @per_minute.setter
    def per_minute(self, value: int) -> None:
        self.limit = value

    def check(self, key: str) -> int | None:
        """Registra a chamada; devolve em quantos segundos libera quando passou do limite."""
        if self.limit <= 0:
            return None
        now = time.monotonic()
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] >= self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return max(1, int(self.window - (now - hits[0])) + 1)
            hits.append(now)
            # não deixa a tabela crescer sem fim com IPs que já sumiram
            if len(self._hits) > 5000:
                for stale in [ip for ip, values in self._hits.items() if not values or now - values[-1] >= self.window][:2500]:
                    self._hits.pop(stale, None)
            return None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


ask_limiter = RateLimiter(int(os.getenv("ASTER_PERGUNTAS_POR_MINUTO", "12")))
day_limiter = RateLimiter(80, window=24 * 3600)
total_limiter = RateLimiter(1500, window=24 * 3600)


def apply_limits() -> None:
    """Lê os limites do painel do administrador (ou do .env, ou o padrão)."""
    from api.admin import config  # importa aqui: admin também usa este módulo

    ask_limiter.limit = config("perguntas_por_minuto")
    day_limiter.limit = config("perguntas_por_dia")
    total_limiter.limit = config("perguntas_por_dia_total")


def limit_questions(request: Request) -> None:
    """Cada pergunta (e cada prova) gasta a chave de IA do dono do site: limites por minuto, por dia e no total."""
    ip = client_ip(request)
    wait = ask_limiter.check(ip)
    if wait is not None:
        raise HTTPException(status_code=429, detail={"code": "too_many_questions", "message": f"Muitas perguntas seguidas. Espere {wait} s e tente de novo."}, headers={"Retry-After": str(wait)})
    wait = day_limiter.check(ip)
    if wait is not None:
        raise HTTPException(status_code=429, detail={"code": "daily_limit", "message": "Você chegou ao limite de perguntas de hoje. Volte amanhã."}, headers={"Retry-After": str(wait)})
    wait = total_limiter.check("todos")
    if wait is not None:
        raise HTTPException(status_code=429, detail={"code": "site_daily_limit", "message": "O Aster atingiu o limite de uso de hoje. Volte amanhã."}, headers={"Retry-After": str(wait)})


def reset_limits() -> None:
    for limiter in (ask_limiter, day_limiter, total_limiter):
        limiter.reset()


# ---------------------------------------------------------------- dados pessoais

CPF = re.compile(r"(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)")
CARD = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE = re.compile(r"(?<!\d)(?:\+?55\s?)?\(?\d{2}\)?\s?9\d{4}[-\s]?\d{4}(?!\d)")


def _luhn(digits: str) -> bool:
    total = 0
    for index, char in enumerate(reversed(digits)):
        value = int(char)
        if index % 2:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return total % 10 == 0


def mask_personal_data(text: str) -> tuple[str, list[str]]:
    """Troca CPF, cartão, e-mail e telefone por marcadores antes de o texto ir para a IA ou para a web."""
    found: list[str] = []

    def card(match: re.Match[str]) -> str:
        digits = re.sub(r"\D", "", match.group())
        if 13 <= len(digits) <= 19 and _luhn(digits):
            found.append("cartão")
            return "[cartão oculto]"
        return match.group()

    def tag(label: str, placeholder: str):
        def replace(_: re.Match[str]) -> str:
            found.append(label)
            return placeholder
        return replace

    text = CARD.sub(card, text)
    text = CPF.sub(tag("CPF", "[CPF oculto]"), text)
    text = EMAIL.sub(tag("e-mail", "[e-mail oculto]"), text)
    text = PHONE.sub(tag("telefone", "[telefone oculto]"), text)
    return text, list(dict.fromkeys(found))


# ---------------------------------------------------------------- erros num formato só

FIELD_NAMES = {"question": "pergunta", "context": "conversa anterior", "answer": "resposta", "key": "chave", "model": "modelo", "chain": "fila de modelos"}


def _readable(error: dict) -> str:
    where = next((FIELD_NAMES.get(str(part), str(part)) for part in reversed(error.get("loc", ())) if not isinstance(part, int) and part != "body"), "requisição")
    kind = error.get("type", "")
    context = error.get("ctx") or {}
    if kind == "string_too_short":
        return f"{where}: precisa ter pelo menos {context.get('min_length')} caracteres"
    if kind == "string_too_long":
        return f"{where}: pode ter no máximo {context.get('max_length')} caracteres"
    if kind == "too_long":
        return f"{where}: no máximo {context.get('max_length')} itens"
    if kind == "missing":
        return f"{where}: campo obrigatório"
    if kind == "json_invalid":
        return "o corpo não é um JSON válido"
    if kind == "value_error":
        return str(context.get("error") or error.get("msg", "valor inválido"))
    return f"{where}: valor inválido"


def error_body(code: str, message: str, details: list[str] | None = None) -> dict:
    body: dict = {"detail": {"code": code, "message": message}}
    if details:
        body["detail"]["details"] = details
    return body


ROUTE_ERRORS = {
    404: ("route_not_found", "Essa rota não existe nesta versão da API do Aster."),
    405: ("method_not_allowed", "Método HTTP não permitido nesta rota."),
}


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


def install(app: FastAPI) -> None:
    @app.middleware("http")
    async def body_limit(request: Request, call_next):
        size = request.headers.get("content-length")
        if size and size.isdigit() and int(size) > MAX_BODY_BYTES:
            return JSONResponse(error_body("payload_too_large", "A requisição passou de 64 KB."), status_code=413)
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        # respostas da API (chaves mascaradas, configurações) nunca ficam em cache
        if request.url.path.startswith(("/api/admin", "/api/settings", "/api/providers")):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, exc: RequestValidationError):
        details = list(dict.fromkeys(_readable(error) for error in exc.errors()))
        return JSONResponse(error_body("invalid_request", f"Requisição inválida: {details[0] if details else 'confira os campos'}.", details), status_code=400)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        if isinstance(exc.detail, dict):
            body = {"detail": exc.detail}
        elif exc.status_code in ROUTE_ERRORS and exc.detail in ("Not Found", "Method Not Allowed"):
            body = error_body(*ROUTE_ERRORS[exc.status_code])
        else:
            body = error_body(f"http_{exc.status_code}", str(exc.detail))
        return JSONResponse(body, status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(Exception)
    async def unexpected(_: Request, exc: Exception):
        # o detalhe técnico fica só no log do servidor
        print(f"[aster] erro inesperado: {type(exc).__name__}: {exc}")
        return JSONResponse(error_body("internal_error", "Algo deu errado no servidor do Aster."), status_code=500)
