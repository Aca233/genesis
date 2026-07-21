import { describe, expect, it } from "vitest";
import { ChapterSettlementSchema } from "./settlement";

describe("ChapterSettlementSchema", () => {
  it("拒绝缺少证据字段的能力变化，避免单次响应静默丢技能", () => {
    const parsed = ChapterSettlementSchema.safeParse({
      pantheonTurns: [],
      extraction: {
        newEntities: [], newGods: [], entityUpdates: [], godUpdates: [],
        revealSections: [], majorCharacterPromotions: [],
        abilityChanges: [{ ownerName: "阿岚", type: "learned" }],
      },
      chronicle: { entries: [], epilogue: "终", chapterTitle: "终章" },
    });
    expect(parsed.success).toBe(false);
  });
});
