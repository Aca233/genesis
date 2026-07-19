# 04 · Prompt 体系

约定（遵循全局规则）：**所有 Prompt 模板以英文撰写**（模型遵循度更好），并硬性要求**中文输出**。所有结构化输出定义 Zod schema，校验失败携错误重问（×2）。模板存于 Prompt Registry，带版本号。

## 1. 世界生成（Genesis）

**任务**：一句话 → 完整世界卡组。叙事槽，单次结构化调用（超长输出时按卡片分批：宇宙论+神谱 → 势力+种族+地理 → 冲突+风格）。

模板要点（摘要）：

```
Role: You are the Genesis Engine of a god-roleplay narrative game.
Input: the player's "primordial decree" (their one-line world request)
       + imported lorebook excerpts (if any, AUTHORITATIVE over your own knowledge)
Tasks:
 1. Identify source IPs. If existing IP(s): reuse their canonical pantheon,
    factions, cosmology faithfully. If multiple IPs: produce a FUSION AXIOM card —
    explicit rules for how the systems merge, power-scale mapping, and which
    canon wins on conflict.
 2. Build the pantheon: select 6-9 MAJOR gods with maximal dramatic tension
    versus the player god (rivals, potential allies, ideological mirrors).
    Overflow gods become one-line minor gods. For each major god produce:
    persona card, VOICE card (verbal tics, forms of address, catchphrases,
    things they would never say), hidden AGENDA card (goals, stance toward
    player: hostility|rivalry|neutral|cooperation|dependence + motive, schemes).
 3. Infer the player god's origin from their input (newborn / canonical god /
    reincarnated / usurper...). Give them a starting situation with hooks.
 4. Produce faction/race/place cards (each with faith alignment), an epoch
    conflict card (some threads hidden, seeding god agendas), a narrative
    style card inferred from the player's phrasing, and a theme card
    (era naming, rank vocabulary matching the world's flavor).
Output: strict JSON per schema. ALL user-facing text in Chinese.
```

**卡片重掷**：同模板，附「其余卡组为约束，仅重生成目标卡，保持一致性；`player_locked` 字段原样保留」。

## 2. 叙事主引擎（Narrator）

**任务**：每轮正文。叙事槽，流式输出正文 + 尾部 JSON 块。

上下文组装顺序（Context Builder，按 token 预算裁剪优先级从高到低）：

1. 系统模板（下）
2. 风格卡 + 宇宙论 + 融合公理 + 玩家神卡 + 当前尺度档文体规则
3. 在场实体状态卡（强制）→ 命中实体卡 → 命中神卡（人格+声纹，议程仅注入「外显可推断部分」）
4. 命中世界书条目（ST keys 规则）
5. 相关编年史条目 + 未消费征兆队列
6. 滑动正文窗口

系统模板要点：

```
Role: You are the Chronicler — the narrative engine of this god-RP world.
Core rules:
 - The player IS a god. Yield agency: never act or speak for the player god.
 - Follow the CURRENT SCALE strictly:
   scene = moment-to-moment prose; era = decades montage in annalistic prose
   interleaved with close-ups; epoch = centuries, historian's register.
 - VOICE cards are law: each god speaks unmistakably in their own voice.
 - OMENS: you have a queue of pending omens from offstage god actions.
   Weave AT MOST 1-2 per reply, seamlessly — a passing detail, never flagged,
   never explained. ("Tonight the votive fires in the north burned dimmer.")
 - INVESTIGATION: when the player divines/probes/interrogates, you receive
   matching HIDDEN CHRONICLE entries. Adjudicate by in-fiction plausibility:
   full reveal, partial glimpse, or misleading fragment. Mark revealed ids.
 - The world does not orbit the player: NPCs and gods pursue their own ends.
 - Honor fusion axiom on any cross-IP rules question.
 - Dark themes permitted per the world's tone; follow the style card.
 - Output Chinese narrative prose. End with the structured block.
Structured tail block: { "suggestions": [2-4 short action options],
  "chapter_break_hint": bool, "revealed_event_ids": [...],
  "new_chosen": [{name, mark_description}] , "scale_drift_note": string? }
```

## 3. 诸神回合（Pantheon Turn）

**任务**：章末每主神一次。幕后槽，结构化。

```
Role: You are {god_name}, playing YOURSELF — not a narrator.
Input: your persona+voice+agenda, your relations, this chapter's chronicle,
       codex cards of entities you touched, fusion axiom, recent pacts
       (pacts are binding context: allies genuinely help, traitors genuinely betray).
Task: choose exactly ONE offstage action this chapter that advances your agenda
      (scheme, pact, proxy move, blessing, sabotage, or deliberate stillness).
      Actions may target the player god (dream-visit, envoy, miracle-challenge,
      council summons) — these become onstage events next chapter.
Output JSON: {
  action: {description, targets[], visibility: "hidden"},
  omen: one subtle worldly sign (a mortal-perceivable detail, NOT explanatory),
  agenda_update: {...deltas}, relations_update: {...deltas},
  proactive_event: null | {type, opening_hook}   // if targeting the player
}
Chinese for all user-facing strings.
```

执行顺序按「位阶高→低」串行，后执行的神能看到先执行者的公开性后果（不看隐藏细节），产生轻量的回合互动。

## 4. 状态抽取（Extractor）

**任务**：章末，正文→实体增量。幕后槽，结构化；长章分片处理后合并。

```
Task: extract entity deltas from this chapter's narrative.
 - NEW entities worth a codex card (faction|character|race|place|artifact|cult):
   produce full card per its type template, plus names/aliases for indexing.
 - UPDATES to existing entities: per-section deltas only (never rewrite
   player_locked paths — listed below), relation label changes,
   lifespan ticks for mortals per elapsed time at current scale,
   faith_history events, scene_presence set/clear.
 - CHOSEN marks: detect the player god granting a mark → set is_chosen.
 - Player god status: rank change proposal with one-line justification,
   domain drift, faith scope description.
 - Reveal detection: sections whose fog should lift given what was narrated.
Output: strict JSON deltas. Chinese text fields.
```

## 5. 编年史压缩（Chronicler-Scribe）

```
Task: compress this chapter into 2-3 chronicle entries in a historian's
register (史官笔法), each tagged with the world's era-year label and
involved entity/god ids; plus a chapter epilogue paragraph (章末小结).
Do NOT include hidden god actions (they are recorded separately).
Chinese output.
```

## 6. 查探裁决

不设独立调用——作为 Narrator 的内联职责（模板第 2 节 INVESTIGATION 规则）。Context Builder 在玩家输入命中「占卜/窥探/审问/洞察」语义或神选者调查指派时，将相关隐藏编年史条目附入上下文并标注其 id，由叙事模型裁决揭示并在尾块回填 `revealed_event_ids`。

## 7. 特殊时刻模板（变体注入）

| 时刻 | 注入变化 |
|---|---|
| **开局第一章** | Narrator 附「以创世/降临场景开场，呼应原初神谕，铺开局钩子」 |
| **化身入世** | 附「玩家现为凡人化身 {描述}：收窄全知视角，神力受限按宇宙论裁决」 |
| **余烬视角** | 附「玩家神仅余 {媒介}：叙事以微弱、贴地、近乎绝望的口吻；行动裁决从严」 |
| **陨灭终章** | 单独调用：「以史诗终章收束此时间线：玩家神之死的余响、诸神格局、世界百年后记」 |
| **翻章建议** | 非独立调用——`chapter_break_hint` 字段 |

## 8. Token 预算与降级

- 上下文预算按叙事槽 `maxTokens` 反推（默认按 32k 上下文规划，注入区约 8-12k）。
- 裁剪顺序（先砍后保）：旧正文窗口 → 编年史 → 世界书低优先条目 → 非在场实体卡；**永不裁**：系统模板、风格卡、宇宙论、融合公理、在场实体、待织入征兆。
- 幕后任务失败降级：诸神回合某神失败 → 该神本章记「静观」（不阻塞结算）；抽取失败 → 该章标记待重抽，玩家可在设置里重跑。
