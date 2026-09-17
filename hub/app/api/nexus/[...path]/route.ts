import { auth } from "@/auth";
import { signInternalToken } from "@/lib/internal-token";

type RouteContext = { params: Promise<{ path: string[] }> };

export const runtime = "nodejs";

async function forward(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.nexus) return Response.json({ error: { code: "NAO_AUTENTICADO" } }, { status: 401 });
  const { path } = await context.params;
  const incoming = new URL(request.url);
  const target = new URL(`/v1/${path.join("/")}`, process.env.NEXUS_API_INTERNAL_URL);
  target.search = incoming.search;
  const token = signInternalToken({
    sub: session.nexus.slug,
    pid: session.nexus.id,
    typ: "session"
  });
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  // Materializa o corpo antes de chamar a API. Isso preserva exatamente o boundary do
  // multipart e impede que o stream do App Router seja encerrado durante a criação do chat.
  const body = ["GET", "HEAD"].includes(request.method)
    ? undefined
    : Buffer.from(await request.arrayBuffer());
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store"
    });
  } catch (cause) {
    console.error("[nexus-proxy] Falha ao encaminhar requisição para a API interna", {
      method: request.method,
      path: target.pathname,
      cause: cause instanceof Error ? cause.message : String(cause)
    });
    return Response.json({ error: {
      code: "NEXUS_API_INDISPONIVEL",
      message: "Não foi possível comunicar com a API do Nexus. Tente novamente."
    } }, { status: 502 });
  }
  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-disposition", "content-length", "cache-control", "x-accel-buffering"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
