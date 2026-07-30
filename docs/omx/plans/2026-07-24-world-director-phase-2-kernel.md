# World Director Phase 2: Draft, Tools, and Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $team (coordinated parallel execution) or $ralph (persistent single-owner completion) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立无数据库副作用的世界查询和草案工具，以及可确定性校验、编译、撤销和投影的世界内核。

**Architecture:** 所有 LLM 变化先进入严格 Zod 判别联合；草案构建器按稳定 key 聚合。查询工具只返回有界、稳定排序的 DTO。内核用当前现实快照校验身份、状态、时间和因果，再编译正向及反向变化。本阶段不接入正式正文路由。

**Tech Stack:** TypeScript 5、Zod 4、Prisma 7、Vitest 4

## Global Constraints

- 版本固定为 Prisma `7.8.0`、Zod `4.4.3`、Vitest `4.1.10`。
- 查询工具必须只读；草案工具只能返回新 `DraftChangeSet`；任何工具都不能接受 Prisma、SQL 或系统命令。
- 所有 schema 使用 `.strict()`；未知字段、跨现实引用和未解析临时 ID 必须失败。
- 世界查询和序列化按稳定 ID、稳定字段顺序输出；相同 revision 的相同请求逐字节一致。
- 神明关系以 `EntityRelation` 为唯一权威边，`God.relations` 仅作迁移兼容投影。
- 每个 mutation 必须具有唯一 `mutationKey` 和 `evidenceClaimId`。
- 本阶段只新增内核能力，不接入正式正文和世界写路径。
- 每项行为先写失败测试；每任务独立提交，只包含任务列出的文件。

---

## 文件结构

```text
src/lib/world-director/draft/schema.ts
src/lib/world-director/draft/schema.test.ts
src/lib/world-director/draft/builder.ts
src/lib/world-director/draft/builder.test.ts
src/lib/world-director/draft/serialize.ts
src/lib/world-director/draft/serialize.test.ts
src/lib/world-director/tools/inspect-world.ts
src/lib/world-director/tools/inspect-world.integration.test.ts
src/lib/world-director/tools/draft-tools.ts
src/lib/world-director/tools/draft-tools.test.ts
src/lib/world-director/kernel/causal-envelope.ts
src/lib/world-director/kernel/causal-envelope.test.ts
src/lib/world-director/kernel/validate.ts
src/lib/world-director/kernel/validate.integration.test.ts
src/lib/world-director/kernel/compile.ts
src/lib/world-director/kernel/compile.test.ts
src/lib/world-director/kernel/inverse.ts
src/lib/world-director/kernel/inverse.test.ts
src/lib/world-director/projections/plan.ts
src/lib/world-director/projections/plan.test.ts
```

---

### Task 1: 定义完整变化代数

**Interfaces:**
- Consumes: Phase 1 的 `RunTrigger`/现实 revision 语义；Zod。
- Produces: `WorldMutationSchema`、`DraftChangeSetSchema`、`WorldMutation`、`DraftChangeSet`、`ActivityDraftSchema`、`ChronicleDraftSchema`、`ObserverTransitionSchema`。

**Files:**
- Create: `src/lib/world-director/draft/schema.ts`
- Create: `src/lib/world-director/draft/schema.test.ts`

- [ ] **Step 1: 写判别联合测试**

```ts
import { describe, expect, it } from "vitest";
import { DraftChangeSetSchema, WorldMutationSchema } from "./schema";

describe("world mutation schema", () => {
  it("接受能力、关系和时间变化", () => {
    expect(WorldMutationSchema.parse({
      kind: "ability.learn",
      mutationKey: "ability:rudi:960",
      ownerType: "entity",
      ownerId: "rudi",
      abilityId: "ability-960",
      evidenceClaimId: "claim-rudi-960",
      reason: "试验完成",
    }).kind).toBe("ability.learn");
  });

  it("拒绝任意字段和无方向关系", () => {
    expect(() => WorldMutationSchema.parse({
      kind: "relation.set",
      sourceId: "rudi",
      label: "信赖",
      rawSql: "delete",
    })).toThrow();
  });

  it("限制一轮 mutation 数量", () => {
    const mutations = Array.from({ length: 65 }, (_, index) => ({
      kind: "event.record",
      mutationKey: `event:${index}`,
      title: `事件${index}`,
      summary: "变化",
      participantIds: [],
      evidenceClaimId: `claim:${index}`,
    }));
    expect(() => DraftChangeSetSchema.parse({
      runId: "run-1",
      baseRealityId: "reality-1",
      baseRevision: 0,
      mutations,
      activityEntries: [],
      chronicleEntries: [],
    })).toThrow();
  });
});
```

- [ ] **Step 2: 运行并确认失败**

```powershell
pnpm test -- src/lib/world-director/draft/schema.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现严格 schema**

在 `schema.ts` 定义公共字段：

```ts
const MutationBase = {
  mutationKey: z.string().trim().min(1).max(160),
  evidenceClaimId: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(1000),
};
```

`WorldMutationSchema` 必须是 `.strict()` 对象组成的 `z.discriminatedUnion("kind", [...])`，至少覆盖：

```text
temporal.set
entity.create
entity.update
entity.transition
god.create
god.update
ability.create
ability.learn
ability.improve
ability.reveal
ability.lose
relation.set
relation.end
event.record
event.advance
observer.set
```

关系 schema 必须包含两个带类型的端点、`label` 和 `note`：

```ts
const ActorRefSchema = z.object({
  actorType: z.enum(["entity", "god"]),
  actorId: z.string().trim().min(1),
}).strict();

const RelationSetSchema = z.object({
  kind: z.literal("relation.set"),
  ...MutationBase,
  source: ActorRefSchema,
  target: ActorRefSchema,
  label: z.string().trim().min(1).max(120),
  note: z.string().trim().min(1).max(2000),
}).strict();
```

神明端点在编译时解析到 `God.codexEntityId` 对应的百科实体；神明没有百科实体时，`god.create` 必须同轮创建并关联一个 codex entity，禁止继续把 `God.relations` JSON 当作第二套权威关系。现有 `God.relations` 仅作为迁移期只读兼容投影。能力 owner 必须是 `{ ownerType: "entity" | "god", ownerId }`；创建对象必须携带 `tempId` 供同轮引用。

完整草案：

```ts
export const DraftChangeSetSchema = z.object({
  runId: z.string().min(1),
  baseRealityId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  mutations: z.array(WorldMutationSchema).max(64),
  activityEntries: z.array(ActivityDraftSchema).max(32).default([]),
  chronicleEntries: z.array(ChronicleDraftSchema).max(16).default([]),
  observerTransition: ObserverTransitionSchema.optional(),
}).strict();
```

- [ ] **Step 4: 运行测试并提交**

```powershell
pnpm test -- src/lib/world-director/draft/schema.test.ts
git add src/lib/world-director/draft/schema.ts src/lib/world-director/draft/schema.test.ts
git commit -m "feat: define world change algebra"
```

Expected: PASS。

---

### Task 2: 构建确定性 DraftBuilder 和序列化

**Interfaces:**
- Consumes: Task 1 的 `WorldMutation`、`DraftChangeSet` 和 schemas。
- Produces: `DraftBuilder.empty(...)`、`DraftBuilder.add(...)`、`DraftBuilder.addMany(...)`、`DraftBuilder.build()`、`stableSerializeDraft(draft): string`。

**Files:**
- Create: `src/lib/world-director/draft/builder.ts`
- Create: `src/lib/world-director/draft/builder.test.ts`
- Create: `src/lib/world-director/draft/serialize.ts`
- Create: `src/lib/world-director/draft/serialize.test.ts`

- [ ] **Step 1: 写顺序无关和重复 key 测试**

```ts
import { expect, it } from "vitest";
import { DraftBuilder } from "./builder";
import { stableSerializeDraft } from "./serialize";

it("相同 mutation 集合产生逐字节相同输出", () => {
  const a = DraftBuilder.empty("run-1", "reality-1", 2)
    .add(entityUpdate)
    .add(abilityLearn)
    .build();
  const b = DraftBuilder.empty("run-1", "reality-1", 2)
    .add(abilityLearn)
    .add(entityUpdate)
    .build();
  expect(stableSerializeDraft(a)).toBe(stableSerializeDraft(b));
});

it("拒绝相同 mutationKey 的不同内容", () => {
  const builder = DraftBuilder.empty("run-1", "reality-1", 2).add(entityUpdate);
  expect(() => builder.add({ ...entityUpdate, reason: "冲突原因" }))
    .toThrow("mutationKey 内容冲突");
});
```

- [ ] **Step 2: 运行并确认失败**

```powershell
pnpm test -- src/lib/world-director/draft/builder.test.ts src/lib/world-director/draft/serialize.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现 builder**

```ts
export class DraftBuilder {
  private readonly mutations = new Map<string, WorldMutation>();

  static empty(runId: string, realityId: string, revision: number): DraftBuilder;
  add(input: unknown): this;
  addMany(input: readonly unknown[]): this;
  build(): DraftChangeSet;
}
```

`add()` 先执行 `WorldMutationSchema.parse()`；同 key 相同内容幂等忽略，不同内容抛错。`build()` 按 `mutationKey`、activity key 和 chronicle key 排序后执行完整 schema。

`stableSerializeDraft()` 递归按对象键排序，数组保持 builder 已确定的业务顺序：

```ts
export function stableSerializeDraft(draft: DraftChangeSet): string {
  return JSON.stringify(sortObjectKeys(DraftChangeSetSchema.parse(draft)));
}
```

- [ ] **Step 4: 测试并提交**

```powershell
pnpm test -- src/lib/world-director/draft/builder.test.ts src/lib/world-director/draft/serialize.test.ts
git add src/lib/world-director/draft
git commit -m "feat: build deterministic world drafts"
```

Expected: PASS。

---

### Task 3: 实现有界、只读、稳定输出的 inspect_world

**Interfaces:**
- Consumes: Prisma `Timeline`、`Entity`、`God`、`Ability`、`EntityRelation`、`WorldEvent`、`WorldActivity`；Phase 1 revision。
- Produces: `InspectWorldInputSchema`、`InspectScope`、`InspectItem`、`inspectWorld(client, raw): Promise<{ scope; items; nextCursor; truncated }>`。

**Files:**
- Create: `src/lib/world-director/tools/inspect-world.ts`
- Create: `src/lib/world-director/tools/inspect-world.integration.test.ts`

- [ ] **Step 1: 写查询边界测试**

测试数据库准备两个 Timeline，并验证：

```ts
const first = await inspectWorld(prisma, {
  timelineId: active.id,
  scope: "entities",
  query: "鲁迪",
  depth: "summary",
  limit: 5,
});
const second = await inspectWorld(prisma, {
  timelineId: active.id,
  scope: "entities",
  query: "鲁迪",
  depth: "summary",
  limit: 5,
});

expect(JSON.stringify(first)).toBe(JSON.stringify(second));
expect(first.items.map((item) => item.id)).toEqual([...first.items.map((item) => item.id)].sort());
expect(first.items.some((item) => item.id === foreignEntity.id)).toBe(false);
expect(await countAllWorldRows(prisma)).toEqual(beforeCounts);
```

另测 `limit: 21` 被 schema 拒绝，`detail` 最多 8 个 ID。

- [ ] **Step 2: 运行并确认失败**

```powershell
pnpm test:integration -- src/lib/world-director/tools/inspect-world.integration.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现查询 schema 和分 scope repository**

```ts
export const InspectWorldInputSchema = z.object({
  timelineId: z.string().min(1),
  scope: z.enum([
    "entities", "gods", "abilities", "relations", "history",
    "events", "places", "items", "organizations",
    "temporal_state", "reality",
  ]),
  query: z.string().trim().max(200).optional(),
  ids: z.array(z.string()).max(8).optional(),
  fields: z.array(z.string()).max(12).optional(),
  depth: z.enum(["search", "summary", "detail"]).default("summary"),
  limit: z.number().int().min(1).max(20).default(10),
  cursor: z.string().optional(),
}).strict();
```

导出：

```ts
export async function inspectWorld(
  client: PrismaClient,
  raw: unknown,
): Promise<{
  scope: InspectScope;
  items: InspectItem[];
  nextCursor: string | null;
  truncated: boolean;
}>;
```

每个查询强制 `timelineId` 条件；结果按稳定 ID 排序；只返回白名单 DTO，不返回 Prisma 原始对象。

- [ ] **Step 4: 测试并提交**

```powershell
pnpm test:integration -- src/lib/world-director/tools/inspect-world.integration.test.ts
git add src/lib/world-director/tools/inspect-world.ts src/lib/world-director/tools/inspect-world.integration.test.ts
git commit -m "feat: add bounded world inspection"
```

Expected: PASS。

---

### Task 4: 实现草案工具分发

**Interfaces:**
- Consumes: Task 1 的 `DraftChangeSet`；Task 2 的 `DraftBuilder`。
- Produces: `DraftToolName`、`executeDraftTool(current, command): { draft; acceptedMutationKeys }`。

**Files:**
- Create: `src/lib/world-director/tools/draft-tools.ts`
- Create: `src/lib/world-director/tools/draft-tools.test.ts`

- [ ] **Step 1: 写工具白名单测试**

```ts
import { expect, it } from "vitest";
import { executeDraftTool } from "./draft-tools";

it("草案工具只返回新草案且不接受未知工具", () => {
  const result = executeDraftTool(emptyDraft, {
    name: "draft_ability_changes",
    arguments: { changes: [abilityLearn] },
  });
  expect(result.draft.mutations).toHaveLength(1);
  expect(() => executeDraftTool(emptyDraft, {
    name: "raw_sql",
    arguments: {},
  })).toThrow("未知草案工具");
});
```

- [ ] **Step 2: 实现纯函数工具**

```ts
export type DraftToolName =
  | "draft_entity_changes"
  | "draft_ability_changes"
  | "draft_relation_changes"
  | "draft_world_progress"
  | "draft_observer_changes";

export function executeDraftTool(
  current: DraftChangeSet,
  command: { name: string; arguments: unknown },
): { draft: DraftChangeSet; acceptedMutationKeys: string[] };
```

所有参数使用各自 `.strict()` schema；函数不得导入 Prisma 或 `@/lib/db`。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test -- src/lib/world-director/tools/draft-tools.test.ts
git add src/lib/world-director/tools/draft-tools.ts src/lib/world-director/tools/draft-tools.test.ts
git commit -m "feat: add side effect free draft tools"
```

Expected: PASS。

---

### Task 5: 实现 CausalEnvelope

**Interfaces:**
- Consumes: 当前 Run 的因果 seed IDs、当前现实关联边和 mutation subject IDs。
- Produces: `validateCausalEnvelope(input): { ok: true } | { ok: false; unreachableIds: string[] }`。

**Files:**
- Create: `src/lib/world-director/kernel/causal-envelope.ts`
- Create: `src/lib/world-director/kernel/causal-envelope.test.ts`

- [ ] **Step 1: 写可达性测试**

```ts
import { expect, it } from "vitest";
import { validateCausalEnvelope } from "./causal-envelope";

it("允许从观察目标沿事件和在场关系扩展", () => {
  expect(validateCausalEnvelope({
    seedIds: ["rudi"],
    edges: [
      ["rudi", "test-event"],
      ["test-event", "ors"],
    ],
    mutationSubjectIds: ["rudi", "ors"],
  }).ok).toBe(true);
});

it("拒绝不可达的遥远帝国", () => {
  expect(validateCausalEnvelope({
    seedIds: ["rudi"],
    edges: [["rudi", "test-event"]],
    mutationSubjectIds: ["remote-empire"],
  })).toMatchObject({ ok: false, unreachableIds: ["remote-empire"] });
});
```

- [ ] **Step 2: 实现无向可达图和最大深度**

```ts
export function validateCausalEnvelope(input: {
  seedIds: readonly string[];
  edges: readonly (readonly [string, string])[];
  mutationSubjectIds: readonly string[];
  maxDepth?: number;
}): { ok: true } | { ok: false; unreachableIds: string[] };
```

默认 `maxDepth = 4`，结果中的不可达 ID 排序稳定。

- [ ] **Step 3: 测试并提交**

```powershell
pnpm test -- src/lib/world-director/kernel/causal-envelope.test.ts
git add src/lib/world-director/kernel/causal-envelope.ts src/lib/world-director/kernel/causal-envelope.test.ts
git commit -m "feat: bound director causal expansion"
```

Expected: PASS。

---

### Task 6: 实现完整校验器

**Interfaces:**
- Consumes: Task 1 的 `DraftChangeSet`；Task 3 的世界读取 DTO；Task 5 的 `validateCausalEnvelope`；Phase 1 `RealityRevision`。
- Produces: `ValidationIssue`、`ValidationReport`、`validateDraft(client, input): Promise<ValidationReport>`。

**Files:**
- Create: `src/lib/world-director/kernel/validate.ts`
- Create: `src/lib/world-director/kernel/validate.integration.test.ts`

- [ ] **Step 1: 写精确错误码测试**

使用真实 Prisma fixture，覆盖并断言：

```ts
expect(report.issues).toContainEqual(expect.objectContaining({
  code: "ABILITY_OWNER_NOT_FOUND",
  mutationKey: "ability:rudi:960",
}));
```

必须分别覆盖：

```text
BASE_REVISION_CONFLICT
FOREIGN_REALITY_REFERENCE
DUPLICATE_ENTITY_CANDIDATE
ABILITY_OWNER_NOT_FOUND
ABILITY_SOURCE_MISSING
RELATION_ENDPOINT_NOT_FOUND
GOD_CODEX_ENTITY_REQUIRED
RELATION_EVIDENCE_TOO_WEAK
ILLEGAL_STATE_TRANSITION
TEMPORAL_REGRESSION_REQUIRES_BRANCH
CAUSAL_SUBJECT_UNREACHABLE
```

- [ ] **Step 2: 实现 ValidationReport**

```ts
export type ValidationIssue = {
  code: ValidationIssueCode;
  mutationKey: string | null;
  path: string;
  message: string;
  repairHint: string;
};

export type ValidationReport = {
  ok: boolean;
  issues: ValidationIssue[];
  checkedRevision: number;
};

export async function validateDraft(
  client: PrismaClient,
  input: {
    draft: DraftChangeSet;
    causalSeedIds: readonly string[];
    allowedHistoricalRewrite: boolean;
  },
): Promise<ValidationReport>;
```

issues 按 `mutationKey + code + path` 排序；只报告精确局部问题；不得写数据库。

- [ ] **Step 3: 运行测试并提交**

```powershell
pnpm test:integration -- src/lib/world-director/kernel/validate.integration.test.ts
git add src/lib/world-director/kernel/validate.ts src/lib/world-director/kernel/validate.integration.test.ts
git commit -m "feat: validate world director drafts"
```

Expected: PASS。

---

### Task 7: 编译正向、反向 ChangeSet 与投影计划

**Interfaces:**
- Consumes: Task 1 的 `DraftChangeSet`；Task 6 已通过的 `ValidationReport`；读取阶段构建的 `WorldSnapshot`。
- Produces: `CanonicalChangeSet`、`CompiledChangeSet`、`compileChangeSet(draft, snapshot)`、`ProjectionOperation`、`planProjections(changeSet)`。

**Files:**
- Create: `src/lib/world-director/kernel/compile.ts`
- Create: `src/lib/world-director/kernel/compile.test.ts`
- Create: `src/lib/world-director/kernel/inverse.ts`
- Create: `src/lib/world-director/kernel/inverse.test.ts`
- Create: `src/lib/world-director/projections/plan.ts`
- Create: `src/lib/world-director/projections/plan.test.ts`

- [ ] **Step 1: 写编译和撤销对称测试**

```ts
it("对已通过草案生成稳定正向和反向载荷", () => {
  const compiled = compileChangeSet(validDraft, snapshot);
  expect(compiled.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  expect(applyPure(snapshot, compiled.forward)).toEqual(afterSnapshot);
  expect(applyPure(afterSnapshot, compiled.inverse)).toEqual(snapshot);
});

it("同一能力变化派生众生录、能力、动态和本轮变化投影", () => {
  expect(planProjections(compiled.forward).map((item) => item.kind)).toEqual([
    "ability",
    "activity",
    "roster",
    "turn_change",
  ]);
});
```

- [ ] **Step 2: 实现编译接口**

```ts
export type CompiledChangeSet = {
  forward: CanonicalChangeSet;
  inverse: CanonicalChangeSet;
  payloadHash: string;
  inverseHash: string;
};

export function compileChangeSet(
  draft: DraftChangeSet,
  snapshot: WorldSnapshot,
): CompiledChangeSet;

export function planProjections(
  changeSet: CanonicalChangeSet,
): ProjectionOperation[];
```

`snapshot` 包含每项 mutation 涉及对象的旧值；反向变化只能从这些旧值生成。创建对象的反向操作使用 `archive_created_object`，提交层再依据引用判断删除或归档。

- [ ] **Step 3: 运行 Phase 2 总验证**

```powershell
pnpm test -- src/lib/world-director
pnpm test:integration -- src/lib/world-director
pnpm exec tsc --noEmit
git diff --check
```

Expected: PASS。

- [ ] **Step 4: 提交**

```powershell
git add src/lib/world-director/kernel/compile.ts src/lib/world-director/kernel/compile.test.ts src/lib/world-director/kernel/inverse.ts src/lib/world-director/kernel/inverse.test.ts src/lib/world-director/projections/plan.ts src/lib/world-director/projections/plan.test.ts
git commit -m "feat: compile reversible world changes"
```
