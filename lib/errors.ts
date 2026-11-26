/**
 * Erros da API em uma linha legível e sempre com o número HTTP: "429 · Muitas perguntas seguidas. Espere 20 s".
 * A API responde { detail: { code, message } }; quando não há corpo (API fora do ar, erro do proxy), o número decide o texto.
 */

const BY_STATUS: Record<number, string> = {
  400: "Pedido inválido. Confira o que foi digitado.",
  401: "Sessão expirada. Entre de novo.",
  403: "Acesso negado a esta ação.",
  404: "Rota não encontrada. A API em execução pode estar desatualizada: rode o iniciar de novo.",
  405: "Método não permitido nesta rota.",
  413: "Pedido grande demais (o limite é 64 KB).",
  429: "Muitos pedidos seguidos. Espere alguns segundos e tente de novo.",
  500: "Erro interno da API do Aster. O detalhe ficou no terminal da API.",
  502: "A API do Aster não está rodando. Confira a janela Aster API ou rode o iniciar de novo.",
  503: "A API do Aster está indisponível agora. Tente de novo em instantes.",
  504: "A API do Aster demorou demais para responder.",
};

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

/** Monta o erro a partir da resposta HTTP e do corpo já lido (ou null, se não era JSON). */
export function apiError(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  const code = typeof detail === "object" && detail ? (detail as { code?: string }).code : undefined;
  const text = typeof detail === "object" && detail && "message" in detail
    ? String((detail as { message: unknown }).message)
    : typeof detail === "string" && !["Not Found", "Method Not Allowed", "Internal Server Error"].includes(detail)
      ? detail
      : BY_STATUS[status] ?? (status >= 500 ? BY_STATUS[500] : "A API do Aster recusou o pedido.");
  return new ApiError(`${status} · ${text}`, status, code);
}

/** Lê a resposta como JSON; se não der certo, lança o erro legível com o número. */
export async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw apiError(response.status, body);
  return body as T;
}

/** fetch que transforma "sem conexão" num erro legível em vez de "Failed to fetch". */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (problem) {
    if ((problem as Error).name === "AbortError") throw problem;
    throw new ApiError("Sem conexão com o site do Aster. Confira se o iniciar ainda está aberto.", 0, "network");
  }
}
