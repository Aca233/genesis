# 时间一致的世界生成设计

日期：2026-07-26
状态：设计已确认并完成规格自检，等待用户复核
范围：一句话创世、资料导入、创世确认、开局物化与 Narrator 上下文
兼容策略：破坏式升级，不兼容旧存档、旧草稿或旧世界

## 1. 背景

当前流程能校验 JSON 结构、稳定引用和部分能力继承，却不能证明生成内容属于同一时间点。现有数据仅以 `epochConflict.epochName` 和 `yearLabel` 表达时间；人物、势力、地点、能力和关系是跨时期的静态综合卡。资料在创世时按上传顺序截取，游玩时按关键词命中，不检查适用时期。

典型错误包括：已死亡人物担任当前领袖、尚未成立或已覆灭势力仍活跃、人物提前获得未来身份/能力/知识、原作未来被写成既成历史、互斥版本混用，以及玩家破坏关键条件后剧情仍强制复刻原作。

根因不是 Prompt 措辞，而是数据契约缺少时间语义。生成、验证、物化和运行时上下文必须共同服从同一时间锚点。

## 2. 目标与非目标

### 2.1 目标

1. 先确定来源版本与开局时间，再生成该时点的世界快照。
2. 区分开局前历史、开局当前状态和原作未来候选事件。
3. 人物、神明、势力、地点、能力和关系都有明确锚点状态。
4. 程序拒绝可确定的时间矛盾，AI 审计语义矛盾。
5. 未指定时期时默认选择原作主线正式开始前夕。
6. 玩家改写原作时记录二创分歧，不伪装成原作正史。
7. 原作未来只在前置条件仍成立时影响推进，不作为强制剧本。
8. Narrator 只获得当前时点有效且与场景相关的内容。
9. 原创世界复用同一时间一致性契约。

### 2.2 非目标

- 公开预设世界市场；
- 自动联网抓取 Wiki；
- 多人共同校订；
- 完整历法换算引擎；
- 多原作版本自动合并；
- 旧存档、旧世界、旧草稿或旧 Schema 迁移；
- 普通原作分歧自动创建数据库现实分支。

## 3. 核心原则

### 3.1 先定时间，再生世界

```text
玩家神谕与资料
→ 世界来源与连续性
→ 时间锚点与原作截止点
→ 开局前关键历史
→ 锚点时刻世界快照
→ 原作未来候选事件
→ 当前冲突
→ 校验、审计与定向修复
```

### 3.2 当前状态不是一生概览

每张运行卡只描述对象在锚点时刻的真实状态。未来身份、能力、关系和知识不能进入当前状态。

### 3.3 原作未来不是既定事实

原作未来是带前置条件的作者侧候选事件。条件失效后，事件必须延后、变形或取消，不能为复刻剧情而凭空恢复条件。

### 3.4 原作知识与角色知识分离

系统可以保存作者侧未来参考；世界内角色只能知道当前时间通过真实渠道获得的信息。Creator 全知也必须区分当前世界秘密与尚未发生的原作未来。

### 3.5 权威顺序

```text
玩家明确设定
> 玩家上传资料
> 已锁定时间锚点
> 本局已发生历史
> 模型自身原作知识
> 模型自由推测
```

玩家改变原作时标记为 `player_override` 并记录分歧，不能标成 `canon`。

## 4. 新世界卡组

新版本只维护一套严格契约；时间字段全部必填。

```ts
type WorldDeck = {
  mode: "pantheon" | "creator";
  worldName: string;
  canonFidelity: CanonFidelity;
  worldSource: WorldSource;
  temporalAnchor: TemporalAnchor;
  cosmology: CosmologyCard;
  fusionAxiom: FusionAxiomCard | null;
  canonPastEvents: CanonPastEvent[];
  playerGod: PlayerGodCard | null;
  majorGods: GodCard[];
  minorGods: GodCard[];
  factions: FactionCard[];
  races: RaceCard[];
  places: PlaceCard[];
  characters: { active: CharacterCard[]; inactive: CharacterCard[] };
  relationsAtAnchor: RelationAtAnchor[];
  abilities: AbilityCard[];
  canonFutureEvents: CanonFutureEvent[];
  epochConflict: EpochConflictCard;
  style: StyleCard;
  theme: ThemeCard;
};
```

能力在模型输出中可按所有者嵌套，但进入验证和运行时前必须归一化为全局可引用的能力图。

模式约束：Pantheon 必须且只能有一个 `playerGod`；Creator 的 `playerGod` 必须为 `null`，且不得把玩家编码成任何世界内对象。玩家神同样具有 `stateAtAnchor`、能力时间状态和 Provenance，不能成为时间规则的例外。

## 5. 世界来源与时间锚点

```ts
type WorldSource = {
  basis: "original" | "single_ip" | "multi_ip";
  sourceIps: string[];
  continuity: string;
  continuitySource: "player_explicit" | "lorebook" | "model_inferred";
  ambiguityNotes: string[];
};

type TemporalAnchor = {
  anchorType:
    | "explicit_date"
    | "explicit_event"
    | "main_story_opening"
    | "original_present";
  currentTimeLabel: string;
  currentEraLabel: string;
  anchorEvent: string;
  canonCutoff: string;
  selectionSource: "player_explicit" | "lorebook" | "model_inferred";
  confidence: "high" | "medium" | "low";
  assumptions: string[];
  futureKnowledgePolicy: "author_only";
};
```

`canonCutoff` 是当前事实与原作未来的硬边界。截止点之后才形成的身份、能力、关系、知识、死亡和事件结果不能写入锚点状态。

锚点选择优先级：玩家明确日期 → 明确事件前后 → 指定身份的有效时期 → 资料指定时期 → 原作主线正式开始前夕 → 原创故事开始之日。互相冲突的玩家条件不静默糅合，转为 `player_override` 和显式假设。

## 6. 来源、证据与字段权限

```ts
type Provenance = {
  canonRelation:
    | "canon"
    | "canon_inferred"
    | "player_override"
    | "generated_original";
  evidence: string[];
};

type FieldAuthority = "player_locked" | "source_locked" | "generated";
```

`canon` 必须由玩家输入或资料直接支持；`canon_inferred` 是受限推导；`player_override` 是玩家二创；`generated_original` 是允许区域内的新创作。模型记忆没有证据时不能标为 `canon`。自动修复不能改 `player_locked`，尽量保留 `source_locked`，优先修复 `generated`。

## 7. 锚点世界快照

### 7.1 人物

```ts
type CharacterCard = {
  ref: string;
  name: string;
  aliases: string[];
  baseline: {
    origin: string;
    raceRef: string;
    personalityCore: string;
  };
  stateAtAnchor: {
    existence:
      | "active"
      | "unborn"
      | "dead"
      | "missing"
      | "sealed"
      | "historical";
    age: string;
    identity: string;
    locationRef: string | null;
    factionMemberships: Array<{
      factionRef: string;
      role: string;
      status: "active" | "former" | "secret";
    }>;
    currentGoals: string[];
    currentSituation: string;
    currentKnowledge: string[];
    prohibitedFutureKnowledge: string[];
    availableAbilityRefs: string[];
    unavailableAbilityRefs: string[];
  };
  provenance: Provenance;
};
```

`characters.active` 只允许 `existence = active`。其他状态进入 `inactive`，不能为凑数量改写生死。活跃人物建议 4 至 12 位；若原作该时点更少，准确性优先。当前身份、位置、阵营、目标、知识和能力都必须在锚点成立。

### 7.2 势力

```ts
type FactionCard = {
  ref: string;
  name: string;
  aliases: string[];
  kind: string;
  ideology: string;
  stateAtAnchor: {
    existence:
      | "active"
      | "forming"
      | "dissolved"
      | "destroyed"
      | "historical";
    territoryRefs: string[];
    leaderRefs: string[];
    memberRefs: string[];
    currentStrength: string;
    currentGoals: string[];
    currentConflicts: string[];
  };
  provenance: Provenance;
};
```

已毁灭或历史势力不能拥有当前领袖和活跃成员；形成中的势力不能被描述为长期成熟组织；领袖必须在锚点可行动且具有成员关系。

### 7.3 地点

```ts
type PlaceCard = {
  ref: string;
  name: string;
  aliases: string[];
  kind: string;
  stateAtAnchor: {
    existence:
      | "accessible"
      | "hidden"
      | "sealed"
      | "destroyed"
      | "not_yet_created";
    controllingFactionRef: string | null;
    currentCondition: string;
    currentOccupantRefs: string[];
  };
  provenance: Provenance;
};
```

当前角色不能位于已毁灭、封印或尚未建立的地点，除非有明确且可验证的特殊规则。

### 7.4 能力

```ts
type AbilityCard = {
  ref: string;
  ownerRef: string;
  name: string;
  kind: AbilityKind;
  effect: string;
  trigger: string;
  cost: string;
  limitations: string;
  mastery: AbilityMastery;
  chronology: {
    statusAtAnchor:
      | "available"
      | "latent"
      | "unlearned"
      | "sealed"
      | "lost"
      | "not_yet_created";
    acquiredByEventRef: string | null;
    availableFromEventRef: string | null;
  };
  provenance: Provenance;
};
```

人物 `availableAbilityRefs` 只能引用 `statusAtAnchor = available` 的能力。未来在本局提前获得能力时，由运行事件记录实际原因和相对原作的影响。

### 7.5 神明

```ts
type GodCard = {
  ref: string;
  name: string;
  aliases: string[];
  stateAtAnchor: {
    existence:
      | "active"
      | "dormant"
      | "sealed"
      | "dead"
      | "fragmented"
      | "not_yet_ascended";
    currentRank: Rank;
    currentDomains: string[];
    currentFaithScope: string;
    currentSituation: string;
  };
  abilityRefs: string[];
  persona: string;
  voice: GodVoice;
  agenda: GodAgenda;
  provenance: Provenance;
};
```

未来才升格的角色不能提前成为当前主神。非 active 状态限制当前行动，验证器检查其与剧情、关系和能力的冲突。

### 7.6 关系

```ts
type RelationAtAnchor = {
  sourceRef: string;
  targetRef: string;
  status:
    | "ally"
    | "enemy"
    | "rival"
    | "subordinate"
    | "family"
    | "unknown"
    | "no_contact";
  publicDescription: string;
  hiddenDescription: string | null;
  provenance: Provenance;
};
```

关系只表达锚点状态。未来关系变化属于未来候选事件或运行事件，不能覆盖开局关系。

### 7.7 种族与玩家神

```ts
type RaceCard = {
  ref: string;
  name: string;
  aliases: string[];
  baseline: {
    traits: string;
    lifespan: string;
    innateAbilityRefs: string[];
    traditionAbilityRefs: string[];
  };
  stateAtAnchor: {
    existence: "active" | "declining" | "extinct" | "not_yet_emerged";
    distributionPlaceRefs: string[];
    currentSituation: string;
  };
  provenance: Provenance;
};

type PlayerGodCard = GodCard & {
  isPlayer: true;
  origin: string;
  currentSituation: string;
};
```

已灭绝或尚未出现的种族不能拥有当前活跃成员。Pantheon 玩家神必须在锚点存在；其出身、位阶、信仰和能力均受锚点与来源约束。Creator 不生成玩家神。

## 8. 事件模型

### 8.1 开局前历史

```ts
type CanonPastEvent = {
  ref: string;
  title: string;
  timeLabel: string;
  order: number;
  summary: string;
  participantRefs: string[];
  affectedRefs: string[];
  consequences: EventConsequence[];
  provenance: Provenance;
};
```

这些事件构成锚点世界的既成历史。Pantheon 普通行动不能追溯修改；Creator 追溯改写沿用现实分叉机制。

### 8.2 原作未来候选事件

```ts
type CanonFutureEvent = {
  ref: string;
  title: string;
  originalTimeLabel: string;
  relativeOrder: number;
  prerequisites: EventCondition[];
  blockers: EventCondition[];
  participantRefs: string[];
  expectedConsequences: EventConsequence[];
  status: "pending" | "eligible" | "altered" | "cancelled" | "occurred";
  visibility: "author_only";
  provenance: Provenance;
};
```

第一版支持人物/势力/地点状态、关系、前置事件和时间窗口等可计算条件；无法计算的条件使用 `{ kind: "custom"; description: string }`，交给 AI 判断且必须返回依据。

### 8.3 本局实际事件

```ts
type RuntimeEvent = {
  id: string;
  title: string;
  timeLabel: string;
  sequence: number;
  causes: EventCause[];
  participantRefs: string[];
  consequences: EventConsequence[];
  canonImpact:
    | "none"
    | "accelerates"
    | "delays"
    | "alters"
    | "cancels"
    | "creates_divergence";
  affectedCanonEventRefs: string[];
};
```

RuntimeEvent 是该局新增历史。原作候选正常发生时也落为 RuntimeEvent，并将候选标记为 `occurred`。

## 9. 原作分歧

普通行为改变原作未来时，不创建数据库 Timeline，而在当前现实记录：

```ts
type CanonDivergence = {
  id: string;
  occurredAt: string;
  runtimeEventId: string;
  severity: "minor" | "significant" | "timeline_break";
  cause: string;
  affectedCanonEventRefs: string[];
  summary: string;
};
```

`minor` 是时间、地点或细节改变；`significant` 是主要人物命运、势力归属或关键结果改变；`timeline_break` 是后续大段原作因果失效。同一连续因果链维护一个主要分歧。

数据库 `Timeline` 表示真实现实分支；`CanonDivergence` 表示该现实相对原作基线的偏离。Creator 追溯改写创建新 Timeline，并在新现实重新计算分歧。

## 10. 三种还原模式

```ts
type CanonFidelity =
  | "strict_canon"
  | "bounded_interpretation"
  | "free_remix";
```

- **严格原作**：资料空白保持未知；原作规则和因果约束最强；关键改变需要充分因果。
- **合理演绎**：允许标明来源的受限推演；允许可信分歧；作为默认模式。
- **自由魔改**：玩家设定优先；允许大幅扩写；原作未来主要作为参考。

三档只改变空白补全自由度、原作惯性和改变关键行为所需的因果强度。本局内部连续性始终是硬约束；前置条件已失效时，任何模式都不能强演原事件。

## 11. 世界推进

每次时间推进执行：

```text
确定新的时间窗口
→ 查找窗口内 future events
→ 检查 prerequisites 与 blockers
→ 全部成立：eligible
→ 部分变化：altered
→ 关键条件失效：cancelled
→ 只向 Narrator 注入 eligible 与相关 altered 事件
→ 生成并保存 RuntimeEvent
→ 应用状态变化
→ 更新候选事件与 CanonDivergence
```

事件可按原作发生、提前/延后、变形或取消。若相同社会矛盾仍存在，可以产生新 RuntimeEvent，但必须有新的原因和参与者，不能凭空复制已经取消的原作事件。

## 12. 资料索引与选择

删除按上传顺序截取前约 8000 字的策略。外部资料先转换为内部索引：

```ts
type LoreIndexEntry = {
  id: string;
  title: string;
  content: string;
  keywords: string[];
  category:
    | "world_rule"
    | "timeline"
    | "character"
    | "faction"
    | "place"
    | "ability"
    | "other";
  temporalHints: string[];
  entityHints: string[];
  priority: number;
};
```

创世预算建议：时间线 30%、世界法则 20%、当前人物 20%、势力与关系 15%、地点 10%、其他 5%。系统保存 `EvidenceUsage { loreEntryId, usedForPaths }`，使审计可以追溯事实来源。运行时检索除关键词外，还必须按时间与对象状态过滤。

## 13. 生成与质量门

### 13.1 总流程

```text
一次结构化主生成
→ Schema 校验
→ 确定性时间校验
→ AI 语义时间审计
→ 必要时定向补丁修复
→ 完整重验
→ 最多两轮修复
→ 玩家确认
→ 开局物化
```

来源和锚点字段必须排在实体卡之前，使同一次结构化输出先建立时间约束。主生成仍为一次调用；发现问题时才追加审计和修复调用。

### 13.2 Schema 校验

至少检查：来源/连续性/锚点存在；原作世界具有 `canonCutoff`；对象具有 `stateAtAnchor`；事实具有 Provenance；未来事件具有前置条件；ref 唯一且可解析；关系与事件不用显示名代替 ref。

### 13.3 确定性时间校验

```ts
validateTemporalConsistency(deck): TemporalIssue[]
```

错误至少包括：

- `ACTIVE_CHARACTER_DEAD`；
- `LEADER_NOT_ACTIVE`；
- `FACTION_NOT_ACTIVE`；
- `ABILITY_NOT_AVAILABLE`；
- `EVENT_PARTICIPANT_UNAVAILABLE`；
- `FUTURE_EVENT_IN_PAST`；
- `PAST_EVENT_AFTER_CUTOFF`；
- `LOCATION_UNAVAILABLE`；
- `DANGLING_TEMPORAL_REF`；
- `INVALID_EVENT_ORDER`；
- `CURRENT_RELATION_TO_INACTIVE_ENTITY`。

警告至少包括：`LOW_ANCHOR_CONFIDENCE`、`CUSTOM_CONDITION_UNCHECKED`、`CANON_INFERRED_WITHOUT_EVIDENCE`、`CONTINUITY_AMBIGUOUS`、`LARGE_CANON_GAP`、`PLAYER_OVERRIDE_CHAIN_RISK`。存在 error 时不能确认世界。

### 13.4 AI 语义审计

审计连续性混用、未来身份/能力/知识泄漏、生死描述冲突、事件因果冲突及无证据原作声明。审计只报告问题，不能在同一次输出中静默修改卡组。

```ts
type TemporalAuditResult = {
  verdict: "pass" | "repair_required";
  issues: Array<{
    severity: "error" | "warning";
    path: string;
    type: TemporalAuditIssueType;
    explanation: string;
    evidenceRefs: string[];
    proposedCorrection: unknown;
  }>;
};
```

### 13.5 定向修复

修复模型只返回受控补丁：

```ts
type DeckPatch = {
  operations: Array<
    | { op: "replace"; path: string; value: unknown }
    | { op: "remove"; path: string }
    | { op: "add"; path: string; value: unknown }
  >;
  explanations: string[];
};
```

服务端验证路径和字段权限后应用补丁，再执行完整 Schema、引用、时间校验和语义审计。最多自动修复两轮；仍有 error 时终止并显示问题，不允许带病开局。

错误只能通过改变玩家锁定内容解决时，修复器应保留玩家要求，将冲突转为显式 `player_override` 和分歧假设，再重新推导受影响节点。

## 14. 创世确认界面

确认页新增时间校准区，展示世界来源、连续性、还原模式、锚点、当前纪元和时间、原作截止点、采用假设、玩家分歧、校验结果和警告。

玩家可编辑连续性、开局时间、锚点事件、二创覆盖和推演假设。修改时间锚点后必须重建：

```text
temporalAnchor
├─ canonPastEvents
├─ canonFutureEvents
├─ character.stateAtAnchor
├─ faction.stateAtAnchor
├─ place.stateAtAnchor
├─ god.stateAtAnchor
├─ ability.chronology
├─ relationsAtAnchor
└─ epochConflict
```

可保留世界名、来源作品、连续性、宇宙法则、种族基础、玩家锁定二创、文风和主题。界面不得只修改时间文字而保留旧状态。

## 15. 开局物化与 Narrator

开局物化把 `stateAtAnchor` 写入活动 Timeline 的初始现实状态，并分别持久化过去、未来和分歧。数据缺失或与锚点矛盾时直接失败，不使用“未名纪元”“此刻”或旧 `draftDeck` 时间回退。

Narrator 每轮只接收：当前时间；当前存在状态；身份、关系、能力和知识边界；相关既成历史；窗口内满足条件的候选事件；已改变事件的差异及禁止照搬结果；相关 RuntimeEvent 与 CanonDivergence。

默认不注入未出生人物、未来能力、无关历史、取消事件和原作未来完整答案。

```ts
type KnowledgeScope =
  | "public_at_anchor"
  | "character_known"
  | "faction_secret"
  | "author_only_future";
```

`CanonFutureEvent` 永远是 `author_only_future`。预言能力若让角色获知未来，必须产生本局证据，不能把作者知识直接视为角色知识。

## 16. 数据与兼容策略

本次采用破坏式升级：

- 删除 `LegacyWorldDeckSchema` 和旧草稿解析；
- 删除旧存档 v1、v2、v3 导入兼容；
- 删除缺少时间字段时的默认补齐；
- 删除从 `draftDeck.epochConflict` 回退时间的逻辑；
- 删除旧世界渐进补齐时间信息的路径；
- 数据库以新基线重建，不编写旧数据转换器；
- 外部资料格式可以导入，但必须转换为新 `LoreIndexEntry`。

实现时可以重建 Prisma 基线迁移，但不得误删用户未提交的其他工作区改动。

## 17. 错误处理

- 结构错误：进入定向修复；
- 确定性时间 error：禁止确认并进入修复；
- 审计 error：进入修复；
- warning：允许确认但必须展示；
- 两轮修复仍失败：任务终止并保存安全错误和问题列表；
- 玩家修改锚点后重建失败：保留原已验证草稿，不应用半成品；
- 运行时事件应用失败：沿用事务和 durable generation，正文、时间、状态、事件与分歧原子提交。

## 18. 测试策略

### 18.1 Schema

- 缺少时间锚点拒绝；
- 缺少来源版本拒绝；
- 未来事件缺少前置条件拒绝；
- 实体缺少锚点状态拒绝；
- Provenance 缺失拒绝；
- 重复或悬空 ref 拒绝。

### 18.2 时间验证器

为每个错误代码编写单元测试，重点覆盖：死亡人物成为领袖、未来能力提前可用、未成立势力拥有成员、已毁地点成为当前位置、未来事件混入过去、事件依赖顺序反转、当前关系依赖不可用对象。

### 18.3 生成集成

固定案例至少包括：

1. 纯原创世界；
2. 单 IP 且未指定时期；
3. 单 IP 且明确指定后期；
4. 玩家提出与原作冲突的二创条件；
5. 多 IP 融合且各自时间点不同。

验证主生成、确定性校验、语义审计、补丁修复、确认和开局物化全链路。

### 18.4 Narrator 回归

- 角色不知道未来秘密；
- 角色不能使用未来能力；
- 已取消事件不被强制复刻；
- 时间推进只加载临近候选事件；
- 玩家分歧持续影响后续条件；
- Creator 全知不会把原作未来说成当前现实；
- Pantheon 与 Creator 的既有可见性边界继续成立。

## 19. 验收标准

1. 每个新世界都有明确来源、连续性、锚点和截止点。
2. 未指定时期的原作世界默认位于主线正式开始前夕。
3. 当前实体状态可追溯到资料、玩家覆盖或明确推演。
4. 程序拒绝已定义的确定性时间矛盾。
5. 语义审计发现未来身份、能力、知识和连续性混用。
6. 自动修复不改玩家锁定字段，最多两轮且每轮完整重验。
7. 玩家修改锚点会重建所有时间依赖状态。
8. Narrator 不接收无关或尚未有效的未来状态。
9. 原作事件条件失效后可以改变或取消，不被强制复刻。
10. 普通原作分歧与数据库现实分支保持独立。
11. 新系统不包含旧存档或旧世界兼容分支。

## 20. 实施阶段建议

后续实施计划应拆为：

1. 新卡组与时间类型契约；
2. 时间一致性验证器及测试；
3. 资料索引与创世 Prompt；
4. 审计和受控补丁修复；
5. 创世确认页时间校准；
6. 开局物化与数据库新基线；
7. Narrator 时间过滤和未来事件推进；
8. 删除旧兼容路径、更新文档并完成全量验证。

本规格只批准设计，不代表已经授权或完成生产代码改造。
