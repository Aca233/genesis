import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { loadAdminAttentionCount } from "@/lib/admin/workbench";
import { AdminForbiddenError, AdminUnauthorizedError, requireAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";
async function loadAdmin() {
  try { return await requireAdmin(); }
  catch (error) { if (error instanceof AdminUnauthorizedError || error instanceof AdminForbiddenError) notFound(); throw error; }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const attentionCountPromise = loadAdminAttentionCount().catch((error) => {
    console.error("[admin.layout] attention count failed", error);
    return null;
  });
  const [admin, attentionCount] = await Promise.all([loadAdmin(), attentionCountPromise]);
  return <AdminShell adminName={admin.name} attentionCount={attentionCount}>{children}</AdminShell>;
}
