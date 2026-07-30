/**
 * End-to-end Genesis budgets include intent extraction, deck generation,
 * semantic audits, bounded local repair rounds, and occasional transport
 * recovery. These are safety ceilings, not target usage.
 */
export const GENESIS_PRIMARY_BUDGET = {
  maxCalls: 32,
  maxInputTokens: 2_000_000,
  maxOutputTokens: 192_000,
} as const;

/** Additional bounded headroom granted when a failed task is explicitly retried. */
export const GENESIS_RETRY_BUDGET_ALLOWANCE = {
  calls: 16,
  inputTokens: 1_000_000,
  outputTokens: 128_000,
} as const;
