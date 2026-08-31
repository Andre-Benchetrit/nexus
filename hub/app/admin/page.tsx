import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin-dashboard";
import { requireNexusProfile } from "@/lib/server-profile";

export default async function AdminPage() {
  const profile = await requireNexusProfile();
  const allowed = profile.permissoes.some((code) =>
    ["governanca.administrar", "auditoria.consultar", "custos.consultar.setor", "custos.consultar.global",
      "documentacao.criar.setor", "documentacao.editar.setor", "documentacao.publicar.setor",
      "documentacao.administrar.global", "documentacao.auditar"].includes(code)
  );
  if (!allowed) redirect("/");
  return <AdminDashboard profile={profile} />;
}
