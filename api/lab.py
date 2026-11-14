"""Rotas do Laboratório: mostram, com os dados reais, cada etapa de como o Aster responde."""
from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from functools import lru_cache

import pymupdf
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from api import main
from api.eval_set import EVAL_SET

router = APIRouter(prefix="/api/lab")

EMBED_MODEL = "gemini-embedding-001"
CORRUPTED = set("őŐĄąŸŮŰŞŤÐłžś")


def _lecture(doc: str, page: int) -> dict:
    return {"document_id": doc, "page": page}


# ---------------------------------------------------------------- 1. ingestão (Aula 6, p. 33-34)

@router.get("/overview")
def overview():
    lib = main.library()
    per_doc = Counter(item.document_id for item in lib.passages)
    documents = [{**doc, "passages": per_doc.get(doc["id"], 0)} for doc in lib.documents]
    lengths = [len(item.quote) for item in lib.passages]
    return {
        "documents": documents,
        "totals": {"documents": len(documents), "pages": len(lib.pages), "passages": len(lib.passages), "avg_chars": round(sum(lengths) / max(1, len(lengths)))},
        "rules": {"min_chars": 40, "max_chars": 600, "split": "frases dentro de cada bloco de texto do slide"},
    }


@router.get("/page")
def page_detail(doc: str, page: int = Query(ge=1)):
    path = main.material_paths().get(doc)
    if path is None or (doc, page) not in main.library().pages:
        raise HTTPException(status_code=404, detail="Página não encontrada")
    with pymupdf.open(path) as document:
        raw = document[page - 1].get_text()
    fixes = Counter(char for char in raw if char in CORRUPTED)
    text = main.library().pages[(doc, page)]
    passages = main.page_passages(doc, page)
    return {
        "document_id": doc,
        "page": page,
        "heading": text.heading,
        "raw": raw[:4000],
        "clean": text.text[:4000],
        "fixes": [{"from": char, "to": char.translate(main.GLYPH_FIXES), "count": count} for char, count in fixes.most_common()],
        "passages": [{"id": item.id, "quote": item.quote, "chars": len(item.quote)} for item in passages],
    }


# ---------------------------------------------------------------- 2. PLN da pergunta (Aula 4, p. 6-9)

@router.get("/nlp")
def nlp(q: str = Query(min_length=1, max_length=500)):
    fixed = q.translate(main.GLYPH_FIXES)
    lower = fixed.lower()
    folded = "".join(ch for ch in unicodedata.normalize("NFKD", lower) if not unicodedata.combining(ch))
    tokens = re.findall(r"[a-z0-9]+", folded)
    short = [token for token in tokens if len(token) < 3]
    long_tokens = [token for token in tokens if len(token) >= 3]
    stop = [token for token in long_tokens if token in main.STOPWORDS]
    kept = [token for token in long_tokens if token not in main.STOPWORDS]
    stems = [{"word": token, "stem": main.stem(token)} for token in kept]
    return {
        "original": q,
        "lower": lower,
        "folded": folded,
        "tokens": tokens,
        "short_removed": short,
        "stopwords_removed": stop,
        "stems": stems,
        "terms": sorted(main.terms(q)),
    }


# ---------------------------------------------------------------- 3. busca e ranking (Aula 6, p. 24; Aula 4, p. 13-14)

@router.get("/search")
def lab_search(q: str = Query(min_length=1, max_length=500), limit: int = Query(10, ge=1, le=25)):
    wanted = sorted(main.terms(q))
    rows = main.rank_candidates(q, limit=limit)
    lib = main.library()
    matched = sum(1 for item in lib.passages if set(wanted) & (lib.quote_terms[item.id] | lib.heading_terms[item.id])) if wanted else 0
    return {
        "terms": wanted,
        "matched": matched,
        "total": len(lib.passages),
        "candidates": [
            {
                **row.item.public(),
                "heading": row.item.heading,
                "score": round(row.score, 3),
                "content_terms": sorted(row.content),
                "heading_terms": sorted(row.heading),
                "coverage": round(row.coverage, 3),
                "length": row.length,
            }
            for row in rows
        ],
    }


# ---------------------------------------------------------------- 4. embeddings reais (Aula 6, p. 25-27 e 36)

class EmbedBody(BaseModel):
    q: str = Field(min_length=3, max_length=500)


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    return dot / ((math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))) or 1)


def _project(vectors: list[list[float]]) -> list[tuple[float, float]]:
    """PCA em 2 dimensões pela matriz de Gram centrada (n pequeno), sem bibliotecas extras."""
    n = len(vectors)
    d = len(vectors[0])
    mean = [sum(vector[k] for vector in vectors) / n for k in range(d)]
    centered = [[vector[k] - mean[k] for k in range(d)] for vector in vectors]
    gram = [[sum(p * q for p, q in zip(a, b)) for b in centered] for a in centered]
    components = []
    matrix = [row[:] for row in gram]
    for _ in range(2):
        vector = [1.0 / math.sqrt(n)] * n
        vector[0] += 0.37
        value = 0.0
        for _ in range(200):
            nxt = [sum(matrix[i][j] * vector[j] for j in range(n)) for i in range(n)]
            norm = math.sqrt(sum(x * x for x in nxt)) or 1
            vector = [x / norm for x in nxt]
            value = norm
        components.append((vector, value))
        matrix = [[matrix[i][j] - value * vector[i] * vector[j] for j in range(n)] for i in range(n)]
    coords = [(components[0][0][i] * math.sqrt(components[0][1]), components[1][0][i] * math.sqrt(components[1][1])) for i in range(n)]
    scale = max(1e-9, max(max(abs(x), abs(y)) for x, y in coords))
    return [(x / scale, y / scale) for x, y in coords]


@lru_cache(maxsize=32)
def _embed(texts: tuple[str, ...]) -> list[list[float]]:
    from google import genai

    key = main.provider_key("gemini")
    if not key:
        raise HTTPException(status_code=400, detail={"code": "no_key", "message": "Os embeddings usam a API do Gemini. Cadastre uma chave do Gemini em Modelos."})
    client = genai.Client(api_key=key, http_options={"retry_options": {"attempts": 1}, "timeout": 30000})
    response = client.models.embed_content(model=EMBED_MODEL, contents=list(texts))
    return [list(item.values) for item in response.embeddings]


@router.post("/embeddings")
def embeddings(body: EmbedBody):
    rows = main.rank_candidates(body.q, limit=15)
    if not rows:
        raise HTTPException(status_code=404, detail={"code": "no_candidates", "message": "A busca lexical não encontrou candidatos para essa pergunta."})
    texts = (body.q, *(row.item.quote for row in rows))
    try:
        vectors = _embed(texts)
    except HTTPException:
        raise
    except Exception as error:
        failure = main.classify_generation_error(error)
        raise HTTPException(status_code=502, detail={"code": failure.code, "message": failure.message}) from None
    question = vectors[0]
    coords = _project(vectors)
    candidates = []
    for index, row in enumerate(rows, start=1):
        candidates.append({**row.item.public(), "heading": row.item.heading, "lexical_rank": index, "lexical_score": round(row.score, 3), "cosine": round(_cosine(question, vectors[index]), 4), "x": round(coords[index][0], 4), "y": round(coords[index][1], 4)})
    order = sorted(candidates, key=lambda item: item["cosine"], reverse=True)
    for rank, item in enumerate(order, start=1):
        item["semantic_rank"] = rank
    return {"model": EMBED_MODEL, "dimensions": len(question), "question": {"x": round(coords[0][0], 4), "y": round(coords[0][1], 4)}, "candidates": candidates}


# ---------------------------------------------------------------- 5. dados reais para o reranker neural (Aula 3; Aula 10, p. 22)

def _features(row: main.Scored, wanted: set[str]) -> list[float]:
    total = max(1, len(wanted))
    return [round(len(row.content) / total, 4), round(len(row.heading) / total, 4)]


@router.get("/relevance")
def relevance(candidates: int = Query(15, ge=5, le=30)):
    queries = []
    for index, entry in enumerate(EVAL_SET):
        wanted = main.terms(entry["q"])
        rows = main.rank_candidates(entry["q"], limit=candidates)
        queries.append({
            "id": index,
            "q": entry["q"],
            "expected": _lecture(entry["doc"], entry["page"]),
            "origin": entry["origin"],
            "candidates": [{"id": row.item.id, "document_id": row.item.document_id, "page": row.item.page, "x": _features(row, wanted), "lexical": round(row.score, 3), "y": int(row.item.document_id == entry["doc"] and row.item.page == entry["page"])} for row in rows],
        })
    return {"features": ["Cobertura da pergunta no trecho", "Cobertura da pergunta no título do slide"], "queries": queries}


# ---------------------------------------------------------------- 8. avaliação (Aula 2, p. 31-33)

@router.get("/scope")
def scope(q: str = ""):
    """O Laboratório só analisa perguntas da matéria, pelo mesmo portão do Estudar."""
    question = " ".join(q.split())[:500]
    if len(question) < 2:
        return {"ok": False, "reason": "short", "message": "Digite uma pergunta sobre a matéria."}
    if main.OVERRIDE.search(question):
        return {"ok": False, "reason": "override", "message": "Essa pergunta tenta mudar as regras do Aster. Use uma dúvida da matéria."}
    if main.is_small_talk(question):
        return {"ok": False, "reason": "small_talk", "message": "Isso é uma conversa, não uma dúvida. O Laboratório mostra o caminho de uma pergunta sobre a matéria."}
    if not main.in_scope(main.AskRequest(question=question)):
        return {"ok": False, "reason": "scope", "message": "Essa pergunta foge da matéria das aulas, então não há caminho para mostrar. Tente algo dos slides."}
    return {"ok": True}


@router.get("/evaluation")
def evaluation():
    results = []
    for entry in EVAL_SET:
        pages: list[tuple[str, int]] = []
        for row in main.rank_candidates(entry["q"], limit=30):
            key = (row.item.document_id, row.item.page)
            if key not in pages:
                pages.append(key)
        target = (entry["doc"], entry["page"])
        rank = pages.index(target) + 1 if target in pages else None
        results.append({"q": entry["q"], "expected": _lecture(*target), "origin": entry["origin"], "rank": rank, "top": [_lecture(*key) for key in pages[:3]]})
    n = len(results)
    metrics = {}
    for k in (1, 3, 6):
        hits = sum(1 for item in results if item["rank"] and item["rank"] <= k)
        # uma página certa por pergunta: recall@k = acertos/n; precisão@k = acertos/(n·k)
        metrics[f"recall@{k}"] = round(hits / n, 3)
        metrics[f"precision@{k}"] = round(hits / (n * k), 3)
    metrics["mrr"] = round(sum(1 / item["rank"] for item in results if item["rank"]) / n, 3)
    return {"metrics": metrics, "results": results}


# ---------------------------------------------------------------- 6. o agente por dentro (Aula 6, p. 7-8; Aula 10, p. 9-13 e 46)

@router.get("/agent")
def agent():
    return {
        "system_prompt": main.SYSTEM_INSTRUCTION.format(catalog=main.catalog_text()),
        "tools": main.TOOLS,
        "max_steps": main.MAX_AGENT_STEPS,
        "chain": [spec.public() for spec in main.agent_models()],
    }
