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
    // só vale a pergunta que veio com a consulta guardada junto; sozinha, pode ser de uma versão antiga
    const run = recallRun();
    const question = sessionStorage.getItem(QUESTION_KEY);
    return question && run?.question === question && run.events.some((event) => event.type === "search_results") ? question : DEFAULT_QUESTION;
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


/** Cada etapa em linguagem simples: o nome, uma frase curta, uma comparação e o roteiro do que apontar na tela. */
export type Talk = { plain: string; say: string; like: string; point: string[] };

export const TALK: Record<StageId, Talk> = {
  ingestao: {
    plain: "Ler as aulas",
    say: "O Aster lê as 12 aulas e corta o texto em pedacinhos. Cada pedacinho guarda de onde veio.",
    like: "É como recortar o livro em fichas de estudo e anotar no verso de onde cada uma saiu.",
    point: ["Os números do acervo: quantas aulas, páginas e trechos", "O texto cru de uma página e os trechos que saíram dela", "O id de cada trecho: é ele que vira a citação na resposta"],
  },
  pln: {
    plain: "Entender a pergunta",
    say: "O Aster joga fora as palavras que não dizem o assunto e fica só com as palavras-chave.",
    like: "É como grifar só as palavras-chave do enunciado de uma prova.",
    point: ["A pergunta original e o que sobra depois de cada passo", "As palavras riscadas, que são descartadas", "O que sobra no fim: é isso que vai para a busca"],
  },
  busca: {
    plain: "Procurar nos slides",
    say: "Cada pedacinho das aulas ganha uma nota: quanto mais palavras-chave ele tem, mais alto fica.",
    like: "É como olhar o índice do livro antes de folhear página por página.",
    point: ["A lista de candidatos, em ordem de nota", "As palavras que bateram em cada trecho", "O limite: se o aluno usar um sinônimo que não está no slide, essa busca não acha"],
  },
  embeddings: {
    plain: "Buscar pelo sentido",
    say: "Aqui a busca é pelo sentido, não pela palavra: frases que querem dizer a mesma coisa ficam perto.",
    like: "É como um mapa: “gato” e “cachorro” moram no mesmo bairro, e “carro” mora longe.",
    point: ["O mapa com a pergunta e os trechos como pontos", "Os pontos mais perto da pergunta são os mais parecidos", "A comparação com a ordem da busca por palavras"],
  },
  reranker: {
    plain: "Uma rede neural reordena",
    say: "Uma rede neural pequena aprende, aqui no navegador, a colocar o trecho certo em primeiro lugar.",
    like: "É como um aluno fazendo lista de exercícios: erra, confere o gabarito, ajusta e vai errando menos.",
    point: ["Os neurônios e as ligações mudando durante o treino", "O erro da rede caindo a cada rodada", "O teste com perguntas novas, que é o número honesto"],
  },
  agente: {
    plain: "A IA decide os passos",
    say: "A IA recebe regras e ferramentas, e decide sozinha quando buscar, quando ler e quando responder.",
    like: "É como um estagiário com um manual e acesso à biblioteca: ele escolhe o que consultar, mas precisa mostrar de onde tirou.",
    point: ["O texto de regras, colorido por tipo de instrução", "As ferramentas que ele pode chamar", "O ciclo pensar, agir e observar numa pergunta de verdade"],
  },
  streaming: {
    plain: "A resposta chega ao vivo",
    say: "O servidor manda cada passo assim que ele acontece, em vez de esperar tudo terminar.",
    like: "É como acompanhar um pedido no aplicativo de entrega: saiu, está a caminho, chegou.",
    point: ["Os eventos chegando um a um, com o tempo de cada", "O formato de um evento", "Rodar a pergunta e ver a lista crescer"],
  },
  avaliacao: {
    plain: "Medir se funciona",
    say: "Fizemos uma prova com 26 perguntas de gabarito conhecido e contamos quantas a busca acertou.",
    like: "É uma prova para o próprio sistema, com nota no final.",
    point: ["Os três anéis: de primeira, entre as 3 e entre as 6", "O placar: cada quadradinho é uma pergunta", "Clicar num quadradinho que errou e mostrar qual era a página certa"],
  },
};
