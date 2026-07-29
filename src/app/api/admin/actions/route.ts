import { NextResponse } from "next/server";
import { z } from "zod";
import { withAdmin } from "@/lib/auth/admin";
import { mutateAdminTask, mutateAdminUser, mutateAdminWorld } from "@/lib/admin/actions";
import { redactAdminError } from "@/lib/admin/security";

const Reason = z.string().trim().min(2).max(500);
const ActionSchema = z.discriminatedUnion("targetType", [
  z.object({ targetType: z.literal("user"), targetUserId: z.string().min(1), action: z.enum(["ban", "unban", "promote", "demote", "revoke-sessions", "delete"]), reason: Reason, confirmation: z.string().max(320).optional() }).strict(),
  z.object({ targetType: z.literal("world"), worldId: z.string().min(1), action: z.enum(["archive", "restore", "delete"]), reason: Reason, confirmation: z.string().max(320).optional() }).strict(),
  z.object({ targetType: z.literal("task"), kind: z.enum(["genesis", "narrative", "rewrite"]), taskId: z.string().min(1), action: z.enum(["cancel", "retry", "recover"]), reason: Reason }).strict(),
]);

function requestIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("cf-connecting-ip") || null;
}

export const POST = withAdmin(async (admin, request) => {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({
    error: "管理操作参数无效",
    fields: parsed.error.flatten().fieldErrors,
  }, { status: 400 });
  const ctx = { actorUserId: admin.id, requestIp: requestIp(request) };
  try {
    const result = parsed.data.targetType === "user" ? await mutateAdminUser(ctx, parsed.data) : parsed.data.targetType === "world" ? await mutateAdminWorld(ctx, parsed.data) : await mutateAdminTask(ctx, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: redactAdminError(error) || "管理操作失败" }, { status: 409 });
  }
});
