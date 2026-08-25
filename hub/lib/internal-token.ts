import { createHmac } from "node:crypto";

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function signInternalToken(payload: Record<string, unknown>, ttlSeconds = 60) {
  const secret = process.env.NEXUS_HUB_INTERNAL_SECRET || "";
  if (secret.length < 32) throw new Error("NEXUS_HUB_INTERNAL_SECRET deve possuir ao menos 32 caracteres.");
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const body = encode({ ...payload, iss: "nexus-hub", aud: "nexus-api", iat: now, exp: now + ttlSeconds });
  const input = `${header}.${body}`;
  const signature = createHmac("sha256", secret).update(input).digest("base64url");
  return `${input}.${signature}`;
}
