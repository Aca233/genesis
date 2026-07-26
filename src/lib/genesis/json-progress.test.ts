import { describe, expect, it } from "vitest";
import {
  GENESIS_TOP_LEVEL_KEYS,
  TopLevelJsonProgressScanner,
} from "./json-progress";

function scanByCharacter(text: string) {
  const scanner = new TopLevelJsonProgressScanner();
  const completed: string[] = [];
  for (const character of text) completed.push(...scanner.push(character));
  return { completed, raw: scanner.getRaw() };
}

describe("TopLevelJsonProgressScanner", () => {
  it("逐字符输入时只在顶层值完整闭合后报告字段", () => {
    const text = '{"worldName":"洪荒","cosmology":{"origin":"混沌","laws":["天道",{"deep":true}]}}';
    const { completed, raw } = scanByCharacter(text);

    expect(completed).toEqual(["worldName", "cosmology"]);
    expect(raw).toBe(text);
  });

  it("不会把未闭合的字符串、对象或数组标记为完成", () => {
    const scanner = new TopLevelJsonProgressScanner();

    expect(scanner.push('{"worldName":"未完')).toEqual([]);
    expect(scanner.push('成","races":[{"name":"人族"}')).toEqual(["worldName"]);
    expect(scanner.push("]")).toEqual(["races"]);
  });

  it("闭合但无法单独解析的顶层值不算完成", () => {
    const scanner = new TopLevelJsonProgressScanner();

    expect(scanner.push('{"cosmology":{"origin":},"worldName":"有效"}')).toEqual(["worldName"]);
  });

  it("正确处理字符串中的转义引号、反斜杠和花括号", () => {
    const text = String.raw`{"worldName":"门后写着 \"{创世}\\终章\"","fusionAxiom":null}`;
    const { completed } = scanByCharacter(text);

    expect(completed).toEqual(["worldName", "fusionAxiom"]);
  });

  it("忽略 Markdown 围栏和 JSON 前的说明文字", () => {
    const scanner = new TopLevelJsonProgressScanner();
    const completed = scanner.push('正在生成……\n```json\n{"worldName":"星海","theme":{"era":"新历"}}\n```');

    expect(completed).toEqual(["worldName", "theme"]);
  });

  it("同一块中可报告多个字段且每个字段只报告一次", () => {
    const scanner = new TopLevelJsonProgressScanner();

    expect(scanner.push('{"worldName":"A","fusionAxiom":null,"style":"')).toEqual([
      "worldName",
      "fusionAxiom",
    ]);
    expect(scanner.push('史诗"} trailing')).toEqual(["style"]);
    expect(scanner.push(" more")).toEqual([]);
  });

  it("只报告创世卡组允许的顶层键", () => {
    const scanner = new TopLevelJsonProgressScanner();
    const completed = scanner.push('{"unknown":{"worldName":"伪字段"},"worldName":"真字段"}');

    expect(completed).toEqual(["worldName"]);
    expect(GENESIS_TOP_LEVEL_KEYS).toContain("mode");
    expect(GENESIS_TOP_LEVEL_KEYS).toContain("majorCharacters");
  });

  it("canonEvents 数组值完整闭合后才被报告", () => {
    const scanner = new TopLevelJsonProgressScanner();

    expect(scanner.push('{"canonEvents":[{"ref":"canon-1","ordinal":1}')).toEqual([]);
    expect(scanner.push("]")).toEqual(["canonEvents"]);
    expect(GENESIS_TOP_LEVEL_KEYS).toContain("canonEvents");
  });

  it("temporalAnchor 对象值完整闭合后才被报告，且紧随 worldName 排序", () => {
    const scanner = new TopLevelJsonProgressScanner();

    expect(scanner.push('{"temporalAnchor":{"anchorOrdinal":0')).toEqual([]);
    expect(scanner.push("}")).toEqual(["temporalAnchor"]);
    expect(GENESIS_TOP_LEVEL_KEYS.indexOf("temporalAnchor"))
      .toBe(GENESIS_TOP_LEVEL_KEYS.indexOf("worldName") + 1);
  });

  it("支持数字、布尔值和 null 这类原始值", () => {
    const scanner = new TopLevelJsonProgressScanner();
    const completed = scanner.push('{"worldName":123,"cosmology":true,"fusionAxiom":null,"theme":false}');

    expect(completed).toEqual(["worldName", "cosmology", "fusionAxiom", "theme"]);
  });
});
