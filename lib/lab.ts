import type { RunEvent } from "./aster";

export type StageId = "ingestao" | "pln" | "busca" | "embeddings" | "reranker" | "agente" | "streaming" | "avaliacao";

type Ref = { document_id: string; page: number; label: string };

export type Stage = {
  id: StageId;
  title: string;
  lecture: string;
  question: string;
  refs: Ref[];
  covers: { document_id: string; from: number; to: number }[];
};

/** O caminho de uma pergunta dentro do Aster, cada etapa explicada pela aula correspondente. */
export const STAGES: Stage[] = [
  { id: "ingestao", title: "Ingestão e chunking", lecture: "Aula 6", question: "Como as aulas viram trechos pesquisáveis?", refs: [{ document_id: "aula-6", page: 33, label: "Ingestão, p. 33" }, { document_id: "aula-6", page: 34, label: "Chunking, p. 34" }, { document_id: "aula-10", page: 26, label: "Extração de PDFs, p. 26" }], covers: [{ document_id: "aula-6", from: 33, to: 35 }, { document_id: "aula-10", from: 26, to: 26 }] },
  { id: "pln", title: "PLN da pergunta", lecture: "Aula 4", question: "O que o Aster faz com o texto que você digita?", refs: [{ document_id: "aula-4", page: 6, label: "Pipeline de PLN, p. 6" }, { document_id: "aula-4", page: 8, label: "Stopwords, p. 8" }, { document_id: "aula-4", page: 9, label: "Stemming, p. 9" }], covers: [{ document_id: "aula-4", from: 6, to: 13 }] },
  { id: "busca", title: "Busca e ranking", lecture: "Aula 6", question: "Como ele escolhe os trechos candidatos?", refs: [{ document_id: "aula-6", page: 24, label: "O problema do lexical, p. 24" }, { document_id: "aula-4", page: 14, label: "TF-IDF, p. 14" }, { document_id: "aula-6", page: 36, label: "Recuperação, p. 36" }], covers: [{ document_id: "aula-6", from: 21, to: 24 }, { document_id: "aula-6", from: 36, to: 36 }, { document_id: "aula-4", from: 14, to: 14 }] },
  { id: "embeddings", title: "Embeddings", lecture: "Aula 6", question: "E se a busca fosse pelo significado?", refs: [{ document_id: "aula-6", page: 25, label: "Embeddings, p. 25" }, { document_id: "aula-6", page: 27, label: "Similaridade, p. 27" }, { document_id: "aula-4", page: 15, label: "Word embeddings, p. 15" }], covers: [{ document_id: "aula-6", from: 25, to: 32 }, { document_id: "aula-4", from: 15, to: 17 }] },
  { id: "reranker", title: "Rede neural reranker", lecture: "Aula 3 e Aula 10", question: "Uma rede neural pode reordenar melhor os resultados?", refs: [{ document_id: "aula-3", page: 5, label: "MLP, p. 5" }, { document_id: "aula-3", page: 16, label: "Loop de treino, p. 16" }, { document_id: "aula-10", page: 22, label: "Reranking, p. 22" }], covers: [{ document_id: "aula-3", from: 3, to: 16 }, { document_id: "aula-10", from: 22, to: 22 }] },
  { id: "agente", title: "Agente e ferramentas", lecture: "Aula 10 e Aula 6", question: "Quem decide o que pesquisar?", refs: [{ document_id: "aula-6", page: 8, label: "System prompt, p. 8" }, { document_id: "aula-10", page: 9, label: "ReAct, p. 9" }, { document_id: "aula-10", page: 13, label: "Function calling, p. 13" }], covers: [{ document_id: "aula-6", from: 7, to: 8 }, { document_id: "aula-10", from: 9, to: 14 }, { document_id: "aula-10", from: 43, to: 47 }] },
  { id: "streaming", title: "Streaming com SSE", lecture: "Aula 7", question: "Como a resposta chega aos poucos na tela?", refs: [{ document_id: "aula-7", page: 16, label: "Pydantic, p. 16" }, { document_id: "aula-7", page: 20, label: "SSE, p. 20" }, { document_id: "aula-7", page: 22, label: "SSE no FastAPI, p. 22" }], covers: [{ document_id: "aula-7", from: 13, to: 22 }] },
  { id: "avaliacao", title: "Avaliação", lecture: "Aula 2", question: "A busca do Aster é boa? Como medir?", refs: [{ document_id: "aula-2", page: 31, label: "Precisão, p. 31" }, { document_id: "aula-2", page: 32, label: "Recall, p. 32" }, { document_id: "aula-2", page: 33, label: "F1 e trade-off, p. 33" }], covers: [{ document_id: "aula-2", from: 29, to: 33 }] },
];

export function stageForPage(documentId: string, page: number) {
  return STAGES.find((stage) => stage.covers.some((range) => range.document_id === documentId && page >= range.from && page <= range.to)) ?? null;
}

export const DEFAULT_QUESTION = "Qual é o papel dos embeddings em um RAG?";
const QUESTION_KEY = "aster:last-question";
const RUN_KEY = "aster:last-run";

export function rememberRun(question: string, events: RunEvent[]) {
  try {
    sessionStorage.setItem(QUESTION_KEY, question);
    sessionStorage.setItem(RUN_KEY, JSON.stringify({ question, events }));
  } catch {
    // armazenamento indisponível: o Laboratório roda a pergunta de novo se precisar
  }
}

export function recallQuestion(): string {
  try {
    return sessionStorage.getItem(QUESTION_KEY) || DEFAULT_QUESTION;
  } catch {
    return DEFAULT_QUESTION;
  }
}

export function recallRun(): { question: string; events: RunEvent[] } | null {
  try {
    const raw = sessionStorage.getItem(RUN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function labGet<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (data as { detail?: unknown }).detail;
    if (response.status === 404 && (!detail || (typeof detail === "object" && (detail as { code?: string }).code === "route_not_found"))) throw new Error("A API em execução não tem as rotas do Laboratório. Reinicie o servidor da API com o código atual.");
    throw new Error(typeof detail === "object" && detail && "message" in detail ? String((detail as { message: string }).message) : typeof detail === "string" ? detail : "A API não respondeu.");
  }
  return data as T;
}

export async function labPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (data as { detail?: unknown }).detail;
    throw new Error(typeof detail === "object" && detail && "message" in detail ? String((detail as { message: string }).message) : typeof detail === "string" ? detail : "A API não respondeu.");
  }
  return data as T;
}

export type Candidate = {
  id: string;
  document_id: string;
  page: number;
  quote: string;
  title: string;
  heading: string;
  score: number;
  content_terms: string[];
  heading_terms: string[];
  coverage: number;
  length: number;
};

export type SearchResult = { terms: string[]; matched: number; total: number; candidates: Candidate[] };
