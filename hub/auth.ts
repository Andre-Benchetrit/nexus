import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { signInternalToken } from "@/lib/internal-token";
import { loadRootEnv } from "@/lib/load-root-env";
import type { NexusProfile, NexusSessionPrincipal } from "@/lib/types";

loadRootEnv();

type NexusIdentity = {
  tenantId: string;
  subjectId: string;
  email: string;
  name: string;
};

const ACCESS_ERROR_CODES = new Set([
  "PRE_CADASTRO_NAO_ENCONTRADO",
  "USUARIO_INATIVO",
  "ACESSO_HUB_NAO_CONCEDIDO",
  "TENANT_NAO_AUTORIZADO"
]);

function nexusAccessErrorCode(error: unknown) {
  if (error instanceof Error && ACCESS_ERROR_CODES.has(error.message)) return error.message;
  return "NEXUS_API_INDISPONIVEL";
}

function identityFromMicrosoftProfile(profile: Record<string, unknown>): NexusIdentity {
  const email = String(profile.email || profile.preferred_username || "");
  return {
    tenantId: String(profile.tid || process.env.NEXUS_HUB_ENTRA_TENANT_ID || ""),
    subjectId: String(profile.oid || profile.sub || ""),
    email,
    name: String(profile.name || email)
  };
}

async function resolveNexusProfile(identity: NexusIdentity) {
  const token = signInternalToken({
    sub: "auth-bootstrap", typ: "auth", ...identity
  });
  const apiUrl = process.env.NEXUS_API_INTERNAL_URL;
  if (!apiUrl) throw new Error("NEXUS_API_INDISPONIVEL");
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/auth/resolve`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    throw new Error(body?.error?.code || "NEXUS_ACCESS_DENIED");
  }
  return response.json() as Promise<NexusProfile>;
}

function sessionPrincipal(profile: NexusProfile): NexusSessionPrincipal {
  const principal = {
    id: profile.id,
    slug: profile.slug,
    nome: profile.nome,
    email: profile.email,
    ativo: profile.ativo
  };
  if (!isSessionPrincipal(principal)) throw new Error("NEXUS_API_INDISPONIVEL");
  return principal;
}

function isSessionPrincipal(value: unknown): value is NexusSessionPrincipal {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<NexusSessionPrincipal>;
  return typeof item.id === "string" && item.id.length > 0
    && typeof item.slug === "string" && item.slug.length > 0
    && typeof item.nome === "string" && item.nome.length > 0
    && typeof item.email === "string" && item.email.length > 0
    && typeof item.ativo === "boolean";
}

function principalFromToken(token: {
  nexus?: unknown;
  nexusPrincipal?: unknown;
  sub?: unknown;
  name?: unknown;
  email?: unknown;
}) {
  const value = token.nexus ?? token.nexusPrincipal;
  if (isSessionPrincipal(value)) return sessionPrincipal(value as NexusProfile);

  // `sub` e um claim padrao do JWT do Auth.js. Ele funciona como fallback
  // duravel caso um runtime descarte claims personalizados entre callback e proxy.
  const match = typeof token.sub === "string"
    ? /^nexus:([^:]+):([a-z0-9-]+)$/.exec(token.sub)
    : null;
  if (!match || typeof token.name !== "string" || typeof token.email !== "string") return undefined;
  const principal = {
    id: match[1],
    slug: match[2],
    nome: token.name,
    email: token.email,
    ativo: true
  };
  return isSessionPrincipal(principal) ? principal : undefined;
}

function nexusSubject(principal: NexusSessionPrincipal) {
  return `nexus:${principal.id}:${principal.slug}`;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  providers: [MicrosoftEntraID({
    clientId: process.env.NEXUS_HUB_ENTRA_CLIENT_ID,
    clientSecret: process.env.NEXUS_HUB_ENTRA_CLIENT_SECRET,
    issuer: `https://login.microsoftonline.com/${process.env.NEXUS_HUB_ENTRA_TENANT_ID}/v2.0`,
    authorization: { params: { scope: "openid profile email", prompt: "select_account" } }
  })],
  pages: { signIn: "/login", error: "/access-denied" },
  callbacks: {
    async jwt({ token, profile, account }) {
      if (account && profile) {
        try {
          const identity = identityFromMicrosoftProfile(profile as Record<string, unknown>);
          const nexusProfile = await resolveNexusProfile(identity);
          // Mantem o nome de claim ja usado pelas sessoes estaveis do Hub,
          // agora contendo apenas o principal minimo (sem papeis e permissoes).
          const principal = sessionPrincipal(nexusProfile);
          token.nexus = principal;
          token.name = principal.nome;
          token.email = principal.email;
          delete token.nexusAccessError;
        } catch (error) {
          delete token.nexus;
          token.nexusAccessError = nexusAccessErrorCode(error);
          console.error("[auth] Falha ao resolver acesso Nexus:", token.nexusAccessError);
        }
      }
      // Migra tanto o JWT completo antigo quanto o claim intermediario usado
      // durante a reducao do cookie para o principal minimo validado.
      const principal = principalFromToken(token);
      if (principal) {
        token.nexus = principal;
        token.sub = nexusSubject(principal);
      } else {
        delete token.nexus;
      }
      delete token.nexusPrincipal;
      delete token.nexusIdentity;
      return token;
    },
    async session({ session, token }) {
      const principal = principalFromToken(token);
      if (principal) {
        session.nexus = principal;
        session.nexusAccessError = undefined;
      } else {
        session.nexus = undefined;
        session.nexusAccessError = token.nexusAccessError as string | undefined;
      }
      return session;
    },
    authorized({ auth: session }) {
      return Boolean(session?.nexus?.ativo);
    }
  }
});

declare module "next-auth" {
  interface Session {
    nexus?: NexusSessionPrincipal;
    nexusAccessError?: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    nexusPrincipal?: NexusSessionPrincipal;
    nexus?: NexusSessionPrincipal;
    nexusIdentity?: NexusIdentity;
    nexusAccessError?: string;
  }
}
