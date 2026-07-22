import { describe, expect, it } from "vitest";
import { completeCreatorDeck } from "@/lib/abilities/embark.test-fixtures";
import { buildDeckPatchPayload, parseWorldRevision } from "./editor-revision";

describe("Genesis editor revision", () => {
  it("初始 GET revision 随 PATCH 成功响应推进并用于下一次保存", () => {
    const deck = completeCreatorDeck();
    let revision = parseWorldRevision("2026-07-22T00:00:00.123Z");
    expect(buildDeckPatchPayload(deck, ["cosmology.origin"], revision)).toMatchObject({
      expectedUpdatedAt: "2026-07-22T00:00:00.123Z",
    });

    revision = parseWorldRevision("2026-07-22T00:00:01.456Z");
    expect(buildDeckPatchPayload(deck, [], revision)).toMatchObject({
      expectedUpdatedAt: "2026-07-22T00:00:01.456Z",
    });
  });

  it("拒绝缺失或无效 revision，避免无条件覆盖", () => {
    expect(() => parseWorldRevision(undefined)).toThrow("世界版本无效");
    expect(() => parseWorldRevision("not-a-date")).toThrow("世界版本无效");
  });
});
