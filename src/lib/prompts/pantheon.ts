import { z } from "zod";

/**
 * 诸神回合（Pantheon Turn）提示词与输出契约（docs/04 §3）。
 * 章末每主神一次调用，幕后槽；按位阶高→低串行，后行者可见先行者的公开后果。
 */

export const PantheonTurnSchema = z.object({
  action: z.object({
    description: z.string().describe("本章该神的一个幕后行动（60-120字，史官暗记体：主语明确，只记行动、对象与意图；不写心理独白、不堆叠形容词、不引用其他神的条目原文）"),
    targets: z.array(z.string()).describe("涉及的实体/神名"),
  }),
  omen: z
    .string()
    .describe("该行动在世间可感知的征兆——一句凡人视角的寻常细节，绝不解释"),
  agendaUpdate: z
    .object({
      shortTermGoals: z.array(z.string()).nullish(),
      schemes: z.array(z.string()).nullish(),
      stanceToPlayer: z
        .object({ level: z.string(), motive: z.string() })
        .nullish(),
    })
    .describe("议程增量（仅变化的字段）"),
  relationsUpdate: z
    .array(
      z.object({
        target: z.string().describe("神名或实体名"),
        label: z.enum(["enemy", "rival", "neutral", "ally", "vassal", "unknown"]),
        note: z.string(),
      }),
    )
    .describe("关系变化（仅变化项，可空数组）"),
  proactiveEvent: z
    .object({
      type: z.string().describe("dream|envoy|miracle|summons|other"),
      openingHook: z.string().describe("下章开场演出此事件的钩子（中文）"),
    })
    .nullable()
    .describe("若行动指向玩家神则非空——将成为下章开场事件"),
});

export type PantheonTurn = z.infer<typeof PantheonTurnSchema>;

const turnJsonSchema = JSON.stringify(z.toJSONSchema(PantheonTurnSchema), null, 2);

/** 非活跃路径：生产仅走 settlement.ts 的单次整理；规则变更须与 settlementSystem 同步。 */
export function pantheonSystem(godName: string): string {
  return `You are ${godName} — playing YOURSELF, a god of this world. You are NOT a narrator; you are a player at the table of divine politics, pursuing your own agenda.

Rules:
- Choose exactly ONE offstage action this chapter that advances your agenda: a scheme, a pact, a proxy move through mortals, a blessing, a sabotage, or deliberate stillness (watching IS a valid action if it fits your temperament).
- Stay ruthlessly in character: your persona, voice and temperament govern what you would actually do. A cautious god probes; a proud god escalates.
- PACTS ARE BINDING CONTEXT: if you have alliances or bargains (with the player god or others), honor them — allies genuinely help, and betrayal happens only when your agenda truly demands it, with consequences you accept.
- Your action may target the player god (dream-visit, envoy, miracle-challenge, council summons). If so, fill proactiveEvent — it becomes an onstage event next chapter.
- OMEN: describe ONE subtle worldly sign of your action — a mortal-perceivable detail (a dimmed votive fire, a strange tide, a priest's uneasy dream). Never explanatory, never naming you.
- You see the public aftermath of higher-ranked gods' turns this chapter (given below, if any); you may react to it.
- YOUR ABILITIES ARE BINDING: obey every effect, trigger, cost, limitation, state and mastery boundary supplied below. Do not invent powers you do not possess.
- Honor the fusion axiom on any cross-IP power question.
- Output ONLY a JSON object matching the schema. All user-facing strings in Chinese.

${turnJsonSchema}`;
}

export function pantheonUserPrompt(opts: {
  godCard: string; // 人格+声纹+议程+关系 JSON
  chapterChronicle: string; // 本章编年史/摘要
  relatedEntities: string; // 该神触及的实体卡
  abilityContext: string; // 行动神自身能力（含仅该神可见的隐藏神权）
  fusionAxiom?: string;
  earlierTurnsPublic: string; // 本章先行诸神的公开后果（位阶更高者）
}): string {
  return `== YOUR FULL CARD (persona / voice / agenda / relations) ==
${opts.godCard}

== THIS CHAPTER'S EVENTS ==
${opts.chapterChronicle}

== ENTITIES YOU TOUCH ==
${opts.relatedEntities || "—"}

== YOUR ABILITY CONTEXT (binding; do not exceed it) ==
${opts.abilityContext || "—"}
${opts.fusionAxiom ? `\n== FUSION AXIOM ==\n${opts.fusionAxiom}` : ""}
${
  opts.earlierTurnsPublic
    ? `\n== PUBLIC AFTERMATH OF HIGHER GODS' MOVES THIS CHAPTER ==\n${opts.earlierTurnsPublic}`
    : ""
}

Decide your one action for this chapter. Output the JSON now.`;
}
