import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdminDashboard } from "@/components/admin-dashboard";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.nexus) redirect("/login");
  const allowed = session.nexus.permissoes.some((code) =>
    ["governanca.administrar", "auditoria.consultar", "custos.consultar.setor", "custos.consultar.global"].includes(code)
  );
  if (!allowed) redirect("/");
  return <AdminDashboard profile={session.nexus} />;
}
