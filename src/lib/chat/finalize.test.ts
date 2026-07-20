import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reveal: vi.fn() }));
vi.mock("@/lib/abilities/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/abilities/mutations")>();
  return { ...actual, revealAbilityInTransaction: mocks.reveal };
});

import { finalizeNarration } from "./finalize";

function fixture() {
  const state = { messages: new Map<string, { id: string; chapterId: string; scale: string }>() };
  const tx = {
    message: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => state.messages.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: String(data.id), chapterId: String(data.chapterId), scale: String(data.scale) };
        state.messages.set(row.id, row);
        return row;
      }),
    },
    ability: { findFirst: vi.fn() },
    chronicleEntry: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const client = {
    $transaction: vi.fn(async (operation: (arg: typeof tx) => Promise<unknown>) => operation(tx)),
  };
  return { state, tx, client };
}

const base = {
  generationId: "generation-1",
  chapterId: "chapter-1",
  chapterIndex: 3,
  timelineId: "timeline-1",
  narratorIndex: 4,
  prose: "叙事正文",
  scale: "scene" as const,
  meta: {
    suggestions: [],
    chapterBreakHint: false,
    revealedEventIds: ["chronicle-1"],
    abilityReveals: [
      { abilityId: "ability-1", visibility: "known" as const, evidence: "能力被清楚见证" },
      { abilityId: "invalid", visibility: "known" as const, evidence: "非法" },
    ],
  },
};

describe("finalizeNarration", () => {
  beforeEach(() => vi.clearAllMocks());
  it("在同一事务中保存消息、揭示能力与编年史，非法 ID 仅跳过", async () => {
    const { client, tx } = fixture();
    tx.ability.findFirst
      .mockResolvedValueOnce({ id: "ability-1", version: 2, rumorText: null })
      .mockResolvedValueOnce(null);
    mocks.reveal.mockResolvedValue({ applied: true });
    const log = vi.fn();

    await finalizeNarration(client as never, { ...base, logInvalidReveal: log });

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.message.create).toHaveBeenCalledTimes(1);
    expect(mocks.reveal).toHaveBeenCalledWith(tx, expect.objectContaining({
      abilityId: "ability-1",
      event: expect.objectContaining({ messageId: "generation-1" }),
    }));
    expect(log).toHaveBeenCalledWith({ abilityId: "invalid", generationId: "generation-1" });
    expect(tx.chronicleEntry.updateMany).toHaveBeenCalledTimes(1);
  });

  it("相同 generationId 重试直接复用，不重复任何副作用", async () => {
    const { client, tx } = fixture();
    tx.ability.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "ability-1" ? { id: "ability-1", version: 2, rumorText: null } : null,
    );
    mocks.reveal.mockResolvedValue({ applied: true });

    await finalizeNarration(client as never, base);
    const second = await finalizeNarration(client as never, base);

    expect(second).toEqual({ messageId: "generation-1", reused: true });
    expect(tx.message.create).toHaveBeenCalledTimes(1);
    expect(mocks.reveal).toHaveBeenCalledTimes(1);
    expect(tx.chronicleEntry.updateMany).toHaveBeenCalledTimes(1);
  });

  it("瞬态揭示写失败会拒绝整个 finalization，不吞错", async () => {
    const { client, tx } = fixture();
    tx.ability.findFirst.mockResolvedValue({ id: "ability-1", version: 2, rumorText: null });
    mocks.reveal.mockRejectedValue(new Error("database unavailable"));

    await expect(finalizeNarration(client as never, base)).rejects.toThrow("database unavailable");
    expect(tx.chronicleEntry.updateMany).not.toHaveBeenCalled();
  });
});
