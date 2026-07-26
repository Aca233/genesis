import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { testSlot } from "@/lib/llm/gateway";
import { ModelSlotSchema } from "@/lib/llm/types";

/**
 * 「试炼一问」连接测试。
 * body: { slot: ModelSlot（可含明文 apiKey）, useSaved?: "narrative"|"backstage" }
 * 明文 key 优先；否则用已保存槽位的密文解密测试。
 */

const BodySchema = z.object({
  slot: ModelSlotSchema,
  useSaved: z.enum(["narrative", "backstage"]).optional(),
});

export async function POST(request: Request) {
  const { slot, useSaved } = BodySchema.parse(await request.json());

  let apiKey = slot.apiKey;
  if (!apiKey && useSaved) {
    const settings = await prisma.settings.findUnique({ where: { userId: "local" } });
    const saved = ModelSlotSchema.safeParse(
      useSaved === "narrative" ? settings?.narrativeSlot : settings?.backstageSlot,
    );
    if (saved.success && saved.data.apiKeyEncrypted) {
      apiKey = decryptSecret(saved.data.apiKeyEncrypted);
    }
  }
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "未提供 API Key" },
      { status: 400 },
    );
  }

  try {
    const reply = await testSlot(slot, apiKey, "local");
    return NextResponse.json({ ok: true, reply: reply.slice(0, 200) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
