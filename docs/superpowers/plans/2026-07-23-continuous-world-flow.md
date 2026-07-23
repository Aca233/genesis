# Continuous World Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将正式游玩改造成无玩家可见章节、单输入、自动轻量更新与自动世界整理的连续流程，并在创世演出期间生成可幂等恢复的开场正文。

**Architecture:** 继续把 `Chapter` 当作内部检查点窗口，不做数据库迁移；Narrator 的同一次响应返回正文与受校验的连续世界元数据。普通输入在一个事务中落玩家消息、Narrator 消息、时间状态和安全轻变化；追溯改写不污染源现实，而是原子创建现有 RealityRewrite 任务。前端根据聊天 SSE 的 durable `followUp` 自动跟进世界整理或现实分叉，刷新时再由 world state 恢复未完成工作。

**Tech Stack:** Next.js 16 Route Handlers、React 19、TypeScript、Prisma 7/PostgreSQL、Zod 4、Vitest 4、SSE

---

## 实施边界与文件结构

### 新增文件

- `src/lib/chat/continuous-meta.ts`：连续 Narrator 元数据、时间标签和轻变化的 Zod 契约。
- `src/lib/chat/continuous-state.ts`：旧存档时间回退、时间部分更新和轻变化白名单应用。
- `src/lib/chat/settlement-policy.ts`：自动世界整理的确定性触发规则。
- `src/lib/chat/follow-up.ts`：聊天完成结果及 `none | settlement | rewrite` durable 契约。
- `src/lib/reality/create-task.ts`：可在已有事务内创建追溯改写任务的共用入口。
- `src/components/play/world-settlement-state.ts`：世界整理 SSE 客户端与恢复编排。
- `src/components/genesis/embark-flow.ts`：物化后立即生成 opening 的可测试编排。
- 与上述模块同目录的 `*.test.ts` / `*.integration.test.ts`。

### 重点修改文件

- `src/lib/prompts/narrator.ts`、`src/lib/context/builder.ts`：无章节提示词、统一创世主输入、文字时间优先和连续元数据输出。
- `src/lib/chat/request.ts`、`src/lib/chat/finalize.ts`、`src/app/api/chat/route.ts`、`src/lib/context/sse.ts`：延迟落玩家消息、原子完成、自动 follow-up。
- `src/lib/settle/pipeline.ts`、`src/lib/prompts/settlement.ts`、`src/app/api/chapters/[id]/settle/route.ts`：内部检查点语义和轻量恢复。
- `src/app/api/worlds/[id]/state/route.ts`、`src/components/play/types.ts`：连续消息、时间标题、编辑权限和恢复状态 DTO。
- `src/components/play/InputDeck.tsx`、`src/components/play/CreatorInputDeck.tsx`、`src/components/play/StoryStream.tsx`、`src/components/play/MessageBlock.tsx`、`src/app/play/[worldId]/page.tsx`：统一输入和连续正文 UI。
- `src/components/genesis/GenesisCeremony.tsx`、`src/app/genesis/[worldId]/page.tsx`：演出与开篇生成并行。
- `src/app/api/messages/[id]/route.ts` 与异文路由：检查点后可编辑、检查点前只读。

### 必须保护的现有用户改动

以下文件在计划开始时已有未提交修改，不得回滚、覆盖或整体重写：

- `src/lib/prompts/rewrite.test.ts`
- `src/lib/prompts/rewrite.ts`
- `src/lib/reality/apply.integration.test.ts`
- `src/lib/reality/apply.ts`
- `src/lib/reality/schemas.test.ts`
- `src/lib/reality/schemas.ts`

对 `src/lib/reality/schemas.ts` 只允许把 `initialRealityState().currentEra` 从 `yearLabel` 修正为 `epochName` 的小补丁；其余新逻辑放入新文件，提交前逐文件检查 staged diff。

---

### Task 1: 定义连续 Narrator 元数据与无章节提示词

**Files:**
- Create: `src/lib/chat/continuous-meta.ts`
- Create: `src/lib/chat/continuous-meta.test.ts`
- Modify: `src/lib/prompts/narrator.ts`
- Modify: `src/lib/prompts/narrator.test.ts`
- Modify: `src/lib/context/builder.ts`
- Modify: `src/lib/context/builder.test.ts`

- [ ] **Step 1: 写连续元数据解析和提示词失败测试**

```ts
// src/lib/chat/continuous-meta.test.ts
import { describe, expect, it } from "vitest";
import { ContinuousNarratorMetaSchema, emptyContinuousMeta } from "./continuous-meta";

describe("ContinuousNarratorMetaSchema", () => {
  it("接受普通推进、部分时间更新和安全轻变化", () => {
    const parsed = ContinuousNarratorMetaSchema.parse({
      suggestions: ["继续观察港口"],
      operation: "continue",
      temporalState: { time: "双月重合之夜" },
      immediateChanges: [
        { kind: "set_scene_presence", entityId: "entity-1", present: true },
      ],
      significantEvent: false,
      settlementReasons: [],
    });
    expect(parsed.temporalState).toEqual({ time: "双月重合之夜" });
  });

  it("拒绝模型自造的任意数据库字段", () => {
    expect(() => ContinuousNarratorMetaSchema.parse({
      ...emptyContinuousMeta(),
      immediateChanges: [{ kind: "raw_sql", value: "drop table worlds" }],
    })).toThrow();
  });
});
```

```ts
// 追加到 src/lib/prompts/narrator.test.ts
it("输出契约不再出现章节，并声明明确时间文字覆盖表盘但不改表盘", () => {
  const prompt = narratorSystem({
    ...baseOptions,
    mode: "creator",
    scale: "scene",
    playerInput: "百年之后再看这里",
    temporal: { era: "黑潮纪元", time: "帝历三百二十七年" },
  });
  expect(prompt).not.toMatch(/Chapter|章节|chapterBreakHint/);
  expect(prompt).toContain("explicit time wording");
  expect(prompt).toContain("overrides the dial for this reply only");
  expect(prompt).toContain("retroactive_rewrite");
});
```

- [ ] **Step 2: 运行测试并确认因模块或新契约缺失而失败**

Run:

```bash
pnpm test -- src/lib/chat/continuous-meta.test.ts src/lib/prompts/narrator.test.ts src/lib/context/builder.test.ts
```

Expected: FAIL，提示 `continuous-meta` 不存在，或旧提示词仍包含 `chapterBreakHint` / `Chapter One`。

- [ ] **Step 3: 实现严格、向后兼容的连续元数据契约**

```ts
// src/lib/chat/continuous-meta.ts
import { z } from "zod";

export const SettlementReasonSchema = z.enum([
  "major_event",
  "ability_change",
  "important_death",
  "faction_change",
  "rank_change",
  "identity_change",
  "relation_restructure",
  "era_change",
  "multi_entity_change",
]);

export const TemporalPatchSchema = z.object({
  era: z.string().trim().min(1).max(120).optional(),
  time: z.string().trim().min(1).max(160).optional(),
}).strict().refine((value) => value.era !== undefined || value.time !== undefined);

export const ImmediateChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set_observer_focus"),
    focusType: z.enum(["world", "place", "entity", "god", "avatar"]),
    focusId: z.string().trim().min(1).nullable(),
  }).strict(),
  z.object({
    kind: z.literal("set_scene_presence"),
    entityId: z.string().trim().min(1),
    present: z.boolean(),
  }).strict(),
  z.object({
    kind: z.literal("set_active_avatar"),
    entityId: z.string().trim().min(1).nullable(),
  }).strict(),
  z.object({
    kind: z.literal("set_entity_section"),
    entityId: z.string().trim().min(1),
    key: z.enum(["whereabouts", "holder", "affiliation", "relationToPlayer", "majorEvents"]),
    content: z.string().trim().min(1).max(1000),
  }).strict(),
]);

export const AbilityRevealSchema = z.object({
  abilityId: z.string().trim().min(1),
  visibility: z.enum(["rumored", "known"]),
  evidence: z.string().trim().min(1),
}).strict();

export const ContinuousNarratorMetaSchema = z.object({
  suggestions: z.array(z.string().trim().min(1)).max(4).default([]),
  operation: z.enum(["continue", "retroactive_rewrite"]).default("continue"),
  temporalState: TemporalPatchSchema.optional(),
  immediateChanges: z.array(ImmediateChangeSchema).max(12).default([]),
  significantEvent: z.boolean().default(false),
  settlementReasons: z.array(SettlementReasonSchema).max(9).default([]),
  revealedEventIds: z.array(z.string()).optional(),
  abilityReveals: z.array(AbilityRevealSchema).optional(),
}).strict();

export type ContinuousNarratorMeta = z.infer<typeof ContinuousNarratorMetaSchema>;
export type ImmediateChange = z.infer<typeof ImmediateChangeSchema>;

export function emptyContinuousMeta(): ContinuousNarratorMeta {
  return {
    suggestions: [],
    operation: "continue",
    immediateChanges: [],
    significantEvent: false,
    settlementReasons: [],
  };
}
```

在 `splitMetaBlock()` 中把 snake_case 模型字段映射为上述 camelCase 类型；损坏 META 回退 `emptyContinuousMeta()`。对旧消息的 `chapterBreakHint` 只在读取时忽略，不再输出。

在 `narratorTurnSystem()` 增加 `playerInput` 和 `temporal`，明确：

```ts
const temporalRule = `The dial is the default span. Explicit time wording in the player's
current text overrides the dial for this reply only; never ask for confirmation and never
change the dial itself. Current era: ${opts.temporal.era}. Current time: ${opts.temporal.time}.`;
```

创世主规则改为让同一输入既可观察、行动、建立未来事实，也可识别对既成历史的推翻；只有后者输出 `retroactive_rewrite`。诸神模式强制 `operation: "continue"`。`openingDirective()` 删除 `Chapter One`，改用 “first passage of this world's recorded history”。

`builder.ts` 将创世主玩家前缀改为 `【创世主意图】`，实体卡首行加入 `[entity.id]`，编年史空时间不再回退 `第N章`，并把当前纪元、时间和本轮原文传给 `narratorTurnSystem()`。

- [ ] **Step 4: 运行聚焦测试并确认通过**

Run:

```bash
pnpm test -- src/lib/chat/continuous-meta.test.ts src/lib/prompts/narrator.test.ts src/lib/context/builder.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交连续元数据与提示词**

```bash
git add src/lib/chat/continuous-meta.ts src/lib/chat/continuous-meta.test.ts src/lib/prompts/narrator.ts src/lib/prompts/narrator.test.ts src/lib/context/builder.ts src/lib/context/builder.test.ts
git commit -m "feat: define continuous narration contract"
```

---

### Task 2: 持久化自由格式纪元、时间与安全轻变化

**Files:**
- Create: `src/lib/chat/continuous-state.ts`
- Create: `src/lib/chat/continuous-state.test.ts`
- Create: `src/lib/chat/continuous-state.integration.test.ts`
- Modify: `src/lib/reality/schemas.ts`
- Modify: `src/lib/reality/schemas.test.ts`

- [ ] **Step 1: 写时间回退、部分更新和引用校验失败测试**

```ts
// src/lib/chat/continuous-state.test.ts
import { describe, expect, it } from "vitest";
import { mergeTemporalState, resolveTemporalState } from "./continuous-state";

describe("continuous temporal state", () => {
  it("部分更新时间时保留原纪元", () => {
    expect(mergeTemporalState(
      { era: "黑潮纪元", time: "帝历三百二十七年" },
      { time: "双月重合之夜" },
    )).toEqual({ era: "黑潮纪元", time: "双月重合之夜" });
  });

  it("旧存档优先回退创世卡的纪元名与最近编年史时间", () => {
    expect(resolveTemporalState({
      realityState: null,
      observerState: null,
      epochName: "第三次退潮时代",
      latestChronicleTime: "潮历九十一年",
    })).toEqual({ era: "第三次退潮时代", time: "潮历九十一年" });
  });
});
```

```ts
// src/lib/chat/continuous-state.integration.test.ts
it("拒绝修改其他现实的实体且不产生任何写入", async () => {
  await expect(applyContinuousState(prisma, {
    timelineId: activeTimeline.id,
    mode: "creator",
    temporalPatch: undefined,
    changes: [{ kind: "set_scene_presence", entityId: foreignEntity.id, present: true }],
  })).rejects.toThrow("轻变化目标不属于当前现实");
  expect((await prisma.entity.findUniqueOrThrow({ where: { id: foreignEntity.id } })).scenePresence).toBe(false);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm test -- src/lib/chat/continuous-state.test.ts
pnpm test:integration -- src/lib/chat/continuous-state.integration.test.ts
```

Expected: FAIL，提示导出不存在。

- [ ] **Step 3: 实现时间状态和轻变化白名单**

`continuous-state.ts` 导出：

```ts
export type TemporalState = { era: string; time: string };

export function mergeTemporalState(
  current: TemporalState,
  patch?: { era?: string; time?: string },
): TemporalState {
  return {
    era: patch?.era?.trim() || current.era,
    time: patch?.time?.trim() || current.time,
  };
}
```

`resolveTemporalState()` 的优先级固定为：

1. `RealityState.currentEra` 与 `ObserverState.timeLabel`；
2. 若两者相同且 draft 中存在 `epochConflict.epochName`，纪元使用 epoch name，避免旧版把 yearLabel 同时写进两个字段；
3. `draftDeck.epochConflict.epochName/yearLabel`；
4. `theme.eraSystem` 与最新公开编年史 `yearLabel`；
5. 最终回退“未名纪元”“此刻”。

`applyContinuousState()` 必须在同一事务中：

- 读取并再次校验活动 timeline；
- 把 temporal patch 写回 `timeline.realityState.currentEra` 与 `timeline.observerState.timeLabel`；
- `set_observer_focus` 的非空 ID 必须属于当前 timeline 且类型匹配；
- `set_active_avatar` 只接受当前 timeline 的 `isCreatorAvatar=true` 实体；
- `set_scene_presence` 只更新当前 timeline 实体；
- `set_entity_section` 只更新已存在、未 `playerLocked`、且 key 与实体类型模板相容的栏目；
- 任一非法项使整个事务失败，不进行部分写入。

在 `initialRealityState()` 中做唯一的小改动：

```ts
currentEra: deck.epochConflict.epochName,
```

`initialObserverState().timeLabel` 继续使用 `yearLabel`。

- [ ] **Step 4: 运行单元与集成测试**

Run:

```bash
pnpm test -- src/lib/chat/continuous-state.test.ts src/lib/reality/schemas.test.ts
pnpm test:integration -- src/lib/chat/continuous-state.integration.test.ts
```

Expected: PASS。

- [ ] **Step 5: 仅暂存本任务行并提交**

先运行：

```bash
git diff -- src/lib/reality/schemas.ts src/lib/reality/schemas.test.ts
```

确认 staged 内容没有覆盖用户已有的 discriminated union / provenance 修改后：

```bash
git add src/lib/chat/continuous-state.ts src/lib/chat/continuous-state.test.ts src/lib/chat/continuous-state.integration.test.ts
git add -p src/lib/reality/schemas.ts src/lib/reality/schemas.test.ts
git commit -m "feat: persist continuous world state"
```

---

### Task 3: 建立自动世界整理触发策略与 durable follow-up

**Files:**
- Create: `src/lib/chat/settlement-policy.ts`
- Create: `src/lib/chat/settlement-policy.test.ts`
- Create: `src/lib/chat/follow-up.ts`
- Create: `src/lib/chat/follow-up.test.ts`
- Modify: `src/lib/chat/request.ts`
- Modify: `src/lib/chat/request.test.ts`
- Modify: `src/lib/context/sse.ts`
- Modify: `src/lib/context/sse.test.ts`

- [ ] **Step 1: 写六轮兜底、重大变化和 SSE 重放失败测试**

```ts
// src/lib/chat/settlement-policy.test.ts
import { describe, expect, it } from "vitest";
import { decideSettlement } from "./settlement-policy";

const base = {
  scale: "scene" as const,
  narratorCountAfter: 1,
  temporalChanged: false,
  eraChanged: false,
  significantEvent: false,
  settlementReasons: [] as const,
};

describe("decideSettlement", () => {
  it("第六个 Narrator 回复必定整理", () => {
    expect(decideSettlement({ ...base, narratorCountAfter: 6 }).required).toBe(true);
  });
  it("宽时间尺度只有实际推进后才整理", () => {
    expect(decideSettlement({ ...base, scale: "years", temporalChanged: false }).required).toBe(false);
    expect(decideSettlement({ ...base, scale: "years", temporalChanged: true }).required).toBe(true);
  });
  it("能力或纪元变化不能被模型的 significant=false 绕过", () => {
    expect(decideSettlement({
      ...base,
      settlementReasons: ["ability_change"],
    }).required).toBe(true);
  });
});
```

```ts
// 追加到 src/lib/context/sse.test.ts
it("done 与 durable 重放都带相同 followUp", async () => {
  const completion = {
    messageId: "message-1",
    meta: continuousMeta,
    followUp: { kind: "settlement", segmentId: "segment-1" } as const,
  };
  const response = narratorCompletionSSE({ completion });
  expect(await response.text()).toContain('"kind":"settlement"');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm test -- src/lib/chat/settlement-policy.test.ts src/lib/chat/follow-up.test.ts src/lib/chat/request.test.ts src/lib/context/sse.test.ts
```

Expected: FAIL，旧完成结果没有 `followUp`。

- [ ] **Step 3: 实现确定性策略和完成结果包络**

```ts
// src/lib/chat/follow-up.ts
import type { ContinuousNarratorMeta } from "./continuous-meta";

export type ChatFollowUp =
  | { kind: "none" }
  | { kind: "settlement"; segmentId: string }
  | { kind: "rewrite"; taskId: string };

export type GenerationCompletion = {
  messageId: string | null;
  meta: ContinuousNarratorMeta;
  followUp: ChatFollowUp;
};

export type StoredGenerationResult = GenerationCompletion & {
  version: 1;
};
```

```ts
// src/lib/chat/settlement-policy.ts
import type { Scale } from "@/lib/cards/schemas";
import type { SettlementReason } from "./continuous-meta";

const WIDE_SCALES = new Set<Scale>(["years", "era", "epoch"]);
const HARD_REASONS = new Set<SettlementReason>([
  "ability_change", "important_death", "faction_change", "rank_change",
  "identity_change", "relation_restructure", "era_change", "multi_entity_change",
]);

export function decideSettlement(input: {
  scale: Scale;
  narratorCountAfter: number;
  temporalChanged: boolean;
  eraChanged: boolean;
  significantEvent: boolean;
  settlementReasons: readonly SettlementReason[];
}) {
  const reasons = new Set(input.settlementReasons);
  if (input.narratorCountAfter >= 6) reasons.add("six_reply_checkpoint");
  if (input.eraChanged) reasons.add("era_change");
  if (WIDE_SCALES.has(input.scale) && input.temporalChanged) reasons.add("time_advance");
  const semanticMajor = input.significantEvent && input.settlementReasons.length > 0;
  const hardChange = input.settlementReasons.some((reason) => HARD_REASONS.has(reason));
  return { required: semanticMajor || hardChange || reasons.has("six_reply_checkpoint")
    || reasons.has("time_advance") || reasons.has("era_change"), reasons: [...reasons] };
}
```

`request.ts` 将 `resultMeta` 写成 `StoredGenerationResult`，并兼容读取旧 `{suggestions, chapterBreakHint}` 结果为：

```ts
{ version: 1, messageId: row.narratorMessageId, meta: normalizedMeta, followUp: { kind: "none" } }
```

对于 `followUp.kind === "rewrite"`，完成重放不再要求源现实存在 Narrator 消息；普通和 settlement 完成仍严格核对 Narrator 消息绑定。

`narratorSSE()` 的 `onDone` 返回完整 `GenerationCompletion`，done 事件直接发送：

```ts
send({ type: "done", ...completion });
```

- [ ] **Step 4: 运行聚焦测试**

Run:

```bash
pnpm test -- src/lib/chat/settlement-policy.test.ts src/lib/chat/follow-up.test.ts src/lib/chat/request.test.ts src/lib/context/sse.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交策略和协议**

```bash
git add src/lib/chat/settlement-policy.ts src/lib/chat/settlement-policy.test.ts src/lib/chat/follow-up.ts src/lib/chat/follow-up.test.ts src/lib/chat/request.ts src/lib/chat/request.test.ts src/lib/context/sse.ts src/lib/context/sse.test.ts
git commit -m "feat: add durable world follow ups"
```

---

### Task 4: 普通输入延迟落库并原子应用正文、时间和轻变化

**Files:**
- Modify: `src/lib/chat/request.ts`
- Modify: `src/lib/chat/request.test.ts`
- Modify: `src/lib/chat/finalize.ts`
- Modify: `src/lib/chat/finalize.test.ts`
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/app/api/chat/route.test.ts`

- [ ] **Step 1: 写源消息延迟落库和原子完成失败测试**

```ts
// 追加到 src/lib/chat/request.test.ts
it("say 只保留请求，不在分类完成前写 player message", async () => {
  const prepared = await prepareGenerationRequest(client, sayInput);
  expect(prepared.meta.playerMessageId).toBe(`genplayer:${sayInput.generationId}`);
  expect(tx.message.create).not.toHaveBeenCalled();
});
```

```ts
// 追加到 src/lib/chat/finalize.test.ts
it("普通完成在一个事务中依次写 player、narrator、时间和轻变化", async () => {
  const result = await finalizeContinuousNarration(client, {
    ...input,
    prose: "港口的潮声越过长堤。",
    meta: {
      ...emptyContinuousMeta(),
      temporalState: { time: "双月重合之夜" },
      immediateChanges: [{ kind: "set_scene_presence", entityId: "port-keeper", present: true }],
    },
  });
  expect(result.followUp).toEqual({ kind: "none" });
  expect(createdRoles).toEqual(["player", "narrator"]);
  expect(updateTimeline).toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行测试并确认旧代码过早写玩家消息**

Run:

```bash
pnpm test -- src/lib/chat/request.test.ts src/lib/chat/finalize.test.ts src/app/api/chat/route.test.ts
```

Expected: FAIL，`reserveInTx()` 仍调用 `message.create()`。

- [ ] **Step 3: 实现普通完成的单事务路径**

从 `reserveInTx()` 删除 player message 创建，只保留稳定 ID、index 和 content。

把 `finalizeNarration()` 重命名为 `finalizeContinuousNarration()`；普通 `operation === "continue"` 时：

1. 校验 world 仍指向 expected timeline；
2. 校验 generation lease；
3. 若 `mode === "say"`，以 `requestMeta.playerMessageId/playerIndex` 幂等创建玩家消息；
4. 创建 Narrator 消息；
5. 调用 Task 2 的事务内轻变化应用函数；
6. 统计当前内部段完成后的 Narrator 数；
7. 调用 `decideSettlement()`；
8. 在 Narrator `meta` 中持久化 `settlementRequired` 与服务端 reasons；
9. 将完整 `StoredGenerationResult` 写入 GenerationRequest；
10. 返回 `{ messageId, meta, followUp }`。

在 `route.ts` 的 builder 调用中不再用“刚落库的玩家消息”假设：

```ts
messages = await buildNarratorContext({
  worldId,
  chapterId,
  playerInput: mode === "say" ? content!.trim() : undefined,
  scale,
  mode,
  directive,
});
```

`onDone` 返回 finalizer 的完整 completion；其 `finally` 仍先按 token 释放 chat operation，随后 SSE 才发 done，因此前端可立即领取 settlement lease。

- [ ] **Step 4: 运行聚焦测试**

Run:

```bash
pnpm test -- src/lib/chat/request.test.ts src/lib/chat/finalize.test.ts src/app/api/chat/route.test.ts
```

Expected: PASS，且冻结现实、幂等 replay、lease 续期原测试继续通过。

- [ ] **Step 5: 提交普通完成链路**

```bash
git add src/lib/chat/request.ts src/lib/chat/request.test.ts src/lib/chat/finalize.ts src/lib/chat/finalize.test.ts src/app/api/chat/route.ts src/app/api/chat/route.test.ts
git commit -m "feat: finalize continuous turns atomically"
```

---

### Task 5: 自动追溯改写不污染源现实

**Files:**
- Create: `src/lib/reality/create-task.ts`
- Create: `src/lib/reality/create-task.integration.test.ts`
- Modify: `src/lib/reality/task-runner.ts`
- Modify: `src/lib/reality/task-runner.integration.test.ts`
- Modify: `src/lib/chat/finalize.ts`
- Modify: `src/lib/chat/finalize.test.ts`
- Modify: `src/app/api/worlds/[id]/rewrites/route.ts`
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/app/api/chat/route.test.ts`

- [ ] **Step 1: 写自动追溯的源现实不变集成测试**

```ts
// src/lib/reality/create-task.integration.test.ts
it("chat 追溯判定只创建固定 retroactive task，不写源现实消息", async () => {
  const before = await prisma.message.count({ where: { chapterId: sourceChapter.id } });
  const completion = await finalizeContinuousNarration(prisma, {
    ...input,
    prose: "这段临时正文不得落入源现实。",
    meta: { ...emptyContinuousMeta(), operation: "retroactive_rewrite" },
  });
  expect(completion.messageId).toBeNull();
  expect(completion.followUp.kind).toBe("rewrite");
  expect(await prisma.message.count({ where: { chapterId: sourceChapter.id } })).toBe(before);
  const task = await prisma.realityRewrite.findUniqueOrThrow({
    where: { idempotencyKey: `chat:${input.generationId}` },
  });
  expect(task.scope).toBe("retroactive");
  expect(task.decree).toBe(input.requestMeta.content);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm test:integration -- src/lib/reality/create-task.integration.test.ts src/lib/reality/task-runner.integration.test.ts
pnpm test -- src/lib/chat/finalize.test.ts src/app/api/chat/route.test.ts
```

Expected: FAIL，finalizer 只会创建普通 Narrator 消息。

- [ ] **Step 3: 抽取事务内任务创建并接入 chat 完成**

`create-task.ts` 提供：

```ts
export async function createRealityRewriteInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    worldId: string;
    sourceTimelineId: string;
    sourceChapterId: string;
    decree: string;
    scope: "retroactive";
    idempotencyKey: string;
  },
) {
  const existing = await tx.realityRewrite.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    if (existing.worldId !== input.worldId || existing.decree !== input.decree
      || existing.scope !== input.scope) throw new RealityRewriteConflictError("幂等键已用于另一项现实改写");
    return existing;
  }
  return tx.realityRewrite.create({ data: { ...input, status: "planning" } });
}
```

现有 `createRealityRewrite()` 继续负责用户所有权与 mode 检查，然后复用此 helper，保持旧 API 测试不变。

`finalizeContinuousNarration()` 在 `operation === "retroactive_rewrite"` 时：

- 仅允许 `world.mode === "creator"`；Pantheon 强制降级为 `continue`；
- 不写 player message、不写 provisional Narrator prose、不应用轻变化；
- 用原始 `GenerationRequest.content` 创建 scope 固定为 `retroactive` 的 task；
- `idempotencyKey` 固定为 `chat:${generationId}`；
- 完成 GenerationRequest，写 `{messageId:null, followUp:{kind:"rewrite",taskId}}`。

route 在 finalizer 返回 rewrite follow-up 后、释放 chat lease后调用：

```ts
if (completion.followUp.kind === "rewrite") {
  ensureRealityRewriteRunning(completion.followUp.taskId);
}
```

RealityRewrite runner 完成时继续只在克隆后的活动现实写 `reality_rewrite_result` Narrator 消息；把新内部段 title 从“现实重铸”改为 null。

- [ ] **Step 4: 运行自动追溯测试**

Run:

```bash
pnpm test -- src/lib/chat/finalize.test.ts src/app/api/chat/route.test.ts src/app/api/worlds/[id]/rewrites/route.test.ts
pnpm test:integration -- src/lib/reality/create-task.integration.test.ts src/lib/reality/task-runner.integration.test.ts
```

Expected: PASS；推进未来的 `operation=continue` 不创建 RealityRewrite。

- [ ] **Step 5: 提交自动追溯路径**

```bash
git add src/lib/reality/create-task.ts src/lib/reality/create-task.integration.test.ts src/lib/reality/task-runner.ts src/lib/reality/task-runner.integration.test.ts src/lib/chat/finalize.ts src/lib/chat/finalize.test.ts src/app/api/worlds/[id]/rewrites/route.ts src/app/api/chat/route.ts src/app/api/chat/route.test.ts
git commit -m "feat: route retroactive intent into reality forks"
```

---

### Task 6: 将章末结算改为自动、可恢复的内部世界整理

**Files:**
- Create: `src/components/play/world-settlement-state.ts`
- Create: `src/components/play/world-settlement-state.test.ts`
- Modify: `src/lib/prompts/settlement.ts`
- Modify: `src/lib/prompts/settlement.test.ts`
- Modify: `src/lib/settle/pipeline.ts`
- Modify: `src/lib/settle/pipeline.integration.test.ts`
- Modify: `src/app/api/chapters/[id]/settle/route.ts`
- Modify: `src/app/api/chapters/[id]/settle/route.test.ts`
- Modify: `src/lib/reality/operation-lock.ts`
- Modify: `src/lib/reality/operation-lock.test.ts`

- [ ] **Step 1: 写无章节文案、恢复和 SSE 客户端失败测试**

```ts
// 追加到 src/lib/prompts/settlement.test.ts
it("世界整理提示词不要求章节标题或下章钩子", () => {
  const prompt = settlementSystem("creator");
  expect(prompt).not.toMatch(/chapter title|end-of-chapter|下章|章节/);
  expect(prompt).toContain("checkpoint window");
});
```

```ts
// src/components/play/world-settlement-state.test.ts
it("解析失败后保留可重试 segmentId", async () => {
  const result = await followWorldSettlement("segment-1", fakeSse([
    { type: "progress", step: "extract" },
    { type: "error", message: "抽取中断" },
  ]));
  expect(result).toEqual({ status: "failed", segmentId: "segment-1", error: "抽取中断" });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm test -- src/lib/prompts/settlement.test.ts src/components/play/world-settlement-state.test.ts src/app/api/chapters/[id]/settle/route.test.ts src/lib/reality/operation-lock.test.ts
```

Expected: FAIL，旧文案仍是章节结算且客户端 helper 不存在。

- [ ] **Step 3: 改造内部世界整理**

在 settlement schema 中使用不含 `chapterTitle` 的 chronicle：

```ts
export const CheckpointChronicleSchema = ChronicleSchema.omit({ chapterTitle: true });
```

系统提示改成一次性整理 “labelled checkpoint window”；`proactiveEvent.openingHook` 改成 “后续事件钩子”。pipeline 内部函数可暂保 `chapterId/chapterIndex` 参数名以降低风险，但：

- 玩家输入标签使用 `【创世主意图】`；
- 不生成或写入 `Chapter.title`；
- 新内部段 `title: null`；
- 所有用户可见进度 detail 使用“世界正在演化”“史官正在整理世界”；
- `done` SSE 只返回 `{type:"done", nextSegmentId}`，不返回 title；
- route 错误改为“内部记录段不存在”“此段尚无正文，不可整理”；
- WorldOperation 的 settlement label 改为“世界整理”。

`world-settlement-state.ts` 实现：

```ts
export type WorldSettlementState =
  | { status: "idle" }
  | { status: "running"; segmentId: string }
  | { status: "failed"; segmentId: string; error: string };

export async function followWorldSettlement(
  segmentId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorldSettlementState> {
  // POST /api/chapters/{segmentId}/settle，逐个解析 data: JSON；
  // done 返回 idle；error 返回 failed，绝不删除已生成正文。
}
```

- [ ] **Step 4: 运行单元和结算集成测试**

Run:

```bash
pnpm test -- src/lib/prompts/settlement.test.ts src/components/play/world-settlement-state.test.ts src/app/api/chapters/[id]/settle/route.test.ts src/lib/reality/operation-lock.test.ts
pnpm test:integration -- src/lib/settle/pipeline.integration.test.ts
```

Expected: PASS，断点续跑、lease fence 和幂等抽取原测试仍通过。

- [ ] **Step 5: 提交内部世界整理**

```bash
git add src/components/play/world-settlement-state.ts src/components/play/world-settlement-state.test.ts src/lib/prompts/settlement.ts src/lib/prompts/settlement.test.ts src/lib/settle/pipeline.ts src/lib/settle/pipeline.integration.test.ts src/app/api/chapters/[id]/settle/route.ts src/app/api/chapters/[id]/settle/route.test.ts src/lib/reality/operation-lock.ts src/lib/reality/operation-lock.test.ts
git commit -m "feat: automate recoverable world settlement"
```

---

### Task 7: 扩展 world state 为连续消息、时间标题与恢复状态

**Files:**
- Modify: `src/app/api/worlds/[id]/state/route.ts`
- Modify: `src/app/api/worlds/[id]/state/route.test.ts`
- Modify: `src/components/play/types.ts`

- [ ] **Step 1: 写 state DTO 失败测试**

```ts
// 追加到 src/app/api/worlds/[id]/state/route.test.ts
it("返回跨内部段的连续消息、时间、逐条编辑权限和待整理状态", async () => {
  const response = await GET(request, context);
  const body = await response.json();
  expect(body.temporal).toEqual({ era: "黑潮纪元", time: "双月重合之夜" });
  expect(body.messages.map((message: { content: string }) => message.content))
    .toEqual(["旧史末句", "当前输入", "当前正文"]);
  expect(body.messages.map((message: { editable: boolean }) => message.editable)
    .toEqual([false, true, true]);
  expect(body.checkpoint).toEqual({
    segmentId: "segment-current",
    needsSettlement: true,
    settling: false,
  });
});
```

- [ ] **Step 2: 运行 route 测试并确认失败**

Run:

```bash
pnpm test -- src/app/api/worlds/[id]/state/route.test.ts
```

Expected: FAIL，旧 DTO 只有 currentChapter/prevChapterTail。

- [ ] **Step 3: 实现连续 DTO**

State route 一次读取最近 4 个内部段（每段消息升序），按 `chapter.index` 再按 `message.index` 展平，最多返回最新 80 条。每条追加：

```ts
editable: chapter.id === currentSegment.id && chapter.settleState === "open"
```

响应改为：

```ts
{
  world,
  timeline,
  temporal: { era, time },
  currentSegment: { id, settleState },
  checkpoint: {
    segmentId: currentSegment.id,
    needsSettlement: currentSegment.settleState !== "settled"
      && (latestNarrator.meta?.settlementRequired === true || narratorCount >= 6),
    settling: currentSegment.settleState.startsWith("settling:")
      || world.operationKind === "settlement",
  },
  operation: world.operationKind ? { kind: world.operationKind } : null,
  messages,
  recentRewrite,
}
```

`types.ts` 对应修改：

```ts
export type MessageRow = { /* existing fields */ editable: boolean };
export type PlayState = {
  world: WorldInfo;
  timeline: TimelineInfo;
  temporal: { era: string; time: string };
  currentSegment: { id: string; settleState: string };
  checkpoint: { segmentId: string; needsSettlement: boolean; settling: boolean };
  operation: { kind: "chat" | "settlement" | "rewrite" } | null;
  messages: MessageRow[];
  recentRewrite: RecentRewrite | null;
  gods: GodRow[];
  avatars: CreatorAvatar[];
};
```

旧存档 temporal 使用 Task 2 的 resolver；切换现实后自然读取目标 timeline 自己的 JSON 状态。

- [ ] **Step 4: 运行 route 测试**

Run:

```bash
pnpm test -- src/app/api/worlds/[id]/state/route.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交连续状态 DTO**

```bash
git add src/app/api/worlds/[id]/state/route.ts src/app/api/worlds/[id]/state/route.test.ts src/components/play/types.ts
git commit -m "feat: expose continuous play state"
```

---

### Task 8: 合并两种模式输入区并自动跟进 settlement/rewrite

**Files:**
- Modify: `src/components/play/InputDeck.tsx`
- Create: `src/components/play/InputDeck.test.tsx`
- Delete: `src/components/play/CreatorInputDeck.tsx`
- Modify: `src/components/play/creator-input-state.ts`
- Modify: `src/components/play/creator-input-state.test.ts`
- Modify: `src/components/play/sse-client.ts`
- Create: `src/components/play/sse-client.test.ts`
- Modify: `src/app/play/[worldId]/page.tsx`

- [ ] **Step 1: 写统一控件与 follow-up 解析失败测试**

```tsx
// src/components/play/InputDeck.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InputDeck } from "./InputDeck";

vi.mock("@/components/theme/useTheme", () => ({
  useTheme: () => ({ candle: false, setMode: vi.fn() }),
}));

it.each(["pantheon", "creator"] as const)("%s 只有一个输入框和统一按钮", (mode) => {
  const html = renderToStaticMarkup(<InputDeck
    mode={mode} scale="scene" onScaleChange={vi.fn()} suggestions={[]}
    busyKind="idle" canContinue onSend={vi.fn()} onContinue={vi.fn()} onStop={vi.fn()}
  />);
  expect((html.match(/<textarea/g) ?? [])).toHaveLength(1);
  expect(html).toContain("续写");
  expect(html).toContain("发送");
  expect(html).not.toMatch(/观测世界|改写现实|改写范围|结束本章|续观/);
});
```

```ts
// src/components/play/sse-client.test.ts
it("把 settlement 和 rewrite followUp 原样交给 onDone", async () => {
  const onDone = vi.fn();
  await streamNarration("/api/chat", {}, handlers({ onDone }), undefined, fakeFetch([
    { type: "done", messageId: null, meta: {}, followUp: { kind: "rewrite", taskId: "rw-1" } },
  ]));
  expect(onDone).toHaveBeenCalledWith(null, {}, { kind: "rewrite", taskId: "rw-1" });
});
```

- [ ] **Step 2: 运行组件与 SSE 测试并确认失败**

Run:

```bash
pnpm test -- src/components/play/InputDeck.test.tsx src/components/play/sse-client.test.ts src/components/play/creator-input-state.test.ts
```

Expected: FAIL，InputDeck 仍有 chapter props，CreatorInputDeck 仍是双通道。

- [ ] **Step 3: 实现统一 InputDeck 与页面编排**

`InputDeck` props 改为：

```ts
type BusyKind = "idle" | "narrating" | "settling" | "rewriting";
type InputDeckProps = {
  mode: "pantheon" | "creator";
  scale: Scale;
  onScaleChange(scale: Scale): void;
  suggestions: string[];
  busyKind: BusyKind;
  canContinue: boolean;
  settlementError?: string | null;
  onSend(content: string): void;
  onContinue(): void;
  onStop(): void;
  onRetrySettlement?(): void;
};
```

两种模式始终渲染同一个时之仪、textarea、“续写”和“发送”。`narrating` 时发送按钮变“■ 搁笔”；`settling`/`rewriting` 时所有输入禁用并显示“世界正在演化…”；结算失败显示“世界整理中断”和“继续整理世界”。删除 `chapterBreakHint`、`onSettle` 及相应按钮。

`creator-input-state.ts` 删除 `CreatorChannel`、`scope`、`submitCreatorInput()`，只保留并重命名共用的：

- `followRealityRewriteEvents()`
- `enrichRewriteResultMessages()`
- rewrite DTO 与进度类型。

`sse-client.ts` 的 done 契约改为：

```ts
onDone(messageId: string | null, meta: MessageMeta, followUp: ChatFollowUp): void;
```

`PlayPage` 收到：

- `none`：重载 world state；
- `settlement`：立即进入 settling，调用 `followWorldSettlement(segmentId)`，完成后重载 state 和实体索引；
- `rewrite`：清掉 provisional streaming prose，调用 `followRealityRewriteEvents(taskId)`，完成后重载活动现实和实体索引；
- 初次 state 的 `checkpoint.needsSettlement || checkpoint.settling`：自动恢复同一 segment 的世界整理；
- 世界整理失败：保持正文和 `segmentId`，只允许“继续整理世界”；
- settlement/rewrite 期间不接受、也不缓存下一条输入。

- [ ] **Step 4: 运行 UI 编排测试**

Run:

```bash
pnpm test -- src/components/play/InputDeck.test.tsx src/components/play/sse-client.test.ts src/components/play/creator-input-state.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交统一输入**

```bash
git add src/components/play/InputDeck.tsx src/components/play/InputDeck.test.tsx src/components/play/creator-input-state.ts src/components/play/creator-input-state.test.ts src/components/play/sse-client.ts src/components/play/sse-client.test.ts src/app/play/[worldId]/page.tsx
git rm src/components/play/CreatorInputDeck.tsx
git commit -m "feat: unify continuous world input"
```

---

### Task 9: 改为连续正文、时间标题和轻量现实分叉提示

**Files:**
- Modify: `src/components/play/StoryStream.tsx`
- Create: `src/components/play/StoryStream.test.tsx`
- Modify: `src/components/play/MessageBlock.tsx`
- Create: `src/components/play/MessageBlock.test.tsx`
- Modify: `src/app/play/[worldId]/page.tsx`

- [ ] **Step 1: 写无章头、标题和分叉提示失败测试**

```tsx
// src/components/play/StoryStream.test.tsx
it("连续正文不渲染章号、章题或前章残页", () => {
  const html = renderToStaticMarkup(<StoryStream
    messages={messages} streamingText={null} rerollingId={null}
    rerollingText="" busy={false} error={null} onRetry={vi.fn()}
    onEdit={vi.fn()} onCut={vi.fn()} onReroll={vi.fn()} onSwitchVariant={vi.fn()}
  />);
  expect(html).not.toMatch(/第.+章|前章残页/);
  expect(html).toContain("旧史末句");
  expect(html).toContain("当前正文");
});
```

```tsx
// src/components/play/MessageBlock.test.tsx
it("追溯结果只显示可打开现实树的轻提示", () => {
  const html = renderToStaticMarkup(<MessageBlock message={rewriteMessage} />);
  expect(html).toContain("⌘ 现实已分叉");
  expect(html).not.toMatch(/天外敕令|溯改既往|敕令释义|返回前现实/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm test -- src/components/play/StoryStream.test.tsx src/components/play/MessageBlock.test.tsx
```

Expected: FAIL，旧组件仍渲染章节头和大红敕令卡。

- [ ] **Step 3: 实现连续正文呈现**

`StoryStream` 删除 `chapterIndex/chapterTitle/prevTail` props、中文章号 helper 和章头，仅按 state DTO 顺序渲染消息。对 `message.editable === false` 传 `readonly`，但不要整体降低历史正文 opacity；在操作区域附近以小字显示“已成史”。

`MessageBlock` 的 rewrite result 与普通 Narrator 正文同排版，正文后追加：

```tsx
<button
  type="button"
  className="mt-2 text-xs text-gilt/75 hover:text-gilt"
  onClick={() => window.dispatchEvent(new CustomEvent("creator:open-realities"))}
>
  ⌘ 现实已分叉
</button>
```

PlayPage 监听 `creator:open-realities` 并打开 `drawerTab="realities"`，不再提供正文内“返回前现实”捷径；返回和切换仍在现实树完成。

顶部标题使用：

```tsx
{state.world.name} · {state.temporal.era} · {state.temporal.time}
```

- [ ] **Step 4: 运行呈现测试**

Run:

```bash
pnpm test -- src/components/play/StoryStream.test.tsx src/components/play/MessageBlock.test.tsx
```

Expected: PASS。

- [ ] **Step 5: 提交连续正文 UI**

```bash
git add src/components/play/StoryStream.tsx src/components/play/StoryStream.test.tsx src/components/play/MessageBlock.tsx src/components/play/MessageBlock.test.tsx src/app/play/[worldId]/page.tsx
git commit -m "feat: render a chapterless story stream"
```

---

### Task 10: 在服务端强制检查点编辑边界

**Files:**
- Modify: `src/app/api/messages/[id]/route.ts`
- Create: `src/app/api/messages/[id]/route.test.ts`
- Modify: `src/app/api/messages/[id]/variants/route.ts`
- Modify: `src/app/api/messages/[id]/variants/route.test.ts`

- [ ] **Step 1: 写 settled 消息不可改、open 消息可改失败测试**

```ts
// src/app/api/messages/[id]/route.test.ts
it.each(["PATCH", "DELETE"] as const)("%s 拒绝修改已成史消息", async (method) => {
  mocks.message.findUnique.mockResolvedValue({
    id: "old-message",
    chapterId: "settled-segment",
    chapter: { settleState: "settled", timeline: { world: { activeTimelineId: "timeline-1" }, id: "timeline-1" } },
  });
  const response = await call(method);
  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toEqual({ error: "此段已成史，不可直接修改" });
  expect(mocks.message.update).not.toHaveBeenCalled();
  expect(mocks.message.deleteMany).not.toHaveBeenCalled();
});
```

```ts
// 追加到 variants route.test.ts
it("settling 段禁止另掷和切换异文", async () => {
  mocks.message.findUnique.mockResolvedValue(messageIn("settling:extract"));
  expect((await POST(request, context)).status).toBe(409);
  expect((await PATCH(request, context)).status).toBe(409);
});
```

- [ ] **Step 2: 运行路由测试并确认 PATCH/DELETE 仍可修改 settled 消息**

Run:

```bash
pnpm test -- src/app/api/messages/[id]/route.test.ts src/app/api/messages/[id]/variants/route.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 添加统一服务端 guard**

在两个 route 文件中复用同一判定（可放在 `src/lib/chat/message-edit-policy.ts`，若新增则同时新增对应单测）：

```ts
export function assertMessageEditable(input: {
  settleState: string;
  timelineId: string;
  activeTimelineId: string | null;
}) {
  if (input.timelineId !== input.activeTimelineId) throw new FrozenRealityError();
  if (input.settleState !== "open") throw new MessageCheckpointError("此段已成史，不可直接修改");
}
```

消息查询必须 include `chapter.timeline.world.activeTimelineId`。PATCH、DELETE、variant POST/PATCH 在任何写入前执行 guard。前端 `editable` 只决定展示，不能替代此检查。

- [ ] **Step 4: 运行编辑边界测试**

Run:

```bash
pnpm test -- src/app/api/messages/[id]/route.test.ts src/app/api/messages/[id]/variants/route.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交编辑边界**

```bash
git add src/app/api/messages/[id]/route.ts src/app/api/messages/[id]/route.test.ts src/app/api/messages/[id]/variants/route.ts src/app/api/messages/[id]/variants/route.test.ts src/lib/chat/message-edit-policy.ts src/lib/chat/message-edit-policy.test.ts
git commit -m "fix: enforce checkpoint message history"
```

---

### Task 11: 创世演出期间生成 opening，并支持单独重试

**Files:**
- Create: `src/components/genesis/embark-flow.ts`
- Create: `src/components/genesis/embark-flow.test.ts`
- Modify: `src/components/genesis/GenesisCeremony.tsx`
- Modify: `src/components/genesis/GenesisCeremony.test.ts`
- Modify: `src/app/genesis/[worldId]/page.tsx`
- Modify: `src/app/api/worlds/[id]/embark/route.ts`
- Modify: `src/app/api/worlds/[id]/embark/route.test.ts`
- Modify: `src/app/play/[worldId]/page.tsx`

- [ ] **Step 1: 写两种时序、opening 单独重试和跳过失败测试**

```ts
// src/components/genesis/embark-flow.test.ts
it("物化完成后立即生成 opening，不等待动画", async () => {
  const calls: string[] = [];
  const flow = createEmbarkFlow({
    materialize: async () => { calls.push("embark"); return { chapterId: "segment-1" }; },
    generateOpening: async () => { calls.push("opening"); },
  });
  await flow.start();
  expect(calls).toEqual(["embark", "opening"]);
});

it("opening 失败后重试不再次物化", async () => {
  const materialize = vi.fn().mockResolvedValue({ chapterId: "segment-1" });
  const generateOpening = vi.fn()
    .mockRejectedValueOnce(new Error("开篇未成"))
    .mockResolvedValueOnce(undefined);
  const flow = createEmbarkFlow({ materialize, generateOpening });
  await flow.start();
  await flow.retryOpening();
  expect(materialize).toHaveBeenCalledTimes(1);
  expect(generateOpening).toHaveBeenCalledTimes(2);
});
```

```ts
// 追加到 GenesisCeremony.test.ts
it("末幕使用世界名、纪元、时间和自此有史，不出现第一章", () => {
  const title = ceremonyTitle(completeDeck());
  expect(title).toEqual({
    world: completeDeck().worldName,
    era: completeDeck().epochConflict.epochName,
    time: completeDeck().epochConflict.yearLabel,
    seal: "自此有史",
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm test -- src/components/genesis/embark-flow.test.ts src/components/genesis/GenesisCeremony.test.ts src/app/api/worlds/[id]/embark/route.test.ts
```

Expected: FAIL，flow/title helper 不存在。

- [ ] **Step 3: 实现物化与开篇编排**

Embark route 响应增加：

```ts
{
  timelineId,
  chapterId,
  temporal: { era: deck.epochConflict.epochName, time: deck.epochConflict.yearLabel },
}
```

`embark-flow.ts` 固定使用：

```ts
export const openingGenerationId = (worldId: string) => `opening:${worldId}`;
```

Genesis page 点击“创世”后立即开始视觉演出，同时：

1. POST embark；
2. 得到 `chapterId` 后立即 POST `/api/chat`，`mode:"opening"`、`scale:"scene"`、稳定 generation ID；
3. opening done 才把 ceremony 数据态设为 done；
4. opening 失败保存 `chapterId` 并显示“开篇未成 / 重试开篇”；
5. 重试只再次调用 `/api/chat`；
6. 动画 `onFinished` 只有在 data phase done 时导航。

`GenesisCeremony` 的末幕改为三行：

```tsx
<h1>{deck.worldName}</h1>
<p>{deck.epochConflict.epochName} · {deck.epochConflict.yearLabel}</p>
<p>自此有史</p>
```

跳过按钮只将 animation 标为 done，data phase 仍 pending 时继续显示“世界正在落笔成形…”。

PlayPage 删除普通“空段即 opening”的 effect；仅当 state 返回整个活动现实 `messages.length===0` 时，使用同一个 `opening:${worldId}` 做异常恢复，保证存档直入和刷新可续跑。

- [ ] **Step 4: 运行开场相关测试**

Run:

```bash
pnpm test -- src/components/genesis/embark-flow.test.ts src/components/genesis/GenesisCeremony.test.ts src/app/api/worlds/[id]/embark/route.test.ts src/app/api/chat/route.test.ts
```

Expected: PASS；opening 重放测试证明不会产生第二条开场。

- [ ] **Step 5: 提交开场并行流程**

```bash
git add src/components/genesis/embark-flow.ts src/components/genesis/embark-flow.test.ts src/components/genesis/GenesisCeremony.tsx src/components/genesis/GenesisCeremony.test.ts src/app/genesis/[worldId]/page.tsx src/app/api/worlds/[id]/embark/route.ts src/app/api/worlds/[id]/embark/route.test.ts src/app/play/[worldId]/page.tsx
git commit -m "feat: generate opening during genesis ceremony"
```

---

### Task 12: 兼容性回归、文案清扫与最终验证

**Files:**
- Modify: `docs/01-产品与交互.md`
- Modify: `docs/02-游戏系统设计.md`
- Modify: `docs/04-LLM编排与提示词.md`
- Modify: `docs/05-视觉与前端规格.md`
- Modify: `docs/06-开发路线图.md`
- Modify only when a failing assertion proves it necessary: affected tests under `src/`

- [ ] **Step 1: 搜索玩家可见旧章节与双通道文案**

Run:

```bash
rg -n "结束本章|第一章|前章残页|翻章|续观|观测世界|改写现实|改写范围|章节结算|岁月流转" src docs
```

Expected: `src/` 中只允许数据库兼容注释、内部类型名和历史测试说明；任何可渲染字符串或 Prompt 命中都必须删除。`docs/superpowers/specs/` 中的设计对比文本允许保留。

- [ ] **Step 2: 更新产品、系统、LLM、视觉和路线文档**

文档必须明确写入以下最终契约：

```md
- Chapter 仅是内部检查点窗口，玩家永远看不到章节号或章题。
- 两种世界模式共享时之仪、单输入框、续写、发送与搁笔。
- 明确时间文字仅覆盖本轮时之仪，不改变表盘。
- 只有推翻既成历史才自动分叉现实。
- 每轮应用安全轻变化；重大变化或六个 Narrator 回复触发自动世界整理。
- 创世演出与 opening 生成并行；跳过视觉仍等待 opening。
- 顶部标题固定为“世界名 · 当前纪元 · 当前时间”。
```

- [ ] **Step 3: 运行完整单元测试**

Run:

```bash
pnpm test
```

Expected: 全部 PASS。

- [ ] **Step 4: 运行集成测试、lint 和生产构建**

Run:

```bash
pnpm test:integration
pnpm lint
pnpm build
```

Expected: 全部退出码 0；Next.js build 不出现 Route Handler 或客户端边界错误。

- [ ] **Step 5: 做变更完整性与用户修改保护检查**

Run:

```bash
git diff --check
git status --short
git diff -- src/lib/prompts/rewrite.ts src/lib/prompts/rewrite.test.ts src/lib/reality/apply.ts src/lib/reality/apply.integration.test.ts src/lib/reality/schemas.ts src/lib/reality/schemas.test.ts
```

Expected:

- `git diff --check` 无输出；
- 不存在意外 migration；
- rewrite/apply 的用户原有修改仍在；
- schemas 只叠加了本计划明确的 `currentEra: epochName` 变化；
- 删除的只有 `CreatorInputDeck.tsx`，`SettleCeremony.tsx` 若已无引用可在本步骤连同专属测试删除，否则保留但不得渲染。

- [ ] **Step 6: 提交文档与最终清扫**

```bash
git add docs/01-产品与交互.md docs/02-游戏系统设计.md docs/04-LLM编排与提示词.md docs/05-视觉与前端规格.md docs/06-开发路线图.md
git add src
git commit -m "docs: align continuous world flow"
```

---

## 验收映射

- 无玩家可见章节：Tasks 6、7、9、12。
- 单输入且创世主不选通道：Tasks 1、8。
- 时之仪默认、文字本轮优先：Task 1；表盘不被服务端 patch 修改由 Task 8 保持。
- 低风险变化即时落库：Tasks 2、4。
- 重大事件与六轮兜底自动整理：Tasks 3、4、6、8。
- 整理中锁输入、失败可续跑：Tasks 6、7、8。
- 追溯才分叉且源现实不污染：Task 5。
- 开场与演出并行、opening 幂等重试：Task 11。
- 世界名、纪元、时间标题：Tasks 2、7、9。
- 最近检查点后可编辑、此前只读：Tasks 7、9、10。
- 旧存档、现实树和导入格式兼容：Tasks 2、5、7、12。

## 计划自检结果

- 设计文档第 1–13 节均映射到至少一个任务。
- 未引入数据库 migration；沿用 `Timeline.realityState.currentEra`、`Timeline.observerState.timeLabel` 和 `Chapter.settleState`。
- `ChatFollowUp`、`GenerationCompletion`、`ContinuousNarratorMeta` 在首次使用前均有定义。
- 自动追溯在分类完成前不写 player message，源现实不残留 decree 或 provisional prose。
- settlement 与 rewrite 都通过现有 world operation lease 串行执行。
- 计划没有省略具体测试命令、预期失败、最小实现和提交边界。
