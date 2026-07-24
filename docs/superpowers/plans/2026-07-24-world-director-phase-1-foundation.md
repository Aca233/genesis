# World Director Phase 1: Persistence and State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立不接入正式游戏写路径的 World Director 持久化模型、状态机、预算、幂等创建和执行租约。

**Architecture:** 先以纯 TypeScript/Zod 定义稳定契约，再添加 Prisma 表和 repository。运行状态全部保存到数据库，Worker 只能凭租约推进；模型调用和修正预算由状态机硬限制。旧 `GenerationRequest` 和 `/api/chat` 在本阶段保持原样。

**Tech Stack:** TypeScript 5、Zod 4、Prisma 7/PostgreSQL、Vitest 4

## Global Constraints

- 版本固定为 Next.js `16.2.10`、Prisma `7.8.0`、Zod `4.4.3`、Vitest `4.1.10`。
- 在隔离 worktree 和 `codex/` 分支实施；保护实施前已有改动及 `prisma/migrations/20260724053824/`。
- 源码语义修改只用原生 `apply_patch`；不得用 shell 或临时脚本改源码。
- 单个 Run 最多 `4` 次 LLM 调用、最多 `2` 次修正；状态机必须硬拒绝越界。
- 本阶段只新增基础设施，不改变 `/api/chat`、settlement 或玩家可见行为。
- 新 Run 必须与既有 chat、settlement、rewrite 共用世界级写锁。
- 每项行为先写失败测试，测试真实数据库状态和公开结果，不只验证 mock 调用。
- 每任务独立提交，只包含任务列出的文件。

---

## 文件结构

### 新增

```text
src/lib/world-director/contracts/run.ts
src/lib/world-director/contracts/run.test.ts
src/lib/world-director/runtime/transitions.ts
src/lib/world-director/runtime/transitions.test.ts
src/lib/world-director/runtime/repository.ts
src/lib/world-director/runtime/repository.integration.test.ts
src/lib/world-director/runtime/lease.ts
src/lib/world-director/runtime/lease.integration.test.ts
src/lib/reality/operation-lock.ts
src/lib/reality/operation-lock.test.ts
src/lib/world-director/runtime/progress.ts
src/lib/world-director/runtime/progress.test.ts
src/lib/world-director/schema-integrity.test.ts
prisma/migrations/20260724183000_world_director_foundation/migration.sql
```

### 修改

```text
prisma/schema.prisma
src/lib/tasks/progress.ts
src/lib/tasks/progress.test.ts
```

---

### Task 1: 定义 Run 契约、阶段和硬预算

**Interfaces:**
- Consumes: Zod `z`。
- Produces: `RunTriggerSchema`、`RunStateSchema`、`RunTrigger`、`RunState`、`MAX_MODEL_CALLS = 4`、`MAX_REPAIRS = 2`、`canSpendModelCall(current: number): boolean`、`canSpendRepair(current: number): boolean`。

**Files:**
- Create: `src/lib/world-director/contracts/run.ts`
- Create: `src/lib/world-director/contracts/run.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_MODEL_CALLS,
  MAX_REPAIRS,
  RunTriggerSchema,
  canSpendModelCall,
  canSpendRepair,
} from "./run";

describe("world director run contract", () => {
  it("接受全部正式触发类型", () => {
    expect([...RunTriggerSchema.options]).toEqual([
      "initial_observation",
      "player_action",
      "observation",
      "continue",
      "time_instrument",
      "revision",
      "variant",
    ]);
  });

  it("在第五次模型调用和第三次修正前硬停止", () => {
    expect(MAX_MODEL_CALLS).toBe(4);
    expect(MAX_REPAIRS).toBe(2);
    expect(canSpendModelCall(3)).toBe(true);
    expect(canSpendModelCall(4)).toBe(false);
    expect(canSpendRepair(1)).toBe(true);
    expect(canSpendRepair(2)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行并确认失败**

```powershell
pnpm test -- src/lib/world-director/contracts/run.test.ts
```

Expected: FAIL，提示 `./run` 不存在。

- [ ] **Step 3: 实现最小契约**

```ts
import { z } from "zod";

export const MAX_MODEL_CALLS = 4;
export const MAX_REPAIRS = 2;

export const RunTriggerSchema = z.enum([
  "initial_observation",
  "player_action",
  "observation",
  "continue",
  "time_instrument",
  "revision",
  "variant",
]);

export const RunStateSchema = z.enum([
  "queued",
  "classifying",
  "branching",
  "reading",
  "planning",
  "validating",
  "repairing",
  "narrating",
  "committing",
  "completed",
  "failed",
  "cancelled",
]);

export type RunTrigger = z.infer<typeof RunTriggerSchema>;
export type RunState = z.infer<typeof RunStateSchema>;

export function canSpendModelCall(current: number): boolean {
  return Number.isInteger(current) && current >= 0 && current < MAX_MODEL_CALLS;
}

export function canSpendRepair(current: number): boolean {
  return Number.isInteger(current) && current >= 0 && current < MAX_REPAIRS;
}
```

- [ ] **Step 4: 运行测试**

```powershell
pnpm test -- src/lib/world-director/contracts/run.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/lib/world-director/contracts/run.ts src/lib/world-director/contracts/run.test.ts
git commit -m "feat: define world director run contract"
```

---

### Task 2: 实现不可倒退的状态转换

**Interfaces:**
- Consumes: Task 1 的 `RunState`。
- Produces: `assertRunTransition(from: RunState, to: RunState): void`。

**Files:**
- Create: `src/lib/world-director/runtime/transitions.ts`
- Create: `src/lib/world-director/runtime/transitions.test.ts`

- [ ] **Step 1: 写合法和非法转换测试**

```ts
import { describe, expect, it } from "vitest";
import { assertRunTransition } from "./transitions";

describe("world director transitions", () => {
  it.each([
    ["queued", "classifying"],
    ["classifying", "reading"],
    ["classifying", "branching"],
    ["branching", "reading"],
    ["reading", "planning"],
    ["planning", "reading"],
    ["planning", "validating"],
    ["validating", "repairing"],
    ["repairing", "validating"],
    ["validating", "narrating"],
    ["narrating", "committing"],
    ["committing", "completed"],
  ] as const)("允许 %s → %s", (from, to) => {
    expect(() => assertRunTransition(from, to)).not.toThrow();
  });

  it.each([
    ["queued", "committing"],
    ["narrating", "completed"],
    ["completed", "committing"],
    ["cancelled", "reading"],
  ] as const)("拒绝 %s → %s", (from, to) => {
    expect(() => assertRunTransition(from, to)).toThrow("非法世界导演状态转换");
  });
});
```

- [ ] **Step 2: 运行并确认失败**

```powershell
pnpm test -- src/lib/world-director/runtime/transitions.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现显式邻接表**

```ts
import type { RunState } from "../contracts/run";

const NEXT: Record<RunState, readonly RunState[]> = {
  queued: ["classifying", "cancelled", "failed"],
  classifying: ["reading", "branching", "failed", "cancelled"],
  branching: ["reading", "failed", "cancelled"],
  reading: ["planning", "failed", "cancelled"],
  planning: ["reading", "validating", "failed", "cancelled"],
  validating: ["repairing", "narrating", "failed", "cancelled"],
  repairing: ["validating", "failed", "cancelled"],
  narrating: ["committing", "failed", "cancelled"],
  committing: ["completed", "failed"],
  completed: [],
  failed: ["queued"],
  cancelled: [],
};

export function assertRunTransition(from: RunState, to: RunState): void {
  if (!NEXT[from].includes(to)) {
    throw new Error(`非法世界导演状态转换：${from} → ${to}`);
  }
}
```

- [ ] **Step 4: 运行测试**

```powershell
pnpm test -- src/lib/world-director/runtime/transitions.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/lib/world-director/runtime/transitions.ts src/lib/world-director/runtime/transitions.test.ts
git commit -m "feat: add world director state machine"
```

---

### Task 3: 添加 Prisma 持久化模型和 migration

**Interfaces:**
- Consumes: 现有 `World`、`Timeline`、`Message` 模型；Task 1 的状态和触发字符串。
- Produces: Prisma delegates `worldDirectorRun`、`worldChangeSet`、`worldInverseChangeSet`、`narrativeClaim`、`runCheckpoint`、`turnVariant`、`realityRevision`，以及对应模型类型。

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260724183000_world_director_foundation/migration.sql`
- Create: `src/lib/world-director/schema-integrity.test.ts`

- [ ] **Step 1: 写 schema integrity 失败测试**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");

describe("world director persistence schema", () => {
  it("声明 Run、ChangeSet、Inverse、Claim、Checkpoint、Variant 和 revision", () => {
    for (const model of [
      "WorldDirectorRun",
      "WorldChangeSet",
      "WorldInverseChangeSet",
      "NarrativeClaim",
      "RunCheckpoint",
      "TurnVariant",
      "RealityRevision",
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
  });

  it("对现实 revision 和 Run 幂等键建立唯一约束", () => {
    expect(schema).toMatch(/model RealityRevision[\s\S]*timelineId\s+String\s+@unique/);
    expect(schema).toMatch(/model WorldDirectorRun[\s\S]*idempotencyKey\s+String\s+@unique/);
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

```powershell
pnpm test -- src/lib/world-director/schema-integrity.test.ts
```

Expected: FAIL，缺少新模型。

- [ ] **Step 3: 在现有模型添加关系字段**

在 `World` 添加：

```prisma
directorRuns WorldDirectorRun[]
```

在 `Timeline` 添加：

```prisma
directorRuns     WorldDirectorRun[]
realityRevision RealityRevision?
```

在 `Message` 添加：

```prisma
playerRun   WorldDirectorRun? @relation("RunPlayerMessage")
narratorRun WorldDirectorRun? @relation("RunNarratorMessage")
```

- [ ] **Step 4: 添加核心模型**

```prisma
model WorldDirectorRun {
  id                   String    @id
  worldId              String    @map("world_id")
  world                World     @relation(fields: [worldId], references: [id], onDelete: Cascade)
  timelineId           String    @map("timeline_id")
  timeline             Timeline  @relation(fields: [timelineId], references: [id], onDelete: Cascade)
  storageChapterId     String?   @map("storage_chapter_id")
  trigger              String
  status               String    @default("queued")
  idempotencyKey       String    @unique @map("idempotency_key")
  baseRevision         Int       @map("base_revision")
  modelCallCount       Int       @default(0) @map("model_call_count")
  repairCount          Int       @default(0) @map("repair_count")
  playerInput          String?   @map("player_input") @db.Text
  directive            String?   @db.Text
  conversationFrames   Json?     @map("conversation_frames")
  toolResults          Json?     @map("tool_results")
  draftChangeSet       Json?     @map("draft_change_set")
  validationReport     Json?     @map("validation_report")
  narrationContract    Json?     @map("narration_contract")
  provisionalFrames    Json?     @map("provisional_frames")
  evidenceIndex        Json?     @map("evidence_index")
  finalContent         String?   @map("final_content") @db.Text
  leaseToken           String?   @map("lease_token")
  leaseExpiresAt       DateTime? @map("lease_expires_at")
  heartbeatAt          DateTime? @map("heartbeat_at")
  retryable            Boolean   @default(true)
  safeError            String?   @map("safe_error")
  error                String?   @db.Text
  parentRunId          String?   @map("parent_run_id")
  parentRun            WorldDirectorRun? @relation("RunParent", fields: [parentRunId], references: [id], onDelete: SetNull)
  childRuns            WorldDirectorRun[] @relation("RunParent")
  revisionOfRunId      String?   @map("revision_of_run_id")
  revisionOfRun        WorldDirectorRun? @relation("RunRevision", fields: [revisionOfRunId], references: [id], onDelete: SetNull)
  revisions            WorldDirectorRun[] @relation("RunRevision")
  playerMessageId      String?   @unique @map("player_message_id")
  playerMessage        Message?  @relation("RunPlayerMessage", fields: [playerMessageId], references: [id], onDelete: SetNull)
  narratorMessageId    String?   @unique @map("narrator_message_id")
  narratorMessage      Message?  @relation("RunNarratorMessage", fields: [narratorMessageId], references: [id], onDelete: SetNull)
  changeSet            WorldChangeSet?
  checkpoint           RunCheckpoint?
  claims               NarrativeClaim[]
  variants             TurnVariant[]
  completedAt          DateTime? @map("completed_at")
  createdAt            DateTime  @default(now()) @map("created_at")
  updatedAt            DateTime  @updatedAt @map("updated_at")

  @@index([timelineId, createdAt])
  @@index([status, leaseExpiresAt])
  @@map("world_director_runs")
}

model WorldChangeSet {
  id             String   @id @default(cuid())
  runId          String   @unique @map("run_id")
  run            WorldDirectorRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  timelineId     String   @map("timeline_id")
  baseRevision   Int      @map("base_revision")
  postRevision   Int      @map("post_revision")
  payload        Json
  payloadHash    String   @map("payload_hash")
  inverse        WorldInverseChangeSet?
  createdAt      DateTime @default(now()) @map("created_at")

  @@index([timelineId, postRevision])
  @@map("world_change_sets")
}

model WorldInverseChangeSet {
  id          String   @id @default(cuid())
  changeSetId String   @unique @map("change_set_id")
  changeSet   WorldChangeSet @relation(fields: [changeSetId], references: [id], onDelete: Cascade)
  payload     Json
  payloadHash String   @map("payload_hash")
  createdAt   DateTime @default(now()) @map("created_at")

  @@map("world_inverse_change_sets")
}

model NarrativeClaim {
  id           String   @id
  runId        String   @map("run_id")
  run          WorldDirectorRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  mutationKey  String   @map("mutation_key")
  claimType    String   @map("claim_type")
  subjectIds   String[] @map("subject_ids")
  evidence     Json
  createdAt    DateTime @default(now()) @map("created_at")

  @@unique([runId, mutationKey])
  @@map("narrative_claims")
}

model RunCheckpoint {
  id                    String   @id @default(cuid())
  runId                 String   @unique @map("run_id")
  run                   WorldDirectorRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  timelineId            String   @map("timeline_id")
  preRevision           Int      @map("pre_revision")
  postRevision          Int      @map("post_revision")
  previousTemporalState Json     @map("previous_temporal_state")
  previousRunId         String?  @map("previous_run_id")
  createdAt             DateTime @default(now()) @map("created_at")

  @@index([timelineId, postRevision])
  @@map("run_checkpoints")
}

model TurnVariant {
  id                String   @id @default(cuid())
  runId             String   @map("run_id")
  run               WorldDirectorRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  status            String   @default("candidate")
  content           String   @db.Text
  draftChangeSet    Json     @map("draft_change_set")
  evidenceIndex     Json     @map("evidence_index")
  validationReport  Json     @map("validation_report")
  chosen            Boolean  @default(false)
  createdAt         DateTime @default(now()) @map("created_at")

  @@index([runId, createdAt])
  @@map("turn_variants")
}

model RealityRevision {
  id         String   @id @default(cuid())
  timelineId String   @unique @map("timeline_id")
  timeline   Timeline @relation(fields: [timelineId], references: [id], onDelete: Cascade)
  revision   Int      @default(0)
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@map("reality_revisions")
}
```

- [ ] **Step 5: 生成 migration SQL**

运行：

```powershell
pnpm prisma migrate dev --name world_director_foundation --create-only
```

将生成目录重命名为计划指定目录时，必须确保没有覆盖现有未跟踪的 `prisma/migrations/20260724053824/`。检查 SQL 包含新表、外键、唯一索引和普通索引，不包含删除旧表。

- [ ] **Step 6: 验证 schema 与测试**

```powershell
pnpm prisma validate
pnpm test -- src/lib/world-director/schema-integrity.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add prisma/schema.prisma prisma/migrations/20260724183000_world_director_foundation/migration.sql src/lib/world-director/schema-integrity.test.ts
git commit -m "feat: persist world director runs"
```

---

### Task 4: 实现幂等 Run 创建与 revision 初始化

**Interfaces:**
- Consumes: Task 1 的 `RunTrigger`；Task 3 的 Prisma delegates。
- Produces: `ReserveRunInput`、`reserveRun(client: PrismaClient, input: ReserveRunInput): Promise<{ run: WorldDirectorRun; created: boolean }>`。

**Files:**
- Create: `src/lib/world-director/runtime/repository.ts`
- Create: `src/lib/world-director/runtime/repository.integration.test.ts`

- [ ] **Step 1: 写并发幂等测试**

测试必须在集成数据库创建一个 World、Timeline、Chapter 和 `RealityRevision(0)`，并验证：

```ts
const input = {
  id: "run-1",
  worldId: world.id,
  timelineId: timeline.id,
  storageChapterId: chapter.id,
  trigger: "observation" as const,
  idempotencyKey: "observation:world-1:client-1",
  playerInput: "观察鲁迪的新弹药",
};

const [a, b] = await Promise.all([
  reserveRun(prisma, input),
  reserveRun(prisma, { ...input, id: "run-2" }),
]);

expect(a.run.id).toBe(b.run.id);
expect(a.created || b.created).toBe(true);
expect(await prisma.worldDirectorRun.count({
  where: { idempotencyKey: input.idempotencyKey },
})).toBe(1);
```

另写测试：相同幂等键但不同 `playerInput` 必须抛出“幂等请求语义不一致”。

- [ ] **Step 2: 运行并确认失败**

```powershell
pnpm test:integration -- src/lib/world-director/runtime/repository.integration.test.ts
```

Expected: FAIL，`reserveRun` 不存在。

- [ ] **Step 3: 实现 repository**

导出：

```ts
export type ReserveRunInput = {
  id: string;
  worldId: string;
  timelineId: string;
  storageChapterId?: string;
  trigger: RunTrigger;
  idempotencyKey: string;
  playerInput?: string;
  directive?: string;
  parentRunId?: string;
  revisionOfRunId?: string;
};

export async function reserveRun(
  client: PrismaClient,
  input: ReserveRunInput,
): Promise<{ run: WorldDirectorRun; created: boolean }>;
```

事务内：

1. 读取 `world.activeTimelineId`，必须等于 `timelineId`；
2. `RealityRevision.upsert({ revision: 0 })`；
3. 查找 `idempotencyKey`；
4. 若存在，逐字段验证语义相同后返回；
5. 若不存在，以当前 revision 创建 `queued` Run；
6. 捕获 `P2002` 后重读并执行同样语义校验。

- [ ] **Step 4: 运行集成测试**

```powershell
pnpm test:integration -- src/lib/world-director/runtime/repository.integration.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/lib/world-director/runtime/repository.ts src/lib/world-director/runtime/repository.integration.test.ts
git commit -m "feat: reserve idempotent director runs"
```

---

### Task 5: 实现租约、心跳、预算消费和阶段推进

**Interfaces:**
- Consumes: Task 1 的预算常量和 `RunState`；Task 2 的 `assertRunTransition`；Task 3 的 `worldDirectorRun` delegate。
- Produces: `DIRECTOR_LEASE_MS`、`DIRECTOR_HEARTBEAT_MS`、`claimRun(...)`、`renewRunLease(...)`、`transitionOwnedRun(...)`、`spendModelCall(...)`、`spendRepair(...)`，签名以本任务 Step 3 代码块为准。

**Files:**
- Create: `src/lib/world-director/runtime/lease.ts`
- Create: `src/lib/world-director/runtime/lease.integration.test.ts`

- [ ] **Step 1: 写租约接管和预算失败测试**

覆盖：

- 第一个 Worker 成功领取 queued Run；
- 未过期时第二个 Worker 领取失败；
- 过期后第二个 Worker 成功接管；
- 非持有者不能心跳或推进阶段；
- 第四次调用后 `spendModelCall` 抛错；
- 第二次修正后 `spendRepair` 抛错；
- `completed` Run 不能重新领取。

- [ ] **Step 2: 运行并确认失败**

```powershell
pnpm test:integration -- src/lib/world-director/runtime/lease.integration.test.ts
```

Expected: FAIL，租约函数不存在。

- [ ] **Step 3: 实现原子租约函数**

导出：

```ts
export const DIRECTOR_LEASE_MS = 5 * 60 * 1000;
export const DIRECTOR_HEARTBEAT_MS = 15 * 1000;

export async function claimRun(
  client: PrismaClient,
  runId: string,
  leaseToken: string,
  now?: Date,
): Promise<boolean>;

export async function renewRunLease(
  client: PrismaClient,
  runId: string,
  leaseToken: string,
  now?: Date,
): Promise<boolean>;

export async function transitionOwnedRun(
  client: PrismaClient,
  input: {
    runId: string;
    leaseToken: string;
    from: RunState;
    to: RunState;
    patch?: Prisma.WorldDirectorRunUpdateManyMutationInput;
  },
): Promise<void>;

export async function spendModelCall(
  client: PrismaClient,
  runId: string,
  leaseToken: string,
): Promise<number>;

export async function spendRepair(
  client: PrismaClient,
  runId: string,
  leaseToken: string,
): Promise<number>;
```

`spendModelCall` 使用 `updateMany` 条件：

```ts
{
  id: runId,
  leaseToken,
  modelCallCount: { lt: MAX_MODEL_CALLS },
  status: { notIn: ["completed", "cancelled"] },
}
```

更新 `modelCallCount: { increment: 1 }` 后重读计数。`spendRepair` 同理。

- [ ] **Step 4: 运行测试**

```powershell
pnpm test:integration -- src/lib/world-director/runtime/lease.integration.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/lib/world-director/runtime/lease.ts src/lib/world-director/runtime/lease.integration.test.ts
git commit -m "feat: lease and budget director runs"
```

---

### Task 6: 将现有世界操作锁接入 director

**Interfaces:**
- Consumes: Task 4 的 `reserveRun`；现有 `claimWorldOperation`、`releaseWorldOperation`、`renewWorldOperation`。
- Produces: 扩展后的 `WorldOperationKind = "chat" | "settlement" | "rewrite" | "director"`；带世界级 director 锁语义的 `reserveRun`。

**Files:**
- Modify: `src/lib/reality/operation-lock.ts`
- Modify: `src/lib/reality/operation-lock.test.ts`
- Modify: `src/lib/world-director/runtime/repository.ts`
- Modify: `src/lib/world-director/runtime/repository.integration.test.ts`

- [ ] **Step 1: 写 director 与现有任务互斥测试**

```ts
it.each(["chat", "settlement", "rewrite"] as const)(
  "活动 %s 操作存在时拒绝创建 director Run",
  async (activeKind) => {
    await seedActiveWorldOperation(activeKind);
    await expect(reserveRun(prisma, input))
      .rejects.toThrow("世界正在执行其他写入任务");
  },
);

it("director Run 持有世界操作锁时拒绝旧写任务", async () => {
  await reserveRun(prisma, input);
  const result = await claimWorldOperation(
    operationClient,
    world.id,
    "chat",
    "legacy-chat",
  );
  expect(result.acquired).toBe(false);
  expect(result.activeKind).toBe("director");
});
```

- [ ] **Step 2: 扩展操作类型**

把 `operation-lock.ts` 的操作 kind 联合增加：

```ts
export type WorldOperationKind =
  | "chat"
  | "settlement"
  | "rewrite"
  | "director";
```

对应中文错误名称增加“世界导演”。

- [ ] **Step 3: reserveRun 原子领取世界级写锁**

`reserveRun()` 在创建新 Run 的同一事务内要求：

- `world.activeTimelineId === input.timelineId`；
- 现有 operation 为空、已过期，或已经是同一 `director + runId`；
- 写入 `operationKind = "director"`、`operationToken = runId` 和 lease；
- 幂等重放同一 Run 时续租而不是创建第二个锁。

Run 完成、失败且不可重试或取消时，由 runtime 释放该世界级锁；可重试失败保留到 lease 过期，避免旧链路趁故障并发写入。

- [ ] **Step 4: 测试并提交**

```powershell
pnpm test -- src/lib/reality/operation-lock.test.ts
pnpm test:integration -- src/lib/world-director/runtime/repository.integration.test.ts
git add src/lib/reality/operation-lock.ts src/lib/reality/operation-lock.test.ts src/lib/world-director/runtime/repository.ts src/lib/world-director/runtime/repository.integration.test.ts
git commit -m "feat: serialize director world writes"
```

Expected: PASS。

---

### Task 7: 接入统一任务进度投影

**Interfaces:**
- Consumes: Task 1 的 `RunState`；现有 `DurableTaskProgress`。
- Produces: `TaskKind` 新成员 `"director"`、`taskStages.director`、`directorProgress(run): DurableTaskProgress`。

**Files:**
- Modify: `src/lib/tasks/progress.ts`
- Modify: `src/lib/tasks/progress.test.ts`
- Create: `src/lib/world-director/runtime/progress.ts`
- Create: `src/lib/world-director/runtime/progress.test.ts`

- [ ] **Step 1: 写五阶段玩家视图测试**

```ts
import { expect, it } from "vitest";
import { directorProgress } from "./progress";

it.each([
  ["classifying", "reading"],
  ["branching", "planning"],
  ["reading", "reading"],
  ["planning", "planning"],
  ["validating", "validating"],
  ["repairing", "validating"],
  ["narrating", "narrating"],
  ["committing", "committing"],
] as const)("%s 映射为 %s", (status, stage) => {
  expect(directorProgress({
    id: "run-1",
    status,
    retryable: true,
    safeError: null,
    updatedAt: new Date("2026-07-24T00:00:00Z"),
  }).stage).toBe(stage);
});
```

同时修改 `tasks/progress.test.ts`，断言 `taskStages.director` 的标签严格为：

```text
读取世界
推演变化
校验因果
编织正文
写入世界
```

- [ ] **Step 2: 运行并确认失败**

```powershell
pnpm test -- src/lib/tasks/progress.test.ts src/lib/world-director/runtime/progress.test.ts
```

Expected: FAIL，`director` task kind 不存在。

- [ ] **Step 3: 扩展任务类型并实现映射**

在 `TaskKind` 增加 `"director"`，在 `taskStages` 增加：

```ts
director: [
  { id: "reading", label: "读取世界" },
  { id: "planning", label: "推演变化" },
  { id: "validating", label: "校验因果" },
  { id: "narrating", label: "编织正文" },
  { id: "committing", label: "写入世界" },
],
```

`directorProgress()` 将 `classifying/reading` 映射到 `reading`，将 `branching/planning` 映射到 `planning`；`completed` 使用 `committing + completed`，`failed` 保留当前映射阶段和安全错误。

- [ ] **Step 4: 运行测试**

```powershell
pnpm test -- src/lib/tasks/progress.test.ts src/lib/world-director/runtime/progress.test.ts
```

Expected: PASS。

- [ ] **Step 5: 运行 Phase 1 总验证**

```powershell
pnpm test -- src/lib/world-director src/lib/tasks/progress.test.ts
pnpm test:integration -- src/lib/world-director
pnpm prisma validate
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Expected: 全部 PASS，旧 `/api/chat` 测试不变。

- [ ] **Step 6: 提交**

```powershell
git add src/lib/tasks/progress.ts src/lib/tasks/progress.test.ts src/lib/world-director/runtime/progress.ts src/lib/world-director/runtime/progress.test.ts
git commit -m "feat: project director run progress"
```
