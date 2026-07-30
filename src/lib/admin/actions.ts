import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { wakeGenesisScheduler } from "@/lib/genesis/scheduler";
import { ensureRealityRewriteRunning } from "@/lib/reality/task-runner";
import { assertAdminConfirmation, assertAdminMutationAllowed, redactAdminError } from "./security";
import { canAdminTaskAction, type AdminTaskAction, type AdminTaskKind } from "./task-attention";

export type AdminActionContext = { actorUserId: string; requestIp: string | null };
type AdminDb = typeof prisma;

function assertAdminTaskActionAllowed(task: { kind: AdminTaskKind; status: string; leaseExpiresAt: Date | null }, action: AdminTaskAction, now: Date) {
  if (!canAdminTaskAction(task, action, now)) throw new Error("任务当前不可执行此操作");
}

async function audit(db: AdminDb, ctx: AdminActionContext, input: { action: string; targetType: string; targetId: string; targetLabel: string; reason: string; success: boolean; metadata?: Prisma.InputJsonValue }) {
  await db.adminAuditLog.create({ data: { actorUserId: ctx.actorUserId, requestIp: ctx.requestIp, ...input } });
}

export async function mutateAdminUser(ctx: AdminActionContext, input: { targetUserId: string; action: "ban" | "unban" | "promote" | "demote" | "revoke-sessions" | "delete"; reason: string; confirmation?: string }, db: AdminDb = prisma) {
  const target = await db.user.findUnique({ where: { id: input.targetUserId }, select: { id: true, name: true, email: true, role: true, banned: true } });
  if (!target) throw new Error("用户不存在");
  const activeAdminCount = await db.user.count({ where: { role: "admin", OR: [{ banned: false }, { banned: null }] } });
  if (input.action === "ban") assertAdminMutationAllowed({ action: "ban-user", actorUserId: ctx.actorUserId, targetUserId: target.id, activeAdminCount, targetIsActiveAdmin: target.role === "admin" && target.banned !== true });
  if (input.action === "demote") assertAdminMutationAllowed({ action: "demote-user", actorUserId: ctx.actorUserId, targetUserId: target.id, activeAdminCount, targetIsActiveAdmin: target.role === "admin" && target.banned !== true });
  if (input.action === "delete") {
    assertAdminMutationAllowed({ action: "delete-user", actorUserId: ctx.actorUserId, targetUserId: target.id, activeAdminCount, targetIsActiveAdmin: target.role === "admin" && target.banned !== true });
    assertAdminConfirmation({ expected: target.email, confirmation: input.confirmation ?? "", reason: input.reason });
  } else if (!input.reason.trim()) throw new Error("必须填写操作原因");

  try {
    if (input.action === "revoke-sessions") await db.session.deleteMany({ where: { userId: target.id } });
    else if (input.action === "delete") await db.$transaction(async (tx) => {
      await tx.adminAuditLog.create({ data: { actorUserId: ctx.actorUserId, action: "delete-user", targetType: "user", targetId: target.id, targetLabel: target.email, reason: input.reason.trim(), success: true, requestIp: ctx.requestIp } });
      await tx.settings.deleteMany({ where: { userId: target.id } });
      await tx.loreIndexEntry.deleteMany({ where: { userId: target.id } });
      await tx.genesisTask.deleteMany({ where: { userId: target.id } });
      await tx.materialCard.deleteMany({ where: { userId: target.id } });
      await tx.world.deleteMany({ where: { userId: target.id } });
      await tx.session.deleteMany({ where: { userId: target.id } });
      await tx.llmCall.updateMany({ where: { userId: target.id }, data: { userId: null } });
      await tx.user.delete({ where: { id: target.id } });
    });
    else {
      const data = input.action === "ban" ? { banned: true, banReason: input.reason.trim() } : input.action === "unban" ? { banned: false, banReason: null, banExpires: null } : input.action === "promote" ? { role: "admin" } : { role: "user" };
      await db.user.update({ where: { id: target.id }, data });
      if (input.action === "ban") await db.session.deleteMany({ where: { userId: target.id } });
    }
    if (input.action !== "delete") await audit(db, ctx, { action: `${input.action}-user`, targetType: "user", targetId: target.id, targetLabel: target.email, reason: input.reason.trim(), success: true, metadata: { previousRole: target.role, previousBanned: target.banned } });
    return { ok: true };
  } catch (error) {
    await audit(db, ctx, { action: `${input.action}-user`, targetType: "user", targetId: target.id, targetLabel: target.email, reason: input.reason.trim(), success: false, metadata: { error: redactAdminError(error) } }).catch(() => undefined);
    throw error;
  }
}

export async function mutateAdminWorld(ctx: AdminActionContext, input: { worldId: string; action: "archive" | "restore" | "delete"; reason: string; confirmation?: string }, db: AdminDb = prisma) {
  const world = await db.world.findUnique({ where: { id: input.worldId }, select: { id: true, name: true, archivedAt: true } });
  if (!world) throw new Error("世界不存在");
  if (input.action === "delete") assertAdminConfirmation({ expected: world.name, confirmation: input.confirmation ?? "", reason: input.reason });
  else if (!input.reason.trim()) throw new Error("必须填写操作原因");
  try {
    if (input.action === "delete") await db.$transaction(async (tx) => { await tx.adminAuditLog.create({ data: { actorUserId: ctx.actorUserId, action: "delete-world", targetType: "world", targetId: world.id, targetLabel: world.name, reason: input.reason.trim(), success: true, requestIp: ctx.requestIp } }); await tx.world.delete({ where: { id: world.id } }); });
    else { await db.world.update({ where: { id: world.id }, data: { archivedAt: input.action === "archive" ? new Date() : null } }); await audit(db, ctx, { action: `${input.action}-world`, targetType: "world", targetId: world.id, targetLabel: world.name, reason: input.reason.trim(), success: true }); }
    return { ok: true };
  } catch (error) {
    await audit(db, ctx, { action: `${input.action}-world`, targetType: "world", targetId: world.id, targetLabel: world.name, reason: input.reason.trim(), success: false, metadata: { error: redactAdminError(error) } }).catch(() => undefined);
    throw error;
  }
}

export async function mutateAdminTask(ctx: AdminActionContext, input: { kind: "genesis" | "narrative" | "rewrite"; taskId: string; action: "cancel" | "retry" | "recover"; reason: string }, db: AdminDb = prisma) {
  if (!input.reason.trim()) throw new Error("必须填写操作原因");
  const now = new Date();
  let targetType = `${input.kind}-task`;
  let targetLabel = input.taskId;
  try {
  if (input.kind === "genesis") {
    const task = await db.genesisTask.findUnique({ where: { id: input.taskId }, select: { id: true, userId: true, status: true, stage: true, leaseExpiresAt: true, aggregateVersion: true } });
    if (!task) throw new Error("任务不存在");
    targetType = "genesis-task";
    targetLabel = task.stage;
    assertAdminTaskActionAllowed({ kind: "genesis", status: task.status, leaseExpiresAt: task.leaseExpiresAt }, input.action, now);
    const nextStatus = input.action === "cancel" ? "cancelled" : "queued";
    const aggregateVersion = task.aggregateVersion + 1;
    const changed = await db.$transaction(async (tx) => {
      const result = await tx.genesisTask.updateMany({
        where: {
          id: task.id,
          aggregateVersion: task.aggregateVersion,
          ...(input.action === "cancel"
            ? { status: { in: ["queued", "running", "repairing"] } }
            : input.action === "retry"
              ? { status: "failed" }
              : { status: { in: ["running", "repairing"] }, leaseExpiresAt: { lt: new Date() } }),
        },
        data: {
          status: nextStatus,
          error: input.action === "cancel" ? "管理员已取消" : null,
          leaseToken: null,
          leaseExpiresAt: null,
          ...(input.action === "cancel" ? {} : { attempt: 0 }),
          aggregateVersion,
        },
      });
      if (result.count !== 1) return false;
      const job = await tx.genesisJob.updateMany({
        where: { genesisTaskId: task.id, nodeKey: "legacy-world-deck" },
        data: {
          status: nextStatus,
          error: input.action === "cancel" ? "管理员已取消" : null,
          leaseToken: null,
          leaseExpiresAt: null,
          completedAt: input.action === "cancel" ? new Date() : null,
          ...(input.action === "cancel" ? {} : { attempt: 0 }),
        },
      });
      if (job.count !== 1) throw new Error("创世任务缺少持久作业");
      await tx.genesisOutbox.create({
        data: {
          taskId: task.id,
          aggregateVersion,
          eventType: input.action === "cancel" ? "task_cancelled" : "task_requeued",
          payloadProjection: {
            status: nextStatus,
            stage: task.stage,
            ...(input.action === "cancel" ? { error: "管理员已取消" } : {}),
          },
        },
      });
      return true;
    });
    if (!changed) throw new Error(input.action === "cancel" ? "任务当前不可取消" : "任务当前不可恢复");
    if (input.action !== "cancel") wakeGenesisScheduler();
    await audit(db, ctx, { action: `${input.action}-task`, targetType: "genesis-task", targetId: task.id, targetLabel: task.stage, reason: input.reason.trim(), success: true });
  } else if (input.kind === "narrative") {
    const task = await db.generationRequest.findUnique({ where: { id: input.taskId }, select: { id: true, status: true, leaseExpiresAt: true, chapter: { select: { timeline: { select: { world: { select: { id: true, name: true } } } } } } } });
    if (!task) throw new Error("任务不存在");
    targetType = "narrative-task";
    targetLabel = task.chapter.timeline.world.name;
    assertAdminTaskActionAllowed({ kind: "narrative", status: task.status, leaseExpiresAt: task.leaseExpiresAt }, input.action, now);
    const result = await db.generationRequest.updateMany({ where: { id: task.id, status: "pending" }, data: { status: "cancelled", retryable: true, safeError: "管理员已取消", leaseExpiresAt: null, stageUpdatedAt: new Date() } });
    if (result.count !== 1) throw new Error("任务当前不可取消");
    await audit(db, ctx, { action: "cancel-task", targetType: "narrative-task", targetId: task.id, targetLabel: task.chapter.timeline.world.name, reason: input.reason.trim(), success: true });
  } else {
    const task = await db.realityRewrite.findUnique({
      where: { id: input.taskId },
      select: {
        id: true,
        status: true,
        plan: true,
        resultTimelineId: true,
        leaseToken: true,
        leaseExpiresAt: true,
        world: { select: { name: true } },
      },
    });
    if (!task) throw new Error("任务不存在");
    targetType = "rewrite-task";
    targetLabel = task.world.name;
    assertAdminTaskActionAllowed({ kind: "rewrite", status: task.status, leaseExpiresAt: task.leaseExpiresAt }, input.action, now);
    if (input.action === "cancel") {
      const result = await db.realityRewrite.updateMany({
        where: { id: task.id, status: { in: ["planning", "applying", "narrating"] } },
        data: { status: "cancelled", leaseToken: null, leaseExpiresAt: null, error: "管理员已取消" },
      });
      if (result.count !== 1) throw new Error("任务当前不可取消");
    } else {
      const nextStatus = input.action === "retry"
        ? task.resultTimelineId !== null
          ? "narrating"
          : task.plan !== null ? "applying" : "planning"
        : task.status;
      const result = await db.realityRewrite.updateMany({
        where: {
          id: task.id,
          status: task.status,
          leaseToken: task.leaseToken,
          leaseExpiresAt: task.leaseExpiresAt,
        },
        data: { status: nextStatus, error: null, leaseToken: null, leaseExpiresAt: null },
      });
      if (result.count !== 1) throw new Error("任务状态已变化，请刷新后重试");
      ensureRealityRewriteRunning(task.id);
    }
    await audit(db, ctx, { action: `${input.action}-task`, targetType: "rewrite-task", targetId: task.id, targetLabel: task.world.name, reason: input.reason.trim(), success: true });
  }
  return { ok: true };
  } catch (error) {
    await audit(db, ctx, { action: `${input.action}-task`, targetType, targetId: input.taskId, targetLabel, reason: input.reason.trim(), success: false, metadata: { error: redactAdminError(error) } }).catch(() => undefined);
    throw error;
  }
}
