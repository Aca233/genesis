import { describe, expect, it } from "vitest";
import { WorldModeSchema, assertModeTransition, worldModeLabel } from "./world-mode";

describe("world mode", () => {
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
});
