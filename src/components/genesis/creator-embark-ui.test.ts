import { describe, expect, it } from "vitest";
import { canEmbarkMode } from "./embark-policy";

describe("genesis embark policy", () => {
  it.each(["pantheon", "creator"] as const)("allows %s worlds to embark", (mode) => {
    expect(canEmbarkMode(mode)).toBe(true);
  });
});
