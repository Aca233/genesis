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

export function semanticRepairPrompt(input: SemanticRepairPromptInput): string {
  const sections = [
    `Perform one bounded semantic repair for mode="${input.mode}".`,
    "Edit only the listed issue paths and strictly necessary references. Preserve all stable refs and every unaffected field. Preserve every locked path exactly. Remove or generalize unsupported details instead of inventing replacements. Do not change the world mode. Return the complete corrected world deck as JSON, not a patch and not commentary.",
    `Creator decree:\n${input.decree}`,
    `FROZEN GENESIS INTENT CONTRACT:\n${JSON.stringify(input.intent)}`,
    `Blocking semantic issues:\n${JSON.stringify(input.issues)}`,
    `Invalid world deck JSON (complete):\n${JSON.stringify(input.invalidDeck)}`,
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
