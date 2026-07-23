# Autonomous World Activity and Durable Task Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不增加每轮 LLM 调用的前提下，让世界随每次 Narrator 回复自主产生可见动态和持续事件，并让聊天、世界整理、现实分叉都显示可恢复、可重连、可从失败步骤重试的真实任务进度。

**Architecture:** Narrator 的一次结构化输出同时返回正文、原有连续状态和轻量世界行动；服务端先把完整模型输出保存到 `GenerationRequest.outputSnapshot`，再以稳定 ID 在单一事务中应用正文、状态、动态和事件。三类长任务统一使用 `TaskProgressEvent`，持久阶段是事实来源，SSE 只传递真实后端状态；动态经独立 projection 层按 Pantheon/Creator 视角下发，关注事件只提高 Context Builder 权重，不额外调用模型或立即切场。

**Tech Stack:** Next.js 16 Route Handlers、React 19、TypeScript、Prisma 7/PostgreSQL、Zod 4、Vitest 4、SSE

---

## 实施边界与文件结构

### 新增文件

- `src/lib/tasks/progress.ts`：三类任务的阶段表、持久摘要、单向转换与安全错误分类。
- `src/lib/tasks/progress-events.ts`：统一 SSE 事件契约、编码器和 durable progress 投影。
- `src/lib/chat/task-runner.ts`：与浏览器连接解耦的聊天 owner、内存订阅器和持久断点恢复。
- `src/lib/settle/task-runner.ts`：与浏览器连接解耦的世界整理 owner 和进度订阅器。
- `src/lib/world-activity/contracts.ts`：Narrator 世界行动、普通动态、重要事件变化的严格 Zod 契约。
- `src/lib/world-activity/apply.ts`：逐项语义校验、稳定 ID 和事务写入。
- `src/lib/world-activity/projection.ts`：Pantheon、Creator limited、Creator omniscient 的可见性投影。
- `src/lib/world-activity/context.ts`：关注事件、当前相关者和近期行动的上下文选择。
- `src/lib/world-activity/clone.ts`：现实分叉时复制事件/动态并重映射所有引用。
- `src/app/api/worlds/[id]/activities/route.ts`：动态与重要事件查询。
- `src/app/api/worlds/[id]/events/[eventId]/focus/route.ts`：关注、替换和取消关注。
- `src/components/play/TaskProgressBar.tsx`：只渲染真实任务步骤的状态条。
- `src/components/play/task-progress-state.ts`：SSE/刷新恢复的纯状态归并函数。
- `src/components/play/WorldActivityPanel.tsx`：当前关注、重要事件、近期动态。
- 与上述模块同目录的 `*.test.ts` / `*.integration.test.ts`。

### 重点修改文件

- `prisma/schema.prisma` 与新 migration：`GenerationRequest` 断点字段、`WorldEvent`、`WorldActivity`。
- `src/lib/chat/request.ts`、`src/lib/chat/finalize.ts`、`src/lib/context/sse.ts`、`src/app/api/chat/route.ts`：先存模型输出，再幂等应用，并发送真实阶段。
- `src/lib/chat/continuous-meta.ts`、`src/lib/prompts/narrator.ts`：把世界轻行动纳入同一次 Narrator META。
- `src/lib/settle/pipeline.ts`、`src/app/api/chapters/[id]/settle/route.ts`：统一世界整理进度和深度事件处理。
- `src/lib/reality/task-runner.ts`、`src/app/api/rewrites/[id]/events/route.ts`：统一现实分叉进度。
- `src/lib/context/builder.ts`：注入当前相关者、关注事件和近期动态。
- `src/app/api/worlds/[id]/state/route.ts`、`src/components/play/types.ts`：下发 durable task 摘要和关注状态。
- `src/components/play/sse-client.ts`、`src/components/play/world-settlement-state.ts`、`src/app/play/[worldId]/page.tsx`、`src/components/play/InputDeck.tsx`：正文始终可读，进度可恢复，失败可原地重试。
- `src/components/play/reality-tree-state.ts`、`src/components/play/RuneRail.tsx`、`src/components/play/PlayDrawer.tsx`：新增独立“动态”符文和未读反馈。
- `src/lib/reality/clone.ts`、`src/app/api/worlds/[id]/export/route.ts`、`src/app/api/worlds/import/route.ts`：现实克隆与存档版本升级。

### 执行前约束

- 写 Next.js Route Handler 前先阅读 `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`；本计划使用原生 `Request`/`Response`、动态 GET 和 `ReadableStream`，不依赖旧版 Pages Router。
- 游戏内继续使用无章节连续流程；`Chapter` 只作为内部检查点和现有外键，不增加章节按钮、章末对话或玩家可见章节概念。
- 每轮 Narrator 仍只调用一次模型；世界行动、普通动态和重要事件变化全部来自同一个 META。
- 以下文件在计划编写时已有用户未提交修改，执行时不得覆盖或整文件暂存：
  - `src/lib/prompts/rewrite.test.ts`
  - `src/lib/prompts/rewrite.ts`
  - `src/lib/reality/apply.integration.test.ts`
  - `src/lib/reality/apply.ts`
  - `src/lib/reality/schemas.test.ts`
  - `src/lib/reality/schemas.ts`
- 修改上述文件前先执行 `git diff -- <file>` 保存基线；提交时使用交互式暂存，只纳入本计划新增 hunk。

---

## Phase 1：真实任务进度与正文断点恢复

### Task 1: 增加聊天任务持久阶段与私有输出快照

**Files:**
- Modify: `prisma/schema.prisma:116-138`
- Modify: `prisma/schema.prisma:98-114`
- Create: `prisma/migrations/20260723110000_durable_generation_progress/migration.sql`
- Test: `src/lib/chat/request.test.ts`

- [ ] **Step 1: 写 schema 形状失败测试**

```ts
// 追加到 src/lib/chat/request.test.ts
import { readFileSync } from "node:fs";

it("GenerationRequest 持久化真实阶段和私有输出快照", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  expect(schema).toContain("stage             String   @default(\"reserved\")");
  expect(schema).toContain("outputSnapshot    Json?    @map(\"output_snapshot\")");
  expect(schema).toContain("retryable         Boolean  @default(true)");
  expect(schema).toContain("safeError         String?  @map(\"safe_error\")");
  expect(schema).toContain("stageUpdatedAt    DateTime @default(now()) @map(\"stage_updated_at\")");
  expect(schema).toContain("settleError     String?   @map(\"settle_error\")");
  expect(schema).toContain("settleRetryable Boolean   @default(true) @map(\"settle_retryable\")");
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm test -- src/lib/chat/request.test.ts
```

Expected: FAIL，缺少 `stage` 或 `outputSnapshot`。

- [ ] **Step 3: 添加 Prisma 字段和可回滚 migration**

```prisma
model GenerationRequest {
  // 保留现有字段
  status            String   @default("pending")
  stage             String   @default("reserved")
  outputSnapshot    Json?    @map("output_snapshot")
  retryable         Boolean  @default(true)
  safeError         String?  @map("safe_error")
  stageUpdatedAt    DateTime @default(now()) @map("stage_updated_at")
  // 保留现有关系和索引
}

model Chapter {
  // 保留现有字段
  settleState     String   @default("open") @map("settle_state")
  settleError     String?  @map("settle_error")
  settleRetryable Boolean  @default(true) @map("settle_retryable")
  settleUpdatedAt DateTime @default(now()) @map("settle_updated_at")
}
```

```sql
ALTER TABLE "generation_requests"
  ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'reserved',
  ADD COLUMN "output_snapshot" JSONB,
  ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "safe_error" TEXT,
  ADD COLUMN "stage_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "generation_requests"
SET "stage" = CASE
  WHEN "status" = 'completed' THEN 'completed'
  WHEN "status" = 'failed' THEN 'reserved'
  ELSE 'reserved'
END;

CREATE INDEX "generation_requests_chapter_id_stage_idx"
  ON "generation_requests"("chapter_id", "stage");

ALTER TABLE "chapters"
  ADD COLUMN "settle_error" TEXT,
  ADD COLUMN "settle_retryable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "settle_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
```

- [ ] **Step 4: 生成客户端并验证**

Run:

```bash
pnpm prisma validate
pnpm prisma generate
pnpm test -- src/lib/chat/request.test.ts
```

Expected: Prisma schema valid；测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add prisma/schema.prisma prisma/migrations/20260723110000_durable_generation_progress/migration.sql src/lib/chat/request.test.ts
git commit -m "feat: persist narration task checkpoints"
```

### Task 2: 定义统一任务阶段、事件和单向归并

**Files:**
- Create: `src/lib/tasks/progress.ts`
- Create: `src/lib/tasks/progress-events.ts`
- Create: `src/lib/tasks/progress.test.ts`
- Create: `src/lib/tasks/progress-events.test.ts`

- [ ] **Step 1: 写阶段单向性和 SSE 契约失败测试**

```ts
// src/lib/tasks/progress.test.ts
import { describe, expect, it } from "vitest";
import { advanceTaskStage, taskStages } from "./progress";

describe("task progress", () => {
  it("只允许同阶段幂等或向前推进", () => {
    expect(advanceTaskStage("chat", "generating", "output_stored")).toBe("output_stored");
    expect(advanceTaskStage("chat", "output_stored", "output_stored")).toBe("output_stored");
    expect(() => advanceTaskStage("chat", "applying", "generating")).toThrow("任务阶段不可倒退");
  });

  it("三类任务都有完整真实步骤", () => {
    expect(taskStages.chat.map((item) => item.id)).toEqual([
      "reserved", "context_ready", "generating", "output_stored", "applying", "completed",
    ]);
    expect(taskStages.settlement.at(-1)?.id).toBe("completed");
    expect(taskStages.rewrite.at(-1)?.id).toBe("completed");
  });
});
```

```ts
// src/lib/tasks/progress-events.test.ts
import { expect, it } from "vitest";
import { TaskProgressEventSchema, encodeTaskEvent } from "./progress-events";

it("统一事件使用 taskId/content/failed 而不是旧 text/error 形状", () => {
  const event = TaskProgressEventSchema.parse({
    type: "progress", taskId: "gen-1", taskKind: "chat",
    stage: "generating", status: "running", occurredAt: new Date(0).toISOString(),
  });
  expect(new TextDecoder().decode(encodeTaskEvent(event))).toContain("\"stage\":\"generating\"");
  expect(() => TaskProgressEventSchema.parse({ type: "text", text: "旧字段" })).toThrow();
});
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run:

```bash
pnpm test -- src/lib/tasks/progress.test.ts src/lib/tasks/progress-events.test.ts
```

Expected: FAIL，无法解析新模块。

- [ ] **Step 3: 实现阶段表和持久摘要**

```ts
// src/lib/tasks/progress.ts
export type TaskKind = "chat" | "settlement" | "rewrite";
export type TaskStatus = "running" | "failed" | "completed";

export const taskStages = {
  chat: [
    { id: "reserved", label: "接收请求" },
    { id: "context_ready", label: "组装上下文" },
    { id: "generating", label: "生成正文" },
    { id: "output_stored", label: "校验模型输出" },
    { id: "applying", label: "写入正文与状态" },
    { id: "completed", label: "更新世界动态" },
  ],
  settlement: [
    { id: "checkpoint_read", label: "读取检查点" },
    { id: "pantheon", label: "推演诸神行动" },
    { id: "extract", label: "抽取持久变化" },
    { id: "chronicle", label: "更新编年史" },
    { id: "snapshot", label: "生成内部快照" },
    { id: "completed", label: "开放后续记录段" },
  ],
  rewrite: [
    { id: "intent_ready", label: "理解追溯意图" },
    { id: "planned", label: "建立改写计划" },
    { id: "branching", label: "克隆现实" },
    { id: "applying", label: "应用新历史" },
    { id: "narrating", label: "生成结果正文" },
    { id: "settling", label: "整理新现实" },
    { id: "completed", label: "切换活动现实" },
  ],
} as const;

export type DurableTaskProgress = {
  taskKind: TaskKind;
  taskId: string;
  stage: string;
  status: TaskStatus;
  retryable: boolean;
  safeError?: string;
  updatedAt: string;
};

export function advanceTaskStage(kind: TaskKind, current: string, next: string): string {
  const order = taskStages[kind].map((item) => item.id as string);
  const currentIndex = order.indexOf(current);
  const nextIndex = order.indexOf(next);
  if (currentIndex < 0 || nextIndex < 0) throw new Error("未知任务阶段");
  if (nextIndex < currentIndex) throw new Error("任务阶段不可倒退");
  return next;
}
```

- [ ] **Step 4: 实现严格事件契约和 SSE 编码器**

```ts
// src/lib/tasks/progress-events.ts
import { z } from "zod";

const base = {
  taskId: z.string().min(1),
};
export const TaskProgressEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("progress"), ...base,
    taskKind: z.enum(["chat", "settlement", "rewrite"]),
    stage: z.string().min(1),
    status: z.enum(["running", "completed"]),
    detail: z.string().optional(),
    occurredAt: z.string().datetime(),
  }).strict(),
  z.object({ type: z.literal("text"), ...base, content: z.string() }).strict(),
  z.object({
    type: z.literal("failed"), ...base, stage: z.string().min(1),
    message: z.string().min(1), retryable: z.boolean(),
  }).strict(),
  z.object({
    type: z.literal("done"), ...base,
    followUp: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }),
      z.object({ kind: z.literal("settlement"), segmentId: z.string() }),
      z.object({ kind: z.literal("rewrite"), taskId: z.string() }),
    ]),
  }).strict(),
]);
export type TaskProgressEvent = z.infer<typeof TaskProgressEventSchema>;
const encoder = new TextEncoder();
export const encodeTaskEvent = (event: TaskProgressEvent) =>
  encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
```

- [ ] **Step 5: 运行测试并提交**

Run:

```bash
pnpm test -- src/lib/tasks/progress.test.ts src/lib/tasks/progress-events.test.ts
```

Expected: PASS。

```bash
git add src/lib/tasks
git commit -m "feat: define durable task progress protocol"
```

### Task 3: 将聊天请求改为“生成一次、保存一次、可重复应用”

**Files:**
- Modify: `src/lib/chat/request.ts`
- Modify: `src/lib/chat/request.test.ts`
- Modify: `src/lib/chat/finalize.ts`
- Modify: `src/lib/chat/finalize.test.ts`

- [ ] **Step 1: 写输出快照和断点领取失败测试**

```ts
// 追加到 src/lib/chat/request.test.ts
it("output_stored 重试直接返回保存输出而不回到生成阶段", async () => {
  mocks.row.stage = "output_stored";
  mocks.row.outputSnapshot = {
    prose: "潮声已抵达王城。",
    parsedMeta: emptyContinuousMeta(),
    generatedAt: "2026-07-23T00:00:00.000Z",
    contractVersion: 1,
  };
  mocks.row.status = "failed";
  const result = await prepareGenerationRequest(client, input);
  expect(result.state).toBe("owner");
  expect(result.resumeFrom).toBe("output_stored");
  expect(result.outputSnapshot?.prose).toBe("潮声已抵达王城。");
});

it("保存输出使用 attempt CAS 且不写公开消息", async () => {
  await storeGenerationOutput(client, "gen-1", 2, {
    prose: "正文", parsedMeta: emptyContinuousMeta(),
    generatedAt: "2026-07-23T00:00:00.000Z", contractVersion: 1,
  });
  expect(mocks.message.create).not.toHaveBeenCalled();
  expect(mocks.generationRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: "gen-1", attempt: 2, stage: "generating" },
    data: expect.objectContaining({ stage: "output_stored" }),
  }));
});
```

- [ ] **Step 2: 运行测试确认缺少恢复接口**

Run:

```bash
pnpm test -- src/lib/chat/request.test.ts src/lib/chat/finalize.test.ts
```

Expected: FAIL，`storeGenerationOutput` / `resumeFrom` 不存在。

- [ ] **Step 3: 实现私有快照、CAS 阶段推进和安全失败**

```ts
// src/lib/chat/request.ts
export const StoredNarratorOutputSchema = z.object({
  prose: z.string().min(1),
  parsedMeta: ContinuousNarratorMetaSchema,
  generatedAt: z.string().datetime(),
  contractVersion: z.literal(1),
}).strict();
export type StoredNarratorOutput = z.infer<typeof StoredNarratorOutputSchema>;

export async function storeGenerationOutput(
  client: GenerationRequestClient,
  generationId: string,
  attempt: number,
  output: StoredNarratorOutput,
) {
  const parsed = StoredNarratorOutputSchema.parse(output);
  return client.$transaction(async (tx) => {
    const saved = await tx.generationRequest.updateMany({
      where: { id: generationId, attempt, stage: "generating" },
      data: {
        outputSnapshot: parsed,
        stage: "output_stored",
        stageUpdatedAt: new Date(),
        error: null,
        safeError: null,
      },
    });
    if (saved.count !== 1) throw new Error("叙事输出保存断点已被接管");
    return parsed;
  });
}
```

将 `PreparedGeneration` 扩为：

```ts
export type PreparedGeneration = {
  meta: GenerationRequestMeta;
  state: "owner" | "pending" | "completed";
  attempt?: number;
  resumeFrom?: "reserved" | "context_ready" | "generating" | "output_stored" | "applying";
  outputSnapshot?: StoredNarratorOutput;
  completion?: GenerationCompletion;
};
```

失败记录必须保留当前 `stage`；`output_stored` 和 `applying` 的 takeover 返回已解析快照，`reserved/context_ready/generating` 才允许重新调用模型。公开错误只写 `safeError`，内部 `error` 不进入 DTO。

- [ ] **Step 4: 让 finalizer 只接受持久快照并以 generationId 幂等应用**

```ts
// src/lib/chat/finalize.ts
export async function applyStoredNarration(
  client: NarrationFinalizationClient,
  input: Omit<FinalizeInput, "prose" | "meta"> & { output: StoredNarratorOutput },
) {
  return client.$transaction(async (tx) => {
    const claimed = await tx.generationRequest.updateMany({
      where: {
        id: input.generationId,
        attempt: input.attempt,
        stage: { in: ["output_stored", "applying"] },
      },
      data: { stage: "applying", stageUpdatedAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error("叙事应用断点已被接管");
    return finalizeStoredOutputInTransaction(tx, {
      ...input,
      prose: input.output.prose,
      meta: input.output.parsedMeta,
    });
  });
}
```

保留现有消息/能力揭示/追溯逻辑，但将最终 `GenerationRequest` 更新设为 `stage: "completed"`；若消息已存在，继续验证请求绑定并完成缺失的 durable completion，而不是重新生成。

- [ ] **Step 5: 运行单元测试并提交**

Run:

```bash
pnpm test -- src/lib/chat/request.test.ts src/lib/chat/finalize.test.ts
```

Expected: PASS；快照恢复测试证明无需第二次 LLM。

```bash
git add src/lib/chat/request.ts src/lib/chat/request.test.ts src/lib/chat/finalize.ts src/lib/chat/finalize.test.ts
git commit -m "feat: resume narration from stored model output"
```

### Task 4: 聊天 SSE 发送真实阶段并支持 durable replay

**Files:**
- Create: `src/lib/chat/task-runner.ts`
- Create: `src/lib/chat/task-runner.test.ts`
- Modify: `src/lib/context/sse.ts`
- Modify: `src/lib/context/sse.test.ts`
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/app/api/chat/route.test.ts`

- [ ] **Step 1: 写事件顺序和“落库失败不重调模型”失败测试**

```ts
// 追加到 src/app/api/chat/route.test.ts
it("已有 output_stored 快照时跳过 narratorSSE 并直接应用", async () => {
  mocks.prepareGenerationRequest.mockResolvedValue({
    state: "owner", attempt: 3, resumeFrom: "output_stored",
    meta: requestMeta,
    outputSnapshot: storedOutput,
  });
  const response = await POST(chatRequest());
  expect(mocks.narratorSSE).not.toHaveBeenCalled();
  expect(mocks.applyStoredNarration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    output: storedOutput,
  }));
  expect(await response.text()).toContain("\"type\":\"done\"");
});
```

```ts
// 追加到 src/lib/context/sse.test.ts
it("只在真实回调边界发送生成和保存阶段", async () => {
  const response = narratorSSE({ taskId: "gen-1", messages, onOutput: save, onDone: apply });
  const events = await readSSE(response);
  expect(events.map((event) => [event.type, event.stage])).toEqual([
    ["progress", "generating"],
    ["text", undefined],
    ["progress", "generating"],
    ["progress", "output_stored"],
    ["progress", "applying"],
    ["progress", "completed"],
    ["done", undefined],
  ]);
});
```

- [ ] **Step 2: 运行测试确认旧 SSE 只有 text/done/error**

Run:

```bash
pnpm test -- src/lib/context/sse.test.ts src/app/api/chat/route.test.ts
```

Expected: FAIL，事件字段或恢复分支不匹配。

- [ ] **Step 3: 拆分生成、保存、应用三个真实边界**

将模型执行移到与 HTTP 连接解耦的 `ensureNarrationTaskRunning()`。模块用 `Map<taskId, Promise<void>>` 保证单进程单 owner，用 `Map<taskId, Set<(event) => void>>` 广播即时文本；数据库 CAS 和世界租约继续提供跨进程唯一性。runner 使用自己的内部 `AbortController`，绝不使用 `request.signal`；浏览器断开只取消订阅，不中止模型、保存或应用。

```ts
type NarrationTaskOptions = {
  taskId: string;
  messages: ChatMessage[];
  onOutput(output: StoredNarratorOutput): Promise<StoredNarratorOutput>;
  onDone(output: StoredNarratorOutput): Promise<GenerationCompletion>;
  onFailure(error: unknown, stage: string): Promise<{ retryable: boolean; safeError: string }>;
  // 保留 cache 和世界租约 heartbeat；signal 由 runner 内部持有
};

export function ensureNarrationTaskRunning(options: NarrationTaskOptions): void;
export function subscribeNarrationTask(
  taskId: string,
  listener: (event: TaskProgressEvent) => void,
): () => void;
```

在第一字节请求模型前发送 `generating/running`；META 完整解析成功后调用 `onOutput`，调用成功才发送 `output_stored/completed`；进入事务前发送 `applying/running`；事务完成后发送 `completed/completed` 和 `done`。SSE 断开不得把后端任务误写为失败，只有模型、校验或数据库操作本身失败才落失败状态。

- [ ] **Step 4: SSE 只订阅 runner，并按持久断点分流**

```ts
if (prepared.outputSnapshot) {
  ensureNarrationTaskRunning({
    taskId: generationId,
    output: prepared.outputSnapshot,
    apply: () => applyStoredNarration(prisma, buildApplyInput(prepared.outputSnapshot)),
  });
  return narrationTaskSSE(generationId, request.signal);
}

await markGenerationStage(prisma, generationId, prepared.attempt!, "context_ready");
ensureNarrationTaskRunning({
  taskId: generationId,
  messages,
  onOutput: (output) => storeGenerationOutput(prisma, generationId, prepared.attempt!, output),
  onDone: (output) => applyStoredNarration(prisma, buildApplyInput(output)),
  // heartbeat 和世界租约逻辑继续使用现有实现
});
return narrationTaskSSE(generationId, request.signal);
```

`narrationTaskSSE()` 建立连接时先读取一次 GenerationRequest 并发送当前 durable 阶段，然后订阅 runner；`request.signal.abort` 仅调用 unsubscribe。`prepared.state === "completed"` 重放 `completed` progress 和既有 `done`；`pending` 轮询持久记录并转发阶段，不创建第二个 owner。重连发生在生成中时不伪造已经丢失的文本块，等 `outputSnapshot` 完整可用后再发全文预览或完成消息。

- [ ] **Step 5: 运行测试并提交**

Run:

```bash
pnpm test -- src/lib/chat/task-runner.test.ts src/lib/context/sse.test.ts src/app/api/chat/route.test.ts src/lib/chat/request.test.ts src/lib/chat/finalize.test.ts
```

Expected: PASS。

```bash
git add src/lib/chat/task-runner.ts src/lib/chat/task-runner.test.ts src/lib/context/sse.ts src/lib/context/sse.test.ts src/app/api/chat/route.ts src/app/api/chat/route.test.ts
git commit -m "feat: stream real narration task stages"
```

### Task 5: 世界整理切换到统一真实进度协议

**Files:**
- Create: `src/lib/settle/task-runner.ts`
- Create: `src/lib/settle/task-runner.test.ts`
- Modify: `src/lib/settle/pipeline.ts`
- Modify: `src/lib/settle/pipeline.integration.test.ts`
- Modify: `src/app/api/chapters/[id]/settle/route.ts`
- Modify: `src/components/play/world-settlement-state.ts`
- Modify: `src/components/play/world-settlement-state.test.ts`

- [ ] **Step 1: 写统一事件与断点恢复失败测试**

```ts
// 追加到 src/components/play/world-settlement-state.test.ts
it("保留已完成步骤并停在服务端声明的失败阶段", async () => {
  const fetcher = sseResponse([
    { type: "progress", taskId: "segment-1", taskKind: "settlement",
      stage: "chronicle", status: "running", occurredAt: now },
    { type: "failed", taskId: "segment-1", stage: "chronicle",
      message: "编年史写入中断", retryable: true },
  ]);
  const result = await followWorldSettlement("segment-1", fetcher, vi.fn());
  expect(result).toMatchObject({
    status: "failed", stage: "chronicle", retryable: true,
    completedStages: ["checkpoint_read", "pantheon", "extract"],
  });
});
```

- [ ] **Step 2: 运行测试确认旧 `{step}` 协议失败**

Run:

```bash
pnpm test -- src/components/play/world-settlement-state.test.ts
```

Expected: FAIL，旧客户端不能解析 `TaskProgressEvent`。

- [ ] **Step 3: 从 `settleState` 发出真实 durable 阶段**

保持现有 `settling:<step>` 状态机和“模型响应先入 snapshot”的恢复能力，把 generator 输出改成：

```ts
yield progressEvent(chapterId, "settlement", "checkpoint_read", "completed");
yield progressEvent(chapterId, "settlement", "pantheon", "running");
// completeStructured 真正返回并持久化 pendingSettlement 后
yield progressEvent(chapterId, "settlement", "pantheon", "completed");
```

每个 `setState()` 成功后才标记上一步 completed；错误时把安全信息写入 `Chapter.settleError/settleRetryable/settleUpdatedAt`，事件使用当前 `parseState(chapter.settleState)`。可重试错误保留 `pendingSettlement`，不重新调用已经成功的 settlement 模型。

- [ ] **Step 4: 用后台 owner 解耦浏览器并统一 data JSON**

`ensureSettlementRunning(segmentId)` 用 active runner Map 去重并在后台消费 `settleChapter()`；每个 generator 事件先持久化阶段，再广播给订阅者。Route Handler 只读取 durable Chapter、调用 ensure、订阅事件；`request.signal.abort` 只退订，不能传进 settle pipeline。

```ts
// route.ts
ensureSettlementRunning(id);
const unsubscribe = subscribeSettlement(id, (event) => {
  controller.enqueue(encodeTaskEvent(event));
});
request.signal.addEventListener("abort", unsubscribe, { once: true });
```

```ts
// world-settlement-state.ts
export type WorldSettlementState =
  | { status: "idle" }
  | { status: "running"; taskId: string; stage: string; completedStages: string[] }
  | { status: "failed"; taskId: string; stage: string; completedStages: string[];
      error: string; retryable: boolean };
```

- [ ] **Step 5: 运行测试并提交**

Run:

```bash
pnpm test -- src/lib/settle/task-runner.test.ts src/components/play/world-settlement-state.test.ts
pnpm test:integration -- src/lib/settle/pipeline.integration.test.ts
```

Expected: PASS。

```bash
git add src/lib/settle/task-runner.ts src/lib/settle/task-runner.test.ts src/lib/settle/pipeline.ts src/lib/settle/pipeline.integration.test.ts src/app/api/chapters/[id]/settle/route.ts src/components/play/world-settlement-state.ts src/components/play/world-settlement-state.test.ts
git commit -m "feat: unify settlement progress events"
```

### Task 6: 现实分叉切换到统一真实进度协议

**Files:**
- Modify: `src/lib/reality/task-runner.ts`
- Modify: `src/lib/reality/task-runner.test.ts`
- Modify: `src/app/api/rewrites/[id]/events/route.ts`
- Modify: `src/app/api/rewrites/[id]/route.ts`

- [ ] **Step 1: 写持久状态到统一阶段的映射测试**

```ts
// 追加到 src/lib/reality/task-runner.test.ts
it.each([
  ["planning", null, "intent_ready"],
  ["planning", { scope: "retroactive" }, "planned"],
  ["applying", null, "branching"],
  ["narrating", null, "narrating"],
  ["completed", null, "completed"],
])("将 %s 映射到真实 rewrite 阶段", (status, plan, stage) => {
  expect(rewriteDurableProgress(task({ status, plan })).stage).toBe(stage);
});
```

- [ ] **Step 2: 运行测试确认缺少 durable mapper**

Run:

```bash
pnpm test -- src/lib/reality/task-runner.test.ts
```

Expected: FAIL，`rewriteDurableProgress` 不存在。

- [ ] **Step 3: 在真正持久边界记录分叉阶段**

为 `RealityRewrite` 复用现有 `status/plan/resultTimelineId/error/updatedAt`，不添加虚假计时器。把 `RealityRewriteStatus` 扩为 `planning | branching | applying | narrating | settling | completed | failed`，并同步 `claimRealityRewriteTask()`、`renewRealityRewriteLease()`、失败 CAS 和重试允许列表。计划保存成功后进入 `branching`；`cloneTimelineGraph` 事务成功后进入 `applying`；结果消息写入后进入 `settling`；新现实整理和世界切换事务成功后才进入 `completed`。`rewriteDurableProgress()` 返回统一摘要并用 `sanitizeRewriteError()` 生成安全错误。

- [ ] **Step 4: 将 events route 改为统一 SSE**

```ts
const progress = rewriteDurableProgress(task);
if (version !== lastVersion) {
  controller.enqueue(encodeTaskEvent({
    type: progress.status === "failed" ? "failed" : "progress",
    taskId: id,
    ...(progress.status === "failed"
      ? { stage: progress.stage, message: progress.safeError!, retryable: progress.retryable }
      : { taskKind: "rewrite", stage: progress.stage,
          status: progress.status === "completed" ? "completed" : "running",
          occurredAt: progress.updatedAt }),
  }));
}
```

完成时追加 `done`，`followUp: { kind: "none" }`；GET 重连先发当前持久状态，不回放前端猜测阶段。

- [ ] **Step 5: 运行测试并提交**

Run:

```bash
pnpm test -- src/lib/reality/task-runner.test.ts src/app/api/rewrites/[id]/route.test.ts
pnpm test:integration -- src/lib/reality/task-runner.integration.test.ts
```

Expected: PASS。

```bash
git add src/lib/reality/task-runner.ts src/lib/reality/task-runner.test.ts src/app/api/rewrites/[id]/events/route.ts src/app/api/rewrites/[id]/route.ts
git commit -m "feat: unify reality rewrite progress"
```

### Task 7: 输入区显示真实进度、保留正文预览并从具体步骤重试

**Files:**
- Create: `src/components/play/task-progress-state.ts`
- Create: `src/components/play/task-progress-state.test.ts`
- Create: `src/components/play/TaskProgressBar.tsx`
- Create: `src/components/play/TaskProgressBar.test.tsx`
- Modify: `src/components/play/sse-client.ts`
- Modify: `src/components/play/InputDeck.tsx`
- Modify: `src/components/play/types.ts`
- Modify: `src/app/api/worlds/[id]/state/route.ts`
- Modify: `src/app/api/worlds/[id]/state/route.test.ts`
- Modify: `src/app/play/[worldId]/page.tsx`

- [ ] **Step 1: 写进度归并和失败 UI 测试**

```ts
// src/components/play/task-progress-state.test.ts
import { expect, it } from "vitest";
import { reduceTaskProgress } from "./task-progress-state";

it("刷新后的 durable 阶段补全此前步骤且不会倒退", () => {
  const applying = reduceTaskProgress(null, {
    taskKind: "chat", taskId: "gen-1", stage: "applying",
    status: "running", retryable: true, updatedAt: now,
  });
  const stale = reduceTaskProgress(applying, {
    taskKind: "chat", taskId: "gen-1", stage: "generating",
    status: "running", retryable: true, updatedAt: earlier,
  });
  expect(stale).toEqual(applying);
  expect(applying?.steps.filter((step) => step.status === "completed").map((step) => step.id))
    .toContain("output_stored");
});
```

```tsx
// src/components/play/TaskProgressBar.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TaskProgressBar } from "./TaskProgressBar";

it("失败阶段显示准确恢复动作", () => {
  const retryable = renderToStaticMarkup(
    <TaskProgressBar progress={failedProgress({ retryable: true })} onRetry={() => undefined} />,
  );
  const refreshOnly = renderToStaticMarkup(
    <TaskProgressBar progress={failedProgress({ retryable: false })} onRefresh={() => undefined} />,
  );
  expect(retryable).toContain("从此处重试");
  expect(refreshOnly).toContain("刷新世界");
  expect(retryable).toContain("写入正文与状态");
});
```

页面编排另加一个纯函数测试：当 `streamingText` 非空且任务在 `applying/failed` 时，`buildNarrationPreviewState()` 返回 `{ visible: true, persisted: false }`，确保失败状态不会卸载正文预览。

- [ ] **Step 2: 运行测试确认新状态模块不存在**

Run:

```bash
pnpm test -- src/components/play/task-progress-state.test.ts src/components/play/TaskProgressBar.test.tsx src/app/api/worlds/[id]/state/route.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 下发 durable task 摘要并归并 SSE**

`PlayState` 新增：

```ts
taskProgress: DurableTaskProgress | null;
```

state route 根据 `World.operationKind` 查询当前 `GenerationRequest`、内部检查点 `settleState` 或 `RealityRewrite`，只返回安全摘要。`reduceTaskProgress` 使用 `taskStages[kind]` 计算：

```ts
type ProgressStepView = {
  id: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
};
```

只有收到服务端 `progress/failed/done` 或刷新 DTO 才改变后端步骤；“刷新界面”作为唯一前端步骤，在消息、state、activities 三个请求完成后标记 completed。

- [ ] **Step 4: 渲染状态条并保持正文可读**

```tsx
<TaskProgressBar
  progress={taskProgress}
  onRetry={taskProgress?.retryable ? retryFromCheckpoint : undefined}
  onRefresh={!taskProgress?.retryable ? reloadState : undefined}
/>
```

`streamingText` 在应用失败时保留并显示“尚未写入世界”；不要用“读取中”覆盖 `StoryStream`。任务运行和失败预览期间锁定输入；重试沿用同一 `generationId`、segmentId 或 rewrite taskId。应用成功后以正式消息替换预览。

- [ ] **Step 5: 运行前端与路由测试**

Run:

```bash
pnpm test -- src/components/play/task-progress-state.test.ts src/components/play/TaskProgressBar.test.tsx src/app/api/worlds/[id]/state/route.test.ts
pnpm lint
```

Expected: PASS；lint 无新增错误。

- [ ] **Step 6: 提交**

```bash
git add src/components/play/task-progress-state.ts src/components/play/task-progress-state.test.ts src/components/play/TaskProgressBar.tsx src/components/play/TaskProgressBar.test.tsx src/components/play/sse-client.ts src/components/play/InputDeck.tsx src/components/play/types.ts src/app/api/worlds/[id]/state/route.ts src/app/api/worlds/[id]/state/route.test.ts src/app/play/[worldId]/page.tsx
git commit -m "feat: show recoverable task progress in play"
```

---

## Phase 2：同轮轻行动与独立动态页

### Task 8: 建立 WorldEvent 与 WorldActivity 数据模型

**Files:**
- Modify: `prisma/schema.prisma:71-96`
- Create: `prisma/migrations/20260723120000_world_activity/migration.sql`
- Create: `src/lib/world-activity/schema.test.ts`

- [ ] **Step 1: 写模型与级联行为失败测试**

```ts
// src/lib/world-activity/schema.test.ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("事件和动态归属 timeline 并由 timeline 级联删除", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  expect(schema).toContain("model WorldEvent");
  expect(schema).toContain("model WorldActivity");
  expect(schema).toMatch(/worldEvents\s+WorldEvent\[\]/);
  expect(schema).toMatch(/worldActivities\s+WorldActivity\[\]/);
  expect(schema.match(/onDelete: Cascade/g)?.length).toBeGreaterThan(1);
});
```

- [ ] **Step 2: 运行测试确认模型不存在**

Run:

```bash
pnpm test -- src/lib/world-activity/schema.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 添加模型**

```prisma
model Timeline {
  // 现有字段
  worldEvents     WorldEvent[]
  worldActivities WorldActivity[]
}

model WorldEvent {
  id               String    @id
  timelineId       String    @map("timeline_id")
  timeline         Timeline  @relation(fields: [timelineId], references: [id], onDelete: Cascade)
  kind             String
  title            String
  summary          String    @db.Text
  phase            String
  visibility       String
  participantIds   String[]  @map("participant_ids")
  originMessageId  String    @map("origin_message_id")
  originActivityId String?   @map("origin_activity_id")
  latestMessageId  String    @map("latest_message_id")
  parentEventId    String?   @map("parent_event_id")
  parentEvent      WorldEvent? @relation("EventChildren", fields: [parentEventId], references: [id], onDelete: SetNull)
  childEvents      WorldEvent[] @relation("EventChildren")
  activities       WorldActivity[]
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")
  resolvedAt       DateTime? @map("resolved_at")

  @@index([timelineId, phase, updatedAt])
  @@map("world_events")
}

model WorldActivity {
  id              String      @id
  timelineId      String      @map("timeline_id")
  timeline        Timeline    @relation(fields: [timelineId], references: [id], onDelete: Cascade)
  eventId         String?     @map("event_id")
  event           WorldEvent? @relation(fields: [eventId], references: [id], onDelete: SetNull)
  recordType      String      @map("record_type")
  kind            String
  text            String      @db.Text
  visibility      String
  actorId         String?     @map("actor_id")
  targetIds       String[]    @map("target_ids")
  subjectIds      String[]    @map("subject_ids")
  sourceMessageId String      @map("source_message_id")
  eraLabel        String      @map("era_label")
  timeLabel       String      @map("time_label")
  createdAt       DateTime    @default(now()) @map("created_at")

  @@index([timelineId, createdAt])
  @@index([eventId, createdAt])
  @@map("world_activities")
}
```

Migration 使用等价 PostgreSQL DDL，所有数组设 `DEFAULT ARRAY[]::TEXT[]`，外键 timeline 设 `ON DELETE CASCADE`，event 设 `ON DELETE SET NULL`。

- [ ] **Step 4: 验证 schema 并提交**

Run:

```bash
pnpm prisma validate
pnpm prisma generate
pnpm test -- src/lib/world-activity/schema.test.ts
```

Expected: PASS。

```bash
git add prisma/schema.prisma prisma/migrations/20260723120000_world_activity/migration.sql src/lib/world-activity/schema.test.ts
git commit -m "feat: add world event and activity storage"
```

### Task 9: 扩展同一次 Narrator META 的世界行动契约

**Files:**
- Create: `src/lib/world-activity/contracts.ts`
- Create: `src/lib/world-activity/contracts.test.ts`
- Modify: `src/lib/chat/continuous-meta.ts`
- Modify: `src/lib/chat/continuous-meta.test.ts`
- Modify: `src/lib/prompts/narrator.ts`
- Modify: `src/lib/prompts/narrator.test.ts`

- [ ] **Step 1: 写严格契约与提示词失败测试**

```ts
// src/lib/world-activity/contracts.test.ts
import { describe, expect, it } from "vitest";
import { WorldActivityMetaSchema } from "./contracts";

describe("WorldActivityMetaSchema", () => {
  it("限制每轮最多三条行动和三条动态", () => {
    const value = validActivityMeta();
    value.worldActions = Array.from({ length: 4 }, () => validWorldAction());
    expect(() => WorldActivityMetaSchema.parse(value)).toThrow();
  });

  it("拒绝任意字段和普通动态伪装重大事件", () => {
    expect(() => WorldActivityMetaSchema.parse({
      ...validActivityMeta(),
      activityEntries: [{ ...validActivity(), importance: "major", sql: "x" }],
    })).toThrow();
  });
});
```

提示词测试断言包含：只推进正文/关注事件/近期冲突相关者、`consequence` 不直接改数据库、只能推进上下文提供的 event ID、不可生成无关新闻、每轮仍是一个 META。

- [ ] **Step 2: 运行测试确认契约缺失**

Run:

```bash
pnpm test -- src/lib/world-activity/contracts.test.ts src/lib/chat/continuous-meta.test.ts src/lib/prompts/narrator.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现严格 Zod 契约**

```ts
// src/lib/world-activity/contracts.ts
import { z } from "zod";

export const ActivityVisibilitySchema = z.enum(["public", "player_known", "hidden"]);
export const WorldActionSchema = z.object({
  actorType: z.enum(["god", "entity"]),
  actorId: z.string().min(1),
  action: z.string().trim().min(1).max(500),
  targetIds: z.array(z.string().min(1)).max(8),
  visibility: ActivityVisibilitySchema,
  consequence: z.string().trim().min(1).max(1000),
}).strict();
export const ActivityEntrySchema = z.object({
  kind: z.enum(["movement", "rumor", "omen", "meeting", "relation", "conflict", "discovery"]),
  text: z.string().trim().min(1).max(1000),
  subjectIds: z.array(z.string().min(1)).min(1).max(12),
  visibility: ActivityVisibilitySchema,
  importance: z.literal("normal"),
}).strict();
export const ImportantEventMutationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"), tempRef: z.string().min(1).max(80),
    kind: z.enum(["war", "conspiracy", "disaster", "religious_conflict", "faction_shift", "world_crisis"]),
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(2000),
    phase: z.enum(["emerging", "escalating"]),
    participantIds: z.array(z.string()).min(1).max(30),
    visibility: ActivityVisibilitySchema,
    progressText: z.string().trim().min(1).max(1000),
    originActivityId: z.string().optional(),
  }).strict(),
  z.object({
    operation: z.literal("advance"), eventId: z.string().min(1),
    phase: z.enum(["emerging", "developing", "escalating", "resolved"]),
    summary: z.string().trim().min(1).max(2000),
    participantIds: z.array(z.string()).min(1).max(30),
    visibility: ActivityVisibilitySchema,
    progressText: z.string().trim().min(1).max(1000),
  }).strict(),
]);
export const WorldActivityMetaSchema = z.object({
  worldActions: z.array(WorldActionSchema).max(3).default([]),
  activityEntries: z.array(ActivityEntrySchema).max(3).default([]),
  importantEventMutation: ImportantEventMutationSchema.optional(),
}).strict();
```

- [ ] **Step 4: 合并到连续 META 和 Narrator JSON 示例**

`ContinuousNarratorMetaSchema` 增加三个字段，`emptyContinuousMeta()` 返回空数组；`splitMetaBlock()` 继续只解析一个 `<<<META ... META>>>`。Narrator 示例 JSON 增加：

```json
{"world_actions":[],"activity_entries":[],"important_event_mutation":null}
```

明确要求正文自然体现行动后果，但 META 中所有状态变化仍受服务端校验；不创建第二次 backstage 调用。

- [ ] **Step 5: 运行测试并提交**

Run:

```bash
pnpm test -- src/lib/world-activity/contracts.test.ts src/lib/chat/continuous-meta.test.ts src/lib/prompts/narrator.test.ts
```

Expected: PASS。

```bash
git add src/lib/world-activity/contracts.ts src/lib/world-activity/contracts.test.ts src/lib/chat/continuous-meta.ts src/lib/chat/continuous-meta.test.ts src/lib/prompts/narrator.ts src/lib/prompts/narrator.test.ts
git commit -m "feat: add same-turn world activity contract"
```

### Task 10: 在正文事务中校验并写入动态

**Files:**
- Create: `src/lib/world-activity/apply.ts`
- Create: `src/lib/world-activity/apply.test.ts`
- Create: `src/lib/world-activity/apply.integration.test.ts`
- Modify: `src/lib/chat/finalize.ts`
- Modify: `src/lib/chat/finalize.test.ts`

- [ ] **Step 1: 写逐项过滤、事件原子性和重放测试**

```ts
// src/lib/world-activity/apply.test.ts
it("保留合法动态并逐项拒绝跨现实 subject", async () => {
  const result = await applyWorldActivityInTransaction(tx, baseInput({
    activityEntries: [
      activity({ subjectIds: ["entity-in-timeline"] }),
      activity({ subjectIds: ["entity-other-timeline"] }),
    ],
  }));
  expect(result.acceptedActivities).toBe(1);
  expect(result.rejectedActivities).toBe(1);
  expect(tx.worldActivity.create).toHaveBeenCalledTimes(1);
});

it("同一 generation 重放不重复写动态或推进事件", async () => {
  await applyWorldActivityInTransaction(tx, baseInput());
  await applyWorldActivityInTransaction(tx, baseInput());
  expect(uniqueActivityIds(tx)).toEqual([
    "activity:gen-1:action:0", "activity:gen-1:activity:0", "activity:gen-1:event:0",
  ]);
});
```

Integration test 强制 `worldActivity.create` 后抛错，断言 Narrator message、时间更新和所有动态均回滚。

- [ ] **Step 2: 运行测试确认 apply 模块不存在**

Run:

```bash
pnpm test -- src/lib/world-activity/apply.test.ts src/lib/chat/finalize.test.ts
pnpm test:integration -- src/lib/world-activity/apply.integration.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现现实成员索引和稳定 ID**

```ts
const stableActivityId = (
  generationId: string,
  type: "action" | "activity" | "event",
  index: number,
) => `activity:${generationId}:${type}:${index}`;
const stableEventId = (generationId: string) => `event:${generationId}:0`;
```

一次查询当前 Timeline 的 God、Entity 和可推进未解决事件，分别校验 actor 类型、target/subject/participant 归属。行动和普通动态用独立循环逐项过滤；重要事件先完整验证，再一次 create/update 加一条 `event_progress`。`create` 只接受本轮合法 activity 的稳定 ID 作为 `originActivityId`，`advance` 只接受 Context Builder 下发过且仍未解决的 event ID。

返回：

```ts
type WorldActivityApplyResult = {
  acceptedActions: number;
  rejectedActions: number;
  acceptedActivities: number;
  rejectedActivities: number;
  eventMutationAccepted: boolean;
};
```

- [ ] **Step 4: 接入 finalizer 原子顺序**

在现有事务中按以下顺序调用：玩家消息 → Narrator 消息 → 时间/安全轻变化 → `applyWorldActivityInTransaction` → settlement policy → durable completion。把接受/拒绝计数写入 Narrator 私有 meta 的 `activityApply`，UI 不显示拒绝细节。`retroactive_rewrite` 分支不调用 activity apply，保证源现实零写入。

- [ ] **Step 5: 运行测试并提交**

Run:

```bash
pnpm test -- src/lib/world-activity/apply.test.ts src/lib/chat/finalize.test.ts
pnpm test:integration -- src/lib/world-activity/apply.integration.test.ts
```

Expected: PASS。

```bash
git add src/lib/world-activity/apply.ts src/lib/world-activity/apply.test.ts src/lib/world-activity/apply.integration.test.ts src/lib/chat/finalize.ts src/lib/chat/finalize.test.ts
git commit -m "feat: apply world activity atomically"
```

### Task 11: 实现双模式动态投影与查询 API

**Files:**
- Create: `src/lib/world-activity/projection.ts`
- Create: `src/lib/world-activity/projection.test.ts`
- Create: `src/app/api/worlds/[id]/activities/route.ts`
- Create: `src/app/api/worlds/[id]/activities/route.test.ts`
- Modify: `src/lib/reality/visibility.ts`
- Modify: `src/lib/reality/visibility.test.ts`

- [ ] **Step 1: 写 Pantheon/Creator 可见性矩阵测试**

```ts
// src/lib/world-activity/projection.test.ts
it.each([
  ["pantheon", "limited", ["public", "player_known"]],
  ["creator", "limited", ["public", "player_known"]],
  ["creator", "omniscient", ["public", "player_known", "hidden"]],
])("%s/%s 只下发允许的动态", (mode, viewpoint, expected) => {
  const projected = projectWorldActivity(rows, viewer(mode, viewpoint));
  expect(projected.activities.map((item) => item.visibility)).toEqual(expected);
});

it("Creator 全知对 hidden 标记世界内尚未知晓", () => {
  const hidden = projectWorldActivity(rows, viewer("creator", "omniscient"))
    .activities.find((item) => item.visibility === "hidden");
  expect(hidden?.knowledgeLabel).toBe("世界内尚未知晓");
});
```

- [ ] **Step 2: 运行测试确认 projection 和 route 不存在**

Run:

```bash
pnpm test -- src/lib/world-activity/projection.test.ts src/app/api/worlds/[id]/activities/route.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现服务端投影**

```ts
export type ProjectedActivity = {
  id: string;
  eventId: string | null;
  recordType: "action" | "activity" | "event_progress";
  kind: string;
  text: string;
  visibility: "public" | "player_known" | "hidden";
  subjectIds: string[];
  eraLabel: string;
  timeLabel: string;
  createdAt: string;
  knowledgeLabel?: "世界内尚未知晓";
};
```

Pantheon 和 Creator limited 在数据库查询后再次过滤 hidden，防止序列化泄漏；Creator omniscient 保留全部并给 hidden 加 `knowledgeLabel`。未通过投影的 actor/target/subject ID 也不得进入 JSON。

- [ ] **Step 4: 实现动态 GET Route Handler**

`GET /api/worlds/:id/activities?before=<iso>&limit=30`：

- 验证本地 owner、活动 Timeline；
- limit 限制 1–50；
- 返回 `focusedEvent`、未解决 `importantEvents`、倒序 `recentActivities`、`nextCursor`；
- 当前关注优先，其余事件按 `updatedAt DESC`；
- 已解决事件仍可读但不可推进；
- Route Handler `export const dynamic = "force-dynamic"`。

- [ ] **Step 5: 运行测试并提交**

Run:

```bash
pnpm test -- src/lib/world-activity/projection.test.ts src/lib/reality/visibility.test.ts src/app/api/worlds/[id]/activities/route.test.ts
```

Expected: PASS，响应 JSON 中 Pantheon 不出现 hidden 文本或 ID。

```bash
git add src/lib/world-activity/projection.ts src/lib/world-activity/projection.test.ts src/app/api/worlds/[id]/activities/route.ts src/app/api/worlds/[id]/activities/route.test.ts src/lib/reality/visibility.ts src/lib/reality/visibility.test.ts
git commit -m "feat: project world activity by viewer"
```

### Task 12: 添加独立“动态”符文和近期动态界面

**Files:**
- Create: `src/components/play/WorldActivityPanel.tsx`
- Create: `src/components/play/WorldActivityPanel.test.tsx`
- Modify: `src/components/play/reality-tree-state.ts`
- Modify: `src/components/play/reality-tree-state.test.ts`
- Modify: `src/components/play/RuneRail.tsx`
- Modify: `src/components/play/PlayDrawer.tsx`
- Modify: `src/components/play/types.ts`
- Modify: `src/app/play/[worldId]/page.tsx`

- [ ] **Step 1: 写页签与对象跳转失败测试**

```ts
// 追加到 src/components/play/reality-tree-state.test.ts
it("两种模式都把动态作为独立符文", () => {
  expect(drawerTabsForMode("pantheon").map((item) => item.tab)).toContain("activity");
  expect(drawerTabsForMode("creator").map((item) => item.tab)).toContain("activity");
});
```

```tsx
// src/components/play/WorldActivityPanel.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorldActivityPanelView } from "./WorldActivityPanel";

it("渲染三组动态并把对象 ID 编码为本地跳转目标", () => {
  const html = renderToStaticMarkup(
    <WorldActivityPanelView
      data={activityFixture()}
      onOpenEntity={() => undefined}
      onSelectEvent={() => undefined}
    />,
  );
  expect(html).toContain("当前关注");
  expect(html).toContain("重要事件");
  expect(html).toContain("近期动态");
  expect(html).toContain('data-entity-id="entity-1"');
  expect(html).toContain('data-event-id="event-1"');
  expect(html).not.toContain("/api/chat");
});
```

将组件拆为负责 fetch 的 `WorldActivityPanel` 和无副作用的 `WorldActivityPanelView`。对象按钮只调用 `onOpenEntity(id)`；事件按钮只调用 `onSelectEvent(id)` 打开本地详情，不触发聊天或模型请求。

- [ ] **Step 2: 运行测试确认页签不存在**

Run:

```bash
pnpm test -- src/components/play/reality-tree-state.test.ts src/components/play/WorldActivityPanel.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 加入 DrawerTab 和动态符文**

```ts
export type ModeDrawerTab =
  | "activity" | "starmap" | "chronicle" | "god"
  | "creator" | "realities" | "lore" | "codex";
```

两种 tab 表都加入：

```ts
{ tab: "activity", glyph: "◌", label: "动态", title: "◌ 世界动态" }
```

`RuneRail` 接收 `unreadActivityCount`，只显示一个小金点或 `9+`，不改变任何世界可见性。

- [ ] **Step 4: 实现按需查询和实体跳转**

`WorldActivityPanel` 打开时 fetch activities；近期动态按“世界名 + 纪元 + 时间”语境显示时间，不显示章节。subject 点击调用页面已有 `drawerEntityId` 跳到 `codex`；God ID 跳到 `god`/星图的既有定位能力，未知或被投影移除的 ID 不渲染链接。

`PlayDrawer` 增加：

```tsx
tab === "activity" ? (
  <WorldActivityPanel
    worldId={world.id}
    timelineId={timeline.id}
    onOpenEntity={onOpenEntity}
  />
) : /* 现有面板 */
```

- [ ] **Step 5: 运行测试、lint 并提交**

Run:

```bash
pnpm test -- src/components/play/reality-tree-state.test.ts src/components/play/WorldActivityPanel.test.tsx
pnpm lint
```

Expected: PASS。

```bash
git add src/components/play/WorldActivityPanel.tsx src/components/play/WorldActivityPanel.test.tsx src/components/play/reality-tree-state.ts src/components/play/reality-tree-state.test.ts src/components/play/RuneRail.tsx src/components/play/PlayDrawer.tsx src/components/play/types.ts src/app/play/[worldId]/page.tsx
git commit -m "feat: add standalone world activity drawer"
```

---

## Phase 3：持续重要事件与单一关注

### Task 13: 持久化单一关注事件并提供替换/取消 API

**Files:**
- Modify: `src/lib/reality/schemas.ts`
- Modify: `src/lib/reality/schemas.test.ts`
- Create: `src/app/api/worlds/[id]/events/[eventId]/focus/route.ts`
- Create: `src/app/api/worlds/[id]/events/[eventId]/focus/route.test.ts`
- Modify: `src/app/api/worlds/[id]/state/route.ts`
- Modify: `src/components/play/types.ts`

- [ ] **Step 1: 先保护用户改动并写失败测试**

Run:

```bash
git diff -- src/lib/reality/schemas.ts src/lib/reality/schemas.test.ts
```

Expected: 显示计划开始前的用户修改；保存该输出用于提交前对照。

```ts
// 追加到 schemas.test.ts
it("旧 ObserverState 缺少 focusedEventId 时补 null", () => {
  expect(ObserverStateSchema.parse(oldObserverState()).focusedEventId).toBeNull();
});
```

Route test 覆盖：关注未解决当前现实事件返回 200；关注第二条会原子替换第一条；DELETE 清空；跨现实和 resolved 返回 409。

- [ ] **Step 2: 运行测试确认字段/API 缺失**

Run:

```bash
pnpm test -- src/lib/reality/schemas.test.ts src/app/api/worlds/[id]/events/[eventId]/focus/route.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 以最小 hunk 扩展 ObserverState**

```ts
export const ObserverStateSchema = z.object({
  // 现有字段保持不变
  focusedEventId: z.string().min(1).nullable().default(null),
}).strict();
```

`initialObserverState()` 明确返回 `focusedEventId: null`。不要重排或格式化用户在该文件中的其他代码。

- [ ] **Step 4: 实现 focus Route Handler**

PUT 在事务中读取活动 timeline、解析 observerState、验证 `event.timelineId === activeTimelineId && resolvedAt === null`，然后只更新 JSON 中 `focusedEventId`。DELETE 仅当 path eventId 与当前关注一致时清空，重复 DELETE 幂等成功。响应返回 `{ focusedEventId }`，不调用 LLM、不生成正文、不改变时间。

- [ ] **Step 5: 测试并只暂存本任务 hunk**

Run:

```bash
pnpm test -- src/lib/reality/schemas.test.ts src/app/api/worlds/[id]/events/[eventId]/focus/route.test.ts src/app/api/worlds/[id]/state/route.test.ts
git diff -- src/lib/reality/schemas.ts src/lib/reality/schemas.test.ts
```

Expected: PASS；diff 同时保留用户原改动和本任务小补丁。

```bash
git add -p src/lib/reality/schemas.ts src/lib/reality/schemas.test.ts
git add src/app/api/worlds/[id]/events/[eventId]/focus/route.ts src/app/api/worlds/[id]/events/[eventId]/focus/route.test.ts src/app/api/worlds/[id]/state/route.ts src/components/play/types.ts
git diff --cached --check
git commit -m "feat: track one focused world event"
```

### Task 14: Context Builder 优先注入关注事件和当前相关者

**Files:**
- Create: `src/lib/world-activity/context.ts`
- Create: `src/lib/world-activity/context.test.ts`
- Modify: `src/lib/context/builder.ts`
- Modify: `src/lib/context/builder.test.ts`

- [ ] **Step 1: 写选择优先级与信息边界失败测试**

```ts
// src/lib/world-activity/context.test.ts
it("关注事件优先于普通近期动态且只出现一次", () => {
  const selected = selectWorldActivityContext({
    focusedEventId: "event-focus",
    currentSubjectIds: ["entity-scene"],
    events,
    activities,
    budget: { events: 3, activities: 8 },
  });
  expect(selected.events[0].id).toBe("event-focus");
  expect(selected.events.filter((item) => item.id === "event-focus")).toHaveLength(1);
});

it("Pantheon 上下文不注入 hidden 动态", () => {
  expect(selectWorldActivityContext(pantheonInput).activities)
    .not.toContainEqual(expect.objectContaining({ visibility: "hidden" }));
});
```

- [ ] **Step 2: 运行测试确认 context 模块不存在**

Run:

```bash
pnpm test -- src/lib/world-activity/context.test.ts src/lib/context/builder.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现确定性相关性排序**

排序分数：

```ts
focused event: +100
正文/场景 subject 交集: +40
未解决事件: +20
最近一次更新: 同分时 updatedAt DESC
稳定兜底: id ASC
```

最多注入 3 个事件、8 条活动；当前事件参与者优先。普通动态一次性仅作为近期依据，不变成永久事实；`action.consequence` 是后续叙事依据但不能转成任意 DB 修改。

- [ ] **Step 4: 接入 Builder 的动态 system block**

```ts
const worldActivityContext = await buildWorldActivityContext({
  timelineId: chapter.timeline.id,
  mode: world.mode,
  observerState,
  currentSubjectIds,
});
messages.push({
  role: "system",
  content: `CURRENT WORLD ACTIVITY\n${JSON.stringify(worldActivityContext)}`,
  cacheScope: "dynamic",
});
```

只给模型可推进的重要事件 ID；Creator omniscient 可看到 hidden 并带“世界内尚未知晓”，Pantheon/limited 不注入 hidden。关注提高权重但不强制正文切到该事件。

- [ ] **Step 5: 运行测试并提交**

Run:

```bash
pnpm test -- src/lib/world-activity/context.test.ts src/lib/context/builder.test.ts
```

Expected: PASS。

```bash
git add src/lib/world-activity/context.ts src/lib/world-activity/context.test.ts src/lib/context/builder.ts src/lib/context/builder.test.ts
git commit -m "feat: prioritize focused events in narration context"
```

### Task 15: 完成重要事件详情、关注交互和未读状态

**Files:**
- Create: `src/components/play/world-activity-panel-state.ts`
- Create: `src/components/play/world-activity-panel-state.test.ts`
- Modify: `src/components/play/WorldActivityPanel.tsx`
- Modify: `src/components/play/WorldActivityPanel.test.tsx`
- Modify: `src/components/play/RuneRail.tsx`
- Modify: `src/app/play/[worldId]/page.tsx`

- [ ] **Step 1: 写追踪、替换、取消和未读测试**

```ts
// src/components/play/world-activity-panel-state.test.ts
import { expect, it } from "vitest";
import { buildFocusMutation, countUnreadActivities } from "./world-activity-panel-state";

it("关注另一事件时要求替换确认且只构造 focus PUT", () => {
  expect(buildFocusMutation({
    worldId: "world-1",
    currentFocusedEventId: "event-a",
    requestedEventId: "event-b",
    confirmedReplacement: false,
  })).toEqual({ kind: "confirm_replace", replacingEventId: "event-a" });

  expect(buildFocusMutation({
    worldId: "world-1",
    currentFocusedEventId: "event-a",
    requestedEventId: "event-b",
    confirmedReplacement: true,
  })).toEqual({
    kind: "request",
    url: "/api/worlds/world-1/events/event-b/focus",
    method: "PUT",
  });
});

it("未读只统计服务端已投影且晚于本地游标的动态", () => {
  expect(countUnreadActivities(projectedActivities, { createdAt: cursorTime, id: cursorId })).toBe(2);
});
```

`WorldActivityPanel.test.tsx` 使用 `renderToStaticMarkup` 断言 resolved 事件无追踪按钮、当前关注显示“取消追踪”、其他事件显示“替换当前关注”。纯函数测试另测取消操作构造 DELETE、打开动态页后游标移动到最新记录、新 `sourceMessageId` 活动到达时 unread 增加。

- [ ] **Step 2: 运行测试确认交互未实现**

Run:

```bash
pnpm test -- src/components/play/world-activity-panel-state.test.ts src/components/play/WorldActivityPanel.test.tsx
```

Expected: FAIL。

- [ ] **Step 3: 实现事件详情和单一关注交互**

详情展示 title、phase、summary、participant links 和按时间排序的 `event_progress`。按钮文案固定为：

- 未关注且无当前关注：“追踪此事件”
- 已有其他关注：“替换当前关注”
- 当前关注：“取消追踪”
- resolved：“事件已结束”

PUT/DELETE 成功后只刷新 state 和 activities，不调用 chat、不立即生成、不切现场。

- [ ] **Step 4: 实现本地未读游标**

以 `worldId:timelineId` 为 key 在 `localStorage` 保存最后打开动态页的 `createdAt/id` 游标。未读只比较已投影到浏览器的记录；hidden 未下发时不能计数。切换现实使用独立游标，打开页签后清零。

- [ ] **Step 5: 运行测试、lint 并提交**

Run:

```bash
pnpm test -- src/components/play/world-activity-panel-state.test.ts src/components/play/WorldActivityPanel.test.tsx
pnpm lint
```

Expected: PASS。

```bash
git add src/components/play/world-activity-panel-state.ts src/components/play/world-activity-panel-state.test.ts src/components/play/WorldActivityPanel.tsx src/components/play/WorldActivityPanel.test.tsx src/components/play/RuneRail.tsx src/app/play/[worldId]/page.tsx
git commit -m "feat: add focused event interactions"
```

---

## Phase 4：世界整理、现实克隆与存档兼容

### Task 16: 世界整理深度推进、合并和派生重要事件

**Files:**
- Modify: `src/lib/prompts/settlement.ts`
- Modify: `src/lib/prompts/settlement.test.ts`
- Modify: `src/lib/settle/pipeline.ts`
- Modify: `src/lib/settle/pipeline.integration.test.ts`
- Create: `src/lib/world-activity/settlement.ts`
- Create: `src/lib/world-activity/settlement.test.ts`

- [ ] **Step 1: 写深度整理契约和幂等失败测试**

```ts
// src/lib/world-activity/settlement.test.ts
it("把重复普通动态合并为一次事件进展", () => {
  const result = normalizeSettlementActivity({
    mergeActivityIds: ["activity-a", "activity-b"],
    eventMutations: [advanceEvent("event-war", "developing")],
  }, knownIds);
  expect(result.mergedActivities).toEqual(["activity-a", "activity-b"]);
  expect(result.eventMutations).toHaveLength(1);
});

it("事件解决时清空 ObserverState 的当前关注", async () => {
  await applySettlementActivity(tx, settlementResolving("event-war"));
  expect(readObserver(tx).focusedEventId).toBeNull();
});
```

- [ ] **Step 2: 运行测试确认整理尚不处理活动**

Run:

```bash
pnpm test -- src/lib/world-activity/settlement.test.ts src/lib/prompts/settlement.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 扩展同一次 settlement 输出**

在现有 settlement 结构中增加：

```ts
worldActivity: {
  mergeActivityIds: string[];
  eventMutations: Array<
    | { operation: "create"; sourceActivityIds: string[]; kind: EventKind;
        title: string; summary: string; phase: "emerging" | "escalating";
        participantIds: string[]; visibility: ActivityVisibility }
    | { operation: "advance"; eventId: string; phase: EventPhase;
        summary: string; participantIds: string[]; visibility: ActivityVisibility;
        progressText: string }
    | { operation: "derive"; parentEventId: string; title: string; kind: EventKind;
        summary: string; participantIds: string[]; visibility: ActivityVisibility }
  >;
}
```

只提供检查点内活动和未解决事件 ID；模型可把重复动态合并、将多条相关普通动态升级、解决或派生事件，不得按标题猜 ID。

- [ ] **Step 4: 在 settlement 幂等步骤中应用**

把 `worldActivity` 应用放在 `chronicle` 后、`snapshot` 前，使用 `settlement:<chapterId>:<index>` 稳定 ID。冻结现实检查和世界租约检查继续包围每个写步骤。解决事件设置 `resolvedAt` 并清除等于该 ID 的 `focusedEventId`；派生事件写 `parentEventId`。

- [ ] **Step 5: 运行测试并提交**

Run:

```bash
pnpm test -- src/lib/world-activity/settlement.test.ts src/lib/prompts/settlement.test.ts
pnpm test:integration -- src/lib/settle/pipeline.integration.test.ts
```

Expected: PASS；断点重跑不会重复合并或派生。

```bash
git add src/lib/world-activity/settlement.ts src/lib/world-activity/settlement.test.ts src/lib/prompts/settlement.ts src/lib/prompts/settlement.test.ts src/lib/settle/pipeline.ts src/lib/settle/pipeline.integration.test.ts
git commit -m "feat: deepen world events during settlement"
```

### Task 17: 现实分叉完整复制事件、动态和关注引用

**Files:**
- Create: `src/lib/world-activity/clone.ts`
- Create: `src/lib/world-activity/clone.test.ts`
- Modify: `src/lib/reality/clone.ts`
- Modify: `src/lib/reality/clone.integration.test.ts`
- Modify: `src/lib/reality/task-runner.ts`
- Modify: `src/lib/reality/tree.integration.test.ts`

- [ ] **Step 1: 写完整 ID 重映射和冻结守卫失败测试**

```ts
// src/lib/world-activity/clone.test.ts
it("重映射事件、父事件、动态、参与者、来源消息和关注事件", () => {
  const cloned = remapWorldActivityGraph(source, maps);
  expect(cloned.events[1].parentEventId).toBe(maps.event.get("event-parent"));
  expect(cloned.activities[0].eventId).toBe(maps.event.get("event-child"));
  expect(cloned.activities[0].sourceMessageId).toBe(maps.message.get("message-old"));
  expect(cloned.observerState.focusedEventId).toBe(maps.event.get("event-child"));
});
```

Integration test 从非活动现实调用事件推进，断言抛出“该现实已被冻结”且事件未改变。

- [ ] **Step 2: 运行测试确认 clone maps 不含活动**

Run:

```bash
pnpm test -- src/lib/world-activity/clone.test.ts
pnpm test:integration -- src/lib/reality/clone.integration.test.ts src/lib/reality/tree.integration.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 扩展 TimelineCloneMaps**

```ts
export type TimelineCloneMaps = {
  // 现有 maps
  event: Map<string, string>;
  activity: Map<string, string>;
};
```

预先为所有 source event/activity 分配新 cuid；先复制 event（parent 暂空），再回填 parent/originActivity，最后复制 activity。participant/actor/target/subject 根据 God/Entity map；source/latest/origin message 根据 Message map；无法映射的外部引用必须使克隆事务失败，不得静默保留旧现实 ID。

- [ ] **Step 4: 接入追溯路径和新现实整理**

`cloneTimelineGraph()` 同一事务复制图并将 observerState.focusedEventId 映射到新事件。源现实不写新正文/动态；新现实 rewrite 结果写入后由 Task 16 整理校正事件。所有事件推进入口先验证 `world.activeTimelineId === timelineId`。

- [ ] **Step 5: 运行测试并提交**

Run:

```bash
pnpm test -- src/lib/world-activity/clone.test.ts
pnpm test:integration -- src/lib/reality/clone.integration.test.ts src/lib/reality/task-runner.integration.test.ts src/lib/reality/tree.integration.test.ts
```

Expected: PASS。

```bash
git add src/lib/world-activity/clone.ts src/lib/world-activity/clone.test.ts src/lib/reality/clone.ts src/lib/reality/clone.integration.test.ts src/lib/reality/task-runner.ts src/lib/reality/tree.integration.test.ts
git commit -m "feat: clone world activity across realities"
```

### Task 18: 存档升级到 version 4 并兼容旧世界

**Files:**
- Modify: `src/app/api/worlds/[id]/export/route.ts`
- Modify: `src/app/api/worlds/[id]/export/route.test.ts`
- Modify: `src/app/api/worlds/import/route.ts`
- Modify: `src/app/api/worlds/import/route.test.ts`

- [ ] **Step 1: 写 version 4、隐藏动态保留和旧版兼容测试**

```ts
// export route test
it("version 4 保留 owner-private hidden 动态但排除任务私有输出", async () => {
  const archive = await exportArchive();
  expect(archive.version).toBe(4);
  expect(archive.world.timelines[0].worldActivities)
    .toContainEqual(expect.objectContaining({ visibility: "hidden" }));
  expect(JSON.stringify(archive)).not.toContain("outputSnapshot");
  expect(JSON.stringify(archive)).not.toContain("leaseToken");
  expect(JSON.stringify(archive)).not.toContain("safeError");
});
```

Import tests 覆盖 version 2/3 自动补 `worldEvents: []`、`worldActivities: []`、`focusedEventId: null`；version 4 事件链和所有引用换新 ID；跨现实引用拒绝。

- [ ] **Step 2: 运行测试确认仍是 version 3**

Run:

```bash
pnpm test -- src/app/api/worlds/[id]/export/route.test.ts src/app/api/worlds/import/route.test.ts
```

Expected: FAIL，导出版本为 3 或 schema 不识别动态。

- [ ] **Step 3: 升级导出格式**

导出 payload：

```ts
{
  version: 4,
  exportedAt: new Date().toISOString(),
  world: projectVersionFourWorld(world),
}
```

每条 Timeline 包含 `worldEvents` 和 `worldActivities`；owner-private 存档保留 hidden。GenerationRequest 不加入导出 include，因此租约、内部错误、私有模型输出都不会进入 JSON。

- [ ] **Step 4: 实现 v4 校验和全局 ID 重映射**

Import schema 允许 `version: z.union([z.literal(2), z.literal(3), z.literal(4)])`。为 event/activity 建 Map 并加入 `allIdMap`；先创建 timeline/message/entity/god，再 event，最后 activity；重映射 parentEventId、originActivityId、eventId、participantIds、actorId、targetIds、subjectIds、source/latest/origin message 和 focusedEventId。v2/v3 使用空集合且不调用 LLM 回填。

- [ ] **Step 5: 运行测试并提交**

Run:

```bash
pnpm test -- src/app/api/worlds/[id]/export/route.test.ts src/app/api/worlds/import/route.test.ts
```

Expected: PASS。

```bash
git add src/app/api/worlds/[id]/export/route.ts src/app/api/worlds/[id]/export/route.test.ts src/app/api/worlds/import/route.ts src/app/api/worlds/import/route.test.ts
git commit -m "feat: archive world activity graphs"
```

### Task 19: 完整回归、文档同步和用户修改保护

**Files:**
- Modify: `docs/03-数据模型.md`
- Modify: `docs/04-AI系统设计.md`
- Modify: `docs/05-API设计.md`
- Modify: `docs/06-前端设计.md`
- Modify: `docs/07-开发路线图.md`
- Verify: all files changed by Tasks 1–18

- [ ] **Step 1: 更新设计文档中的真实实现**

文档必须明确：

- `Chapter` 仍是内部检查点，游戏 UI 无章节；
- 每轮只有一次 Narrator 调用；
- `GenerationRequest` 的 `reserved → context_ready → generating → output_stored → applying → completed`；
- `WorldEvent` / `WorldActivity` 字段、级联删除和稳定 ID；
- activities/focus API 与统一 `TaskProgressEvent`；
- Pantheon、Creator limited、Creator omniscient 的投影矩阵；
- version 4 存档和 v2/v3 空动态兼容；
- 标题继续使用“世界名 + 纪元 + 时间”。

- [ ] **Step 2: 运行全部单元与集成测试**

Run:

```bash
pnpm test
pnpm test:integration
```

Expected: 所有测试 PASS，无 hanging SSE 测试、无重复动态、无第二次 LLM 调用。

- [ ] **Step 3: 运行静态检查和生产构建**

Run:

```bash
pnpm prisma validate
pnpm lint
pnpm build
```

Expected: Prisma valid；lint 无 error；Next.js 16 production build 成功。

- [ ] **Step 4: 执行关键手工验收**

1. 新世界进入游玩页，opening 正文在创世就绪动画期间已开始生成，动画结束时正文已部分或大部分可读。
2. 发送一次输入，状态条按真实步骤推进；浏览器断网再恢复，阶段从 durable 状态继续。
3. 在 `output_stored` 后模拟数据库失败，正文预览保留并标“尚未写入世界”；点击“从此处重试”后不产生第二次 LLM 请求。
4. 打开动态符文，Pantheon 看不到 hidden；Creator 全知可见且标“世界内尚未知晓”。
5. 追踪一个事件，再追踪另一个时出现替换确认；追踪后不立即生成正文。
6. 推进几轮后事件产生连续进展；世界整理可升级、解决或派生事件。
7. 现实分叉后源现实不变，新现实事件/动态/关注 ID 全部属于新 Timeline。
8. 导出再导入 version 4 后事件链一致；导入 version 3 后动态为空但可继续游玩。

- [ ] **Step 5: 检查用户原有修改未被覆盖**

Run:

```bash
git status --short
git diff -- src/lib/prompts/rewrite.test.ts src/lib/prompts/rewrite.ts src/lib/reality/apply.integration.test.ts src/lib/reality/apply.ts src/lib/reality/schemas.test.ts src/lib/reality/schemas.ts
git diff --cached --check
```

Expected: 四个 rewrite/apply 文件的用户修改仍完整；schemas 两个文件只额外包含本计划的 focusedEventId hunk；无意外整文件格式化。

- [ ] **Step 6: 提交文档与最终修正**

```bash
git add docs/03-数据模型.md docs/04-AI系统设计.md docs/05-API设计.md docs/06-前端设计.md docs/07-开发路线图.md
git diff --cached --check
git commit -m "docs: document autonomous world activity"
```

---

## 规格覆盖索引

- 目标、非目标、核心循环、每轮轻推演：Tasks 9–10、14。
- 深度推演：Task 16。
- 普通动态、重要事件、单一关注：Tasks 8–10、13–16。
- 独立动态页、点击行为、未读：Tasks 12、15。
- Pantheon/Creator 可见性：Task 11。
- Narrator 输出契约：Task 9。
- 持久化模型：Tasks 1、8、13。
- 服务端校验、逐项过滤、事务顺序和追溯：Tasks 10、17。
- 真实进度、统一 SSE、可恢复状态机、私有快照：Tasks 1–7。
- 断线恢复、失败步骤、正文预览：Tasks 4、7。
- 模块边界：Tasks 2、8–15、17。
- 数据迁移、克隆、存档兼容和级联删除：Tasks 8、17、18。
- 契约、原子、幂等、可见性、现实树和进度测试：各任务对应测试及 Task 19 全量回归。
- 四阶段上线与全部验收标准：Phase 1–4、Task 19。
