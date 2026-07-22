import { describe, expect, it } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { buildCeremonyStamps } from "./GenesisCeremony";

describe("buildCeremonyStamps", () => {
  it("保留诸神模式的玩家神拓印", () => {
    expect(buildCeremonyStamps(completeDeck())).toContain("初启之神 · 汝之神格");
  });

  it("Creator 仪式不出现玩家神或汝之神格", () => {
    const stamps = buildCeremonyStamps(completeCreatorDeck());
    expect(stamps.some((stamp) => stamp.includes("汝之神格"))).toBe(false);
    expect(stamps).toEqual(expect.arrayContaining(["潮汐之神 · 入谱", "律法之神 · 入谱"]));
  });
});
