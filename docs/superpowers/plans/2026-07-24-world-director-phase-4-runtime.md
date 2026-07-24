# World Director Phase 4: Durable Runtime, Narration, and Atomic Commit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Agent 规划、正文契约、段落暂显、证据审计和权威世界写入连成可恢复的持久 Run，同时提供不影响正式游戏的 shadow mode。

**Architecture:** Controller 只创建或读取 Run；Worker 领取租约后驱动状态机。规划完成后冻结 `DraftChangeSet`，生成 `NarrationContract`，正文帧先写 Run 再通过 SSE 暂显。最终提交在一个 Prisma 事务中验证 revision、写正文、应用 ChangeSet、更新投影并完成 Run。

**Tech Stack:** Next.js 16.2.10 Route Handlers、Prisma 7、Zod 4、SSE、Vitest 4

---

## 文件结构

```text
src/lib/world-director/narration/contract.ts
src/lib/world-director/narration/contract.test.ts
src/lib/world-director/narration/stream.ts
src/lib/world-director/narration/stream.test.ts
src/lib/world-director/narration/evidence.ts
src/lib/world-director/narration/evidence.test.ts
src/lib/world-director/kernel/apply.ts
src/lib/world-director/kernel/apply.integration.test.ts
src/lib/world-director/kernel/commit.ts
src/lib/world-director/kernel/commit.integration.test.ts
src/lib/world-director/runtime/controller.ts
src/lib/world-director/runtime/controller.integration.test.ts
src/lib/world-director/runtime/worker.ts
src/lib/world-director/runtime/worker.test.ts
src/lib/world-director/runtime/pump.ts
src/lib/world-director/runtime/pump.integration.test.ts
src/lib/world-director/runtime/events.ts
src/lib/world-director/runtime/events.test.ts
src/instrumentation.ts
src/app/api/agent-runs/route.ts
src/app/api/agent-runs/route.test.ts
src/app/api/agent-runs/[runId]/route.ts
src/app/api/agent-runs/[runId]/stream/route.ts
src/app/api/agent-runs/[runId]/cancel/route.ts
src/app/api/agent-runs/[runId]/retry/route.ts
```

执行本计划前再次阅读：

```text
node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
```

---

### Task 1: 生成 NarrationContract 和系统标题

**Files:**
- Create: `src/lib/world-director/narration/contract.ts`
- Create: `src/lib/world-director/narration/contract.test.ts`

- [ ] **Step 1: 写标题和 required claims 测试**

```ts
import { expect, it } from "vitest";
import { buildNarrationContract } from "./contract";

it("标题严格使用世界名、纪元和时间", () => {
  const contract = buildNarrationContract({
    worldName: "六面世界",
    temporal: { era: "时空崩毁之纪元", time: "两百年重置中" },
    changeSet,
    observer,
    allowedReveals: [],
    continuityFacts: [],
    styleProfile,
  });
  expect(contract.worldTitle).toBe("六面世界 · 时空崩毁之纪元 · 两百年重置中");
  expect(contract.requiredClaims.map((claim) => claim.id))
    .toContain("claim_ability_rudi_960");
  expect(contract.worldTitle).not.toMatch(/章|Chapter/);
});
```

- [ ] **Step 2: 实现契约**

```ts
export const NarrationContractSchema = z.object({
  worldTitle: z.string().min(1),
  temporalState: TemporalStateSchema,
  viewpoint: ObserverViewSchema,
  requiredClaims: z.array(ClaimSchema).max(64),
  allowedReveals: z.array(FactRefSchema).max(128),
  forbiddenAssertions: z.array(ConstraintSchema).max(128),
  continuityFacts: z.array(FactRefSchema).max(128),
  styleProfile: StyleProfileSchema,
}).strict();
```

每个重大 mutation 映射一个 required claim；普通 activity 可以按重要性不生成 claim。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test -- src/lib/world-director/narration/contract.test.ts
git add src/lib/world-director/narration/contract.ts src/lib/world-director/narration/contract.test.ts
git commit -m "feat: build narration contracts"
```

Expected: PASS。

---

### Task 2: 实现段落帧解析、暂存和协议隔离

**Files:**
- Create: `src/lib/world-director/narration/stream.ts`
- Create: `src/lib/world-director/narration/stream.test.ts`

- [ ] **Step 1: 写帧顺序和泄漏测试**

```ts
it("只接受连续 sequence", () => {
  const state = appendNarrativeFrame(emptyState, frame({ sequence: 0 }));
  expect(() => appendNarrativeFrame(state, frame({ sequence: 2 })))
    .toThrow("正文帧序号不连续");
});

it.each(["<<<META", "<<<AGENT_FRAME", "\"type\":\"tool_call\""])(
  "拒绝正文协议泄漏 %s",
  (marker) => {
    expect(() => validateNarrativeText(`正文 ${marker}`))
      .toThrow("正文包含内部协议");
  },
);
```

- [ ] **Step 2: 实现正文帧**

```ts
export const NarrativeStreamFrameSchema = z.object({
  sequence: z.number().int().nonnegative(),
  text: z.string().min(1).max(8000),
  supportsClaims: z.array(z.string()).max(32),
  referencedFacts: z.array(z.string()).max(64),
}).strict();

export function appendNarrativeFrame(
  current: readonly NarrativeStreamFrame[],
  raw: unknown,
): NarrativeStreamFrame[];

export function publicFrame(frame: NarrativeStreamFrame): {
  sequence: number;
  text: string;
};
```

`publicFrame()` 不返回 claim 或 fact IDs。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test -- src/lib/world-director/narration/stream.test.ts
git add src/lib/world-director/narration/stream.ts src/lib/world-director/narration/stream.test.ts
git commit -m "feat: gate provisional narrative frames"
```

Expected: PASS。

---

### Task 3: 实现双向证据审计

**Files:**
- Create: `src/lib/world-director/narration/evidence.ts`
- Create: `src/lib/world-director/narration/evidence.test.ts`

- [ ] **Step 1: 写遗漏和猜测测试**

```ts
it("发现 ChangeSet 中能力变化没有正文证据", () => {
  expect(auditEvidence({
    contract,
    frames: [frameWithoutAbility],
    assertedFacts: [],
  }).issues).toContainEqual(expect.objectContaining({
    code: "REQUIRED_CLAIM_MISSING",
    claimId: "claim_ability_rudi_960",
  }));
});

it("角色猜测不会被要求写成死亡 mutation", () => {
  expect(classifyNarrativeAssertion({
    text: "鲁迪怀疑人神已经死亡。",
    epistemicMode: "character_belief",
  }).kind).toBe("belief");
});
```

- [ ] **Step 2: 实现审计报告**

```ts
export type EvidenceIssue =
  | { code: "REQUIRED_CLAIM_MISSING"; claimId: string; repairHint: string }
  | { code: "UNBACKED_WORLD_ASSERTION"; assertionId: string; repairHint: string }
  | { code: "FORBIDDEN_REVEAL"; factId: string; repairHint: string };

export function auditEvidence(input: {
  contract: NarrationContract;
  frames: readonly NarrativeStreamFrame[];
  assertedFacts: readonly NarrativeAssertion[];
}): { ok: boolean; issues: EvidenceIssue[]; evidenceIndex: EvidenceIndex };
```

重大事实分类只接受结构化 assertion；不能仅靠字符串正则推断死亡或能力。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test -- src/lib/world-director/narration/evidence.test.ts
git add src/lib/world-director/narration/evidence.ts src/lib/world-director/narration/evidence.test.ts
git commit -m "feat: audit narration evidence"
```

Expected: PASS。

---

### Task 4: 实现 CanonicalChangeSet 事务应用器

**Files:**
- Create: `src/lib/world-director/kernel/apply.ts`
- Create: `src/lib/world-director/kernel/apply.integration.test.ts`

- [ ] **Step 1: 写人物、神明、能力、关系、时间和事件应用测试**

一个集成测试在单事务应用：

```text
temporal.set
entity.update
ability.create
ability.learn
relation.set
event.record
observer.set
```

断言所有目标属于当前 Timeline，且得到明确 `ApplyResult`。关系测试必须同时覆盖 entity → entity、god → entity 和 entity → god；神明关系端点解析到 `God.codexEntityId`，并由同一 `EntityRelation` 作为权威边。另测一项引用外部 Timeline 时整个事务回滚。

- [ ] **Step 2: 实现事务内接口**

```ts
export type ApplyResult = {
  createdObjectIds: Record<string, string>;
  changedEntityIds: string[];
  changedGodIds: string[];
  changedAbilityIds: string[];
  changedRelationIds: string[];
  changedEventIds: string[];
  temporalChanged: boolean;
  observerChanged: boolean;
};

export async function applyCanonicalChangeSetInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    runId: string;
    timelineId: string;
    changeSet: CanonicalChangeSet;
  },
): Promise<ApplyResult>;
```

每个 mutation handler 单独函数；所有查询带 `timelineId`；同轮 tempId 在 `createdObjectIds` 中解析。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test:integration -- src/lib/world-director/kernel/apply.integration.test.ts
git add src/lib/world-director/kernel/apply.ts src/lib/world-director/kernel/apply.integration.test.ts
git commit -m "feat: apply canonical world changes"
```

Expected: PASS。

---

### Task 5: 实现同步投影应用

**Files:**
- Create: `src/lib/world-director/projections/apply.ts`
- Create: `src/lib/world-director/projections/apply.integration.test.ts`

- [ ] **Step 1: 写同一 runId 投影测试**

提交“鲁迪掌握960新式穿甲弹”后断言：

- Ability 存在且 owner 是鲁迪；
- AbilityEvent 关联 narrator message；
- Entity 最近经历 section 更新；
- 涉及神明的关系边可同时被人物关系图和诸神详情读取，`God.relations` 只作为兼容投影同步；
- WorldActivity 有 actor 名称和 sourceMessageId；
- 本轮变化投影只包含能力变化；
- 所有可扩展表都有同一 `runId` 或 `changeSetId` 来源字段。

- [ ] **Step 2: 必要时扩展来源字段**

如果现有 `AbilityEvent`、`WorldActivity`、`ChronicleEntry` 缺少统一来源，新增 migration：

```prisma
runId       String? @map("run_id")
changeSetId String? @map("change_set_id")
```

旧数据允许 null，新 World Director 提交必须非 null。migration 只能新增 nullable 列和索引，不修改旧记录。

- [ ] **Step 3: 实现投影应用**

```ts
export async function applyProjectionPlanInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    runId: string;
    changeSetId: string;
    timelineId: string;
    sourceMessageId: string;
    temporal: TemporalState;
    plan: readonly ProjectionOperation[];
    applyResult: ApplyResult;
  },
): Promise<ProjectionApplyResult>;
```

本轮变化存于 Run 的 `resultMeta.turnChanges` 或专用投影表；选择其一后所有 API 统一读取，不重复让 LLM 生成。

- [ ] **Step 4: 测试并提交**

```powershell
pnpm test:integration -- src/lib/world-director/projections/apply.integration.test.ts
git add prisma/schema.prisma prisma/migrations/*_world_director_projection_sources/migration.sql src/lib/world-director/projections/apply.ts src/lib/world-director/projections/apply.integration.test.ts
git commit -m "feat: project committed world changes"
```

Expected: PASS。

---

### Task 6: 实现原子 commit 和故障注入

**Files:**
- Create: `src/lib/world-director/kernel/commit.ts`
- Create: `src/lib/world-director/kernel/commit.integration.test.ts`

- [ ] **Step 1: 写每一步故障注入测试**

参数化故障点：

```ts
const failurePoints = [
  "after_player_message",
  "after_narrator_message",
  "after_world_apply",
  "after_projection_apply",
  "after_change_set",
  "before_revision_increment",
] as const;
```

每个 failure point 执行后断言：

```ts
expect(await prisma.message.count({ where: { id: { in: messageIds } } })).toBe(0);
expect(await prisma.worldChangeSet.count({ where: { runId } })).toBe(0);
expect((await prisma.realityRevision.findUniqueOrThrow({
  where: { timelineId },
})).revision).toBe(baseRevision);
expect((await prisma.worldDirectorRun.findUniqueOrThrow({ where: { id: runId } })).status)
  .not.toBe("completed");
```

- [ ] **Step 2: 实现 commit**

```ts
export async function commitDirectorRun(
  client: PrismaClient,
  input: {
    runId: string;
    leaseToken: string;
    compiled: CompiledChangeSet;
    contract: NarrationContract;
    frames: readonly NarrativeStreamFrame[];
    evidence: EvidenceIndex;
    failureInjector?: (point: CommitFailurePoint) => void;
  },
): Promise<DirectorCompletion>;
```

事务顺序严格遵循规格：

1. 锁定/条件更新 Run 到 `committing`；
2. 验证 active Timeline 和 base revision；
3. 创建玩家消息（如有）；
4. 创建 narrator 消息；
5. 应用权威状态；
6. 创建 ChangeSet 和 Inverse；
7. 应用投影；
8. 创建 Claims 和 Checkpoint；
9. `RealityRevision + 1`；
10. 标记 completed。

`storageChapterId` 只作为旧 `Message.chapterId` 的内部容器，不参与状态判断或标题生成。

如果当前 Timeline 没有可用的内部 Message 容器，Controller 在创建 Run 时调用确定性的 `ensureStorageChapter()`：只创建下一个内部 `Chapter` 行并保持 `title/summary` 为空，不触发 settlement，也不把 index 暴露给玩家。去章节化表示产品和运行控制不再依赖章节，而不是在同一版本强行删除所有旧消息外键。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test:integration -- src/lib/world-director/kernel/commit.integration.test.ts
git add src/lib/world-director/kernel/commit.ts src/lib/world-director/kernel/commit.integration.test.ts
git commit -m "feat: atomically commit director runs"
```

Expected: PASS。

---

### Task 7: 实现 Controller、Worker 和 durable events

**Files:**
- Create: `src/lib/world-director/runtime/controller.ts`
- Create: `src/lib/world-director/runtime/controller.integration.test.ts`
- Create: `src/lib/world-director/runtime/worker.ts`
- Create: `src/lib/world-director/runtime/worker.test.ts`
- Create: `src/lib/world-director/runtime/events.ts`
- Create: `src/lib/world-director/runtime/events.test.ts`

- [ ] **Step 1: 写恢复测试**

覆盖：

- Run 已有 conversation/tool results 时 Worker 从下一阶段继续；
- provisional frame 已保存时不重复生成该 frame；
- `committing` 失败后只重试 commit，不调用模型；
- lease 过期后新 Worker 接管；
- shadow mode 运行完整流程但不写 Message、ChangeSet 和 revision。

- [ ] **Step 2: 实现 Controller**

```ts
export async function createDirectorRun(input: CreateDirectorRunInput): Promise<{
  runId: string;
  state: RunState;
  created: boolean;
}>;

export async function cancelDirectorRun(runId: string): Promise<void>;
export async function retryDirectorRun(runId: string): Promise<void>;
```

- [ ] **Step 3: 实现 Worker**

```ts
export async function ensureDirectorRunRunning(runId: string): Promise<void>;
export async function executeDirectorRun(runId: string, leaseToken: string): Promise<void>;
```

`executeDirectorRun()` 按持久化 state 分发；每阶段完成后先持久化再进入下一阶段。使用依赖注入的 Agent、Narrator、Kernel，便于 fake 测试。

Worker 心跳必须同时续租 `WorldDirectorRun` 和 `World.operationKind=director/operationToken=runId` 两层租约。完成、取消或不可重试失败时释放世界级操作锁；发生可重试故障时让租约自然过期，由接管 Worker 重新领取，不能在 Run 尚可恢复时开放旧写路径。

- [ ] **Step 4: 实现事件协议**

```ts
export type DirectorRunEvent =
  | { type: "progress"; runId: string; stage: string; status: string; occurredAt: string }
  | { type: "text"; runId: string; sequence: number; text: string }
  | { type: "reference"; runId: string; title: string; url: string }
  | { type: "completed"; runId: string; messageId: string; postRevision: number }
  | { type: "failed"; runId: string; stage: string; message: string; retryable: boolean };
```

事件可从内存 pub/sub 提速，但数据库 Run 是恢复真相。新订阅者先从数据库重放已有帧，再接实时事件。

- [ ] **Step 5: 测试并提交**

```powershell
pnpm test -- src/lib/world-director/runtime
pnpm test:integration -- src/lib/world-director/runtime
git add src/lib/world-director/runtime
git commit -m "feat: run durable world director workers"
```

Expected: PASS。

---

### Task 8: 添加服务端恢复泵

**Files:**
- Create: `src/lib/world-director/runtime/pump.ts`
- Create: `src/lib/world-director/runtime/pump.integration.test.ts`
- Create: `src/instrumentation.ts`

执行前阅读本项目 Next.js 16 文档：

```text
node_modules/next/dist/docs/01-app/02-guides/instrumentation.md
```

- [ ] **Step 1: 写服务重启恢复测试**

```ts
it("扫描 queued 和租约过期 Run 并重新调度", async () => {
  await seedRun({ id: "queued", status: "queued", leaseExpiresAt: null });
  await seedRun({ id: "expired", status: "planning", leaseExpiresAt: past });
  await seedRun({ id: "live", status: "narrating", leaseExpiresAt: future });
  await pumpDirectorRuns({ ensureRunning });
  expect(ensureRunning.mock.calls.flat()).toEqual(["expired", "queued"]);
});
```

- [ ] **Step 2: 实现一次扫描和本地泵**

```ts
export async function pumpDirectorRuns(deps?: {
  ensureRunning?: (runId: string) => Promise<void>;
}): Promise<number>;

export function startDirectorRunPump(): () => void;
```

`pumpDirectorRuns()` 只选择 `queued` 或 lease 已过期且可重试的非终态 Run，按创建时间排序并限制单批数量。`startDirectorRunPump()` 使用单进程全局符号防止 Fast Refresh 重复启动，周期只负责触发扫描；真正并发安全仍由数据库租约保证。

- [ ] **Step 3: 使用 instrumentation 启动**

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startDirectorRunPump } = await import(
    "@/lib/world-director/runtime/pump"
  );
  startDirectorRunPump();
}
```

若别名在 instrumentation 构建上下文不可用，使用 `./lib/world-director/runtime/pump` 相对导入。泵不是唯一恢复入口：创建 Run、读取活动 Run、retry API 仍调用 `ensureDirectorRunRunning()`，保证 instrumentation 被部署环境限制时也能按访问恢复。

- [ ] **Step 4: 测试并提交**

```powershell
pnpm test:integration -- src/lib/world-director/runtime/pump.integration.test.ts
pnpm build
git add src/lib/world-director/runtime/pump.ts src/lib/world-director/runtime/pump.integration.test.ts src/instrumentation.ts
git commit -m "feat: resume director runs after restart"
```

Expected: PASS。

---

### Task 9: 添加 Agent Run Route Handlers

**Files:**
- Create: `src/app/api/agent-runs/route.ts`
- Create: `src/app/api/agent-runs/route.test.ts`
- Create: `src/app/api/agent-runs/[runId]/route.ts`
- Create: `src/app/api/agent-runs/[runId]/stream/route.ts`
- Create: `src/app/api/agent-runs/[runId]/cancel/route.ts`
- Create: `src/app/api/agent-runs/[runId]/retry/route.ts`

- [ ] **Step 1: 写创建、幂等、查询和取消 Route 测试**

创建 body：

```ts
const CreateRunSchema = z.object({
  worldId: z.string().min(1),
  trigger: RunTriggerSchema,
  content: z.string().max(8000).optional(),
  directive: z.string().max(2000).optional(),
  clientRequestId: z.string().min(8).max(128),
  shadow: z.boolean().default(false),
}).strict();
```

断言重复 `clientRequestId` 返回同一个 `runId`。GET 返回公开 Run 状态，不返回 conversation、toolResults、DraftChangeSet 或 claim IDs。

- [ ] **Step 2: 实现 Route Handlers**

- `POST /api/agent-runs`：创建并 fire-and-forget `ensureDirectorRunRunning`；
- `GET /api/agent-runs/[runId]`：返回公开状态和暂显正文；
- `GET /api/agent-runs/[runId]/stream`：数据库重放 + 实时 SSE；
- `POST /cancel`：执行取消规则；
- `POST /retry`：只重置可重试失败 Run；
- 所有动态 GET 显式使用数据库，因此不要设置静态缓存；
- `maxDuration` 仅用于 SSE 连接，不作为 Worker 生命周期。

- [ ] **Step 3: 运行 Phase 4 总验证**

```powershell
pnpm test -- src/lib/world-director src/app/api/agent-runs
pnpm test:integration -- src/lib/world-director
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Expected: PASS；旧 `/api/chat` 仍未替换。

- [ ] **Step 4: 提交**

```powershell
git add src/app/api/agent-runs
git commit -m "feat: expose durable director run api"
```
