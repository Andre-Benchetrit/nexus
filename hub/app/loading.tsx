import { NexusLogo } from "@/components/nexus-logo";

export default function Loading() {
  return <main className="route-loading" role="status" aria-label="Carregando Nexus">
    <div className="route-loading-card">
      <NexusLogo />
      <span className="route-loading-orbit"><i /><i /><i /></span>
      <strong>Preparando sua área</strong>
      <small>Validando acesso e carregando informações autorizadas…</small>
    </div>
  </main>;
}
