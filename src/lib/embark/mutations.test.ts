import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { PantheonWorldDeckSchema, type WorldDeck } from "@/lib/cards/schemas";

vi.mock("@/lib/abilities/embark", () => ({
  materializeDeckAbilities: vi.fn(async () => undefined),
}));

import { materializeEmbarkDeck } from "./mutations";

/**
 * 时间锚点契约（时间一致设计稿 §12）下的开局物化：
 * - 新契约卡组：realityState/observerState 从 temporalAnchor 取值并持久化
 *   anchorOrdinal/canonCutoff；非 active 锚点状态人物物化为 heat=dormant。
 * - 旧卡组：物化数据逐字节不变（不出现任何新键）。
 */

function anchoredDeck(): WorldDeck {
  const deck = completeDeck();
  return PantheonWorldDeckSchema.parse({
    ...deck,
    temporalAnchor: {
      source: {
        basis: "single_ip",
        sourceIps: ["测试原作"],
        continuity: "原著小说线",
        continuitySource: "model_inferred",
        ambiguityNotes: [],
      },
      anchor: {
        anchorType: "main_story_opening",
        currentTimeLabel: "帝国历 998 年冬",
        currentEraLabel: "帝国历晚期",
        anchorEvent: "就在黑船叩港的前夜",
        canonCutoff: "主线大战爆发之前",
        selectionSource: "model_inferred",
        confidence: "high",
        assumptions: [],
      },
      anchorOrdinal: 0,
    },
    majorCharacters: deck.majorCharacters.map((character, index) => ({
      ...character,
      ...(index === 1 ? { statusAtAnchor: "dead", anchorNote: "三年前战死于北境" } : {}),
      ...(index === 2 ? { statusAtAnchor: "active" } : {}),
    })),
  });
}

function fakeTx() {
  const entityRows: Record<string, unknown>[] = [];
  const timelineRows: Record<string, unknown>[] = [];
  let idCounter = 0;
  const nextId = () => `id-${++idCounter}`;
  const tx = {
    timeline: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        timelineRows.push(data);
        return { ...data, id: "timeline-1" };
      }),
    },
    god: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: nextId() })),
      update: vi.fn(async () => ({})),
    },
    entity: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        entityRows.push(data);
        return { ...data, id: nextId() };
      }),
    },
    canonEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: nextId() })),
    },
    chapter: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: "chapter-1" })),
    },
    world: {
      update: vi.fn(async () => ({})),
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, entityRows, timelineRows };
}

function characterRow(entityRows: Record<string, unknown>[], name: string): Record<string, unknown> {
  const row = entityRows.find((entry) => entry.type === "character" && entry.name === name);
  if (!row) throw new Error(`缺少人物实体 ${name}`);
  return row;
}

describe("materializeEmbarkDeck 时间锚点物化", () => {
  it("新契约卡组：锚点时间入 realityState/observerState，非 active 人物物化为 dormant", async () => {
    const { tx, entityRows, timelineRows } = fakeTx();

    await materializeEmbarkDeck(tx, "world-1", anchoredDeck(), "pantheon");

    expect(timelineRows).toHaveLength(1);
    expect(timelineRows[0]!.realityState).toMatchObject({
      currentEra: "帝国历晚期",
      anchorOrdinal: 0,
      canonCutoff: "主线大战爆发之前",
    });
    expect(timelineRows[0]!.observerState).toMatchObject({
      timeLabel: "帝国历 998 年冬",
    });

    // statusAtAnchor=dead 的人物 2 物化为 dormant；active（显式或缺省）不写 heat 键
    expect(characterRow(entityRows, "人物2")).toMatchObject({ heat: "dormant" });
    expect(characterRow(entityRows, "人物1")).not.toHaveProperty("heat");
    expect(characterRow(entityRows, "人物3")).not.toHaveProperty("heat");
  });

  it("旧卡组（无 temporalAnchor）：物化数据逐字节不变，不出现锚点键", async () => {
    const { tx, entityRows, timelineRows } = fakeTx();
    const deck = completeDeck();

    await materializeEmbarkDeck(tx, "world-1", deck, "pantheon");

    const realityState = timelineRows[0]!.realityState as Record<string, unknown>;
    const observerState = timelineRows[0]!.observerState as Record<string, unknown>;
    expect(realityState.currentEra).toBe(deck.epochConflict.epochName);
    expect(realityState).not.toHaveProperty("anchorOrdinal");
    expect(realityState).not.toHaveProperty("canonCutoff");
    expect(observerState.timeLabel).toBe(deck.epochConflict.yearLabel);
    for (const row of entityRows) {
      expect(row).not.toHaveProperty("heat");
    }
  });

  it("卡组携带 temporalAnchor 但人物全为 active 时不产生任何 dormant 实体", async () => {
    const { tx, entityRows } = fakeTx();
    const deck = completeDeck();
    const anchored = PantheonWorldDeckSchema.parse({
      ...deck,
      temporalAnchor: {
        source: { basis: "original", ambiguityNotes: [] },
        anchor: {
          anchorType: "original_present",
          currentTimeLabel: "裂光元年",
          currentEraLabel: "裂光纪",
          anchorEvent: "晨钟第一次为新神鸣响",
          canonCutoff: null,
          selectionSource: "model_inferred",
          confidence: "high",
          assumptions: [],
        },
        anchorOrdinal: 0,
      },
    });

    await materializeEmbarkDeck(tx, "world-1", anchored, "pantheon");

    for (const row of entityRows) {
      expect(row).not.toHaveProperty("heat");
    }
  });
});
