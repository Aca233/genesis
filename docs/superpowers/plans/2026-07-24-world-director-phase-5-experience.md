# World Director Phase 5: Play Experience and Revision Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将游玩界面接入持久 Run，并把异文、朱批、裁去和重新生成改造成正文与 ChangeSet 一致的现实修订操作。

**Architecture:** 页面只持有当前活动 `runId` 并订阅其 SSE；刷新从 world state 恢复未完成 Run。初始空世界自动创建 `initial_observation`。所有消息编辑先解析到源 Run：末端修订原地撤销重算，历史修订创建子现实。旧 Message 路由停止直接改文本和按章节删除。

**Tech Stack:** Next.js 16.2.10、React 19、TypeScript、SSE、Vitest

## Global Constraints

- 版本固定为 Next.js `16.2.10`、React `19.2.4`、Vitest `4.1.10`。
- 玩家标题固定为 `{世界名} · {纪元} · {时间}`，不得显示章节号或章末流程。
- 初次进入创建幂等 `initial_observation`；就绪动画不等待 Run 完成。
- 纯查询和 UI 操作不得创建 Run；行动、观察、续写和时之仪必须创建 Run。
- 前端只显示“读取世界 → 推演变化 → 校验因果 → 编织正文 → 写入世界”。
- 最新轮次修订必须精确撤销；有后续历史时必须分叉并保留源现实。
- 异文、朱批、裁去和重生成不能只修改 Message 文本。
- 每项行为先写失败测试；每任务独立提交，只包含任务列出的文件。

---

## 文件结构

```text
src/components/play/director-run-client.ts
src/components/play/director-run-client.test.ts
src/components/play/director-progress-state.ts
src/components/play/director-progress-state.test.ts
src/components/play/TurnChanges.tsx
src/components/play/TurnReferences.tsx
src/components/play/StoryStream.tsx
src/components/play/InputDeck.tsx
src/components/play/types.ts
src/app/play/[worldId]/page.tsx
src/components/genesis/embark-flow.ts
src/components/genesis/embark-flow.test.ts
src/components/genesis/GenesisCeremony.tsx
src/app/genesis/[worldId]/page.tsx
src/app/api/worlds/[id]/state/route.ts
src/app/api/worlds/[id]/state/route.test.ts
src/lib/world-director/reality/revision.ts
src/lib/world-director/reality/revision.integration.test.ts
src/lib/world-director/reality/branch.ts
src/lib/world-director/reality/branch.integration.test.ts
src/app/api/agent-runs/[runId]/variants/route.ts
src/app/api/agent-runs/[runId]/revise/route.ts
src/app/api/agent-runs/[runId]/cut/route.ts
src/app/api/messages/[id]/route.ts
src/app/api/messages/[id]/route.test.ts
src/app/api/messages/[id]/variants/route.ts
src/app/api/messages/[id]/variants/route.test.ts
```

---

### Task 1: 添加前端 Run SSE 客户端

**Interfaces:**
- Consumes: Phase 4 `DirectorRunEvent` 和 Agent Run HTTP/SSE endpoints。
- Produces: `CreateRunInput`、`DirectorRunHandlers`、`createAndFollowDirectorRun(...)`、`followDirectorRun(...)`、`reduceDirectorEvent(...)`。

**Files:**
- Create: `src/components/play/director-run-client.ts`
- Create: `src/components/play/director-run-client.test.ts`
- Create: `src/components/play/director-progress-state.ts`
- Create: `src/components/play/director-progress-state.test.ts`

- [ ] **Step 1: 写重放、去重和恢复测试**

```ts
it("按 sequence 去重暂显正文", () => {
  const state = reduceDirectorEvent(initial, { type: "text", sequence: 0, text: "甲" });
  const replayed = reduceDirectorEvent(state, { type: "text", sequence: 0, text: "甲" });
  expect(replayed.provisionalText).toBe("甲");
});

it("完成后清除暂显并返回 messageId", () => {
  const state = reduceDirectorEvent(withText, {
    type: "completed",
    runId: "run-1",
    messageId: "message-1",
    postRevision: 2,
  });
  expect(state.provisionalText).toBe("");
  expect(state.messageId).toBe("message-1");
});
```

- [ ] **Step 2: 实现客户端**

```ts
export async function createAndFollowDirectorRun(
  input: CreateRunInput,
  handlers: DirectorRunHandlers,
  signal?: AbortSignal,
): Promise<void>;

export async function followDirectorRun(
  runId: string,
  handlers: DirectorRunHandlers,
  signal?: AbortSignal,
): Promise<void>;
```

先 POST 创建，再 GET stream；网络重连前 GET Run 状态并从最后 sequence 继续。SSE 断开不自动创建新 Run。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test -- src/components/play/director-run-client.test.ts src/components/play/director-progress-state.test.ts
git add src/components/play/director-run-client.ts src/components/play/director-run-client.test.ts src/components/play/director-progress-state.ts src/components/play/director-progress-state.test.ts
git commit -m "feat: follow director runs in play client"
```

Expected: PASS。

---

### Task 2: 扩展 world state 返回未完成 Run

**Interfaces:**
- Consumes: Phase 1 `directorProgress`；Phase 4 `WorldDirectorRun` 持久状态和 provisional frames。
- Produces: `PlayState.activeDirectorRun`、`PlayState.latestRunId` 和不依赖公开章节字段的 world state DTO。

**Files:**
- Modify: `src/app/api/worlds/[id]/state/route.ts`
- Create: `src/app/api/worlds/[id]/state/route.test.ts`
- Modify: `src/components/play/types.ts`

- [ ] **Step 1: 写 DTO 测试**

断言返回：

```ts
{
  activeDirectorRun: {
    id: "run-1",
    status: "narrating",
    progress: { taskKind: "director", stage: "narrating" },
    provisionalText: "已通过的暂显正文",
    lastSequence: 2,
  },
  currentChapter: undefined,
  currentSegment: undefined,
  checkpoint: undefined,
}
```

在 Phase 5 仍可内部查询最新 Chapter 作为 Message 容器，但公开 DTO 不再要求前端理解 chapter。

- [ ] **Step 2: 修改 state route**

优先查当前 Timeline 最新 `status in queued...committing, failed` 的 Run。公开：

- `activeDirectorRun`；
- `latestRunId`；
- `temporal`；
- 连续 messages；
- gods、avatars 和当前现实。

删除前端使用的 settlement checkpoint 恢复逻辑；旧字段在 Phase 6 正式切换前可以临时保留为 deprecated，但页面不再读取。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test -- src/app/api/worlds/[id]/state/route.test.ts
pnpm exec tsc --noEmit
git add src/app/api/worlds/[id]/state/route.ts src/app/api/worlds/[id]/state/route.test.ts src/components/play/types.ts
git commit -m "feat: expose active director run state"
```

Expected: PASS。

---

### Task 3: 游戏页面切换到 Run API

**Interfaces:**
- Consumes: Tasks 1–2 的 Run client、reducer 和 PlayState DTO；现有 `StoryStream`、`InputDeck`、`PlayDrawer`。
- Produces: `play-director-flow.ts` 的 `resumeOrOpenWorld(...)`；页面 trigger 映射；`TurnChanges` 和 `TurnReferences`。

**Files:**
- Modify: `src/app/play/[worldId]/page.tsx`
- Modify: `src/components/play/StoryStream.tsx`
- Modify: `src/components/play/InputDeck.tsx`
- Create: `src/components/play/TurnChanges.tsx`
- Create: `src/components/play/TurnReferences.tsx`
- Add or modify focused component tests in `src/components/play/*.test.tsx`

- [ ] **Step 1: 写页面编排测试**

抽取可测试的 `play-director-flow.ts`，验证：

```ts
it("空世界自动创建 initial_observation", async () => {
  await resumeOrOpenWorld({
    state: { messages: [], activeDirectorRun: null },
    createRun,
    followRun,
  });
  expect(createRun).toHaveBeenCalledWith(expect.objectContaining({
    trigger: "initial_observation",
  }));
});

it("已有活动 Run 时只恢复，不创建新 Run", async () => {
  await resumeOrOpenWorld({
    state: { messages: [], activeDirectorRun: { id: "run-1" } },
    createRun,
    followRun,
  });
  expect(createRun).not.toHaveBeenCalled();
  expect(followRun).toHaveBeenCalledWith("run-1");
});
```

- [ ] **Step 2: 替换 runChat**

页面动作映射：

```text
发送输入 → player_action
继续 → continue
观察建议 → observation
时之仪 → time_instrument
空世界 → initial_observation
```

`clientRequestId` 在动作开始时生成并保存在 ref/local state；重连复用，不重新生成。

- [ ] **Step 3: 删除页面 settlement 编排**

移除：

- `followWorldSettlement`；
- `settling` 和 `settlementState`；
- `checkpoint.needsSettlement` effect；
- `followUp.kind === settlement`；
- 章末重试 UI。

保留现实切换、实体索引和纯查询抽屉。

- [ ] **Step 4: 显示进度、暂显正文、变化和参考**

- `StoryStream` 显示 Run 暂显段落；
- `InputDeck` 在 progress 期间禁用会改变世界的重复动作；
- 进度严格显示五阶段；
- `TurnChanges` 只显示提交结果中的非空实际变化；
- `TurnReferences` 只在使用外部搜索时显示来源；
- “查阅外部资料”是进度附加提示，不成为第六个主阶段；
- 返回主菜单 Link 不取消 Run。

- [ ] **Step 5: 运行测试并提交**

```powershell
pnpm test -- src/components/play src/app/play
pnpm exec tsc --noEmit
git add src/app/play/[worldId]/page.tsx src/components/play
git commit -m "feat: drive play through director runs"
```

Expected: PASS。

---

### Task 4: 让创世就绪动画与初始观察 Run 并行

**Interfaces:**
- Consumes: Phase 4 `POST /api/agent-runs`；Task 1 Run client；现有 embark materialization 和 Genesis Ceremony。
- Produces: 新 `EmbarkMaterialization`、`createEmbarkFlow({ createInitialObservation })` 和稳定 `opening:${worldId}` 幂等键。

**Files:**
- Modify: `src/components/genesis/embark-flow.ts`
- Modify: `src/components/genesis/embark-flow.test.ts`
- Modify: `src/components/genesis/GenesisCeremony.tsx`
- Modify: `src/app/genesis/[worldId]/page.tsx`

- [ ] **Step 1: 改写 embark flow 测试**

```ts
it("物化后立即创建 initial_observation，动画无需等待正文完成", async () => {
  const calls: string[] = [];
  const flow = createEmbarkFlow({
    worldId: "world-1",
    materialize: async () => {
      calls.push("embark");
      return { timelineId: "timeline-1" };
    },
    createInitialObservation: async (input) => {
      calls.push(`run:${input.clientRequestId}`);
      return { runId: "run-opening" };
    },
  });

  await expect(flow.start()).resolves.toEqual({
    timelineId: "timeline-1",
    runId: "run-opening",
  });
  expect(calls).toEqual(["embark", "run:opening:world-1"]);
});

it("重试开篇复用同一幂等 initial_observation", async () => {
  await flow.start();
  await flow.retryOpening();
  expect(createInitialObservation).toHaveBeenNthCalledWith(2, expect.objectContaining({
    clientRequestId: "opening:world-1",
  }));
});
```

- [ ] **Step 2: 替换旧 opening 请求**

`EmbarkMaterialization` 改为：

```ts
export type EmbarkMaterialization = {
  timelineId: string;
  storageChapterId: string;
  temporal?: { era: string; time: string };
};
```

依赖改为：

```ts
createInitialObservation(input: {
  worldId: string;
  trigger: "initial_observation";
  clientRequestId: string;
}): Promise<{ runId: string }>;
```

`clientRequestId` 继续稳定使用 `opening:${worldId}`。删除 `chapterId/scale/mode: opening`。

- [ ] **Step 3: 并行就绪动画**

`GenesisCeremony` 在世界物化完成后立即开始既有就绪动画，同时 `createEmbarkFlow.start()` 创建 Run。动画不等待 Run 完成；动画结束后导航到 `/play/[worldId]`，PlayPage 根据 world state 恢复 `run-opening` 的已有暂显帧。若 Run 尚未产生正文，页面显示流式光标而不是“点击开始”。

- [ ] **Step 4: 测试并提交**

```powershell
pnpm test -- src/components/genesis/embark-flow.test.ts src/components/genesis/GenesisCeremony.test.ts
pnpm exec tsc --noEmit
git add src/components/genesis/embark-flow.ts src/components/genesis/embark-flow.test.ts src/components/genesis/GenesisCeremony.tsx src/app/genesis/[worldId]/page.tsx
git commit -m "feat: start opening director run during ceremony"
```

Expected: PASS。

---

### Task 5: 实现最新轮次精确撤销

**Interfaces:**
- Consumes: Phase 2 `WorldInverseChangeSet`；Phase 4 completed Run/checkpoint/projection sources；当前 `RealityRevision`。
- Produces: `rollbackLatestRun(client, input): Promise<{ timelineId: string; revision: number }>` 和归档消息读取语义。

**Files:**
- Create: `src/lib/world-director/reality/revision.ts`
- Create: `src/lib/world-director/reality/revision.integration.test.ts`

- [ ] **Step 1: 写末端检测和撤销测试**

```ts
it("最新 Run 可以原地撤销到 preRevision", async () => {
  const result = await rollbackLatestRun(prisma, {
    runId: latest.id,
    expectedRevision: latest.postRevision,
  });
  expect(result.revision).toBe(latest.preRevision);
  expect(await prisma.ability.findUnique({ where: { id: createdAbility.id } })).toBeNull();
});

it("存在后续 Run 时拒绝原地撤销", async () => {
  await expect(rollbackLatestRun(prisma, {
    runId: old.id,
    expectedRevision: latest.postRevision,
  })).rejects.toThrow("目标轮次后已有正式历史");
});
```

- [ ] **Step 2: 实现撤销事务**

```ts
export async function rollbackLatestRun(
  client: PrismaClient,
  input: { runId: string; expectedRevision: number },
): Promise<{ timelineId: string; revision: number }>;
```

事务内验证目标 Run 是当前 Timeline 的最后 completed Run，再应用 `WorldInverseChangeSet`、归档投影和消息、恢复 temporal、revision 回到 preRevision。归档消息而非硬删除时，需要新增 `Message.archivedAt` nullable 字段；公开消息查询过滤归档项。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test:integration -- src/lib/world-director/reality/revision.integration.test.ts
git add prisma/schema.prisma prisma/migrations/*_director_message_archive/migration.sql src/lib/world-director/reality/revision.ts src/lib/world-director/reality/revision.integration.test.ts
git commit -m "feat: rollback latest director runs"
```

Expected: PASS。

---

### Task 6: 实现历史修订自动分叉

**Interfaces:**
- Consumes: Task 5 的末端判定；现有 `src/lib/reality/clone.ts`；可信 RunCheckpoint/CutoverBaseline。
- Produces: `prepareRevisionBranch(client, input): Promise<{ sourceTimelineId; preparedTimelineId; anchorRevision }>`。

**Files:**
- Create: `src/lib/world-director/reality/branch.ts`
- Create: `src/lib/world-director/reality/branch.integration.test.ts`
- Reuse without rewriting: `src/lib/reality/clone.ts`

- [ ] **Step 1: 写源现实保留测试**

创建三轮历史，修改第一轮，断言：

- 源 Timeline 的三轮和 revision 不变；
- 新 Timeline 从第一轮 `preRevision` 对应状态建立；
- 新 Timeline 的 `branchName` 使用分叉时间和首个差异事实；
- `world.activeTimelineId` 只在新 RevisionRun 完整提交后切换；
- 新现实树节点不使用章节号。

- [ ] **Step 2: 实现 PreparedReality**

```ts
export async function prepareRevisionBranch(
  client: PrismaClient,
  input: {
    sourceRunId: string;
    reason: "variant" | "revision" | "cut" | "time_rewrite";
    requestedContent?: string;
  },
): Promise<{
  sourceTimelineId: string;
  preparedTimelineId: string;
  anchorRevision: number;
}>;
```

优先复用 `clone.ts` 的对象映射逻辑，但必须按可信 checkpoint 裁剪 source Run 后历史。Prepared Timeline 在 Run 完成前不设为 active。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test:integration -- src/lib/world-director/reality/branch.integration.test.ts
git add src/lib/world-director/reality/branch.ts src/lib/world-director/reality/branch.integration.test.ts
git commit -m "feat: branch historical director revisions"
```

Expected: PASS。

---

### Task 7: 添加异文、朱批和裁去 Run API

**Interfaces:**
- Consumes: Phase 4 Controller；Tasks 5–6 的撤销和分叉；Phase 1 `TurnVariant`。
- Produces: `POST/PATCH /api/agent-runs/[runId]/variants`、`POST /revise`、`POST /cut` 的公开契约。

**Files:**
- Create: `src/app/api/agent-runs/[runId]/variants/route.ts`
- Create: `src/app/api/agent-runs/[runId]/revise/route.ts`
- Create: `src/app/api/agent-runs/[runId]/cut/route.ts`
- Add focused route tests next to each route or in matching `route.test.ts`

- [ ] **Step 1: 写 Route 行为测试**

覆盖：

- `POST variants` 生成候选，不修改当前世界；
- `PATCH variants` 最新轮次原子切换；
- `PATCH variants` 历史轮次创建子现实；
- `POST revise` 纯措辞变化复用 ChangeSet；
- `POST revise` 事实变化创建 RevisionRun；
- `POST cut` 最新轮次确定性撤销；
- `POST cut` 历史轮次创建裁去分支。

- [ ] **Step 2: 实现 API**

请求 schema：

```ts
const ReviseSchema = z.object({
  content: z.string().trim().min(1).max(50000),
  clientRequestId: z.string().min(8).max(128),
}).strict();

const ChooseVariantSchema = z.object({
  variantId: z.string().min(1),
  clientRequestId: z.string().min(8).max(128),
}).strict();
```

所有变更返回 `runId` 或 `preparedTimelineId`，前端统一跟随 Run，不直接替换本地 Message。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test -- src/app/api/agent-runs
pnpm test:integration -- src/lib/world-director/reality
git add src/app/api/agent-runs/[runId]
git commit -m "feat: revise director history safely"
```

Expected: PASS。

---

### Task 8: 废弃 Message 直接写入路由

**Interfaces:**
- Consumes: Task 7 的 revision endpoints；Message 到 `WorldDirectorRun` 的关联。
- Produces: 对绑定 Run 的旧 Message 写路由返回 409/迁移目标；PlayPage 所有编辑动作统一使用 Run API。

**Files:**
- Modify: `src/app/api/messages/[id]/route.ts`
- Modify or create: `src/app/api/messages/[id]/route.test.ts`
- Modify: `src/app/api/messages/[id]/variants/route.ts`
- Modify: `src/app/api/messages/[id]/variants/route.test.ts`
- Modify: `src/app/play/[worldId]/page.tsx`

- [ ] **Step 1: 写拒绝直接修改测试**

对于绑定 `WorldDirectorRun` 的 narrator message：

```ts
expect(await PATCH(request, context)).toMatchResponse(409, {
  error: "此正文绑定世界变化，请使用朱批修订",
  runId: "run-1",
});
```

DELETE 同理返回 cut endpoint；variants 路由返回新 Run variant endpoint。旧未绑定 Run 的历史消息保持只读兼容，不直接改权威世界。

- [ ] **Step 2: 修改路由和页面操作**

页面 `edit/cut/reroll/switchVariant` 全部调用 Agent Run API。删除本地按 `message.index` 截断和只替换文本的逻辑，成功后统一 `reloadState()`。

- [ ] **Step 3: 运行 Phase 5 总验证**

```powershell
pnpm test -- src/components/play src/app/api/messages src/app/api/agent-runs
pnpm test:integration -- src/lib/world-director/reality src/lib/world-director/kernel
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Expected: PASS。

- [ ] **Step 4: 提交**

```powershell
git add src/app/api/messages src/app/play/[worldId]/page.tsx
git commit -m "refactor: route message edits through director runs"
```
