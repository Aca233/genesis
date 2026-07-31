import { describe, expect, it } from "vitest";
import { WORLD_MODES, WORLD_MODE_PRESENTATION, WorldModeSchema, assertModeTransition, worldModeLabel } from "./world-mode";

describe("world mode", () => {
  it("prioritizes creator first in creation UI order", () => {
    expect(WORLD_MODES).toEqual(["creator", "pantheon"]);
  });

  it("accepts only pantheon and creator", () => {
    expect(WorldModeSchema.parse("pantheon")).toBe("pantheon");
    expect(WorldModeSchema.parse("creator")).toBe("creator");
    expect(() => WorldModeSchema.parse("absolute")).toThrow();
  });

  it("does not allow a persisted world to change modes", () => {
    expect(() => assertModeTransition("pantheon", "creator")).toThrow("世界模式不可更改");
    expect(assertModeTransition("creator", "creator")).toBeUndefined();
  });

  it("provides stable Chinese labels", () => {
    expect(worldModeLabel("pantheon")).toBe("诸神共世");
    expect(worldModeLabel("creator")).toBe("创世主");
  });

  it("provides stable creation copy for both selectable modes", () => {
    expect(WORLD_MODE_PRESENTATION.pantheon).toMatchObject({
      label: "诸神共世",
      validationNoun: "神谕",
    });
    expect(WORLD_MODE_PRESENTATION.pantheon.placeholder).toContain("我是谁");
    expect(WORLD_MODE_PRESENTATION.creator).toMatchObject({
      label: "创世主",
      validationNoun: "世界描述",
      description: "立于世界之外，观看一个自行运转的宇宙，并以绝对敕令改写现实。",
    });
    expect(WORLD_MODE_PRESENTATION.creator.placeholder).not.toMatch(/我是|我是谁/);
  });
});
