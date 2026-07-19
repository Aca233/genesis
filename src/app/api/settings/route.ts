import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { ModelSlotSchema, type ModelSlot } from "@/lib/llm/types";

/**
 * 设置读写。
 * GET  → 返回设置（Key 以掩码呈现，密文不出服务器）
 * PUT  → 保存槽位/偏好；带明文 apiKey 的槽位在此加密
 */

const PutSchema = z.object({
  narrativeSlot: ModelSlotSchema.nullish(),
  backstageSlot: ModelSlotSchema.nullish(),
  prefs: z.record(z.string(), z.unknown()).nullish(),
});

function maskSlot(raw: unknown) {
  if (!raw) return null;
  const parsed = ModelSlotSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { apiKeyEncrypted: _, apiKey: __, ...rest } = parsed.data;
  return { ...rest, hasKey: Boolean(parsed.data.apiKeyEncrypted) };
}

/** 落库前处理：明文 key → 加密；未提供明文时保留旧密文 */
function sealSlot(
  incoming: ModelSlot | null | undefined,
  existing: unknown,
): ModelSlot | null {
  if (!incoming) return null;
  const { apiKey, ...rest } = incoming;
  if (apiKey) {
    return { ...rest, apiKeyEncrypted: encryptSecret(apiKey) };
  }
  const prev = ModelSlotSchema.safeParse(existing);
  return {
    ...rest,
    apiKeyEncrypted: prev.success ? prev.data.apiKeyEncrypted : undefined,
  };
}

export async function GET() {
  const settings = await prisma.settings.findUnique({ where: { userId: "local" } });
  return NextResponse.json({
    narrativeSlot: maskSlot(settings?.narrativeSlot),
    backstageSlot: maskSlot(settings?.backstageSlot),
    prefs: settings?.prefs ?? {},
  });
}

export async function PUT(request: Request) {
  const body = PutSchema.parse(await request.json());
  const existing = await prisma.settings.findUnique({ where: { userId: "local" } });

  const narrativeSlot =
    body.narrativeSlot === undefined
      ? undefined
      : sealSlot(body.narrativeSlot, existing?.narrativeSlot);
  const backstageSlot =
    body.backstageSlot === undefined
      ? undefined
      : sealSlot(body.backstageSlot, existing?.backstageSlot);

  const data: Prisma.SettingsUpdateInput = {
    ...(narrativeSlot !== undefined && {
      narrativeSlot: (narrativeSlot ?? undefined) as Prisma.InputJsonValue | undefined,
    }),
    ...(backstageSlot !== undefined && {
      backstageSlot: (backstageSlot ?? undefined) as Prisma.InputJsonValue | undefined,
    }),
    ...(body.prefs !== undefined && {
      prefs: (body.prefs ?? undefined) as Prisma.InputJsonValue | undefined,
    }),
  };

  await prisma.settings.upsert({
    where: { userId: "local" },
    create: { userId: "local", ...data } as Prisma.SettingsCreateInput,
    update: data,
  });

  return NextResponse.json({ ok: true });
}
