# World Director Phase 6: Migration, Cache Observability, and Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $team (coordinated parallel execution) or $ralph (persistent single-owner completion) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 确定性迁移旧历史和活动现实基线，验证缓存与 Provider 能力，正式切换世界写路径，并删除 META/settlement 的事实生成职责。

**Architecture:** 迁移器不调用 LLM；能可靠转换的旧 META 编译为只读 LegacyRun，当前状态封装为 `CutoverBaselineCheckpoint`。切换前在数据库副本 shadow replay；维护窗口内备份、最终迁移、验证 Hash、切换前端和写 API。故障时进入只读，不回退旧 META。

**Tech Stack:** Prisma 7/PostgreSQL、Next.js 16.2.10、TypeScript、Vitest、现有缓存统计

## Global Constraints

- 版本固定为 Next.js `16.2.10`、Prisma `7.8.0`、Vitest `4.1.10`。
- 迁移器不得调用 LLM，不得猜测旧 `InverseChangeSet`，不得丢弃玩家正文。
- 所有活动现实必须生成稳定 `CutoverBaselineCheckpoint`；Hash mismatch 阻止切换。
- 正式 Provider 必须通过至少一种 Agent 协议；启用搜索时必须返回并保存来源 URL。
- 正式切换后 `/api/chat` 不得写世界，META parser 只允许存在于 legacy migration。
- settlement LLM 不得继续判定死亡、新神、新能力、关系或编年史核心事实。
- 缓存命中必须由 usage 证明；接受缓存键但无读取量时显示 `cache_key_hint_only`。
- 切换失败后进入只读，不得重新启用旧 META 写入。
- 每项行为先写失败测试；每任务独立提交，只包含任务列出的文件。

---

## 文件结构

```text
prisma/schema.prisma
prisma/migrations/20260725200000_world_director_cutover/migration.sql
src/lib/world-director/migration/contracts.ts
src/lib/world-director/migration/contracts.test.ts
src/lib/world-director/migration/legacy.ts
src/lib/world-director/migration/legacy.integration.test.ts
src/lib/world-director/migration/baseline.ts
src/lib/world-director/migration/baseline.integration.test.ts
src/lib/world-director/migration/report.ts
src/lib/world-director/migration/report.test.ts
scripts/world-director-cutover.ts
scripts/world-director-verify.ts
src/lib/llm/cache-observability.ts
src/lib/llm/cache-observability.test.ts
src/lib/llm/cache-stats.ts
src/lib/llm/cache-stats.test.ts
src/components/settings/PromptCacheStats.tsx
src/components/settings/prompt-cache-stats-state.ts
src/components/settings/prompt-cache-stats-state.test.ts
src/app/api/settings/cache-stats/route.ts
src/app/api/chat/route.ts
src/app/api/chat/route.test.ts
src/lib/chat/continuous-meta.ts
src/lib/chat/settlement-policy.ts
src/lib/settle/pipeline.ts
src/lib/prompts/settlement.ts
src/app/api/chapters/[id]/settle/route.ts
src/app/api/worlds/[id]/state/route.ts
src/app/play/[worldId]/page.tsx
docs/runbooks/world-director-cutover.md
```

---

### Task 1: 添加 LegacyRun 和切换基线持久化

**Interfaces:**
- Consumes: Phase 1 Run/revision 模型和现有 Timeline/Message 历史。
- Produces: Prisma delegates `legacyDirectorRun`、`cutoverBaselineCheckpoint`；`CutoverBaselineSchema` 和 legacy migration contracts。

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260725200000_world_director_cutover/migration.sql`
- Create: `src/lib/world-director/migration/contracts.ts`
- Create: `src/lib/world-director/migration/contracts.test.ts`

- [ ] **Step 1: 写 schema 和契约测试**

```ts
it("基线必须包含现实、revision、状态 hash 和来源时间", () => {
  expect(CutoverBaselineSchema.parse({
    timelineId: "timeline-1",
    revision: 0,
    temporalState: { era: "甲龙历", time: "432年" },
    stateHash: "a".repeat(64),
    payload: {},
    createdAt: "2026-07-25T00:00:00.000Z",
  }).stateHash).toHaveLength(64);
});
```

- [ ] **Step 2: 添加模型**

```prisma
model LegacyDirectorRun {
  id              String   @id
  timelineId      String   @map("timeline_id")
  chapterId       String   @map("chapter_id")
  messageId       String   @unique @map("message_id")
  temporalLabel   String?  @map("temporal_label")
  legacyMeta      Json?    @map("legacy_meta")
  compiledPayload Json?    @map("compiled_payload")
  verified        Boolean  @default(false)
  diagnostics     Json?
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([timelineId, createdAt])
  @@map("legacy_director_runs")
}

model CutoverBaselineCheckpoint {
  id            String   @id @default(cuid())
  timelineId    String   @unique @map("timeline_id")
  revision      Int
  temporalState Json     @map("temporal_state")
  payload       Json
  stateHash     String   @map("state_hash")
  diagnostics   Json?
  createdAt     DateTime @default(now()) @map("created_at")

  @@map("cutover_baseline_checkpoints")
}
```

为 Timeline 添加关系字段。migration 只新增表和索引。

- [ ] **Step 3: 验证并提交**

```powershell
pnpm prisma validate
pnpm test -- src/lib/world-director/migration/contracts.test.ts
git add prisma/schema.prisma prisma/migrations/20260725200000_world_director_cutover/migration.sql src/lib/world-director/migration/contracts.ts src/lib/world-director/migration/contracts.test.ts
git commit -m "feat: persist director cutover baselines"
```

Expected: PASS。

---

### Task 2: 确定性编译旧 META 为 LegacyRun

**Interfaces:**
- Consumes: Task 1 persistence；旧 `Message.meta/variants`、WorldActivity、Chronicle、AbilityEvent。
- Produces: `LegacyMigrationReport`、`migrateLegacyRuns(client, { worldId?, dryRun }): Promise<LegacyMigrationReport>`。

**Files:**
- Create: `src/lib/world-director/migration/legacy.ts`
- Create: `src/lib/world-director/migration/legacy.integration.test.ts`

- [ ] **Step 1: 写旧数据矩阵**

Fixtures 覆盖：

```text
单行 META
多行 META
snake_case 字段
缺字段 META
损坏 META
正文泄漏 META
能力揭示
活动记录
神明参与事件
旧异文
```

断言迁移不调用任何 LLM mock；损坏项创建 `verified=false` 和 diagnostics，不丢正文。

- [ ] **Step 2: 实现迁移**

```ts
export async function migrateLegacyRuns(
  client: PrismaClient,
  input: { worldId?: string; dryRun: boolean },
): Promise<LegacyMigrationReport>;
```

规则：

- 只读取现有 `Message.meta/variants`、WorldActivity、Chronicle、AbilityEvent；
- 可靠字段映射到只读 `compiledPayload`；
- 不生成 `InverseChangeSet`；
- 正文只去除已经确认是协议泄漏的尾部 META，原始内容保存在 diagnostics；
- 使用 messageId 作为幂等键，可重复运行。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test:integration -- src/lib/world-director/migration/legacy.integration.test.ts
git add src/lib/world-director/migration/legacy.ts src/lib/world-director/migration/legacy.integration.test.ts
git commit -m "feat: migrate legacy narrative records"
```

Expected: PASS。

---

### Task 3: 生成权威基线和状态 Hash

**Interfaces:**
- Consumes: Task 1 `CutoverBaselineCheckpoint`；当前权威世界表。
- Produces: `buildCutoverBaseline(client, timelineId)`、稳定 baseline payload 和 SHA-256 `stateHash`。

**Files:**
- Create: `src/lib/world-director/migration/baseline.ts`
- Create: `src/lib/world-director/migration/baseline.integration.test.ts`

- [ ] **Step 1: 写稳定 Hash 测试**

```ts
it("数据库返回顺序变化不影响基线 hash", async () => {
  const a = await buildCutoverBaseline(prisma, timeline.id);
  randomizeFixtureInsertionOrder();
  const b = await buildCutoverBaseline(prisma, timeline.id);
  expect(a.stateHash).toBe(b.stateHash);
});
```

另测人物、能力、关系、神明、事件任一权威字段变化会改变 Hash。

- [ ] **Step 2: 实现规范快照**

基线 payload 按稳定 ID 排序并包含：

```text
temporal
observer
entities + sections
gods
abilities
entityRelations
memberships
active events
world activities 的最后权威游标
chronicle 的最后权威游标
```

不包含：

- createdAt/updatedAt；
- 非权威摘要缓存；
- LLM 调用日志；
- 未采用异文；
- UI local state。

Hash 使用 SHA-256 的稳定 JSON。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test:integration -- src/lib/world-director/migration/baseline.integration.test.ts
git add src/lib/world-director/migration/baseline.ts src/lib/world-director/migration/baseline.integration.test.ts
git commit -m "feat: build authoritative cutover baselines"
```

Expected: PASS。

---

### Task 4: 生成迁移完整性报告和 CLI

**Interfaces:**
- Consumes: Tasks 2–3 的 migration/baseline 结果。
- Produces: 完整性报告 DTO、`director:migrate:dry`、`director:migrate`、`director:verify` CLI。

**Files:**
- Create: `src/lib/world-director/migration/report.ts`
- Create: `src/lib/world-director/migration/report.test.ts`
- Create: `scripts/world-director-cutover.ts`
- Create: `scripts/world-director-verify.ts`
- Modify: `package.json`

- [ ] **Step 1: 写报告聚合测试**

```ts
expect(report).toMatchObject({
  worlds: 1,
  timelines: 2,
  messages: 30,
  legacyRunsVerified: 20,
  legacyRunsUnverified: 2,
  baselineHashMismatches: 0,
});
expect(report.orphanRelations).toEqual([]);
expect(report.abilitiesWithoutOwner).toEqual([]);
```

- [ ] **Step 2: 实现报告**

报告必须包含：

```text
世界数
现实数
消息数
成功/失败 LegacyRun 数
损坏 META
正文协议泄漏
重复人物/神明候选
悬空关系
无拥有者能力
无主体动态
基线 Hash 不一致
没有可信 checkpoint 的旧编辑锚点
```

- [ ] **Step 3: 添加 CLI 脚本**

`package.json` 增加：

```json
{
  "scripts": {
    "director:migrate:dry": "tsx scripts/world-director-cutover.ts --dry-run",
    "director:migrate": "tsx scripts/world-director-cutover.ts --apply",
    "director:verify": "tsx scripts/world-director-verify.ts"
  }
}
```

若项目尚无 `tsx`，将它作为 devDependency 正常安装并更新 `pnpm-lock.yaml`；不得用临时 Node/Python 脚本代替正式迁移工具。

CLI 必须要求显式 `--apply` 才写库；输出 JSON 报告文件路径；检测到 Hash mismatch 时退出码非零。

- [ ] **Step 4: 测试并提交**

```powershell
pnpm test -- src/lib/world-director/migration/report.test.ts
pnpm director:migrate:dry
git add package.json pnpm-lock.yaml scripts/world-director-cutover.ts scripts/world-director-verify.ts src/lib/world-director/migration/report.ts src/lib/world-director/migration/report.test.ts
git commit -m "feat: verify director cutover data"
```

Expected: dry-run 不写数据库，报告生成成功。

---

### Task 5: 增加缓存层级与真实能力观测

**Interfaces:**
- Consumes: Phase 3 L0/L1/Run incremental telemetry；现有 `LlmCall` usage。
- Produces: 扩展 `LlmCall` 字段、`classifyCacheEvidence(...)`、Gateway telemetry 持久化和分层 cache stats。

**Files:**
- Create: `src/lib/llm/cache-observability.ts`
- Create: `src/lib/llm/cache-observability.test.ts`
- Modify: `prisma/schema.prisma`
- Create: matching cache observability migration
- Modify: `src/lib/llm/gateway.ts`
- Modify: `src/lib/llm/cache-stats.ts`
- Modify: `src/lib/llm/cache-stats.test.ts`

- [ ] **Step 1: 写诊断测试**

```ts
it("连续稳定前缀零 cached tokens 后标记 hint_only", () => {
  const result = classifyCacheEvidence([
    call({ stablePrefixHash: "same", cacheRequested: true, cacheReadTokens: 0 }),
    call({ stablePrefixHash: "same", cacheRequested: true, cacheReadTokens: 0 }),
    call({ stablePrefixHash: "same", cacheRequested: true, cacheReadTokens: 0 }),
  ]);
  expect(result.capability).toBe("cache_key_hint_only");
});
```

另测 `cacheReadTokens > 0` 时为 `implicit_prefix_cache` 或 `explicit_prefix_cache`。

- [ ] **Step 2: 扩展 LlmCall**

新增 nullable 字段：

```prisma
stablePrefixHash String? @map("stable_prefix_hash")
agentRunId       String? @map("agent_run_id")
agentCallIndex   Int?    @map("agent_call_index")
dynamicTokens    Int?    @map("dynamic_tokens")
toolResultTokens Int?    @map("tool_result_tokens")
cacheCapability  String? @map("cache_capability")
cacheLayer       String? @map("cache_layer")
```

- [ ] **Step 3: Gateway 写入观测**

`CompletionRequest` 增加内部 telemetry：

```ts
telemetry?: {
  agentRunId?: string;
  agentCallIndex?: number;
  stablePrefixHash?: string;
  dynamicTokens?: number;
  toolResultTokens?: number;
  cacheLayer?: "L0" | "L1" | "run_incremental";
}
```

Adapter payload 不得包含 telemetry。

- [ ] **Step 4: 聚合统计**

`cache-stats.ts` 输出：

```text
globalPolicy
worldConstitution
runIncremental
byProvider
byTask
unconfirmedProviders
averageDynamicTokens
estimatedSavedTokens
```

- [ ] **Step 5: 测试并提交**

```powershell
pnpm test -- src/lib/llm/cache-observability.test.ts src/lib/llm/cache-stats.test.ts src/lib/llm/gateway.test.ts
pnpm prisma validate
git add prisma/schema.prisma prisma/migrations/*_director_cache_observability/migration.sql src/lib/llm
git commit -m "feat: diagnose director prompt caching"
```

Expected: PASS。

---

### Task 6: 更新缓存设置界面

**Interfaces:**
- Consumes: Task 5 分层 cache stats API DTO。
- Produces: 缓存统计 UI state 和明确的 confirmed/unconfirmed/hint-only 展示。

**Files:**
- Modify: `src/app/api/settings/cache-stats/route.ts`
- Modify: `src/components/settings/PromptCacheStats.tsx`
- Modify: `src/components/settings/prompt-cache-stats-state.ts`
- Modify: `src/components/settings/prompt-cache-stats-state.test.ts`

- [ ] **Step 1: 写状态映射测试**

断言 UI 数据明确区分：

```text
已请求缓存
Provider 已确认缓存
Provider 未确认缓存
L0 命中
L1 命中
Run 内增量命中
```

旧 “章末” 标签删除，新增 “世界导演” 和 “后台维护”。

- [ ] **Step 2: 实现 UI**

总命中率保留，但下方必须显示按层级和 Provider 的诊断。`cache_key_hint_only` 显示“端点接受缓存键，但未返回缓存读取量”。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test -- src/components/settings/prompt-cache-stats-state.test.ts
pnpm exec tsc --noEmit
git add src/app/api/settings/cache-stats/route.ts src/components/settings
git commit -m "feat: explain director cache behavior"
```

Expected: PASS。

---

### Task 7: Shadow replay 和切换门槛自动检查

**Interfaces:**
- Consumes: Tasks 1–4 的迁移验证；Phase 3 Provider probe；Phase 4 shadow runtime；Phase 5 revision flow。
- Produces: `shadowReplay(...)`、扩展后的 `director:verify` gate 和非零失败退出语义。

**Files:**
- Create: `src/lib/world-director/migration/shadow-replay.ts`
- Create: `src/lib/world-director/migration/shadow-replay.integration.test.ts`
- Modify: `scripts/world-director-verify.ts`

- [ ] **Step 1: 写代表性场景**

Shadow replay 至少运行：

```text
普通行动
观察
继续
时之仪
新人物
新神明
新能力
关系变化
神明死亡
时间重置
历史改写
异文
朱批
裁去
外部搜索
无原生工具的 Text Agent Frame
```

使用测试数据库 clone 或事务回滚，不写正式世界。

- [ ] **Step 2: 实现 gate**

`director:verify` 在任一条件失败时退出非零：

- baseline 缺失或 Hash mismatch；
- Provider 三种 Agent 协议均不可用；
- 启用原生搜索但没有来源；
- 原子故障注入未通过；
- shadow replay 产生协议泄漏；
- 存在会阻止切换的悬空引用；
- 旧写任务仍在运行。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test:integration -- src/lib/world-director/migration/shadow-replay.integration.test.ts
pnpm director:verify
git add src/lib/world-director/migration/shadow-replay.ts src/lib/world-director/migration/shadow-replay.integration.test.ts scripts/world-director-verify.ts
git commit -m "test: gate world director cutover"
```

Expected: 测试环境 PASS。

---

### Task 8: 正式切换写路径并停用旧事实生成

**Interfaces:**
- Consumes: Phase 4 Agent Run API；Phase 5 PlayPage；Task 7 已通过的 cutover gate。
- Produces: `/api/chat` 410 迁移响应、无 settlement 的 world state/play flow、仅供迁移的 legacy META parser、唯一正式 Agent 写路径。

**Files:**
- Modify: `src/app/api/chat/route.ts`
- Create or modify: `src/app/api/chat/route.test.ts`
- Modify: `src/app/play/[worldId]/page.tsx`
- Modify: `src/app/api/worlds/[id]/state/route.ts`
- Modify: `src/lib/chat/continuous-meta.ts`
- Modify: `src/lib/chat/settlement-policy.ts`
- Modify: `src/lib/settle/pipeline.ts`
- Modify: `src/lib/prompts/settlement.ts`
- Modify: `src/app/api/chapters/[id]/settle/route.ts`
- Update affected tests

- [ ] **Step 1: 写旧链路不可写测试**

```ts
it("POST /api/chat 返回 Agent Run 迁移响应且不创建 GenerationRequest", async () => {
  const response = await POST(oldChatRequest);
  expect(response.status).toBe(410);
  expect(await response.json()).toEqual({
    error: "叙事接口已迁移到世界导演",
    endpoint: "/api/agent-runs",
  });
  expect(await prisma.generationRequest.count()).toBe(0);
});
```

settle Route 对新 World Director 容器返回 410 或只允许明确的 legacy maintenance，不调用 settlement prompt。

- [ ] **Step 2: 切换页面和 state**

页面已经在 Phase 5 使用 Agent Run；此处删除所有 deprecated chat/settlement 分支。state route 删除公开 `currentChapter/currentSegment/checkpoint`。

- [ ] **Step 3: 移除 META 和 settlement 事实职责**

- `continuous-meta.ts` 仅留旧数据迁移 parser，并移动到 `world-director/migration/legacy-meta.ts`；
- 正式运行代码不能 import 它；
- `settlement-policy.ts` 从运行时删除；
- `settle/pipeline.ts` 只保留确定性维护函数，移除 LLM extract/pantheon/chronicle 事实写入；
- `prompts/settlement.ts` 删除或只留无法被生产引用的 legacy fixture；
- 全局 grep 断言新运行路径没有 `<<<META`、`settlementRequired` 和 `followUp.kind === "settlement"`。

- [ ] **Step 4: 运行旧链路隔离测试**

```powershell
pnpm test -- src/app/api/chat src/app/api/chapters src/lib/chat src/lib/settle src/lib/context/sse.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS；新 Run 是唯一正式写路径。

- [ ] **Step 5: 提交**

```powershell
git add src/app/api/chat src/app/api/chapters src/app/play/[worldId]/page.tsx src/app/api/worlds/[id]/state/route.ts src/lib/chat src/lib/settle src/lib/prompts/settlement.ts src/lib/world-director/migration
git commit -m "refactor: cut over to world director runtime"
```

---

### Task 9: 编写切换与回滚运行手册

**Interfaces:**
- Consumes: Tasks 4、7、8 的 CLI、gate 和正式端点行为。
- Produces: `docs/runbooks/world-director-cutover.md`，包含备份、部署、验证、只读恢复和禁止旧链路回退的操作步骤。

**Files:**
- Create: `docs/runbooks/world-director-cutover.md`

- [ ] **Step 1: 写维护窗口命令**

手册必须包含实际顺序：

```powershell
pnpm director:migrate:dry
pnpm director:verify
pg_dump ...
pnpm prisma migrate deploy
pnpm director:migrate
pnpm director:verify
pnpm build
```

数据库连接参数使用环境变量占位名，不写真实凭据。

- [ ] **Step 2: 写失败处置**

明确：

```text
切换前失败 → 恢复服务，旧链路仍未禁用
迁移后、路由切换前失败 → 从备份恢复
路由切换后失败 → 世界进入只读，修复并恢复 Run
禁止重新启用旧 META 写入
```

还需包含：

- 查看活动 Run；
- 识别过期租约；
- 重新执行 commit；
- 验证基线 Hash；
- 确认旧 `/api/chat` 为 410；
- 确认 settlement 不调用 LLM；
- 检查 Provider 能力和缓存 usage。

- [ ] **Step 3: 提交**

```powershell
git add docs/runbooks/world-director-cutover.md
git commit -m "docs: add world director cutover runbook"
```

---

### Task 10: 最终验收

**Interfaces:**
- Consumes: Phase 1–6 全部公开接口、测试、迁移工具和运行手册。
- Produces: 全量验证证据、玩家九场景验收结果、唯一事实来源 grep 结果和最终可集成分支。

**Files:** 全部相关实现与测试。

- [ ] **Step 1: 运行全量测试**

```powershell
pnpm test
pnpm test:integration
pnpm prisma validate
pnpm exec tsc --noEmit
pnpm lint
pnpm build
git diff --check
```

Expected: 全部退出码 `0`。

- [ ] **Step 2: 执行数据与 Provider gate**

```powershell
pnpm director:migrate:dry
pnpm director:verify
```

Expected:

- 所有现实有基线；
- 无 Hash mismatch；
- 正式模型适合世界导演；
- 搜索若启用则有来源；
- shadow replay 全部通过。

- [ ] **Step 3: 手工验收九个玩家场景**

逐项验证规格第 24 节：

```text
进入游戏自动正文
新能力与关系
神明显示
世界动态
时间而非章节
观察自然推进
修改正文
中断恢复
缓存诊断
```

- [ ] **Step 4: 检查唯一事实来源**

```powershell
git grep -n "<<<META" -- src
git grep -n "settlementRequired" -- src
git grep -n "followUp.kind.*settlement" -- src
git grep -n "finalizeNarration" -- src
```

Expected：只允许出现在 legacy migration/test fixture；不得出现在正式运行路径。

- [ ] **Step 5: 最终提交**

```powershell
git status --short
git add <only-final-verification-files>
git commit -m "test: verify world director cutover"
```

若没有验证阶段源码改动，则不创建空提交。
