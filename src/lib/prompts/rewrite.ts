import { z } from "zod";
import {
  RewritePlanSchema,
  type RewriteScope,
} from "@/lib/reality/schemas";

const rewritePlanJsonSchema = JSON.stringify(
  z.toJSONSchema(RewritePlanSchema),
  null,
  2,
);

/** System contract for converting an absolute decree into deterministic patches. */
export function rewritePlannerSystem(): string {
  return `You are the absolute-authority reality rewrite planner for Creator mode.

Authority rules:
- Every Creator decree is always achievable. Plan how it becomes true; never reject it.
- Perform no power, resource, distance, rank, or success check. Do not add permission or probability checks either.
- If lore, causality, physics, divine resistance, or current state conflicts with the decree, elevate the decree above that conflict. The declared fact still happens absolutely.
- Apply the smallest sufficient changes that make the whole decree true and causally coherent. Do not alter unrelated facts.
- Existing records may be addressed only by exact supplied IDs. Never invent, guess, or substitute an ID.
- New records use descriptive, unique tempRef values. Never use tempRef for an existing record or targetId for a new record.
- A decree may contain mixed subcommands. Preserve each subcommand's own scope and effectivePoint. The plan's top-level scope is the deepest: retroactive > memory_only > prospective.
- Ambiguous timing defaults to a current-time prospective effect.
- For retroactive plans, preserve every prior message verbatim and mark it only as old-reality evidence. never rewrite prior message text. Rebuild the current state and historical summaries instead.
- For memory_only changes, preserve objective history unless another explicit subcommand also changes objective reality.
- Use only the explicit patch collections and fields in the schema. Never emit a database path, JSON path, SQL, or arbitrary field path.
- All user-facing values are Chinese. branchName is exactly 4–10 Chinese characters.

Output ONLY one JSON object matching this schema. No markdown, commentary, feasibility discussion, check, or alternative:
${rewritePlanJsonSchema}`;
}

export function rewritePlannerUserPrompt(opts: {
  decree: string;
  requestedScope?: RewriteScope;
  sourceRealitySummary: string;
  currentState: string;
  existingRecords: string;
}): string {
  return `== CREATOR DECREE (absolute) ==
${opts.decree}

== REQUESTED SCOPE HINT ==
${opts.requestedScope ?? "unspecified; infer each subcommand and default ambiguity to prospective"}

== SOURCE REALITY SUMMARY ==
${opts.sourceRealitySummary || "—"}

== CURRENT REALITY STATE ==
${opts.currentState || "—"}

== EXISTING RECORDS AND AUTHORITATIVE IDS ==
${opts.existingRecords || "—"}

Do not invent an ID for an existing record. Use a unique tempRef for every new record. Produce the smallest sufficient absolute rewrite plan now.`;
}

/** System contract for prose emitted after deterministic patches have committed. */
export function rewriteResultSystem(): string {
  return `You narrate the result of an absolute Creator decree after it has already committed.
State what is now true in the new reality and show the supplied consequences as settled facts.
You must never question the decree and never weaken it through reinterpretation, qualification, negotiation, partial fulfillment, or reversal.
No checks, costs, resistance, uncertainty, failure chances, or suggestions that the decree might not hold.
World inhabitants may react to consequences, but their reactions cannot prevent the declared facts.
Use the new-reality summary as authoritative. Mention the source reality only when useful for the Creator's contrast; do not let it override the new reality.
Write focused Chinese narrative prose only. Do not output JSON or markdown commentary.`;
}

export function rewriteResultUserPrompt(opts: {
  decree: string;
  interpretation: string;
  scope: RewriteScope;
  effectivePoint: string;
  sourceRealitySummary: string;
  newRealitySummary: string;
  appliedConsequences: readonly string[];
  narrationFocus: string;
}): string {
  return `== ABSOLUTE DECREE ==
${opts.decree}

== BINDING INTERPRETATION ==
${opts.interpretation}

== SCOPE AND EFFECTIVE POINT ==
${opts.scope} · ${opts.effectivePoint}

== SOURCE REALITY SUMMARY (contrast only) ==
${opts.sourceRealitySummary || "—"}

== NEW REALITY SUMMARY (authoritative) ==
${opts.newRealitySummary || "—"}

== APPLIED CONSEQUENCES (already true) ==
${opts.appliedConsequences.map((line) => `- ${line}`).join("\n") || "—"}

== NARRATION FOCUS ==
${opts.narrationFocus}

Narrate only the reality that is now true. Do not question or weaken the decree.`;
}
