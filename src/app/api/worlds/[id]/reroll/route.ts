import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { completeStructured } from "@/lib/llm/structured";
import {
  CreatorWorldDeckSchema,
  PantheonWorldDeckSchema,
  parsePersistedWorldDeck,
  DECK_CARD_KEYS,
  type WorldDeck,
} from "@/lib/cards/schemas";
import { validateDeckReferences } from "@/lib/abilities/validator";
import {
  genesisSystem,
  rerollReferenceRepairPrompt,
  rerollUserPrompt,
} from "@/lib/prompts/genesis";
import { assertModeTransition, WorldModeSchema } from "@/lib/world-mode";
import { withAuth } from "@/lib/auth/route";
import { ownedWhere } from "@/lib/auth/ownership";
import type { ParsedLorebookEntry } from "@/lib/lorebook/st-import";
import { generateGenesisIntent } from "@/lib/genesis/intent-generator";
import {
  assertGenesisIntentForMode,
  parseGenesisIntent,
  type GenesisIntentContract,
} from "@/lib/genesis/intent";
import type { GenesisQualityReport } from "@/lib/genesis/semantic-audit";
import {
  enforceGenesisQuality,
  GenesisSemanticGateError,
} from "@/lib/genesis/semantic-gate";
import { preserveLockedPaths } from "@/lib/genesis/locked-paths";
import { resolveLorebookExcerpts } from "@/lib/genesis/task-runner";

/**
 * POST /api/worlds/[id]/reroll —— 单卡重掷（其余卡组为约束；player_locked 保留）
 * body: { cardKey: DeckCardKey, note?: string }
 */

const BodySchema = z.object({
  cardKey: z.enum(DECK_CARD_KEYS),
  note: z.string().max(500).optional(),
});

export const maxDuration = 300;

function normalizeLorebookEntries(entries: Array<{
  keys: string[];
  content: string;
  enabled: boolean;
  stExtra: Prisma.JsonValue | null;
}>): ParsedLorebookEntry[] {
  return entries.map((entry) => ({
    keys: entry.keys,
    content: entry.content,
    enabled: entry.enabled,
    stExtra: entry.stExtra !== null
      && typeof entry.stExtra === "object"
      && !Array.isArray(entry.stExtra)
      ? { ...entry.stExtra }
      : {},
  }));
}

function referenceIssue(deck: WorldDeck): string | null {
  try {
    validateDeckReferences(deck);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export const POST = withAuth(async (
  userId,
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const { cardKey, note } = BodySchema.parse(await request.json());

  const world = await prisma.world.findFirst({
    where: ownedWhere.world(userId, id),
    include: { lorebookEntries: true },
  });
  if (world === null) {
    return NextResponse.json({ error: "世界草稿不存在" }, { status: 404 });
  }
  if (world.status !== "draft") {
    return NextResponse.json({ error: "世界已开局，不可修改卡组" }, { status: 409 });
  }
  if (world.draftDeck === null) {
    return NextResponse.json({ error: "世界草稿不存在" }, { status: 404 });
  }

  let currentDeck: WorldDeck;
  try {
    currentDeck = parsePersistedWorldDeck(world.draftDeck);
  } catch {
    return NextResponse.json({ error: "草稿卡组已损坏" }, { status: 500 });
  }

  const mode = WorldModeSchema.parse(world.mode);
  try {
    assertModeTransition(mode, currentDeck.mode);
  } catch {
    return NextResponse.json({ error: "世界模式不可更改" }, { status: 409 });
  }
  if (mode === "creator" && cardKey === "playerGod") {
    return NextResponse.json({ error: "创世主模式不能重掷玩家神" }, { status: 409 });
  }
  const lockedPaths = world.lockedPaths;

  const persistedIntent = parseGenesisIntent(world.genesisIntent);
  if (world.genesisIntent !== null && persistedIntent === null) {
    return NextResponse.json({ error: "创世意图契约已损坏" }, { status: 500 });
  }
  if (persistedIntent !== null) {
    try {
      assertGenesisIntentForMode(persistedIntent, mode);
    } catch {
      return NextResponse.json(
        { error: "创世意图契约与世界模式不匹配" },
        { status: 500 },
      );
    }
  }

  let lorebookExcerpts: string | undefined;
  let intent: GenesisIntentContract;
  try {
    lorebookExcerpts = await resolveLorebookExcerpts(
      normalizeLorebookEntries(world.lorebookEntries),
      userId,
    );
    intent = persistedIntent ?? await generateGenesisIntent({
      mode,
      decree: world.genesisInput,
      userId,
      lorebookExcerpts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  let generated: WorldDeck;
  try {
    const requestOptions = {
      task: "reroll" as const,
      userId,
      system: genesisSystem(mode),
      user: rerollUserPrompt({
        mode,
        decree: world.genesisInput,
        cardKey,
        currentDeckJson: JSON.stringify(currentDeck),
        intentContract: intent,
        lockedNote: lockedPaths.length ? lockedPaths.join(", ") : undefined,
        playerNote: note,
      }),
      maxTokens: 16000,
      cache: { namespace: `reroll:v1:${mode}` },
    };
    generated = mode === "pantheon"
      ? await completeStructured("narrative", { ...requestOptions, schema: PantheonWorldDeckSchema })
      : await completeStructured("narrative", { ...requestOptions, schema: CreatorWorldDeckSchema });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
  try {
    assertModeTransition(mode, generated.mode);
  } catch {
    return NextResponse.json({ error: "世界模式不可更改" }, { status: 409 });
  }

  let deck: WorldDeck;
  try {
    deck = preserveLockedPaths(generated, currentDeck, lockedPaths, mode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `重掷结果与锁定字段无法组成有效卡组：${message}` }, { status: 502 });
  }

  const firstReferenceIssue = referenceIssue(deck);
  if (firstReferenceIssue !== null) {
    try {
      const repairOptions = {
        task: "reroll" as const,
        userId,
        system: genesisSystem(mode),
        user: rerollReferenceRepairPrompt({
          mode,
          decree: world.genesisInput,
          currentDeckJson: JSON.stringify(deck),
          referenceIssue: firstReferenceIssue,
          intentContract: intent,
        }),
        maxTokens: 16000,
        cache: { namespace: `reroll:v1:${mode}` },
      };
      const repaired = mode === "pantheon"
        ? await completeStructured("narrative", { ...repairOptions, schema: PantheonWorldDeckSchema })
        : await completeStructured("narrative", { ...repairOptions, schema: CreatorWorldDeckSchema });
      try {
        assertModeTransition(mode, repaired.mode);
      } catch {
        return NextResponse.json({ error: "世界模式不可更改" }, { status: 409 });
      }
      deck = preserveLockedPaths(repaired, currentDeck, lockedPaths, mode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `重掷引用修复失败：${message}` }, { status: 502 });
    }

    const repairedReferenceIssue = referenceIssue(deck);
    if (repairedReferenceIssue !== null) {
      return NextResponse.json(
        { error: "重掷引用修复后仍无效", issues: [repairedReferenceIssue] },
        { status: 502 },
      );
    }
  }

  let auditReport: GenesisQualityReport;
  try {
    const quality = await enforceGenesisQuality({
      deck,
      mode,
      decree: world.genesisInput,
      intent,
      userId,
      lorebookExcerpts,
      materialSnapshot: null,
      lockedPaths,
      currentDeck,
    });
    deck = quality.deck;
    auditReport = quality.report;
  } catch (err) {
    if (err instanceof GenesisSemanticGateError) {
      return NextResponse.json(
        { error: err.message, auditReport: err.report },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  try {
    assertModeTransition(mode, deck.mode);
  } catch {
    return NextResponse.json({ error: "世界模式不可更改" }, { status: 409 });
  }

  const updatedAt = await prisma.$transaction(async (tx) => {
    const { count } = await tx.world.updateMany({
      where: { id, userId, mode, status: "draft", updatedAt: world.updatedAt },
      data: {
        name: deck.worldName,
        draftDeck: deck as unknown as Prisma.InputJsonValue,
        themeCard: deck.theme as unknown as Prisma.InputJsonValue,
        styleCard: deck.style as unknown as Prisma.InputJsonValue,
        cosmology: deck.cosmology as unknown as Prisma.InputJsonValue,
        genesisIntent: intent as unknown as Prisma.InputJsonValue,
        fusionAxiom: deck.fusionAxiom
          ? (deck.fusionAxiom as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
    if (count !== 1) return null;
    await tx.genesisTask.updateMany({
      where: { worldId: id, userId },
      data: { auditReport: auditReport as unknown as Prisma.InputJsonValue },
    });
    const updated = await tx.world.findUnique({
      where: { id },
      select: { updatedAt: true },
    });
    return updated?.updatedAt ?? null;
  });
  if (updatedAt === null) {
    const latest = await prisma.world.findUnique({ where: { id }, select: { status: true } });
    return NextResponse.json(
      {
        error: latest !== null && latest.status !== "draft"
          ? "世界已开局，不可修改卡组"
          : "卡组已被其他操作更新，请刷新后重试",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ deck, updatedAt, auditReport, genesisIntent: intent });
});
