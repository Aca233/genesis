import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { buildCeremonyStamps, ceremonyTitle, GenesisCeremony } from "./GenesisCeremony";

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

it("末幕使用世界名、纪元、时间和自此有史", () => {
  const deck = completeDeck();
  expect(ceremonyTitle(deck)).toEqual({
    world: deck.worldName,
    era: deck.epochConflict.epochName,
    time: deck.epochConflict.yearLabel,
    seal: "自此有史",
  });
});

it("仪式使用星图背景和独立遮罩，不透出卡组页面", () => {
  const html = renderToStaticMarkup(createElement(GenesisCeremony, {
    decree: "自此开天。",
    deck: completeDeck(),
    embark: { phase: "pending" },
    onFinished: () => undefined,
  }));

  expect(html).toContain("play-background--ceremony");
  expect(html).toContain("ceremony-veil");
  expect(html).toContain("ceremony-content");
});
