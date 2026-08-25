import { auth } from "@/auth";
import { signInternalToken } from "@/lib/internal-token";

type RouteContext = { params: Promise<{ path: string[] }> };

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
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body,
    cache: "no-store",
    signal: request.signal
  });
  const responseHeaders = new Headers();
  for (const name of ["content-type", "cache-control", "x-accel-buffering"]) {
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
