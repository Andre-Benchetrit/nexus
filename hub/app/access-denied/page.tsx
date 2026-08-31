import { NexusLogo } from "@/components/nexus-logo";
import { signOut } from "@/auth";

const accessMessages: Record<string, { eyebrow: string; title: string; description: string }> = {
  NEXUS_API_INDISPONIVEL: {
    eyebrow: "SERVIÇO INDISPONÍVEL",
    title: "Não foi possível concluir seu acesso ao Nexus.",
    description: "A autenticação Microsoft funcionou, mas a API interna do Nexus não respondeu. No ambiente local, confirme que a API está ativa em localhost:3001."
  },
  USUARIO_INATIVO: {
    eyebrow: "USUÁRIO INATIVO",
    title: "Seu acesso ao Nexus está desativado.",
    description: "Entre com outra conta Microsoft ou peça a um administrador para reativar seu cadastro."
  },
  TENANT_NAO_AUTORIZADO: {
    eyebrow: "ORGANIZAÇÃO NÃO AUTORIZADA",
    title: "Esta conta Microsoft pertence a outra organização.",
    description: "Escolha uma conta corporativa do locatário autorizado para o Nexus."
  }
};

const defaultMessage = {
  eyebrow: "ACESSO NÃO LIBERADO",
  title: "Sua conta ainda não possui acesso ao Nexus.",
  description: "Você pode escolher outra conta Microsoft ou solicitar ao administrador o pré-cadastro deste e-mail corporativo."
};

export default async function AccessDeniedPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string; error?: string }>;
}) {
  const params = await searchParams;
  const message = accessMessages[params.reason || ""] || defaultMessage;
  return <main className="login-page"><section className="login-card glass-panel">
    <NexusLogo size="large" />
    <p className="eyebrow">{message.eyebrow}</p>
    <h1>{message.title}</h1>
    <p className="muted">{message.description}</p>
    <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
      <button className="secondary-button" type="submit">Entrar com outra conta</button>
    </form>
  </section></main>;
}
