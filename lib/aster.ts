export type LectureSource = {
  kind: "aula";
  id: string;
  document_id: string;
  title: string;
  page: number;
  quote: string;
  pdf_url: string;
};

export type WebSource = {
  kind: "web";
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  provider: "google" | "wikipedia" | string;
};

export type Source = LectureSource | WebSource;

export type PagePayload = {
  document_id: string;
  title: string;
  page: number;
  heading: string;
  pdf_url: string;
  passages: LectureSource[];
};

export type AnswerBlock = { text: string; citation_ids: string[] };

export type Material = { id: string; title: string; subject: string; pages: number };

export type RunEvent = {
  run_id: string;
  seq: number;
  t: number;
  type:
    | "run_started"
    | "agent_thinking"
    | "agent_thought"
    | "tool_call"
    | "search_results"
    | "page_read"
    | "web_results"
    | "tool_error"
    | "answer_check"
    | "answer_ready"
    | "model_fallback"
    | "insufficient_evidence"
    | "run_failed";
  data: Record<string, any>;
};

export type TraceNode =
  | { kind: "question"; id: string; text: string }
  | { kind: "search"; id: string; query: string; aula: string | null; intent: string; hits: LectureSource[] | null }
  | { kind: "read"; id: string; aula: string; page: number; intent: string; payload: PagePayload | null }
  | { kind: "web"; id: string; query: string; intent: string; provider: string | null; results: WebSource[] | null }
  | { kind: "check"; id: string; ok: boolean | null; message: string }
  | { kind: "fallback"; id: string; model: string }
  | { kind: "answer"; id: string; citations: number; chat: boolean }
  | { kind: "stop"; id: string; tone: "empty" | "error"; message: string };

export type TurnStatus = "running" | "answered" | "empty" | "failed";

export type Turn = {
  id: string;
  question: string;
  status: TurnStatus;
  thinking: boolean;
  step: number;
  model: string | null;
  mode: "ai" | "local" | null;
  thoughts: string[];
  nodes: TraceNode[];
  seen: Record<string, Source>;
  blocks: AnswerBlock[];
  sources: Source[];
  usedFallback: boolean;
  chat: boolean;
  message: string;
  elapsed: number;
  events: RunEvent[];
};

export function newTurn(id: string, question: string): Turn {
  return {
    id,
    question,
    status: "running",
    thinking: true,
    step: 0,
    model: null,
    mode: null,
    thoughts: [],
    nodes: [{ kind: "question", id: `${id}-q`, text: question }],
    seen: {},
    blocks: [],
    sources: [],
    usedFallback: false,
    chat: false,
    message: "",
    elapsed: 0,
    events: [],
  };
}

function patchNode(nodes: TraceNode[], id: string, patch: (node: TraceNode) => TraceNode): TraceNode[] {
  return nodes.map((node) => (node.id === id ? patch(node) : node));
}

/** Reducer puro: o mesmo caminho serve para a consulta ao vivo e para o replay. */
export function applyEvent(turn: Turn, event: RunEvent): Turn {
  const data = event.data;
  const next: Turn = { ...turn, elapsed: event.t ?? turn.elapsed };
  switch (event.type) {
    case "run_started":
      return { ...next, model: data.model ?? null, mode: data.mode ?? null };
    case "agent_thinking":
      return { ...next, thinking: true, step: data.step ?? turn.step + 1, model: data.model ?? turn.model };
    case "agent_thought":
      return { ...next, thoughts: [...turn.thoughts, String(data.text ?? "")] };
    case "tool_call": {
      const args = data.args ?? {};
      const intent = String(args.intencao ?? "");
      const base = { ...next, thinking: false };
      if (data.tool === "buscar_nas_aulas") return { ...base, nodes: [...turn.nodes, { kind: "search", id: data.call_id, query: String(args.consulta ?? ""), aula: args.aula ?? null, intent, hits: null }] };
      if (data.tool === "ler_pagina") return { ...base, nodes: [...turn.nodes, { kind: "read", id: data.call_id, aula: String(args.aula ?? ""), page: Number(args.pagina ?? 0), intent, payload: null }] };
      if (data.tool === "pesquisar_na_web") return { ...base, nodes: [...turn.nodes, { kind: "web", id: data.call_id, query: String(args.consulta ?? ""), intent, provider: null, results: null }] };
      if (data.tool === "responder") return { ...base, nodes: [...turn.nodes, { kind: "check", id: data.call_id, ok: null, message: "Conferindo as citações" }] };
      return base;
    }
    case "search_results": {
      const hits = (data.hits ?? []).map(normalizeSource) as LectureSource[];
      const seen = { ...turn.seen };
      hits.forEach((hit) => { seen[hit.id] = hit; });
      return { ...next, seen, nodes: patchNode(turn.nodes, data.call_id, (node) => (node.kind === "search" ? { ...node, hits } : node)) };
    }
    case "page_read": {
      const payload = { ...(data as PagePayload), passages: ((data.passages ?? []) as unknown[]).map(normalizeSource) as LectureSource[] };
      const seen = { ...turn.seen };
      payload.passages.forEach((item) => { seen[item.id] = item; });
      return { ...next, seen, nodes: patchNode(turn.nodes, data.call_id, (node) => (node.kind === "read" ? { ...node, payload } : node)) };
    }
    case "web_results": {
      const results = (data.results ?? []).map(normalizeSource) as WebSource[];
      const seen = { ...turn.seen };
      results.forEach((item) => { seen[item.id] = item; });
      return { ...next, seen, nodes: patchNode(turn.nodes, data.call_id, (node) => (node.kind === "web" ? { ...node, results, provider: data.provider ?? null } : node)) };
    }
    case "tool_error":
      return { ...next, nodes: patchNode(turn.nodes, data.call_id, (node) => (node.kind === "read" ? { ...node, intent: `${node.intent} (página inexistente)` } : node)) };
    case "answer_check":
      return { ...next, nodes: patchNode(turn.nodes, data.call_id, (node) => (node.kind === "check" ? { ...node, ok: !!data.ok, message: String(data.message ?? "") } : node)) };
    case "model_fallback":
      return { ...next, usedFallback: true, model: data.model ?? turn.model, nodes: [...turn.nodes, { kind: "fallback", id: `fb-${event.seq}`, model: String(data.model ?? "") }] };
    case "answer_ready": {
      const sources: Source[] = (data.sources ?? []).map(normalizeSource);
      const seen = { ...turn.seen };
      sources.forEach((item) => { seen[item.id] = item; });
      return {
        ...next,
        status: "answered",
        thinking: false,
        seen,
        blocks: data.blocks ?? [],
        sources,
        model: data.model ?? turn.model,
        mode: data.mode ?? turn.mode,
        usedFallback: !!data.used_fallback,
        chat: data.kind === "chat",
        nodes: [...turn.nodes, { kind: "answer", id: `${turn.id}-a`, citations: sources.length, chat: data.kind === "chat" }],
      };
    }
    case "insufficient_evidence":
      return { ...next, status: "empty", thinking: false, message: String(data.message ?? ""), nodes: [...turn.nodes, { kind: "stop", id: `${turn.id}-stop`, tone: "empty", message: String(data.reason || data.message || "") }] };
    case "run_failed":
      return { ...next, status: "failed", thinking: false, message: String(data.message ?? ""), nodes: [...turn.nodes, { kind: "stop", id: `${turn.id}-stop`, tone: "error", message: String(data.message ?? "") }] };
    default:
      return next;
  }
}

/** Quanto tempo cada evento fica em cena antes do próximo, para o olho acompanhar. */
export function eventDwell(event: RunEvent): number {
  switch (event.type) {
    case "tool_call": return 650;
    case "search_results": return 1100;
    case "page_read": return 1400;
    case "web_results": return 1100;
    case "answer_check": return 700;
    case "model_fallback": return 900;
    case "agent_thought": return 120;
    default: return 260;
  }
}

export function lectureLabel(documentId: string, page?: number) {
  const number = documentId.match(/\d+/)?.[0];
  const name = number ? `Aula ${number}` : documentId;
  return page ? `${name}, p. ${page}` : name;
}

export function faviconUrl(domain: string | undefined) {
  if (!domain) domain = "wikipedia.org";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

export function siteName(domain: string | undefined) {
  if (!domain) return "Web";
  if (domain.endsWith("wikipedia.org")) return "Wikipédia";
  return domain.replace(/^www\./, "");
}

/** Normaliza fontes vindas da API (versões antigas não mandam "kind"). */
export function normalizeSource(raw: any): Source {
  if (raw?.kind === "web" || (!raw?.document_id && raw?.url)) return { ...raw, kind: "web", domain: raw.domain ?? "" } as WebSource;
  return { ...raw, kind: "aula" } as LectureSource;
}
