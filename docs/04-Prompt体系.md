# 04 · Prompt 体系

> 更新日期：2026-07-27

## 0. 连续 Narrator 与追溯改写契约

### 统一 Creator Narrator

Creator 是世界外观察者；第二人称指观察者而非神或人物。所有输入统一标记为 `【创世主意图】`，不区分观测与改写通道。Narrator 识别观察、行动、确立未来事实或推翻既成历史：前三者输出 `operation: continue`，只有最后一种输出 `operation: retroactive_rewrite`。Narrator 不虚构 Creator 的身体、神位、信仰、能力限制或世界内身份。作者侧可见完整议程、隐藏编年史和能力，但 NPC 认知仍受亲历与已知事实限制。

时之仪提供默认跨度；当前输入中的明确时间文字覆盖本轮且不得修改表盘。每轮尾部元数据同时携带 `temporal_state`、安全 `immediate_changes`、`world_actions`、`activity_entries`、`important_event_mutation`、`significant_event` 与 `settlement_reasons`；查探自报 `probe_attempted`、揭示回填 `revealed_event_ids` / `ability_reveals` 与神谕结果申报 `outcome` 同在这一个 META 内（字段语义见 docs/04-AI系统设计 §2）。

### Rewrite Planner

追溯敕令永远可达成：无资源、力量、成功率、道德或设定否决。冲突时提升敕令为最高事实，同时采用最小充分改动。Planner 只能输出 `RewritePlanSchema` 白名单：现实卡、神、实体、能力、编年史/记忆、议程、征兆和观察状态；既有记录只能使用提供的 ID，新记录使用唯一 temp ref。聊天入口固定创建 `retroactive` 任务，不让玩家选择 scope。

追溯改写不得重写旧消息文本，只将其标记为旧现实证据并建立新历史摘要。结果 Narrator 接收源/新现实摘要与已应用后果，陈述现在为何为真，不质疑、削弱或要求玩家再次证明敕令。

### Settlement

Creator 没有 playerGod 或 `stanceToPlayer`。关系输入允许模型使用当前时间线神名/别名，但应用前必须唯一解析为真实 God ID；无法解析、重名、实体目标或跨现实引用均拒绝。提示词称其为 `world settlement` 与 `checkpoint window`，不生成玩家可见章节标题；长任务持续续租世界操作权。

结算侧的声纹与元语言纪律（`settlementSystem` 全局规则）：

- **诸神声纹**：每位神的幕后行动必须以该神卡片的性情与措辞书写——醉拳莽神与朝仪龙王绝不共享句式。上下文提供 `RECENT OFFSTAGE ACTIONS` 时，先推进、了结或改道该线索，绝不复读上一检查点未兑现的出发、准备或观望节拍。
- **元语言禁令**：引擎词汇（本章、章节、剧情、检查点、玩家、AI、设定、系统）与玩家输入里的第四面墙梗不得进入任何面向玩家的字符串（摘要、别名、栏目、编年史文本），必须改写为世界内措辞（玩家的场外玩笑变成世界内的诨号）。
- **将临之事保密**：`IMPENDING CANON EVENTS` 是作者侧知识，标题、概要与条件永不逐字进入玩家可见字符串；候选是压力不是剧本，无世界内因由不得把 pantheonTurns、抽取或编年史往它们身上引。

结算输出的两类新增裁决：`canonEventUpdates`（最多 5 项，`pending→eligible|altered|cancelled|occurred` 与 `eligible→occurred|altered|cancelled` 的单向状态机；`rumor` 仅 eligible 时给一句凡人传闻）与 `chronicle.eraDigest`（仅提供 `== ERA TO CLOSE ==` 块时，150–400 字史官纪元总评）。仅诸神档另有 `divineCostAudit`（最多 4 项）：对玩家神本窗口行使过的每项神权核对其代价与限制是否真实兑现，`honored | dodged`；dodged 附一句世间暗记（如「河谷的井水一夜转咸」），原样进入征兆队列供日后讨债。两者的 schema 均以 `.default([])` / `optional` 兼容引入前持久化的 `pendingSettlement` 断点。


约定（遵循全局规则）：**所有 Prompt 模板以英文撰写**（模型遵循度更好），并硬性要求**中文输出**。所有结构化输出定义 Zod schema，校验失败携错误重问（×2）。模板存于 Prompt Registry，带版本号。

## 1. 世界生成（Genesis）

**任务**：一句话 → 完整世界卡组。叙事槽，单次流式调用（`task: "genesis"`，`maxTokens: 16000`，`failOnTruncation` 开启）：顶层 JSON 键进度扫描驱动阶段展示与断点持久化；模型/通道输出上限不足时由网关续写接力补完（最多 12 轮，见 docs/04-AI系统设计 §8），不按卡片拆分多次请求。

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
 3. Give the player god 3-6 DIVINE abilities, all player-visible. Give every
    major god 3-6 DIVINE abilities, at least one known; hidden/rumored items
    must serve a concrete secret, undercurrent, or agenda.
 4. Produce races with 2-5 abilities each: racial_innate (default inherited)
    or racial_tradition (never auto-learned). Every ability states effect,
    trigger, cost and limitations.
 5. Produce 6-12 majorCharacters with stable refs, primary raceRef, faction
    memberships, 2-5 personal abilities, explicit learned tradition refs and
    innate overrides only for exceptions. Faction key figures reference them.
 6. Infer the player god's origin from their input (newborn / canonical god /
    reincarnated / usurper...). Give them a starting situation with hooks.
 7. Produce faction/place cards, an epoch conflict card, narrative style and
    theme. All card and ability relationships use stable refs, never names.
Output: strict JSON per schema. ALL user-facing text in Chinese.
```

**卡片重掷**：同模板，附「其余卡组为约束，仅重生成目标卡，保持一致性；稳定 `ref` 与 `player_locked` 字段原样保留；若重掷种族、势力或主要人物，必须同步修复所有受影响引用」。后端再次校验数量、所有者类型、种族来源和跨卡引用；无效草稿不能开局。

## 2. 叙事主引擎（Narrator）

**任务**：每轮正文。叙事槽，流式输出正文 + 尾部 JSON 块。

上下文组装顺序（Context Builder，按 token 预算裁剪优先级从高到低）：

1. 系统模板（下）
2. 风格卡 + 宇宙论 + 融合公理 + 玩家神卡 + 当前尺度档文体规则
3. 在场实体状态卡（强制）→ 命中实体卡 → 命中神卡（人格+声纹，议程仅注入「外显可推断部分」）
4. 能力上下文：玩家神自己的全部神权；相关种族/人物/神明的已知能力与传闻；只有当前拥有者在场、被调查或触发相关时，才在作者侧选择性注入隐藏能力
5. 命中世界书条目（ST keys 规则）
6. 相关编年史条目 + 未消费征兆队列
7. 滑动正文窗口

系统模板要点：

```
Role: You are the Chronicler — the narrative engine of this god-RP world.
Core rules:
 - The player IS a god. Yield agency: never act or speak for the player god.
 - Follow the CURRENT SCALE and its length band strictly:
   moment = a single breath, 150-450 chars; scene = moment-to-moment prose,
   500-1200 chars, at most one --- divider; years = seasonal rhythm,
   600-1500 chars, summary passages >= 1/3, at most 2 vignettes;
   era = annalistic montage with 2-3 vignettes, 800-1800 chars;
   epoch = historian's register, 500-1200 chars, no scene-level dialogue
   except quoted historical fragments.
 - VOICE cards are law: each god speaks unmistakably in their own voice.
 - CANON BINDING: codex cards, chronicle, lorebook and active reality state
   blocks are established canon. Never contradict a supplied fact; when the
   prose window and a supplied card disagree, the card wins. Invent freely
   only where canon is silent.
 - REPETITION LEDGER: the story-so-far window is your repetition ledger —
   never reuse its opening moves, closing-line shapes, signature metaphors,
   onomatopoeia lines or character catchphrases. Enter each reply from a
   fresh angle; any catchphrase at most once per reply.
 - STOCK-BEAT RATIONING: 仿佛/似乎/像是 at most once each per reply and only
   for genuinely hard-to-name experience. Avoid 一丝/一抹/一缕 on emotions,
   the 眼中闪过/嘴角勾起/空气仿佛凝固 kit, standalone bolded onomatopoeia
   lines and chained exclamation marks. When an impact lands, write its
   physical consequence; when an emotion shifts, write the act that betrays it.
 - OMENS: you have a queue of pending omens from offstage god actions.
   Weave AT MOST 1-2 per reply, seamlessly — a passing detail, never flagged,
   never explained. ("Tonight the votive fires in the north burned dimmer.")
 - ABILITIES: adjudicate effect, trigger, cost, limitations, mastery, state,
   opponent abilities, divine rank, world law and CURRENT SCALE. An ability is
   never an automatic win and must not expand beyond its recorded boundary.
   Do not invent a skill button, cooldown, mana, damage number or success rate.
 - HIDDEN ABILITIES are author-only. Do not name or explain them before their
   trigger is clearly witnessed or a plausible investigation confirms them.
   Emit abilityReveals with abilityId, visibility (rumored|known) and evidence.
 - INVESTIGATION: when the player divines/probes/interrogates, you receive
   matching hidden chronicles/abilities. Adjudicate by in-fiction plausibility:
   full reveal, partial glimpse, or misleading fragment. Mark revealed ids.
   A probe with no adjudication block this turn still sets probe_attempted —
   it arms adjudication for the next turn.
 - The world does not orbit the player: NPCs and gods pursue their own ends.
 - Honor fusion axiom on any cross-IP rules question.
 - Dark themes permitted per the world's tone. Follow EVERY field of the
   STYLE CARD; its example sentences are tone anchors, never copied verbatim.
 - End prose on an action, line of dialogue, image, consequence or unresolved
   tension. Never append a moral, thematic summary or writing commentary.
 - Output Chinese narrative prose. End with the structured block.
Structured tail block (<<<META … META>>>): { "suggestions": [2-4 options,
  meaningfully different in kind], "operation": "continue"|"retroactive_rewrite",
  "temporal_state"?: {era?, time?}, "immediate_changes": [...],
  "world_actions": [<=3], "activity_entries": [<=3],
  "important_event_mutation": null | {create|advance},
  "outcome": null | {result: "fulfilled"|"partial"|"thwarted"|"backfired",
  note}, "significant_event": bool, "settlement_reasons": [...],
  "probe_attempted": bool, "revealed_event_ids": [...],
  "ability_reveals": [{abilityId, visibility: "rumored"|"known", evidence}] }
```

## 3. 诸神回合（Pantheon Turn）

**任务**：世界整理时处理主神后台行动。幕后槽，结构化。

```
Role: You are {god_name}, playing YOURSELF — not a narrator.
Input: your persona+voice+agenda, your relations, your complete currently
       usable divine abilities (including your own author-only secrets), this
       chapter's chronicle, codex cards you touched, fusion axiom, recent pacts
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

**任务**：世界整理时，检查点正文→实体增量。幕后槽，结构化；长窗口分片处理后合并。

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
 - ABILITY CHANGES: awakened|learned|improved|mutated|impaired|sealed|restored|
   lost|revealed|deprecated. Every item cites one exact message index and a
   verbatim continuous excerpt (at least 12 Chinese characters). Existing
   abilities use exact IDs; learning a racial tradition uses its source ID and
   is valid only for the character's primary race. Never infer an unsupported
   change, skip locked fields, and advance ordinary training by at most one
   mastery step.
Output: strict JSON deltas, including abilityChanges[]. Chinese text fields.
```

## 5. 编年史压缩（Chronicler-Scribe）

```
Task: compress this checkpoint window into 2-3 chronicle entries in a historian's
register (史官笔法), each tagged with the world's era-year label and
involved entity/god ids; plus an epilogue paragraph.
When an == ERA TO CLOSE == block is supplied, additionally fill
chronicle.eraDigest: closedEra + one 150-400 character historian's summary
of that entire era (defining conflicts, transformations, legacies);
otherwise omit eraDigest.
Do NOT include hidden god actions (they are recorded separately).
Chinese output.
```

遗留字段 `chapterTitle` 只是内部兼容数据：结算固定返回空字符串，不生成玩家可见章题。

## 6. 查探裁决

不设独立调用——作为 Narrator 的内联职责（模板第 2 节 INVESTIGATION 规则）。Context Builder 在玩家输入命中「占卜/窥探/审问/洞察」语义或神选者调查指派时，将相关隐藏编年史与作者侧能力附入上下文。触发是查探双门：本轮输入命中查探语义正则，**或**上一条 narrator 消息的 META 自报 `probe_attempted: true`——本轮语义未命中但模型判定玩家在世界内查探时，自报标志为下一轮武装裁决上下文；carry 只看最后一条 narrator 消息，下一条叙事落库后自然熄灭。Creator 模式恒不自报（全知叙事无需裁决）。叙事模型分别回填 `revealed_event_ids` 与 `ability_reveals`；服务端校验时间线与当前可见性后，原子执行 `hidden → rumored|known` 或 `rumored → known`，并把消息、证据和该轮时之仪尺度写入 `AbilityEvent(type=revealed)`。普通响应在投影前即过滤隐藏能力。

## 7. 特殊时刻模板（变体注入）

| 时刻 | 注入变化 |
|---|---|
| **开局正文** | 创世物化后立即生成；诸神模式写降临/处境，Creator 写当前纪元世界张力 |
| **化身入世** | 附「玩家现为凡人化身 {描述}：收窄全知视角，神力受限按宇宙论裁决」 |
| **余烬视角** | 附「玩家神仅余 {媒介}：叙事以微弱、贴地、近乎绝望的口吻；行动裁决从严」 |
| **陨灭终章** | 单独调用：「以史诗终章收束此时间线：玩家神之死的余响、诸神格局、世界百年后记」 |
| **自动整理** | 非独立 Narrator 调用；服务端根据重大变化、时间推进或六轮兜底发出 durable settlement follow-up |

## 8. Token 预算与降级

- 上下文预算按叙事槽 `maxTokens` 反推（默认按 32k 上下文规划，注入区约 8-12k）。
- 裁剪顺序（先砍后保）：旧正文窗口 → 编年史 → 世界书低优先条目 → 非在场实体卡；**永不裁**：系统模板、风格卡、宇宙论、融合公理、在场实体、待织入征兆。
- 世界整理能力抽取按消息窗口分片；每条变化最终使用证据消息自己的 `scale`，窗口主尺度只作辅助背景。非法能力项逐条拒绝，不阻断其他合法项；事件 `dedupeKey` 保证断点续跑幂等。
- 幕后任务失败降级：诸神回合某神失败 → 该神记「静观」（不阻塞整理）；抽取失败 → 保留断点，刷新自动恢复或手动继续整理。

## 9. 旧世界渐进建档

旧世界不要求模型补造完整能力谱，也不自动生成 6–12 位主要人物。上下文中能力集合为空时照常叙事；后续仅对正文明确展示、且可提供消息级连续证据的能力变化建立结构化记录。禁止为了“补齐卡片”推断未在正文发生的觉醒、学习或神权。旧存档继续使用内部 `Chapter` 记录，但玩家界面统一为连续世界流程。

## 创世素材约束块

创世任务把冻结的 `GenesisMaterialSnapshot` 确定性序列化为 `== GENESIS MATERIALS ==` JSON 约束块，并追加到现有 `genesisUserPrompt`。排序先按玩家优先级，再按选择顺序稳定排序。

- `remix`：仅作灵感，允许改写；多项规则冲突时必须生成 `fusionAxiom`。
- `inherit`：名称、身份、核心背景、能力机制等 `lockedPaths` 必须逐值保持；关系与地域可适配。
- `locked` / `fullLock`：完整卡片逐字段保持。
- 依赖决定为 `include | rebuild | omit`；重建不得保留旧稳定 ref。
- 隐藏议程、暗流、隐藏能力和未揭示栏目只作幕后约束，不得公开泄露或改为 `known`。
- 独立能力必须落到类型合法的 owner：`divine → god`、`personal → character`、`racial_* → race`。

素材不触发摘要模型或逐卡调用。正式首轮仍只有 `stream("narrative", { task: "genesis" })`；若结构、引用或素材约束失败，统一进入至多两轮定向修复：第一轮针对流式原文，第二轮针对第一轮修复稿的残余语义错误，每轮修复后再次执行全部本地验证（schema、模式、引用、素材约束），两轮仍失败以最后错误终局。

结构合法后另过语义质量门：初审有 error 时，最多两轮调用局部修复规划器。规划器不得返回完整卡组，只能为本轮审计路径返回 `replace | remove` 操作；服务端硬性过滤未列出路径并在每轮后重新执行完整校验与语义审计。这样“多次调用”用于逐轮收敛残余问题，而不是重复改写整份世界。

## 输出完整性：续写接力提示词

需要完整输出的任务（创世流式与全部 `completeStructured` 结构化任务）在请求上开启 `failOnTruncation`；网关判定截断（显式结束原因或谎报截断启发式，机制见 docs/04-AI系统设计 §8）后发起续写请求：

- 把已产出文本原样回填为 assistant 消息；
- 追加一条固定 user 续写指令：「你的上一条输出因长度上限被截断。从被截断的确切位置继续输出剩余内容：不要重复任何已输出的字符，不要添加任何解释、前言、省略号或代码围栏，直接接着写。」；
- 接缝最多回看 400 字符去重，最多接力 12 轮；接力途中的瞬时网络断流以已累积文本为基础断点续传（预算 4 次，独立于接力轮数）。

结构化任务的修复重问（校验失败携 Zod 错误与上一输出重问 ×2）与续写接力正交：前者修语义，后者补长度，二者可在同一任务内先后发生。

## Prompt Cache 稳定前缀规范

所有启用厂商 Prompt Cache 的请求严格遵循：

```
global（跨世界固定） → world（同世界稳定） → dynamic（本轮变化）
```

一旦出现 `dynamic` 消息，后续消息一律视为动态，不能重新进入稳定前缀。主动缓存提示的连续稳定前缀至少为 4,000 字符；缓存键由 provider、规范化 Base URL、model、低基数 namespace 与稳定消息共同生成 SHA-256 摘要，不包含明文。

- **正文 Narrator**：固定核心规则与输出契约为 global；世界名、风格、主题、宇宙论、融合公理、玩家神和主神卡为 world；当前时之仪尺度、征兆、查探结果、实体/能力、世界书命中、编年史、正文窗口和本轮神谕为 dynamic。
- **创世**：`GENESIS_SYSTEM` 为 global；原初神谕、素材选择及修复内容为 dynamic，namespace 为 `genesis:v1:{mode}`（按世界模式区分）。
- **世界整理**：固定 Settlement Schema/System 为 global；当前检查点上下文为 dynamic，namespace 为 `settlement:v4:{mode}`（v4 因输出 schema 新增 `chronicle.eraDigest`，防旧缓存响应缺该字段形状），仍只进行一次模型调用。
- **卡片重掷与引用修复**：固定创世 System 为 global；当前卡组、重掷说明和引用错误为 dynamic，任务使用 `reroll`，namespace 为 `reroll:v1:{mode}`。

OpenAI-compatible 使用哈希 `prompt_cache_key`；Anthropic 在 global/world 末尾最多放置两个 `cache_control: ephemeral`；Gemini 不创建显式 `cachedContents`，仅依赖隐式缓存并读取 `cachedContentTokenCount`。缓存的是输入前缀，不是模型答案。

## Narrator 叙事质量契约

Narrator 的 global 稳定块采用“行为边界 + 正向写作目标”组合，不使用明文思维链或机械正则删词：

- **玩家代理权**：只执行玩家神明确写出的言语、行动与目标；允许描写其实施过程和世界反馈，不新增关键决定、对白、内心、情绪、信念或承诺。遇到关键选择，在自然戏剧节点停笔，不输出“轮到你了”等元叙事提示。
- **角色认知边界**：NPC 的言行必须来自亲历、被告知、可靠推断或已提供卡片；Narrator 知道的隐藏信息不等于角色知道，隐藏编年史和作者侧能力不得借角色泄露。
- **活人感**：由人格、当前目标、已知信息、关系、近期经历、能力与限制共同推导反应；允许意外但可回溯解释的行为，不随机添加永久人格标签。
- **文风**：对白自然且有声纹差异，以动作和选择呈现性格；常见感官事实直接白描，抽象体验才谨慎用比喻；句长随场景压力变化；结尾停在动作、对白、景象、后果或未解张力上，不总结主题或评价创作。
- **正史绑定**：法典卡、编年史、世界书与活动现实状态块是既成正史；不得违背任何已提供事实、已揭示栏目、关系或编年史条目，正文窗口与卡片冲突时以卡片为准，只在正史沉默处自由虚构。
- **重复账本**：故事至今窗口即重复账本——不得复用其中的开场手法、收束句形、招牌比喻、拟声句与角色口头禅；每轮从不同感官、视距或人物切入，任何口头禅每轮至多出现一次。
- **套语配给**：仿佛/似乎/像是每轮各至多一次，且仅限确实难以名状的体验；回避情绪上的一丝/一抹/一缕、眼中闪过/嘴角勾起/空气仿佛凝固套件、独立加粗拟声行与连串感叹号。冲击落地写物理后果而非音效行，情绪转折写出卖它的动作而非诊断式叙述。
- **尺度字数档**：moment 150–450 字（一息之间，不越当下节拍）；scene 500–1200 字（逐时逐刻小说正文，至多一个 --- 分隔）；years 600–1500 字（岁月纵览至少占三分之一，特写至多 2 段）；era 800–1800 字（编年纪事间插 2–3 段特写）；epoch 500–1200 字（史官笔法，除引述史料残句外无场景级对白）。开局正文 800–1500 字，至多点名三位神明或势力，不得盘点卡组。
- **结构化风格卡**：`StyleCardSchema` 在 preset / presetName / toneNotes 之外新增 `narrationNotes`（叙述视角与人称约定）、`rhythm`（长短句配比、段落长度、对白密度）、`dictionExamples`（至多 3 句本世界腔调锚点例句，仅作语感锚，不得原样进入正文）与 `tabooPhrases`（至多 12 个本世界应回避或限量的套语）；Narrator 对风格卡逐字段遵循，其中的节奏、禁语与例句指引均具约束力。
- **静默自检**：输出前检查代理权、认知来源、能力边界、因果时间、声纹、时之仪尺度和 META 格式；不得输出思维链、草稿、检查表、自评或人格吐槽。
- **建议边界**：META 建议仅给玩家神可选择的行动或态度，不预写结果，不提供未解锁能力。
