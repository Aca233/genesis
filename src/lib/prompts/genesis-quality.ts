import type { WorldDeck } from "@/lib/cards/schemas";
import type { GenesisIntentContract } from "@/lib/genesis/intent";
import type { GenesisSemanticIssue } from "@/lib/genesis/semantic-audit";
import type { WorldMode } from "@/lib/world-mode";

export type SemanticRepairPromptInput = {
  mode: WorldMode;
  decree: string;
  intent: GenesisIntentContract;
  invalidDeck: WorldDeck;
  issues: GenesisSemanticIssue[];
  lockedPaths?: string[];
  lorebookExcerpts?: string;
  materialConstraints?: string;
};

export const GENESIS_SEMANTIC_REPAIR_SYSTEM = `You are a bounded semantic repair planner for a god-roleplay world generator.
Return only path-level repair operations for the supplied semantic issues. Never return or rewrite the complete world deck. Every operation path must exactly match one supplied issue path. Use action="replace" with valueJson containing one valid JSON value, or action="remove" with valueJson=null. Do not reorder arrays or modify unlisted paths.`;

export function semanticRepairPrompt(input: SemanticRepairPromptInput): string {
  const sections = [
    `Perform one bounded semantic repair for mode="${input.mode}".`,
    "Return path-level operations only. Each path must exactly match one listed issue path. Preserve all stable refs and every unaffected field. Preserve every locked path exactly. Remove or generalize unsupported details instead of inventing replacements. Do not change the world mode. Never return the complete world deck.",
    `Creator decree:\n${input.decree}`,
    `FROZEN GENESIS INTENT CONTRACT:\n${JSON.stringify(input.intent)}`,
    `Blocking semantic issues:\n${JSON.stringify(input.issues)}`,
    `Invalid world deck JSON (read-only context):\n${JSON.stringify(input.invalidDeck)}`,
    `Locked paths (must remain byte-for-byte equivalent as JSON values):\n${JSON.stringify(input.lockedPaths ?? [])}`,
  ];

  if (input.lorebookExcerpts !== undefined && input.lorebookExcerpts.trim().length > 0) {
    sections.push(`Lorebook excerpts (reference evidence):\n${input.lorebookExcerpts}`);
  }
  if (input.materialConstraints !== undefined && input.materialConstraints.trim().length > 0) {
    sections.push(`Material constraints (binding):\n${input.materialConstraints}`);
  }

  return sections.join("\n\n");
}
