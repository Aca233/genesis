/**
 * End-to-end Genesis budgets include intent extraction, five V2 stages,
 * sixteen bounded semantic repair rounds, and physical transport recovery.
 * The configured pipeline can issue up to 130 logical calls; permits count
 * physical requests, so the call ceiling allows two requests per logical call
 * plus bounded transport-recovery headroom.
 * These are safety ceilings, not target usage.
 */
export const GENESIS_PRIMARY_BUDGET = {
  maxCalls: 320,
  maxInputTokens: 30_000_000,
  maxOutputTokens: 2_500_000,
} as const;

/** Additional bounded headroom granted when a failed task is explicitly retried. */
export const GENESIS_RETRY_BUDGET_ALLOWANCE = {
  calls: 160,
  inputTokens: 15_000_000,
  outputTokens: 1_250_000,
} as const;

export type GenesisBudgetSnapshot = {
  maxCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  usedCalls: number;
  usedInputTokens: number;
  usedOutputTokens: number;
};

/**
 * Retry keeps settled usage, restores old tasks to the current baseline, and
 * always grants one additional bounded recovery allowance beyond prior limits.
 */
export function expandedGenesisRetryBudget(current: GenesisBudgetSnapshot) {
  return {
    maxCalls: Math.max(
      GENESIS_PRIMARY_BUDGET.maxCalls,
      current.maxCalls + GENESIS_RETRY_BUDGET_ALLOWANCE.calls,
      current.usedCalls + GENESIS_RETRY_BUDGET_ALLOWANCE.calls,
    ),
    maxInputTokens: Math.max(
      GENESIS_PRIMARY_BUDGET.maxInputTokens,
      current.maxInputTokens + GENESIS_RETRY_BUDGET_ALLOWANCE.inputTokens,
      current.usedInputTokens + GENESIS_RETRY_BUDGET_ALLOWANCE.inputTokens,
    ),
    maxOutputTokens: Math.max(
      GENESIS_PRIMARY_BUDGET.maxOutputTokens,
      current.maxOutputTokens + GENESIS_RETRY_BUDGET_ALLOWANCE.outputTokens,
      current.usedOutputTokens + GENESIS_RETRY_BUDGET_ALLOWANCE.outputTokens,
    ),
  } as const;
}
