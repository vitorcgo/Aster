"""Acervo das aulas: leitura dos PDFs, trechos citáveis e a busca lexical usada pelo agente e pelo Laboratório."""

from __future__ import annotations

import math
import re
import threading
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_MATERIALS = ROOT / "data" / "materials"
SEARCH_LIMIT = 6


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


STOPWORDS = {"qual", "quais", "como", "para", "uma", "uns", "umas", "que", "dos", "das", "com", "sobre", "papel", "aula", "aulas", "isso", "esse", "essa", "este", "esta", "por", "pela", "pelo", "nos", "nas", "the", "and", "sao", "ser", "tem", "mais", "entre", "quando", "onde", "porque", "explique", "explica", "diferenca", "funciona", "serve",
             # verbos e pronomes genéricos: casavam com qualquer slide e viravam ruído
             "faz", "fazer", "feito", "faco", "fazem", "quem", "pode", "podem", "posso", "existe", "existem", "tipo", "coisa",
             "algum", "alguma", "muito", "bem", "ter", "ver", "dizer", "diz", "usar", "usa", "dar", "ficar", "fica",
             # conectivos e pronomes que entram em perguntas longas, em forma de situação
             "mas", "ante", "antes", "depois", "los", "las", "ainda", "desde", "dia", "tudo", "quase", "acontece", "acontecendo",
             "estao", "cada", "seu", "sua", "seus", "suas", "ele", "ela", "eles", "elas", "num", "numa", "aos", "pra", "sem",
             # enchimento de pedido ("eu quero saber como..."): casava com slides de exemplo que começam igual
             "quero", "queria", "gostaria", "saber", "sei", "entender", "entendo", "aprender", "preciso", "ajuda", "ajude", "duvida"}

# formas curtas que o aluno usa para o termo do slide ("front" para "frontend")
ALIASES = {"front": "fronten", "back": "backen"}

# Um trecho só é candidato se cobrir metade dos termos da pergunta (ou 3 termos, em perguntas longas).
# Medido nas 26 perguntas de avaliação: recall@1 subiu de 58% para 65%, e perguntas fora da matéria
# deixam de "encontrar" slides por uma palavra solta.
MIN_COVERAGE = 0.5
MIN_MATCHED_TERMS = 3
# Slide cujo título é quase só o termo perguntado ("Tokenização", "O que é Function Calling?") costuma ser o da
# definição. Medido nas 26 perguntas: 1º lugar de 65% para 81%, top 3 de 65% para 85%, MRR de 0,71 para 0,84,
# com ganho tanto nas perguntas dos simulados quanto nas de conceitos.
TIGHT_HEADING_WEIGHT = 2.5
SECOND_PASSAGE_WEIGHT = 0.25


def stem(word: str) -> str:
    if len(word) > 4 and word.endswith("s"):
        word = word[:-1]
    for suffix in ("coes", "cao", "mente", "idade", "agem", "ismo", "ing"):
        if len(word) > len(suffix) + 3 and word.endswith(suffix):
            word = word[: -len(suffix)]
            break
    return word[:7]


def terms(value: str) -> set[str]:
    normalized = unicodedata.normalize("NFKD", value.translate(GLYPH_FIXES).lower())
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    found = {stem(word) for word in re.findall(r"[a-z0-9]{3,}", normalized) if word not in STOPWORDS}
    return {ALIASES.get(term, term) for term in found}


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
        except Exception as error:
            print(f"[aster] não consegui ler {path.name}: {type(error).__name__}: {error}")
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


@dataclass(frozen=True)
class Scored:
    """Um trecho candidato e as partes da pontuação lexical, para a busca e para o Laboratório."""
    item: Evidence
    score: float
    content: frozenset[str]
    heading: frozenset[str]
    coverage: float
    length: int


def rank_candidates(query: str, document_id: str | None = None, limit: int = SEARCH_LIMIT, per_page_limit: int = 2, relaxed: bool = False) -> list[Scored]:
    wanted = terms(query)
    if not wanted:
        return []
    ranked: list[Scored] = []
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
        if coverage < MIN_COVERAGE and len(content | heading) < (2 if relaxed else MIN_MATCHED_TERMS):
            continue
        # termos em comum pesam mais em trechos curtos; o título do slide e a cobertura da pergunta somam
        score = 2.4 * len(content) / math.sqrt(max(4, len(item_terms))) + 1.2 * len(heading) / len(wanted) + coverage
        if heading:
            score += TIGHT_HEADING_WEIGHT * len(heading) / len(lib.heading_terms[item.id])
        if re.match(r"^\d+\s", item.quote):
            score -= .3
        ranked.append(Scored(item, score, frozenset(content), frozenset(heading), coverage, len(item_terms)))
    # a página vale pelo melhor trecho, com um pouco do segundo: um slide inteiro sobre o tema ganha de uma frase solta
    best: dict[tuple[str, int], list[float]] = {}
    for row in ranked:
        best.setdefault((row.item.document_id, row.item.page), []).append(row.score)
    page_score = {key: max(scores) + SECOND_PASSAGE_WEIGHT * (sorted(scores)[-2] if len(scores) > 1 else 0) for key, scores in best.items()}
    ranked.sort(key=lambda row: (page_score[(row.item.document_id, row.item.page)], row.score), reverse=True)
    result: list[Scored] = []
    per_page: dict[tuple[str, int], int] = {}
    for row in ranked:
        key = (row.item.document_id, row.item.page)
        if per_page.get(key, 0) >= per_page_limit:
            continue
        per_page[key] = per_page.get(key, 0) + 1
        result.append(row)
        if len(result) >= limit:
            break
    return result


def search(query: str, document_id: str | None = None, limit: int = SEARCH_LIMIT) -> list[Evidence]:
    return [row.item for row in rank_candidates(query, document_id, limit)]


def search_relaxed(query: str, document_id: str | None = None, limit: int = SEARCH_LIMIT) -> list[Evidence]:
    """Segunda tentativa de uma consulta longa que não achou nada: aceita trechos com pelo menos 2 termos dela."""
    return [row.item for row in rank_candidates(query, document_id, limit, relaxed=True)]


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
