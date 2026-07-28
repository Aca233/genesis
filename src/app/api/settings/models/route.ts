import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { adapters } from "@/lib/llm/adapters";
import { ModelSlotSchema } from "@/lib/llm/types";
import { withAuth } from "@/lib/auth/route";

/**
 * POST /api/settings/models —— 获取端点可用模型列表
 * body: { provider, baseUrl, apiKey?, useSaved?: "narrative"|"backstage" }
 * 明文 key 优先；否则用已保存槽位的密文解密。
 */

const BodySchema = z.object({
  provider: z.enum(["openai-compatible", "anthropic", "gemini"]),
  baseUrl: z.string().min(1),
  apiKey: z.string().optional(),
  useSaved: z.enum(["narrative", "backstage"]).optional(),
});

export const POST = withAuth(async (userId, request: Request) => {
  const { provider, baseUrl, apiKey: plainKey, useSaved } = BodySchema.parse(
    await request.json(),
  );

  let apiKey = plainKey;
  if (!apiKey && useSaved) {
    const settings = await prisma.settings.findUnique({ where: { userId } });
    const saved = ModelSlotSchema.safeParse(
      useSaved === "narrative" ? settings?.narrativeSlot : settings?.backstageSlot,
    );
    if (saved.success && saved.data.apiKeyEncrypted) {
      apiKey = decryptSecret(saved.data.apiKeyEncrypted);
    }
  }
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "未提供 API Key" }, { status: 400 });
  }

  try {
    const models = await adapters[provider].listModels(baseUrl, apiKey);
    return NextResponse.json({ ok: true, models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
});
