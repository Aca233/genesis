import { describe, expect, it } from "vitest";
import {
  expandedGenesisRetryBudget,
  GENESIS_PRIMARY_BUDGET,
} from "./budget";

describe("Genesis model budgets", () => {
  it("covers two physical requests for every configured logical call", () => {
    expect(GENESIS_PRIMARY_BUDGET).toEqual({
      maxCalls: 320,
      maxInputTokens: 30_000_000,
      maxOutputTokens: 2_500_000,
    });
  });

  it("raises legacy failed tasks to the current primary baseline", () => {
    expect(expandedGenesisRetryBudget({
      maxCalls: 32,
      maxInputTokens: 2_000_000,
      maxOutputTokens: 192_000,
      usedCalls: 32,
      usedInputTokens: 1_800_000,
      usedOutputTokens: 180_000,
    })).toEqual(GENESIS_PRIMARY_BUDGET);
  });

  it("adds bounded headroom when a current-budget task is retried", () => {
    expect(expandedGenesisRetryBudget({
      maxCalls: 320,
      maxInputTokens: 30_000_000,
      maxOutputTokens: 2_500_000,
      usedCalls: 320,
      usedInputTokens: 29_000_000,
      usedOutputTokens: 2_400_000,
    })).toEqual({
      maxCalls: 480,
      maxInputTokens: 45_000_000,
      maxOutputTokens: 3_750_000,
    });
  });
});
