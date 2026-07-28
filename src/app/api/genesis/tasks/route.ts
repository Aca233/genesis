import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseStWorldbook } from "@/lib/lorebook/st-import";
import { MaterialSelectionItemSchema } from "@/lib/materials/types";
import { buildGenesisMaterialSnapshot, snapshotJson } from "@/lib/materials/task-snapshot";
import { WorldModeSchema } from "@/lib/world-mode";
import { withAuth } from "@/lib/auth/route";
import {
  GENESIS_CREATE_MAX_BYTES,
  PayloadLimitError,
  readUtf8Body,
} from "@/lib/genesis/limits";

const CreateGenesisTaskSchema = z.object({
  mode: WorldModeSchema.default("pantheon"),
  decree: z.string().trim().min(2, "神谕太短").max(2000, "神谕过长"),
  lorebook: z.unknown().optional(),
  lorebookName: z.string().max(255).optional(),
  materialSelections: z.array(MaterialSelectionItemSchema).max(40).default([]),
});

export const POST = withAuth(async (userId, request: Request) => {
  let body: unknown;
  try {
    const rawBody = await readUtf8Body(request, GENESIS_CREATE_MAX_BYTES);
    body = JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof PayloadLimitError) {
      return NextResponse.json({
        error: "创世请求超过安全上限",
        code: error.code,
        observedBytes: error.observedBytes,
        limitBytes: error.limitBytes,
      }, { status: 413 });
    }
    return NextResponse.json({ error: "创世请求无效" }, { status: 400 });
  }
  const parsed = CreateGenesisTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "创世请求无效" },
      { status: 400 },
    );
  }

  if (parsed.data.lorebook !== undefined) {
    try {
      parseStWorldbook(parsed.data.lorebook);
    } catch {
      return NextResponse.json(
        { error: "世界书格式无法解析：请提供 SillyTavern worldbook JSON" },
        { status: 400 },
      );
    }
  }

  let materialSelection;
  try { materialSelection = await buildGenesisMaterialSnapshot(parsed.data.materialSelections, userId); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }

  const taskData = {
    userId,
    mode: parsed.data.mode,
    decree: parsed.data.decree,
    lorebook: parsed.data.lorebook as Prisma.InputJsonValue | undefined,
    lorebookName: parsed.data.lorebookName,
    materialSelection: snapshotJson(materialSelection),
    completedKeys: [],
  };
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 128)) {
    return NextResponse.json({ error: "创世幂等键长度必须为 8–128 字符" }, { status: 400 });
  }
  const requestHash = createHash("sha256").update(JSON.stringify({
    mode: taskData.mode,
    decree: taskData.decree,
    lorebook: taskData.lorebook ?? null,
    lorebookName: taskData.lorebookName ?? null,
    materialSelection: taskData.materialSelection,
  }), "utf8").digest("hex");

  const task = idempotencyKey
    ? await prisma.genesisTask.upsert({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        create: { ...taskData, idempotencyKey, requestHash },
        update: {},
        select: { id: true, requestHash: true },
      })
    : await prisma.genesisTask.create({
        data: taskData,
        select: { id: true, requestHash: true },
      });

  if (idempotencyKey && task.requestHash !== requestHash) {
    return NextResponse.json({ error: "幂等键已用于不同的创世请求" }, { status: 409 });
  }

  return NextResponse.json({ taskId: task.id }, { status: 202 });
});
