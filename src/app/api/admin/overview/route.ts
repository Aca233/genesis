import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/auth/admin";
import { loadAdminOverview } from "@/lib/admin/data";

export const dynamic = "force-dynamic";
export const GET = withAdmin(async () => NextResponse.json(await loadAdminOverview()));
