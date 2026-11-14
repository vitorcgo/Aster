/** Memória duradoura do Aster: fatos curtos que o aluno contou. Fica só neste navegador. */
const KEY = "aster:memoria";
const LIMIT = 12;

export function loadMemory(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((item) => typeof item === "string").slice(-LIMIT) : [];
  } catch {
    return [];
  }
}

export function saveMemory(facts: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(facts.slice(-LIMIT)));
  } catch {
    // sem armazenamento, a memória vale só até fechar a página
  }
}

/** Acrescenta um fato, sem repetir o que já está guardado. */
export function addFact(facts: string[], fact: string): string[] {
  const clean = fact.trim();
  if (!clean || facts.some((item) => item.toLowerCase() === clean.toLowerCase())) return facts;
  return [...facts, clean].slice(-LIMIT);
}
