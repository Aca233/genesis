import { z } from "zod";
import type { WorldMode } from "@/lib/world-mode";

export const GenesisIntentContractSchema = z.object({
  sourceBasis: z.enum(["original", "single_ip", "multi_ip"]),
  sourceIps: z.array(z.string().min(1)).max(6),
  explicitPremise: z.array(z.string().min(1)).min(1).max(8),
  narrativeCenter: z.object({
    identity: z.string().min(1),
    role: z.string().min(1),
    startState: z.string().min(1),
  }).strict(),
  playerRole: z.object({
    type: z.enum(["independent_god", "external_creator"]),
    narrativeFunction: z.enum(["observer_patron", "limited_intervener", "external_author"]),
    mustNotReplaceProtagonist: z.boolean(),
  }).strict(),
  forbiddenExpansions: z.array(z.string().min(1)).max(12),
  factsAtAnchor: z.array(z.string().min(1)).max(12),
  futureOnly: z.array(z.string().min(1)).max(12),
  fusionBoundaries: z.array(z.string().min(1)).max(10),
  uncertaintyPolicy: z.literal("omit_or_generalize"),
  corePressures: z.array(z.string().min(1)).min(1).max(8),
}).strict().superRefine((intent, ctx) => {
  const sourceCount = intent.sourceIps.length;
  const sourceCountMatches = intent.sourceBasis === "original"
    ? sourceCount === 0
    : intent.sourceBasis === "single_ip"
      ? sourceCount === 1
      : sourceCount >= 2;
  if (!sourceCountMatches) {
    ctx.addIssue({
      code: "custom",
      path: ["sourceIps"],
      message: "sourceBasis 与 sourceIps 基数不一致",
    });
  }

  const future = new Set(intent.futureOnly.map((item) => item.trim()));
  intent.factsAtAnchor.forEach((item, index) => {
    if (future.has(item.trim())) {
      ctx.addIssue({
        code: "custom",
        path: ["factsAtAnchor", index],
        message: "锚点事实与 futureOnly 重复",
      });
    }
  });
});

export type GenesisIntentContract = z.infer<typeof GenesisIntentContractSchema>;

export function parseGenesisIntent(value: unknown): GenesisIntentContract | null {
  const parsed = GenesisIntentContractSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function assertGenesisIntentForMode(
  intent: GenesisIntentContract,
  mode: WorldMode,
): void {
  if (mode === "pantheon") {
    if (intent.playerRole.type !== "independent_god") {
      throw new Error("pantheon 模式要求 playerRole.type 为 independent_god");
    }
    if (!intent.playerRole.mustNotReplaceProtagonist) {
      throw new Error("pantheon 模式要求 mustNotReplaceProtagonist 为 true");
    }
    return;
  }

  if (intent.playerRole.type !== "external_creator") {
    throw new Error("creator 模式要求 playerRole.type 为 external_creator");
  }
  if (intent.playerRole.narrativeFunction !== "external_author") {
    throw new Error("creator 模式要求 playerRole.narrativeFunction 为 external_author");
  }
}
