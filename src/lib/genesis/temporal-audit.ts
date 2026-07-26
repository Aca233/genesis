import { z } from "zod";
import { completeStructured } from "@/lib/llm/structured";
import type { SlotName } from "@/lib/llm/types";

/**
 * AI 语义审计（时间一致设计稿 §10.4，阶段 2 报告型）。
 *
 * - 只对 IP 世界执行（temporalAnchor 存在 ∧ source.basis≠original）——它是散文级
 *   未来泄漏的唯一探测器；原创世界无正史可泄漏，内部一致性由确定性验证器
 *   （temporal-validator.ts T1–T7）覆盖，直接跳过。
 * - 一次 completeStructured 调用（backstage 槽位，task="extract"），输入为
 *   全卡组紧凑 JSON（+ 可选资料索引摘录）。
 * - **只报告，不修改，不阻断**：审计调用自身失败（网络、校验不过、槽位缺配）
 *   一律返回 null，静默跳过——绝不影响创世成败。
 * - 结果落 GenesisTask.auditReport（Json 列），经任务 DTO 供确认页展示。
 */

export const TemporalAuditIssueTypeSchema = z.enum([
  "future_identity_leak",   // 锚点后才获得的身份/头衔/能力被写成现状
  "continuity_mix",         // 混入了声明连续性之外的版本事实
  "death_conflict",         // 散文层的生死矛盾（statusAtAnchor 枚举覆盖不到处）
  "causality_conflict",     // 因果倒置：锚点时其原因尚未发生的结果被写成既成
  "unsupported_canon_claim", // 把原作/资料不支持的断言当正史陈述
]);
export type TemporalAuditIssueType = z.infer<typeof TemporalAuditIssueTypeSchema>;

export const TemporalAuditIssueSchema = z.object({
  severity: z.literal("warning").describe("阶段 2 报告型上线：恒为 warning，不阻断"),
  path: z.string().min(1).describe('违规字段在卡组 JSON 中的点分路径，如 "majorCharacters.2.background"'),
  type: TemporalAuditIssueTypeSchema,
  explanation: z.string().min(1).describe("中文一两句：点名泄漏/冲突的具体事实"),
  evidenceRefs: z.array(z.string()).describe("支撑该判定的卡片/事件稳定 ref 或资料摘录标题；没有则为空数组"),
}).strict();
export type TemporalAuditIssue = z.infer<typeof TemporalAuditIssueSchema>;

/** 沿用初稿 TemporalAuditResult 结构（§10.4）。字段名一经落地不可变。 */
export const TemporalAuditResultSchema = z.object({
  verdict: z.enum(["pass", "warnings"]),
  issues: z.array(TemporalAuditIssueSchema),
}).strict();
export type TemporalAuditResult = z.infer<typeof TemporalAuditResultSchema>;

/**
 * 结构化视图输入（先例：temporal-validator.ts 的 TemporalConsistencyDeckView）：
 * 审计只读取 temporalAnchor.source.basis 判档，其余整体序列化进提示词。
 * 结构兼容 WorldDeck，测试无需构造全量卡组。
 */
export interface TemporalAuditDeckView {
  temporalAnchor?: {
    source: { basis: string };
  };
}

const auditJsonSchema = JSON.stringify(z.toJSONSchema(TemporalAuditResultSchema), null, 2);

export const TEMPORAL_AUDIT_SYSTEM = `You are the temporal-consistency auditor of a god-roleplay narrative game. The world deck you receive derives from existing source works (IPs) and is frozen at a specific temporal anchor — see its temporalAnchor card for the declared continuity, anchor event and canonCutoff. Every card must describe the world AS OF that anchor moment: source-work events after canonCutoff have NOT yet happened in this world.

A deterministic validator has already checked machine-checkable predicates (dead leaders of active factions, event ordinal order, dangling refs, future-timed abilities). Your job is the PROSE-LEVEL semantic audit those predicates cannot express. Report ONLY these issue types:
- future_identity_leak: prose gives an entity an identity, title, power, relationship or knowledge it only gains AFTER the canon cutoff in the source work.
- continuity_mix: prose mixes facts from a different continuity/adaptation than the one declared in temporalAnchor.source.
- death_conflict: prose treats an entity dead/absent at the anchor as currently alive and acting (or the reverse), beyond what the statusAtAnchor enums already encode.
- causality_conflict: prose states as accomplished an outcome whose canonical cause has not yet happened at the anchor, or contradicts the deck's own event order.
- unsupported_canon_claim: prose asserts as source-work canon a claim the source material (and the provided lore excerpts, if any) does not support.

Rules:
1. This audit is REPORT-ONLY. Never rewrite or "fix" anything; only report.
2. Report genuine anchor-time violations only. Content explicitly framed as past history (past canonEvents, anchorNote backstory), as future (epoch=future canonEvents), or as deliberate player rewrites (provenance.canonRelation="player_override") is NOT an issue.
3. severity is always "warning".
4. path is the dot-path of the offending field inside the deck JSON (e.g. "majorCharacters.2.background").
5. evidenceRefs lists the stable refs of deck cards/events (or lore excerpt titles) supporting the judgment; empty array when none.
6. explanation is Chinese, one or two sentences, naming the leaked or conflicting fact.
7. Report at most the 12 most significant issues. If nothing violates the anchor, return verdict "pass" with an empty issues array; otherwise "warnings".

Output ONLY a JSON object matching this JSON Schema. No commentary or markdown fence.

${auditJsonSchema}`;

export function temporalAuditUserPrompt(deck: TemporalAuditDeckView, lorebookExcerpts?: string): string {
  const sections = [
    "Audit the following world deck against its temporal anchor. Return the JSON report.",
    `World deck JSON (compact):\n${JSON.stringify(deck)}`,
  ];
  if (lorebookExcerpts !== undefined && lorebookExcerpts.trim().length > 0) {
    sections.push(`Source-material lore excerpts (reference evidence):\n${lorebookExcerpts}`);
  }
  return sections.join("\n\n");
}

/** 依赖注入面（测试替身用）：completeStructured 以审计 schema 实例化后的窄签名。 */
type AuditDeps = {
  complete: (
    slot: SlotName,
    opts: {
      task: "extract";
      /** 发起审计的用户(多租户 Phase A 归因)。 */
      userId: string;
      system: string;
      user: string;
      schema: z.ZodType<TemporalAuditResult>;
      temperature?: number;
      maxTokens?: number;
    },
  ) => Promise<TemporalAuditResult>;
};

/**
 * 对卡组做一次报告型 AI 语义审计。
 *
 * 返回值：
 * - 非 IP 世界（无 temporalAnchor 或 basis=original）→ null（跳过，不调用模型）；
 * - 审计调用失败（网络/结构化校验/任何异常）→ null（静默跳过，绝不阻断创世）；
 * - 成功 → TemporalAuditResult，verdict 由 issues 数量确定性归一
 *   （有 issue ⇔ warnings），杜绝模型自报 verdict 与清单不符。
 */
export async function auditTemporalSemantics(
  deck: TemporalAuditDeckView,
  opts: { slot?: SlotName; lorebookExcerpts?: string } = {},
  deps: AuditDeps = { complete: completeStructured },
): Promise<TemporalAuditResult | null> {
  const anchor = deck.temporalAnchor;
  if (anchor === undefined || anchor.source.basis === "original") return null;

  try {
    const result = await deps.complete(opts.slot ?? "backstage", {
      task: "extract",
      userId: "local", // Phase A 单用户;后续波由创世任务归属用户换真值
      system: TEMPORAL_AUDIT_SYSTEM,
      user: temporalAuditUserPrompt(deck, opts.lorebookExcerpts),
      schema: TemporalAuditResultSchema,
      temperature: 0.2,
      maxTokens: 8000,
    });
    return {
      verdict: result.issues.length > 0 ? "warnings" : "pass",
      issues: result.issues,
    };
  } catch {
    // §10.4 报告型语义：审计自身失败不阻断创世，静默跳过。
    return null;
  }
}
