import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/auth/admin";
import { loadAdminDashboard } from "@/lib/admin/dashboard";

export const dynamic = "force-dynamic";
export const GET = withAdmin(async () => NextResponse.json(await loadAdminDashboard()));
