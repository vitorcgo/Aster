// Repasse do streaming do agente. O rewrite do Next em modo dev derruba conexões
// SSE longas; uma rota própria entrega os bytes assim que a API os envia.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const apiOrigin = process.env.ASTER_API_ORIGIN || "http://127.0.0.1:8000";

export async function POST(request: Request) {
  let upstream: Response;
  try {
    upstream = await fetch(`${apiOrigin}/api/tutor/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return Response.json({ detail: "A API do Aster não está rodando." }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response(await upstream.text(), { status: upstream.status, headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" } });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
