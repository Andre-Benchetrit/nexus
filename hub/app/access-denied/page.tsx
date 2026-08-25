import Link from "next/link";
import { NexusLogo } from "@/components/nexus-logo";

export default function AccessDeniedPage() {
  return <main className="login-page"><section className="login-card glass-panel">
    <NexusLogo size="large" />
    <p className="eyebrow">ACESSO NÃO LIBERADO</p>
    <h1>Sua conta ainda não possui acesso ao Nexus.</h1>
    <p className="muted">Solicite ao administrador o pré-cadastro do seu e-mail corporativo.</p>
    <Link className="secondary-button" href="/login">Voltar ao login</Link>
  </section></main>;
}
