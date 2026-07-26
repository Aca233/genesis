# 时间一致的世界生成设计（修订版）

日期：2026-07-26
状态：修订版设计，取代同日初稿，等待用户复核
范围：创世期时间契约（卡组、验证、审计、物化、确认页）＋ 与世界导演运行时的边界
兼容策略：新世界强制新契约；旧路径删除与数据库基线重建移交独立的导演切换计划（见 §15）

## 0. 摘要与修订裁决

初稿的诊断与概念骨架经代码实证核查后确认正确，**保留并重构，不推倒**：

- **保留**：根因诊断（数据契约缺少时间语义，§1）；先定锚点再生世界；锚点状态快照 `stateAtAnchor`；权威顺序；原作未来 = 带前置条件的作者侧候选事件（初稿最有价值的设计）；正史分歧与数据库现实分支分离；三档还原模式；修复不得改写玩家锁定、冲突转 `player_override`；物化无时间回退。
- **修正**（初稿的五个结构性缺陷）：
  1. **可计算性**：初稿拒绝历法引擎，却承诺 `FUTURE_EVENT_IN_PAST` 等基于自由字符串时间标签的校验——不可计算。修订引入**统一序数时间轴**（§5.3），标签仅作展示。
  2. **单次生成不可行**：新契约全量字段估算输出 30k–45k token，超出现行 16k 上限（`src/lib/genesis/task-runner.ts:205`）。修订采用**分段生成 + 字段瘦身**（§10）。
  3. **运行时越界**：初稿 §11/§15 重复实现了已批准的世界导演设计（2026-07-24）所拥有的推进与注入机制。修订将运行时机制**移交导演内核**，本设计只输出需求（§14）。
  4. **破坏式升级捆绑**：数据毁灭是产品决策，不是时间机制。移交独立切换计划（§15）。初稿"删除 v1–v3 存档导入"系误判——导入本就仅接受 version 4（`src/app/api/worlds/import/route.ts:1026`）。
  5. **未定义的承重类型**：`EventCondition`/`EventConsequence` 等在修订中给出闭合定义（§8.4）或明确标注为后期开放问题。

## 1. 背景与根因（保留自初稿）

当前流程能校验 JSON 结构、稳定引用和能力继承，却不能证明生成内容属于同一时间点。卡组契约中唯一的时间数据是 `epochConflict.epochName/yearLabel` 两个自由字符串（`src/lib/cards/schemas.ts:231-236`）；人物、势力、地点是跨时期静态综合卡；资料创世时按上传顺序截取约 8000 字（`src/lib/lorebook/st-import.ts:52-66`），游玩时按关键词命中 4000 字预算（`src/lib/context/builder.ts:17,108-130`），均不检查适用时期。

典型错误：已死亡人物担任当前领袖、未成立势力活跃、人物提前获得未来能力、原作未来被写成既成历史、玩家破坏关键条件后剧情仍强制复刻原作。

**根因不是 Prompt 措辞，而是数据契约缺少时间语义。**

修订版补充一项初稿遗漏的基线事实：运行时时间**已经在推进**——叙事者每回合可通过 meta `temporal_state` 输出自由字符串时间标签，事务化写入 `realityState.currentEra` / `observerState.timeLabel`（`src/lib/chat/continuous-meta.ts:20-26`、`finalize.ts:249-256`），纪元变更强制结算（`settlement-policy.ts:38-43`）。问题不在"没有时间"，而在**所有时间值不可比较、无锚点约束**。

## 2. 目标与非目标

### 2.1 目标（保留初稿 1–9，新增第 10）

1. 先确定来源版本与开局时间，再生成该时点的世界快照。
2. 区分开局前历史、开局当前状态和原作未来候选事件。
3. 实体都有明确锚点状态。
4. 程序拒绝**谓词可写出的**时间矛盾，AI 审计语义矛盾。
5. 未指定时期时默认选择原作主线正式开始前夕。
6. 玩家改写原作记录为二创分歧，不伪装正史。
7. 原作未来只在前置条件成立时影响推进,不作为强制剧本。
8. Narrator 只获得当前时点有效且相关的内容。
9. 原创世界复用同一契约的**降级档**（§6.2），不承担无意义成本。
10. 每一阶段独立可交付、可测试，有明确切割线（§16）。

### 2.2 非目标

- 完整历法换算引擎（序数时间轴不是历法引擎，见 §5.3）；
- 公开预设世界市场、自动抓取 Wiki、多人校订、多原作版本自动合并；
- 运行时推进引擎与逐回合注入的**实现**（属世界导演内核，本设计只提需求）；
- 旧数据删除与数据库基线重建（属独立切换计划）。

## 3. 核心原则（保留自初稿）

### 3.1 先定时间，再生世界

```text
玩家神谕与资料
→ 世界来源与连续性
→ 时间锚点与原作截止点
→ 开局前关键历史（序数化）
→ 锚点时刻世界快照
→ 原作未来候选事件（序数化，作者侧）
→ 当前冲突
→ 校验、审计与修复
```

### 3.2 当前状态不是一生概览

每张运行卡只描述对象在锚点时刻的真实状态。未来身份、能力、关系和知识不进入当前状态。

### 3.3 原作未来不是既定事实

原作未来是带前置条件的作者侧候选事件。条件失效后，事件必须延后、变形或取消，不能为复刻剧情凭空恢复条件。

### 3.4 原作知识与角色知识分离

系统保存作者侧未来参考；世界内角色只知道当前时间通过真实渠道获得的信息。**注入边界规则：正史未来事件永不进入 Narrator 的散文上下文，只进入审计上下文**（修订：初稿的 `prohibitedFutureKnowledge` 字段因"粉红大象"效应删除——把剧透写进防剧透的提示词本身就是泄漏，且与 `canonFutureEvents.participantRefs` 冗余）。

### 3.5 权威顺序

```text
玩家明确设定 > 玩家上传资料 > 已锁定时间锚点
> 本局已发生历史 > 模型自身原作知识 > 模型自由推测
```

玩家改变原作时标记 `player_override` 并记录分歧，不能标成 `canon`。

## 4. 契约演进策略：加法优先

初稿的 `characters.{active,inactive}` 重构与全局能力图会破坏至少 58 个导入文件与四条承重不变量（embark 物化 `src/lib/embark/mutations.ts:206,231`、图标主题 `task-runner.ts:341`、重掷粒度 `DECK_CARD_KEYS`、流式进度扫描 `json-progress.ts`、素材库快照校验）。修订采用：

- **阶段 1 只做加法**：保留现有顶层形状，新增 `temporalAnchor` 顶层卡 + 各实体 `statusAtAnchor` 枚举字段 + 能力 `timing` 字段；
- `characters.{active,inactive}` 拆分**取消**——`statusAtAnchor` 枚举 + 验证器规则（active 人物数量下限等）达成同等约束，零迁移成本；
- 能力图归一化推迟到阶段 2，附完整消费者清单后执行；
- `majorCharacters` 下限 6→4（`schemas.ts:269`）：小体量原作在早期锚点可能确实不足 6 名可活动人物，准确性优先。

## 5. 世界来源与时间锚点

### 5.1 WorldSource（判别联合，见 §6.2 降级档）

```ts
type WorldSource =
  | { basis: "original"; ambiguityNotes: string[] }
  | {
      basis: "single_ip" | "multi_ip";
      sourceIps: string[];
      continuity: string;
      continuitySource: "player_explicit" | "lorebook" | "model_inferred";
      ambiguityNotes: string[];
    };
```

### 5.2 TemporalAnchor

```ts
type TemporalAnchor = {
  anchorType: "explicit_date" | "explicit_event" | "identity_period"
    | "main_story_opening" | "original_present";
  currentTimeLabel: string;   // 展示用
  currentEraLabel: string;    // 展示用
  anchorEvent: string;
  canonCutoff: string | null; // basis=original 时必须为 null，否则必填
  selectionSource: "player_explicit" | "lorebook" | "model_inferred";
  confidence: "high" | "medium" | "low";
  assumptions: string[];
};
```

（修订：`anchorType` 增补 `identity_period` 以对齐初稿 §5 自身的六级优先级列表；`canonCutoff` 可空化解初稿 §4"全部必填"与 §13.2"仅原作世界需要"的自相矛盾。）

### 5.3 序数时间轴（新增，解决可计算性）

**所有确定性时间校验只在整数序数上进行；时间标签只做展示。** 正史事件（过去+未来）收敛为**一个**全局有序数组：

```ts
type CanonEvent = {
  ref: string;
  title: string;
  timeLabel: string;            // 展示用，自由字符串
  ordinal: number;              // 全局唯一、严格递增
  epoch: "past" | "future";     // ordinal < anchorOrdinal ⇔ past
  summary: string;
  participantRefs: string[];
  // future 档专属：
  prerequisites?: EventCondition[];
  blockers?: EventCondition[];
  expectedConsequences?: EventConsequence[];
  status?: "pending" | "eligible" | "altered" | "cancelled" | "occurred";
  visibility?: "author_only";
};
// 卡组级：anchorOrdinal: number —— 锚点在该序列中的位置
```

这不是历法引擎：不换算年月、不解析标签，只要求生成器给事件排一个整数先后序。`FUTURE_EVENT_IN_PAST`、`PAST_EVENT_AFTER_CUTOFF`、`INVALID_EVENT_ORDER` 全部化为对 `ordinal` 与 `anchorOrdinal` 的整数比较——谓词可写出，校验才诚实。

## 6. 来源、证据与字段权限

### 6.1 Provenance（修订：降为卡级、可选）

```ts
type Provenance = {
  canonRelation: "canon" | "canon_inferred" | "player_override" | "generated_original";
  evidence?: string[]; // 可选；模型伪造引用不可信，仅供审计线索
};
```

- **卡级**而非逐字段——逐字段 Provenance 估算多耗 3–5k token 且模型可靠性差；
- `basis=original` 世界整体省略（全部必然是 `generated_original`）；
- 字段权限沿用现有 `lockedPaths` / `lockedFields` 机制（`prisma:22`、`continuous-state.ts:170-171`），仅新增 `source_locked` 一档语义；不引入平行的权限存储。

### 6.2 原创世界降级档

`basis=original` 时：无 `canonCutoff`、无 future 档正史事件（原创的"未来规划"归世界导演的作者侧事件机制）、无 `CanonDivergence`、无还原模式、无 Provenance、AI 审计可跳过（无正史可泄漏，内部一致性由确定性校验覆盖）。锚点、序数过去事件（背景史）、`statusAtAnchor` 快照对原创世界同样有价值，全部保留。**一套契约，两个档位**，生成成本约减半。

## 7. 锚点世界快照

阶段 1 仅加 `statusAtAnchor` 枚举 + 一行说明；阶段 2 扩展为瘦快照对象。以人物为例：

```ts
// 阶段 1（加法字段）
type MajorCharacterCardPatch = {
  statusAtAnchor: "active" | "unborn" | "dead" | "missing" | "sealed" | "historical";
  anchorNote: string; // 一句话说明该状态（如"三年前战死于北境"）
};

// 阶段 2（瘦快照，替代初稿的 10 字段全量版）
type CharacterStateAtAnchor = {
  identity: string;
  locationRef: string | null;
  factionMemberships: Array<{ factionRef: string; role: string;
    status: "active" | "former" | "secret" }>;
  currentGoals: string[];       // ≤3
  currentSituation: string;
  knowledgeHints?: string[];    // ≤3，提示性而非权威边界（初稿 currentKnowledge 降级）
};
```

势力（`active|forming|dissolved|destroyed|historical`）、地点（`accessible|hidden|sealed|destroyed|not_yet_created`）、神明（`active|dormant|sealed|dead|fragmented|not_yet_ascended`）、种族（`active|declining|extinct|not_yet_emerged`）同理：阶段 1 枚举 + 注记，阶段 2 瘦对象。玩家神同样受锚点约束，不是时间规则的例外。

能力沿用现有 `DeckAbilitySchema`，**新增一个字段并与现有机制显式合并**（初稿遗漏的映射）：

```ts
timing: "at_anchor" | "future" | "lost"; // 默认 at_anchor
// 保留不变：visibility/rumorText（隐藏能力机制，与时间正交）、
// lockedFields、racial_innate/racial_tradition 继承约束、racialOverrides。
// 现有 state(sealed/lost) 与 timing 的合并在阶段 2 统一为单枚举，附消费者清单。
// 新增时间规则：不能已习得锚点时尚不存在的传承（验证器 T6）。
```

关系（阶段 2）：**有界**——每名 active 人物 1–4 条锚点相关关系；`hiddenDescription` 与 Provenance 可选；允许指向非 active 实体的**追念关系**（`memorial: true`，如"先王之子"），消费者为 Narrator 关系块与导演工具查询。

## 8. 事件模型

### 8.1 统一正史事件序列

见 §5.3 `CanonEvent[]`。过去档构成既成历史；future 档为作者侧候选（`visibility: "author_only"`，永不进入 Narrator 散文上下文）。

### 8.2 本局实际事件：并入 WorldEvent（修订）

初稿的 `RuntimeEvent` 与现有 `WorldEvent`/`WorldActivity`（`prisma/schema.prisma:173-219`，每回合由叙事 meta 喂入，随现实分叉克隆）重叠约 80%。修订**不建平行表**，改为扩展 `WorldEvent`：

```ts
// WorldEvent 增列
sequence: number;          // 世界内序数
canonImpact: "none" | "accelerates" | "delays" | "alters" | "cancels" | "creates_divergence";
affectedCanonEventRefs: string[];
```

### 8.3 正史分歧（保留初稿结构）

```ts
type CanonDivergence = {
  id: string;
  occurredAt: string;
  worldEventId: string;      // 原 runtimeEventId，指向 WorldEvent
  severity: "minor" | "significant" | "timeline_break";
  cause: string;
  affectedCanonEventRefs: string[];
  summary: string;
};
```

数据库 `Timeline` 表示真实现实分支；`CanonDivergence` 表示该现实相对原作基线的偏离。Creator 追溯改写走既有现实分叉（`src/lib/reality/clone.ts`），并在新现实重算分歧。

### 8.4 条件与后果（初稿未定义，修订闭合）

```ts
type EventCondition =
  | { kind: "entity_status"; entityRef: string; requiredStatus: string[] }
  | { kind: "relation_status"; sourceRef: string; targetRef: string; requiredStatus: string[] }
  | { kind: "prior_event_occurred"; canonEventRef: string }
  | { kind: "ordinal_window"; notBeforeOrdinal?: number; notAfterOrdinal?: number }
  | { kind: "custom"; description: string }; // AI 判定，必须返回依据

type EventConsequence =
  | { kind: "status_change"; targetRef: string; toStatus: string }
  | { kind: "relation_change"; sourceRef: string; targetRef: string; toStatus: string }
  | { kind: "custom"; description: string };
```

## 9. 三种还原模式（保留，范围收窄）

`strict_canon | bounded_interpretation | free_remix`，语义同初稿：只改变空白补全自由度、原作惯性与改变关键行为所需的因果强度；**本局内部连续性始终是硬约束**。仅对 IP 世界有效。阶段 1 以隐藏常量 `bounded_interpretation` 实现，UI 选择器后置。

## 10. 生成流水线与预算（修订核心）

### 10.1 分段生成

复用现有 GenesisTask 租约/心跳/断点续传/阶段机（`task-runner.ts:91-146,234-243`）与顶层键流式进度扫描（`generate.ts:85-99`），把一次调用拆为：

```text
段 A：worldSource + temporalAnchor + canonEvents 骨架 + cosmology + epochConflict
段 B：实体快照（gods/factions/races/places/characters + statusAtAnchor + 能力）
段 C：关系 + future 档事件细化 + style/theme
```

每段独立 zod 校验、独立可重试；段间以已生成内容为约束上下文。锚点与来源排在段 A 最前，使时间约束先于一切实体建立（保留初稿"来源和锚点字段必须排在实体卡之前"）。

### 10.2 调用与 token 预算表（初稿缺失，修订补齐）

| 路径 | IP 世界 | 原创世界 |
|---|---|---|
| 顺利路径 | 段 A+B+C（3 次）+ 审计（1 次）= 4 次 | 段 A+B+C = 3 次，免审计 |
| 最坏路径 | + 2 轮修复（每轮修复 1 次 + 复验审计 1 次）= 8 次 | + 2 轮修复 = 5 次 |
| 单段输出预算 | ≤ 12k token | ≤ 12k token |

资料索引调用另计（§12：导入时一次性批量，与创世解耦）。锚点重校准 = 重新创世任务,同预算（§13）。

### 10.3 确定性校验（谓词化）

`validateTemporalConsistency(deck)` 挂载在 `validateParsedDeck` 现有调用位（`generate.ts:48-59`，与 `validateDeckReferences` 并列）。阶段 1 错误码及**精确谓词**：

| 码 | 谓词 |
|---|---|
| T1 `ANCHOR_MISSING` | `basis≠original ∧ canonCutoff=null` |
| T2 `DEAD_LEADER` | 势力 `statusAtAnchor∈{active,forming}` ∧ 其领袖/关键人物 ref 指向 `statusAtAnchor≠active` 的人物 |
| T3 `INACTIVE_FACTION_WITH_MEMBERS` | 势力 `statusAtAnchor∈{dissolved,destroyed,historical}` ∧ 有人物对其保持 `status=active` 的成员关系 |
| T4 `FUTURE_ABILITY_HELD` | 人物/神 `statusAtAnchor=active` ∧ 其能力列表含 `timing≠at_anchor` |
| T5 `EVENT_ORDER_INVALID` | `epoch=past ∧ ordinal≥anchorOrdinal`，或 `epoch=future ∧ ordinal≤anchorOrdinal`，或 ordinal 重复 |
| T6 `TRADITION_NOT_YET_EXTANT` | 已习得传承能力的来源种族/传统在锚点 `not_yet_emerged` |
| T7 `DANGLING_TEMPORAL_REF` | 事件/关系/成员引用不存在的 ref |

事件参与者校验**按事件时点判定**（修订初稿 T 类误报）：past 事件参与者允许锚点已死；future 事件参与者允许锚点未生。追念关系（`memorial: true`）豁免 T3 类检查。初稿的 `ACTIVE_CHARACTER_DEAD` 删除——schema 层已使其不可达。

校验失败 → 走**现有** `genesisRepairPrompt` 全段修复（`generate.ts:104-124`，错误列表追加时间码），单段重生成；两轮仍失败 → 任务终止并展示问题（沿用 `task-runner.ts:276-289`）。**初稿的 DeckPatch 补丁引擎从批准范围移除**——现有修复路径未证明不足，凭阶段 2 遥测数据再议；若再议，按 `RewritePlanSchema` 式类型化 ops 建模（`src/lib/reality/schemas.ts:387-459` 有现成先例），而非裸 JSON-Pointer。

### 10.4 AI 语义审计

IP 世界**无条件**执行（它是散文级未来泄漏的唯一探测器）；原创世界跳过。实现为一次 `completeStructured` 调用（`src/lib/llm/structured.ts:38-101`），输入 = 全卡组 + 资料索引摘录，输出沿用初稿 `TemporalAuditResult` 结构；**审计只报告，不修改**。阶段 2 先以"报告型警告"上线（确认页展示，不阻断），有数据后再决定是否阻断。

## 11. 资料索引与选择

方向保留初稿（废除 8000 字上传序截取），实现具体化：

- **产地**：素材导入/上传时的一次性后台批量分类调用（复用 Settings 现有 backstage 槽位），每次调用处理 N≤20 条,结果持久化、跨创世复用;
- `LoreIndexEntry` 结构同初稿，但 `temporalHints` 收敛为 `{ eraGuess: string; relativeToMainline: "before" | "during" | "after" | "unknown" }`，避免又造一批不可比字符串;
- 创世预算按类别分配（时间线 30% / 世界法则 20% / 当前人物 20% / 势力关系 15% / 地点 10% / 其他 5%），百分比按**字符预算**落地;
- 索引失败回退：使用原始条目并在确认页警告，**不阻断创世**;
- `EvidenceUsage` 由**系统**在注入时记录（哪条索引进了哪段生成上下文），不要求模型自报引用;
- 保留 `LorebookEntry` 表用于 SillyTavern 往返导出（`st-export.ts`），索引是附加层不是替换。

## 12. 物化与 Narrator（创世侧）

- Embark 物化单点（`src/lib/embark/mutations.ts:131-133`）：`initialRealityState.currentEra` / `initialObserverState.timeLabel` 改从 `temporalAnchor` 取值；`anchorOrdinal`、`canonCutoff`、正史事件与分歧分别持久化;
- 非 active 实体不物化为在场实体（dormant 或跳过,一处分支）;
- **删除五处时间回退**（fail-fast 替代）：`builder.ts:377-386`（未名纪元/此刻）、`continuous-state.ts:41-50`、`world-activity/settlement.ts:215-216,298-299`、`settle/pipeline.ts:285-290`、`settle/pipeline.ts:662-664`（元年种子）——仅对新契约世界生效;
- Narrator 回合头（`narrator.ts:273-277` CURRENT WORLD TIME 块）扩展：锚点事件、`canonCutoff`、一条毯式规则——"**截止点之后的原作事件在本世界尚未发生，除非它已在本局中发生**"。这是阶段 1 对"原作未来被当既成事实"的提示词级防线（非保证,硬保证在导演内核,§14）。

## 13. 创世确认界面

- 阶段 1：确认页新增**只读**时间校准卡（来源、连续性、锚点、截止点、置信度、假设清单、校验/审计结果）;修改锚点 = 以同一神谕 + 修改后锚点**重新创世**（诚实计费,零新机制）;
- 后置阶段：就地重校准实现为 GenesisTask 变体（同租约/SSE/阶段机），被保留段作为锁定约束传入（同现有单卡重掷 `prompts/genesis.ts:85-109` 的约束机制）,锁与重建段冲突时弹确认框转 `player_override`,成功后草稿原子替换。初稿"修改时间锚点后必须重建 9 类结构"的树保留为该任务的依赖闭包定义。

## 14. 与世界导演运行时的边界（新增章节，替代初稿 §11/§15 的运行时部分）

已批准的世界导演设计（`docs/superpowers/specs/2026-07-24-world-director-agent-design.md` + 6 份阶段计划）拥有运行时：时之仪推进、NarrationContract 知识边界、确定性内核校验 + ≤2 轮修复、`builder.ts` 的 L0/L1/L2 分层替换。本设计**不在现行 META/settlement 链上实现任何推进机制**（那是注定报废的工作），改为向导演内核输出五项需求：

1. 时之仪推进时评估 future 档 `CanonEvent` 的 `prerequisites/blockers`（§8.4 闭合条件用内核确定性规则,`custom` 条件交内核的 AI 判定并要求依据）,维护 `pending→eligible→altered/cancelled/occurred` 状态机;
2. 候选事件正常发生时落为 `WorldEvent`（带 `canonImpact/affectedCanonEventRefs`）并回写 `occurred`;条件失效的事件可延后/变形/取消,同一社会矛盾可产生新事件但必须有新原因与参与者,不复刻已取消事件;
3. `CanonDivergence` 由内核在 ChangeSet 提交时原子记录,同一因果链维护一个主要分歧;
4. `author_only` 知识域并入 NarrationContract 的 `forbiddenAssertions`——正史未来永不进入散文上下文;预言类能力获知未来必须产生本局证据事件;
5. 时间字段属于导演上下文的 L2 动态层,永不进入 L0/L1 缓存前缀。

在导演落地前的过渡期,阶段 1–4 的产物（锚点头、序数事件、状态快照）已可被现行 `builder.ts` 消费（§12）,两套 pipeline 消费同一数据契约,无双写。

## 15. 兼容与切换（收窄）

本设计范围内：**新世界必须携带完整时间契约,物化与运行时对新世界 fail-fast、无静默补齐**。

移交独立切换计划（与导演 phase-6 切换合并执行,需用户对数据损失显式签字）：删除 `LegacyWorldDeckSchema`（`cards/schemas.ts:289-597`）、存档格式升 v5（v4 存档保留**只读导入**为"遗留世界,无时间保证"——素材库是用户资产,`extract-deck.ts` 消费旧形卡组,必须给转换器或明示放弃）、数据库基线重建、旧回退路径物理删除。

## 16. 实施阶段与切割线

| 阶段 | 内容 | 规模 | 切割线交付 |
|---|---|---|---|
| 1 锚点地基 | §4 加法契约 + §5 锚点/序数轴 + §10.3 验证器 T1–T7 + 现有修复路径 + §12 物化/回退删除 + §13 只读校准卡 + 提示词锚点规则 | M | 死人不再当领袖;未指定时期默认主线前夕;Narrator 拿到真时间与截止点 |
| 2 快照深化 | 瘦 `stateAtAnchor` 对象 + 有界关系 + 卡级 Provenance + 分段生成 + 报告型 AI 审计;含 §4 消费者清单迁移 | L | IP 世界锚点保真度大幅提升,仍无运行时引擎 |
| 3 正史事件（惰性） | `CanonEvent` 全量入库 + Narrator 参考注入（只读）+ settlement 维护 `occurred` | M | 叙事者知道什么还没发生 |
| 4 资料索引 | §11 全部 | M | 资料不再按上传顺序说谎 |
| 5 活的正史未来 | §14 需求在导演内核内实现（依赖导演 phase 1–4）;DeckPatch 凭遥测再议 | L | 条件失效的原作事件真正改道 |
| 6 重校准 + 切换 | §13 后置项 + §15 切换计划 | L | 旧路径清除,契约唯一 |

阶段 1–4 与导演路线图**并行无依赖**;阶段 5 排在导演 phase 4 之后;阶段 6 与导演 phase 6 合并。

## 17. 测试策略

- **Schema**：缺锚点拒绝（IP 档）、原创档 cutoff 必须为 null、future 事件缺条件拒绝、ordinal 重复/越界拒绝、悬空 ref 拒绝;
- **验证器**：T1–T7 每码一组单测,含豁免路径（past 事件的已死参与者、追念关系、原创档跳过 T1）;
- **生成集成**（5 固定案例保留初稿）：纯原创 / 单 IP 未指定时期 / 单 IP 指定后期 / 玩家二创冲突 / 多 IP 各异时点;每案例断言分段预算内完成与全链路绿;
- **Narrator 回归**：角色不知未来秘密、不能用未来能力、已取消事件不复刻、Creator 全知不把原作未来说成现状、现有可见性边界不回归;
- **迁移守护**：旧世界（无锚点）继续可玩,新契约代码路径对其零影响（阶段 1–4 期间）。

## 18. 验收标准

1. 新 IP 世界必有来源、连续性、锚点、截止点与序数事件轴;原创世界有锚点与背景史,无冗余正史机件。
2. 未指定时期的原作世界默认主线正式开始前夕。
3. T1–T7 全部以整数/枚举谓词实现,零字符串时间比较。
4. 校验失败经现有修复路径重试,两轮仍败则任务终止,不带病开局。
5. 修复不改玩家锁定;冲突显式转 `player_override`。
6. Narrator 回合头含锚点与截止点毯式规则;正史未来不进散文上下文。
7. 每阶段独立可交付,阶段 1 不含任何数据库破坏性变更。
8. 运行时推进机制零实现于现行 META/settlement 链;需求文档化并被导演设计引用。

本规格只批准设计,不代表已授权或完成生产代码改造。
