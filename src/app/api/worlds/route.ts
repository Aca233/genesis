import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { completeStructured } from "@/lib/llm/structured";
import { WorldDeckSchema } from "@/lib/cards/schemas";
import { GENESIS_SYSTEM, genesisUserPrompt } from "@/lib/prompts/genesis";
import { parseStWorldbook, lorebookExcerpts } from "@/lib/lorebook/st-import";

/**
 * POST /api/worlds —— 创世：一句话 → 世界卡组草稿
 * body: { decree: string, lorebook?: unknown(ST worldbook JSON) }
 * GET  /api/worlds —— 存档列表
 */

const CreateSchema = z.object({
  decree: z.string().min(2, "神谕太短").max(2000),
  lorebook: z.unknown().optional(),
});

export const maxDuration = 300;

export async function POST(request: Request) {
  const body = CreateSchema.parse(await request.json());

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
    deck = await completeStructured("narrative", {
      task: "genesis",
      system: GENESIS_SYSTEM,
      user: genesisUserPrompt(body.decree, excerpts),
      schema: WorldDeckSchema,
      maxTokens: 16000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const world = await prisma.world.create({
    data: {
      name: deck.worldName,
      genesisInput: body.decree,
      status: "draft",
      draftDeck: deck as unknown as Prisma.InputJsonValue,
      themeCard: deck.theme as unknown as Prisma.InputJsonValue,
      styleCard: deck.style as unknown as Prisma.InputJsonValue,
      cosmology: deck.cosmology as unknown as Prisma.InputJsonValue,
      fusionAxiom: deck.fusionAxiom
        ? (deck.fusionAxiom as unknown as Prisma.InputJsonValue)
        : undefined,
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
      name: true,
      genesisInput: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ worlds });
}
