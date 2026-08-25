import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { signInternalToken } from "@/lib/internal-token";
import { loadRootEnv } from "@/lib/load-root-env";

loadRootEnv();

type NexusProfile = {
  id: string;
  slug: string;
  nome: string;
  email: string;
  ativo: boolean;
  setores: Array<{
    id: string; slug: string; nome: string; papeis: string[]; permissoes?: string[];
  }>;
  papeisGlobais: string[];
  permissoesGlobais?: string[];
  permissoes: string[];
};

async function resolveNexusProfile(profile: Record<string, unknown>) {
  const tenantId = String(profile.tid || process.env.NEXUS_HUB_ENTRA_TENANT_ID || "");
  const subjectId = String(profile.oid || profile.sub || "");
  const email = String(profile.email || profile.preferred_username || "");
  const token = signInternalToken({
    sub: "auth-bootstrap", typ: "auth", tenantId, subjectId, email,
    name: String(profile.name || email)
  });
  const response = await fetch(`${process.env.NEXUS_API_INTERNAL_URL}/v1/auth/resolve`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store"
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    throw new Error(body?.error?.code || "NEXUS_ACCESS_DENIED");
  }
  return response.json() as Promise<NexusProfile>;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  providers: [MicrosoftEntraID({
    clientId: process.env.NEXUS_HUB_ENTRA_CLIENT_ID,
    clientSecret: process.env.NEXUS_HUB_ENTRA_CLIENT_SECRET,
    issuer: `https://login.microsoftonline.com/${process.env.NEXUS_HUB_ENTRA_TENANT_ID}/v2.0`,
    authorization: { params: { scope: "openid profile email" } }
  })],
  pages: { signIn: "/login", error: "/access-denied" },
  callbacks: {
    async jwt({ token, profile, account }) {
      if (account && profile) token.nexus = await resolveNexusProfile(profile as Record<string, unknown>);
      return token;
    },
    async session({ session, token }) {
      session.nexus = token.nexus as NexusProfile | undefined;
      return session;
    },
    authorized({ auth: session }) {
      return Boolean(session?.nexus?.ativo);
    }
  }
});

declare module "next-auth" {
  interface Session { nexus?: NexusProfile }
}

declare module "@auth/core/jwt" {
  interface JWT { nexus?: NexusProfile }
}
