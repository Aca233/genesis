import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TemporalAnchorCardSchema, type TemporalAnchorCard } from "@/lib/cards/schemas";
import { TemporalCalibrationCard } from "./TemporalCalibrationCard";

function ipAnchorCard(): TemporalAnchorCard {
  return TemporalAnchorCardSchema.parse({
    source: {
      basis: "single_ip",
      sourceIps: ["测试原作"],
      continuity: "原著小说线",
      continuitySource: "model_inferred",
      ambiguityNotes: [],
    },
    anchor: {
      anchorType: "main_story_opening",
      currentTimeLabel: "裂光元年冬",
      currentEraLabel: "裂光纪",
      anchorEvent: "主线开幕前夜，晨钟尚未鸣响",
      canonCutoff: "原著第一卷开幕之前",
      selectionSource: "model_inferred",
      confidence: "high",
      assumptions: ["神谕未指定时期，默认主线前夕"],
    },
    anchorOrdinal: 0,
  });
}

function originalAnchorCard(): TemporalAnchorCard {
  const ip = ipAnchorCard();
  return TemporalAnchorCardSchema.parse({
    source: { basis: "original", ambiguityNotes: [] },
    anchor: {
      ...ip.anchor,
      anchorType: "original_present",
      canonCutoff: null,
      selectionSource: "player_explicit",
      assumptions: [],
    },
    anchorOrdinal: 0,
  });
}

describe("TemporalCalibrationCard", () => {
  it("IP 锚点：陈列来源、连续性、锚点、截止点、置信度、假设与将临之事条数", () => {
    const html = renderToStaticMarkup(
      <TemporalCalibrationCard card={ipAnchorCard()} canonEventCount={3} />,
    );
    expect(html).toContain("时间校准");
    expect(html).toContain("单一原作");
    expect(html).toContain("测试原作");
    expect(html).toContain("连续性：原著小说线");
    expect(html).toContain("主线开幕前夜，晨钟尚未鸣响");
    expect(html).toContain("裂光纪");
    expect(html).toContain("裂光元年冬");
    expect(html).toContain("原著第一卷开幕之前");
    expect(html).toContain("截止点之后的原作事件，在此界尚未发生");
    expect(html).toContain("高");
    expect(html).toContain("主线开幕前夕");
    expect(html).toContain("模型推断");
    expect(html).toContain("神谕未指定时期，默认主线前夕");
    expect(html).toContain("3 条");
  });

  it("原创锚点：降级档无截止点、无连续性行，空假设与零将临之事有占位说明", () => {
    const html = renderToStaticMarkup(
      <TemporalCalibrationCard card={originalAnchorCard()} canonEventCount={0} />,
    );
    expect(html).toContain("原创世界");
    expect(html).toContain("原创世界无截止点");
    expect(html).not.toContain("连续性：");
    expect(html).not.toContain("截止点之后的原作事件");
    expect(html).toContain("玩家明示");
    expect(html).toContain("原创当下");
    expect(html).toContain("锚点判定未附加假设");
    expect(html).toContain("此界未录将临之事");
  });

  it("只读契约：无任何输入控件、按钮或重掷入口，并明示修改锚点即重新创世", () => {
    for (const [card, count] of [
      [ipAnchorCard(), 3],
      [originalAnchorCard(), 0],
    ] as const) {
      const html = renderToStaticMarkup(
        <TemporalCalibrationCard card={card} canonEventCount={count} />,
      );
      expect(html).not.toContain("<input");
      expect(html).not.toContain("<textarea");
      expect(html).not.toContain("<select");
      expect(html).not.toContain("<button");
      expect(html).not.toContain("重掷");
      expect(html).toContain("重新创世");
    }
  });
});
