"""Chaves de IA do visitante: cada pessoa usa a própria chave, guardada só no navegador dela.

A chave chega junto com a pergunta, vale só durante aquela consulta (num ContextVar) e nunca é gravada,
registrada em log nem devolvida. Sem chave do visitante, vale a do dono do site, se ele tiver cadastrado uma.
"""

from __future__ import annotations

import contextvars
import hashlib

from pydantic import BaseModel, Field, field_validator

from api.providers import PROVIDERS


class VisitorModel(BaseModel):
    provider: str
    model: str = Field(min_length=1, max_length=160)


class VisitorAI(BaseModel):
    keys: dict[str, str] = Field(default_factory=dict)
    chain: list[VisitorModel] = Field(default_factory=list, max_length=6)

    @field_validator("keys")
    @classmethod
    def clean_keys(cls, value: dict[str, str]) -> dict[str, str]:
        clean = {}
        for provider, key in value.items():
            key = str(key).strip()
            if provider in PROVIDERS and 8 <= len(key) <= 400 and key.isprintable() and " " not in key:
                clean[provider] = key
        return clean

    @field_validator("chain")
    @classmethod
    def clean_chain(cls, value: list[VisitorModel]) -> list[VisitorModel]:
        return [item for item in value if item.provider in PROVIDERS]


_current: contextvars.ContextVar[VisitorAI | None] = contextvars.ContextVar("aster_visitor_ai", default=None)


class use:
    """Liga as chaves do visitante durante uma consulta: `with visitor.use(request.ai): ...`"""

    def __init__(self, ai: VisitorAI | None) -> None:
        self.ai = ai if ai and ai.keys else None
        self.token: contextvars.Token | None = None

    def __enter__(self) -> "use":
        self.token = _current.set(self.ai)
        return self

    def __exit__(self, *_exc) -> None:
        if self.token is not None:
            _current.reset(self.token)


def current() -> VisitorAI | None:
    return _current.get()


def key(provider: str) -> str | None:
    """Chave do visitante para o provedor; None quando o visitante não mandou chaves (vale a do site)."""
    ai = _current.get()
    if ai is None:
        return None
    return ai.keys.get(provider, "")


def chain() -> list[tuple[str, str]] | None:
    ai = _current.get()
    if ai is None or not ai.chain:
        return None
    return [(item.provider, item.model) for item in ai.chain]


def fingerprint(value: str) -> str:
    """Identifica uma chave sem revelá-la: a pausa por falta de cota vale só para a chave que falhou."""
    return hashlib.sha256(value.encode()).hexdigest()[:10] if value else "site"

