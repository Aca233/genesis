import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    world: { findUnique: vi.fn() },
    chapter: { findUnique: vi.fn() },
    god: { findMany: vi.fn() },
    omenQueue: { findMany: vi.fn(), updateMany: vi.fn() },
    chronicleEntry: { findMany: vi.fn() },
    entity: { findMany: vi.fn() },
  },
  buildAbilityContext: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/abilities/context", () => ({
  buildAbilityContext: mocks.buildAbilityContext,
}));

import { buildNarratorContext } from "./builder";

describe("buildNarratorContext ability viewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.world.findUnique.mockResolvedValue({
      name: "测试世界", styleCard: null, themeCard: null, cosmology: null,
      fusionAxiom: null, lorebookEntries: [],
    });
    mocks.prisma.chapter.findUnique
      .mockResolvedValueOnce({
        id: "chapter-1", timelineId: "timeline-1", index: 1,
        messages: [{ role: "narrator", content: "林霁站在潮神庙前" }],
      })
      .mockResolvedValueOnce(null);
    mocks.prisma.god.findMany.mockResolvedValue([]);
    mocks.prisma.omenQueue.findMany.mockResolvedValue([]);
    mocks.prisma.chronicleEntry.findMany.mockResolvedValue([]);
    mocks.prisma.entity.findMany.mockResolvedValue([]);
    mocks.buildAbilityContext.mockResolvedValue(
      "== KNOWN ABILITIES ==\n—\n\n== AUTHOR-ONLY HIDDEN ABILITIES ==\n- [hidden] 秘能",
    );
  });

  it("chat Narrator 使用 narrator viewer，并把相关幕后能力仅放入模型 system context", async () => {
    const messages = await buildNarratorContext({
      worldId: "world-1", chapterId: "chapter-1", playerInput: "询问林霁",
      scale: "scene", mode: "say",
    });

    expect(mocks.buildAbilityContext).toHaveBeenCalledWith({
      timelineId: "timeline-1",
      viewer: "narrator",
      searchText: expect.stringContaining("林霁"),
    });
    expect(messages.some((message) =>
      message.role === "system" && message.content.includes("[hidden] 秘能"),
    )).toBe(true);
    expect(messages.filter((message) => message.role === "user")
      .every((message) => !message.content.includes("[hidden] 秘能"))).toBe(true);
  });
});
