import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin-dashboard";
import { requireNexusProfile } from "@/lib/server-profile";

export default async function AdminPage() {
  const profile = await requireNexusProfile();
  const auditAllowed = profile.permissoes.includes("auditoria.consultar") ||
    profile.setores.some((setor) => setor.permissoes?.includes("auditoria.consultar.setor"));
  const allowed = auditAllowed || profile.permissoes.some((code) =>
    ["governanca.administrar", "custos.consultar.setor", "custos.consultar.global",
      "documentacao.criar.setor", "documentacao.editar.setor", "documentacao.publicar.setor",
      "documentacao.administrar.global", "documentacao.auditar"].includes(code)
  );
  if (!allowed) redirect("/");
  return <AdminDashboard profile={profile} />;
}
