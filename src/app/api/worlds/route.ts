import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { completeStructured } from "@/lib/llm/structured";
import { CreatorWorldDeckSchema, PantheonWorldDeckSchema } from "@/lib/cards/schemas";
import { validateDeckReferences } from "@/lib/abilities/validator";
import { genesisSystem, genesisUserPrompt } from "@/lib/prompts/genesis";
import { parseStWorldbook, lorebookExcerpts } from "@/lib/lorebook/st-import";
import { WorldModeSchema } from "@/lib/world-mode";
import { buildWorldIconTheme } from "@/lib/icons/theme";

/**
 * POST /api/worlds —— 创世：一句话 → 世界卡组草稿
 * body: { decree: string, lorebook?: unknown(ST worldbook JSON) }
 * GET  /api/worlds —— 存档列表
 */

const CreateSchema = z.object({
  mode: WorldModeSchema.default("pantheon"),
  decree: z.string().min(2, "神谕太短").max(2000),
  lorebook: z.unknown().optional(),
});

export const maxDuration = 300;

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "创世请求无效" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "创世请求无效" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // 世界书导入（可选）
  let excerpts: string | undefined;
  let parsedEntries: ReturnType<typeof parseStWorldbook> = [];
  if (body.lorebook) {
    try {
      parsedEntries = parseStWorldbook(body.lorebook);
      excerpts = lorebookExcerpts(parsedEntries) || undefined;
    } catch {
      return NextResponse.json(
        { error: "世界书格式无法解析：请提供 SillyTavern worldbook JSON" },
        { status: 400 },
      );
    }
  }

  let deck;
  try {
    const request = {
      task: "genesis" as const,
      system: genesisSystem(body.mode),
      user: genesisUserPrompt({
        mode: body.mode,
        decree: body.decree,
        lorebookExcerpts: excerpts,
      }),
      maxTokens: 16000,
      cache: { namespace: `genesis:v1:${body.mode}` },
    };
    deck = body.mode === "pantheon"
      ? await completeStructured("narrative", { ...request, schema: PantheonWorldDeckSchema })
      : await completeStructured("narrative", { ...request, schema: CreatorWorldDeckSchema });
    if (deck.mode !== body.mode) throw new Error("创世卡组模式不匹配");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  try {
    validateDeckReferences(deck);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "卡组引用校验失败", issues: [message] }, { status: 400 });
  }

  const world = await prisma.world.create({
    data: {
      name: deck.worldName,
      genesisInput: body.decree,
      mode: body.mode,
      status: "draft",
      draftDeck: deck as unknown as Prisma.InputJsonValue,
      themeCard: deck.theme as unknown as Prisma.InputJsonValue,
      styleCard: deck.style as unknown as Prisma.InputJsonValue,
      cosmology: deck.cosmology as unknown as Prisma.InputJsonValue,
      fusionAxiom: deck.fusionAxiom
        ? (deck.fusionAxiom as unknown as Prisma.InputJsonValue)
        : undefined,
      iconTheme: buildWorldIconTheme(deck) as unknown as Prisma.InputJsonValue,
      lorebookEntries: {
        create: parsedEntries.map((e) => ({
          keys: e.keys,
          content: e.content,
          enabled: e.enabled,
          stExtra: e.stExtra as Prisma.InputJsonValue,
          source: "imported",
        })),
      },
    },
  });

  return NextResponse.json({ worldId: world.id, deck });
}

export async function GET() {
  const worlds = await prisma.world.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      mode: true,
      name: true,
      genesisInput: true,
      status: true,
      materialArchiveStatus: true,
      materialArchiveError: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ worlds });
}
