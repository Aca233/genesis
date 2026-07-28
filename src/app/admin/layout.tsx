import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminForbiddenError, AdminUnauthorizedError, requireAdmin } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";
async function loadAdmin() {
  try { return await requireAdmin(); }
  catch (error) { if (error instanceof AdminUnauthorizedError || error instanceof AdminForbiddenError) notFound(); throw error; }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await loadAdmin();
  return <AdminShell adminName={admin.name}>{children}</AdminShell>;
}
