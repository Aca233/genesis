# 04 · Prompt 体系

## 0. Creator Prompt 与改写契约增补

### 观测 Narrator

Creator 是世界外观察者；第二人称指观察者而非神或人物。普通输入标记为 `【天外观测】`，只控制焦点/跨度/镜头，不授权改写事实。Narrator 不虚构 Creator 的身体、神位、信仰、能力限制或世界内身份。作者侧可见完整议程、隐藏编年史和能力，但 NPC 认知仍受亲历与已知事实限制。Creator 开场展示当前纪元世界张力，不写降临场景。

### Rewrite Planner

敕令永远可达成：无资源、力量、成功率、道德或设定否决。冲突时提升敕令为最高事实，同时采用最小充分改动。Planner 只能输出 `RewritePlanSchema` 白名单：现实卡、神、实体、能力、编年史/记忆、议程、征兆和观察状态；既有记录只能使用提供的 ID，新记录使用唯一 temp ref。混合子命令 scope 归一化为 `retroactive > memory_only > prospective`。

追溯改写不得重写旧消息文本，只将其标记为旧现实证据并建立新历史摘要。结果 Narrator 接收源/新现实摘要与已应用后果，陈述现在为何为真，不质疑、削弱或要求玩家再次证明敕令。

### Settlement

Creator 没有 playerGod 或 `stanceToPlayer`。关系输入允许模型使用当前时间线神名/别名，但应用前必须唯一解析为真实 God ID；无法解析、重名、实体目标或跨现实引用均拒绝。结算长任务持续续租世界操作权。


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
 - Follow the CURRENT SCALE strictly:
   scene = moment-to-moment prose; era = decades montage in annalistic prose
   interleaved with close-ups; epoch = centuries, historian's register.
 - VOICE cards are law: each god speaks unmistakably in their own voice.
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
 - The world does not orbit the player: NPCs and gods pursue their own ends.
 - Honor fusion axiom on any cross-IP rules question.
 - Dark themes permitted per the world's tone; follow the style card.
 - Output Chinese narrative prose. End with the structured block.
Structured tail block: { "suggestions": [2-4 short action options],
  "chapterBreakHint": bool, "revealed_event_ids": [...],
  "ability_reveals": [{abilityId, visibility: "rumored"|"known", evidence}] }
```

## 3. 诸神回合（Pantheon Turn）

**任务**：章末每主神一次。幕后槽，结构化。

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
Task: compress this chapter into 2-3 chronicle entries in a historian's
register (史官笔法), each tagged with the world's era-year label and
involved entity/god ids; plus a chapter epilogue paragraph (章末小结).
Do NOT include hidden god actions (they are recorded separately).
Chinese output.
```

## 6. 查探裁决

不设独立调用——作为 Narrator 的内联职责（模板第 2 节 INVESTIGATION 规则）。Context Builder 在玩家输入命中「占卜/窥探/审问/洞察」语义或神选者调查指派时，将相关隐藏编年史与作者侧能力附入上下文。叙事模型分别回填 `revealed_event_ids` 与 `ability_reveals`；服务端校验时间线与当前可见性后，原子执行 `hidden → rumored|known` 或 `rumored → known`，并把消息、证据和该轮时之仪尺度写入 `AbilityEvent(type=revealed)`。普通响应在投影前即过滤隐藏能力。

## 7. 特殊时刻模板（变体注入）

| 时刻 | 注入变化 |
|---|---|
| **开局第一章** | Narrator 附「以创世/降临场景开场，呼应原初神谕，铺开局钩子」 |
| **化身入世** | 附「玩家现为凡人化身 {描述}：收窄全知视角，神力受限按宇宙论裁决」 |
| **余烬视角** | 附「玩家神仅余 {媒介}：叙事以微弱、贴地、近乎绝望的口吻；行动裁决从严」 |
| **陨灭终章** | 单独调用：「以史诗终章收束此时间线：玩家神之死的余响、诸神格局、世界百年后记」 |
| **翻章建议** | 非独立调用——`chapterBreakHint` 字段只显示建议；不自动翻章，仍由玩家点击「结束本章」后集中结算 |

## 8. Token 预算与降级

- 上下文预算按叙事槽 `maxTokens` 反推（默认按 32k 上下文规划，注入区约 8-12k）。
- 裁剪顺序（先砍后保）：旧正文窗口 → 编年史 → 世界书低优先条目 → 非在场实体卡；**永不裁**：系统模板、风格卡、宇宙论、融合公理、在场实体、待织入征兆。
- 章末能力抽取按消息窗口分片；每条变化最终使用证据消息自己的 `scale`，整章主尺度只作辅助背景。非法能力项逐条拒绝，不阻断同章其他合法结算；事件 `dedupeKey` 保证断点续跑幂等。
- 幕后任务失败降级：诸神回合某神失败 → 该神本章记「静观」（不阻塞结算）；抽取失败 → 该章保留断点，重新点击结算可续跑。

## 9. 旧世界渐进建档

旧世界不要求模型补造完整能力谱，也不自动生成 6–12 位主要人物。上下文中能力集合为空时照常叙事；后续仅对正文明确展示、且可提供消息级连续证据的能力变化建立结构化记录。禁止为了“补齐卡片”推断未在正文发生的觉醒、学习或神权。章节交互不变：同章可以继续多轮对话，只有玩家手动「结束本章」才触发抽取。

## 创世素材约束块

创世任务把冻结的 `GenesisMaterialSnapshot` 确定性序列化为 `== GENESIS MATERIALS ==` JSON 约束块，并追加到现有 `genesisUserPrompt`。排序先按玩家优先级，再按选择顺序稳定排序。

- `remix`：仅作灵感，允许改写；多项规则冲突时必须生成 `fusionAxiom`。
- `inherit`：名称、身份、核心背景、能力机制等 `lockedPaths` 必须逐值保持；关系与地域可适配。
- `locked` / `fullLock`：完整卡片逐字段保持。
- 依赖决定为 `include | rebuild | omit`；重建不得保留旧稳定 ref。
- 隐藏议程、暗流、隐藏能力和未揭示栏目只作幕后约束，不得公开泄露或改为 `known`。
- 独立能力必须落到类型合法的 owner：`divine → god`、`personal → character`、`racial_* → race`。

素材不触发摘要模型或逐卡调用。正式首轮仍只有 `stream("narrative", { task: "genesis" })`；若结构、引用或素材约束失败，统一进入既有的一次 repair，修复后再次执行本地验证，不新增第三次请求。

## Prompt Cache 稳定前缀规范

所有启用厂商 Prompt Cache 的请求严格遵循：

```
global（跨世界固定） → world（同世界稳定） → dynamic（本轮变化）
```

一旦出现 `dynamic` 消息，后续消息一律视为动态，不能重新进入稳定前缀。主动缓存提示的连续稳定前缀至少为 4,000 字符；缓存键由 provider、规范化 Base URL、model、低基数 namespace 与稳定消息共同生成 SHA-256 摘要，不包含明文。

- **正文 Narrator**：固定核心规则与输出契约为 global；世界名、风格、主题、宇宙论、融合公理、玩家神和主神卡为 world；当前时之仪尺度、征兆、查探结果、实体/能力、世界书命中、编年史、正文窗口和本轮神谕为 dynamic。
- **创世**：`GENESIS_SYSTEM` 为 global；原初神谕、素材选择及修复内容为 dynamic，namespace 为 `genesis:v1`。
- **章末结算**：固定 Settlement Schema/System 为 global；本章上下文为 dynamic，namespace 为 `settlement:v1`，仍只进行一次模型调用。
- **卡片重掷与引用修复**：固定创世 System 为 global；当前卡组、重掷说明和引用错误为 dynamic，任务与 namespace 均使用 `reroll` / `reroll:v1`。

OpenAI-compatible 使用哈希 `prompt_cache_key`；Anthropic 在 global/world 末尾最多放置两个 `cache_control: ephemeral`；Gemini 不创建显式 `cachedContents`，仅依赖隐式缓存并读取 `cachedContentTokenCount`。缓存的是输入前缀，不是模型答案。

## Narrator 叙事质量契约

Narrator 的 global 稳定块采用“行为边界 + 正向写作目标”组合，不使用明文思维链或机械正则删词：

- **玩家代理权**：只执行玩家神明确写出的言语、行动与目标；允许描写其实施过程和世界反馈，不新增关键决定、对白、内心、情绪、信念或承诺。遇到关键选择，在自然戏剧节点停笔，不输出“轮到你了”等元叙事提示。
- **角色认知边界**：NPC 的言行必须来自亲历、被告知、可靠推断或已提供卡片；Narrator 知道的隐藏信息不等于角色知道，隐藏编年史和作者侧能力不得借角色泄露。
- **活人感**：由人格、当前目标、已知信息、关系、近期经历、能力与限制共同推导反应；允许意外但可回溯解释的行为，不随机添加永久人格标签。
- **文风**：对白自然且有声纹差异，以动作和选择呈现性格；常见感官事实直接白描，抽象体验才谨慎用比喻；句长随场景压力变化；结尾停在动作、对白、景象、后果或未解张力上，不总结主题或评价创作。
- **静默自检**：输出前检查代理权、认知来源、能力边界、因果时间、声纹、时之仪尺度和 META 格式；不得输出思维链、草稿、检查表、自评或人格吐槽。
- **建议边界**：META 建议仅给玩家神可选择的行动或态度，不预写结果，不提供未解锁能力。
