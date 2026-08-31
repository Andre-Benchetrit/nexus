import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { NexusLogo } from "@/components/nexus-logo";

export default async function LoginPage() {
  const session = await auth();
  if (session?.nexus?.ativo) redirect("/");
  if (session?.nexusAccessError) {
    redirect(`/access-denied?reason=${encodeURIComponent(session.nexusAccessError)}`);
  }
  return <main className="login-page">
    <section className="login-card glass-panel">
      <NexusLogo size="large" />
      <p className="eyebrow">INTELIGÊNCIA FID</p>
      <h1>Dados, contexto e decisões em um só lugar.</h1>
      <p className="muted">Entre com sua conta corporativa Microsoft para acessar o Nexus.</p>
      <form action={async () => { "use server"; await signIn("microsoft-entra-id", { redirectTo: "/" }); }}>
        <button className="primary-button login-button" type="submit">
          <span className="microsoft-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          Escolher conta Microsoft
        </button>
      </form>
      <small>Você poderá escolher qual conta Microsoft usar. Acesso restrito a colaboradores previamente autorizados.</small>
    </section>
  </main>;
}
