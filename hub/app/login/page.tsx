import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { NexusLogo } from "@/components/nexus-logo";

export default async function LoginPage() {
  if (await auth()) redirect("/");
  return <main className="login-page">
    <section className="login-card glass-panel">
      <NexusLogo size="large" />
      <p className="eyebrow">INTELIGÊNCIA FID</p>
      <h1>Dados, contexto e decisões em um só lugar.</h1>
      <p className="muted">Entre com sua conta corporativa Microsoft para acessar o Nexus.</p>
      <form action={async () => { "use server"; await signIn("microsoft-entra-id", { redirectTo: "/" }); }}>
        <button className="primary-button login-button" type="submit">
          <span className="microsoft-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          Entrar com Microsoft
        </button>
      </form>
      <small>Acesso restrito a colaboradores previamente autorizados.</small>
    </section>
  </main>;
}
