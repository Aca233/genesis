import type { GenesisIntentContract } from "@/lib/genesis/intent";
import type { GenesisSemanticIssue } from "@/lib/genesis/semantic-audit";
import type { WorldMode } from "@/lib/world-mode";

export type SemanticRepairReference = {
  path: string;
  ref: string;
  name?: string;
};

export type SemanticRepairPromptInput = {
  mode: WorldMode;
  decree: string;
  intent: GenesisIntentContract;
  issues: GenesisSemanticIssue[];
  issueValues?: Array<{ path: string; value: unknown }>;
  referenceCatalog?: SemanticRepairReference[];
  requiredRemovePaths?: string[];
  lockedPaths?: string[];
  lorebookExcerpts?: string;
  materialConstraints?: string;
  repairFeedback?: string;
};

export const GENESIS_SEMANTIC_REPAIR_SYSTEM = `You are a bounded semantic repair planner for a god-roleplay world generator.
Return only path-level repair operations for the supplied semantic issues. Never return or rewrite the complete world deck. Every operation path must exactly match one supplied issue path. Use action="replace" with valueJson containing a JSON-encoded string (example: valueJson="\\\"corrected text\\\""); use action="remove" with valueJson=null. Paths listed under Required remove paths must use action="remove" and must never be replaced with invented objects. Do not reorder arrays or modify unlisted paths.`;

export function semanticRepairPrompt(input: SemanticRepairPromptInput): string {
  const sections = [
    `Perform one bounded semantic repair for mode="${input.mode}".`,
    "Return path-level operations only. Each path must exactly match one listed issue path. Preserve all stable refs and every unaffected field. Preserve every locked path exactly. Remove or generalize unsupported details instead of inventing replacements. Do not change the world mode. Never return the complete world deck.",
    `Creator decree:\n${input.decree}`,
    `FROZEN GENESIS INTENT CONTRACT:\n${JSON.stringify(input.intent)}`,
    `Blocking semantic issues:\n${JSON.stringify(input.issues)}`,
    `Current JSON values at the exact issue paths (edit these values directly):\n${JSON.stringify(input.issueValues ?? [])}`,
    `Available stable card references (use only when a repaired value needs a ref):\n${JSON.stringify(input.referenceCatalog ?? [])}`,
    `Required remove paths (must use action="remove"):\n${JSON.stringify(input.requiredRemovePaths ?? [])}`,
    `Locked paths (must remain byte-for-byte equivalent as JSON values):\n${JSON.stringify(input.lockedPaths ?? [])}`,
  ];

  if (input.lorebookExcerpts !== undefined && input.lorebookExcerpts.trim().length > 0) {
    sections.push(`Lorebook excerpts (reference evidence):\n${input.lorebookExcerpts}`);
  }
  if (input.materialConstraints !== undefined && input.materialConstraints.trim().length > 0) {
    sections.push(`Material constraints (binding):\n${input.materialConstraints}`);
  }
  if (input.repairFeedback !== undefined && input.repairFeedback.trim().length > 0) {
    sections.push(`Previous patch failed full deck validation. Correct the patch values without changing any unlisted path:\n${input.repairFeedback}`);
  }

  return sections.join("\n\n");
}
