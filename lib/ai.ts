/**
 * Chaves de IA do visitante. Ficam só neste navegador (localStorage) e vão junto com cada pergunta.
 * O servidor usa a chave só durante a consulta e não a guarda.
 */
export type VisitorModel = { provider: string; model: string };
export type VisitorAI = { keys: Record<string, string>; chain: VisitorModel[] };

const KEY = "aster:ia";
export const AI_EVENT = "aster:ia-changed";

export function loadAI(): VisitorAI {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const keys = saved && typeof saved.keys === "object" && saved.keys ? Object.fromEntries(Object.entries(saved.keys).filter(([, value]) => typeof value === "string" && value)) as Record<string, string> : {};
    const chain = Array.isArray(saved?.chain) ? saved.chain.filter((item: VisitorModel) => item && typeof item.provider === "string" && typeof item.model === "string").slice(0, 6) : [];
    return { keys, chain };
  } catch {
    return { keys: {}, chain: [] };
  }
}

export function saveAI(next: VisitorAI) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // sem armazenamento, a chave vale só enquanto a página estiver aberta
  }
  window.dispatchEvent(new CustomEvent(AI_EVENT));
}

/** O que vai junto com a pergunta; sem chaves, nada vai e vale a configuração do site. */
export function aiPayload(): VisitorAI | undefined {
  const ai = loadAI();
  if (!Object.keys(ai.keys).length) return undefined;
  // só modelos de provedores com chave: o resto falharia de qualquer jeito
  return { keys: ai.keys, chain: ai.chain.filter((item) => ai.keys[item.provider]) };
}

export function maskKey(key: string) {
  return key.length >= 8 ? `••••${key.slice(-4)}` : "••••";
}

