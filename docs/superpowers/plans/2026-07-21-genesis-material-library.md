# 创世素材库（万象藏库）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立自动收录、收藏/隐藏、不可变版本、依赖选择、独立能力分配和三级锁定约束的“万象藏库”，并把选定素材合并进现有的一次流式创世请求。

**Architecture:** 使用 `MaterialCard` 作为可查询索引、`MaterialVersion` 作为不可变 JSON 快照；素材域集中处理 Schema、拆分、依赖、预算、提示词序列化和生成结果约束。创世任务保存启动时选择快照，任务运行器只在现有单次流式请求中追加约束；创世完成后的最终编辑卡组在 embark 事务中幂等收录初始素材。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、Prisma 7/PostgreSQL、Zod 4、Vitest、Tailwind CSS 4。

---

## 约定与文件边界

### 新建文件

- `prisma/migrations/20260721160000_material_library/migration.sql`：素材表、创世任务素材快照、运行态稳定素材引用和归档状态字段。
- `src/lib/materials/types.ts`：素材种类、复用模式、依赖决定、任务快照及 API DTO 的 Zod Schema。
- `src/lib/materials/schemas.ts`：不同素材内容的联合 Schema、`schemaVersion` 迁移和本地编辑校验。
- `src/lib/materials/extract-deck.ts`：从最终 `WorldDeck` 拆分独立素材、能力和依赖。
- `src/lib/materials/repository.ts`：幂等初始收录、不可变版本、默认版本、收藏/隐藏、删除规则。
- `src/lib/materials/archive-world.ts`：从最终草稿幂等归档并维护世界归档状态。
- `src/lib/materials/runtime-snapshot.ts`：从运行态 God/Entity/Ability 构造完整剧情版本。
- `src/lib/materials/selection.ts`：依赖解析、能力拥有者校验、冲突分级、预算和确定性核心摘要。
- `src/lib/materials/prompt.ts`：将任务快照序列化为创世 Prompt 约束。
- `src/lib/materials/validate-result.ts`：生成后锁定字段、能力拥有者、依赖重建与可见性校验。
- `src/app/api/materials/route.ts`：素材列表查询。
- `src/app/api/materials/[id]/route.ts`：收藏、隐藏、默认版本、删除素材卡。
- `src/app/api/materials/[id]/versions/route.ts`：查看版本和复制编辑创建新版本。
- `src/app/api/materials/versions/[id]/route.ts`：读取/删除单个不可变版本。
- `src/app/api/materials/snapshot/route.ts`：从运行态对象手动保存剧情版本。
- `src/app/api/worlds/[id]/materials/archive/route.ts`：失败归档的本地重试入口。
- `src/app/materials/page.tsx`：万象藏库页面边界。
- `src/components/materials/MaterialLibrary.tsx`：筛选、排序、收藏、隐藏和版本操作。
- `src/components/materials/MaterialDetail.tsx`：完整内容、版本链与复制编辑。
- `src/components/materials/MaterialPicker.tsx`：创世页逐张选择、版本与复用模式。
- `src/components/materials/DependencyDialog.tsx`：依赖逐次确认与能力拥有者选择。
- `src/components/materials/ConflictPanel.tsx`：冲突优先级和阻止创世提示。
- `src/components/materials/SaveMaterialVersionButton.tsx`：运行态保存版本按钮。
- 对应 `*.test.ts` 与 `*.integration.test.ts`：每个领域行为按任务列出。

### 修改文件

- `prisma/schema.prisma`：新增素材关系及 `GenesisTask.materialSelection`。
- `src/lib/cards/schemas.ts`：为 `PlaceCard` 增加稳定 `ref`，避免地点素材无法稳定去重。
- `src/lib/prompts/genesis.ts`：接受素材约束文本，明确三种复用模式和隐藏内容规则。
- `src/lib/genesis/task-runner.ts`：读取任务素材快照、构造 Prompt、生成后本地校验。
- `src/app/api/genesis/tasks/route.ts`：校验并冻结素材选择快照。
- `src/lib/embark/mutations.ts`：物化时保存 God/Entity/Ability 的稳定素材引用。
- `src/app/api/worlds/[id]/embark/route.ts`：世界成功落地后触发独立、可重试且不阻塞开局的素材归档。
- `src/app/page.tsx`：增加素材选择入口、数量/预算/冲突摘要。
- `src/components/play/CodexPanel.tsx`、`GodPanel.tsx`、`AbilityList.tsx`：增加手动保存剧情版本入口。
- `src/components/play/PlayDrawer.tsx`：向神格页传递世界/时间线信息。
- `src/app/play/[worldId]/page.tsx`：把 world/timeline ID 传入抽屉组件。

### 实施约束

- 开始每个 Next.js Route Handler/UI 任务前，重新核对 `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` 和 `05-server-and-client-components.md`。
- 测试命令在当前环境使用 Windows Node；各任务给出完整 `cmd.exe /c` 命令。
- 集成测试数据库：`TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test`。
- 不重写历史版本；复制编辑始终 `create` 新版本。
- 未选择素材时，Prompt 和任务行为必须与现有流程一致。
- 正式创世只能保留一条 `stream("narrative", task: "genesis")` 主请求；素材不得触发逐卡模型调用。

---

## Task 1：建立素材数据库模型

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260721160000_material_library/migration.sql`
- Test: `src/lib/materials/schema-integrity.test.ts`

- [ ] **Step 1：先写失败的 Prisma Schema 完整性测试**

创建测试，读取 `prisma/schema.prisma`，断言包含：

```ts
expect(schema).toContain("model MaterialCard {");
expect(schema).toContain("model MaterialVersion {");
expect(schema).toContain("materialSelection Json?");
expect(schema).toContain("materialArchiveStatus String");
expect(schema).toContain("materialRef String?");
expect(schema).toContain("@@unique([userId, sourceKind, sourceRef])");
expect(schema).toContain("@@unique([cardId, version])");
```

- [ ] **Step 2：运行测试并确认失败**

Run:

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/lib/materials/schema-integrity.test.ts"
```

Expected: FAIL，提示缺少 `MaterialCard`。

- [ ] **Step 3：添加 Prisma 模型**

在 `World` 增加 `materialCards MaterialCard[]`，并增加 `materialArchiveStatus`（默认 `pending`）与 `materialArchiveError`。在 `God`、`Entity`、`Ability` 各增加 nullable `materialRef`，并为 `[timelineId, materialRef]` 建唯一约束，用来把开局卡组 ref 延续到运行态；剧情中新建对象没有 ref 时由快照服务使用数据库 ID 形成稳定来源键。在 `GenesisTask` 增加：

```prisma
materialSelection Json? @map("material_selection")
```

新增：

```prisma
model MaterialCard {
  id                 String            @id @default(cuid())
  userId             String            @default("local") @map("user_id")
  kind               String
  name               String
  summary            String
  favorite           Boolean           @default(false)
  hidden             Boolean           @default(false)
  sourceWorldId      String?            @map("source_world_id")
  sourceWorld        World?             @relation(fields: [sourceWorldId], references: [id], onDelete: SetNull)
  sourceWorldName    String              @map("source_world_name")
  sourceKind         String              @map("source_kind")
  sourceRef          String              @map("source_ref")
  defaultVersionId   String?             @map("default_version_id")
  versions           MaterialVersion[]   @relation("MaterialCardVersions")
  defaultVersion     MaterialVersion?    @relation("MaterialDefaultVersion", fields: [defaultVersionId], references: [id], onDelete: SetNull)
  lastUsedAt         DateTime?            @map("last_used_at")
  createdAt          DateTime             @default(now()) @map("created_at")
  updatedAt          DateTime             @updatedAt @map("updated_at")

  @@unique([userId, sourceKind, sourceRef])
  @@index([userId, favorite, hidden, updatedAt])
  @@index([sourceWorldId])
  @@map("material_cards")
}

model MaterialVersion {
  id              String            @id @default(cuid())
  cardId          String            @map("card_id")
  card            MaterialCard      @relation("MaterialCardVersions", fields: [cardId], references: [id], onDelete: Cascade)
  defaultForCards MaterialCard[]     @relation("MaterialDefaultVersion")
  version         Int
  name            String
  note            String?
  content         Json
  dependencies    Json
  schemaVersion   Int               @default(1) @map("schema_version")
  isInitial       Boolean           @default(false) @map("is_initial")
  parentVersionId String?           @map("parent_version_id")
  parentVersion   MaterialVersion?  @relation("MaterialVersionParents", fields: [parentVersionId], references: [id], onDelete: SetNull)
  childVersions   MaterialVersion[] @relation("MaterialVersionParents")
  createdAt       DateTime          @default(now()) @map("created_at")

  @@unique([cardId, version])
  @@index([parentVersionId])
  @@map("material_versions")
}
```

- [ ] **Step 4：编写迁移 SQL**

迁移必须创建两张表、外键、唯一索引，为 `genesis_tasks` 增加 `material_selection JSONB`，为 `worlds` 增加归档状态/错误字段，并为 `gods`、`entities`、`abilities` 增加 `material_ref` 与部分唯一索引。`source_world_id` 使用 `ON DELETE SET NULL`；版本与卡片使用 `ON DELETE CASCADE`；默认版本使用延后添加的外键避免建表顺序循环。

- [ ] **Step 5：生成 Prisma Client 并运行测试**

Run:

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd exec prisma generate"
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/lib/materials/schema-integrity.test.ts"
cmd.exe /c "cd /d C:\创世 && pnpm.cmd exec tsc --noEmit"
```

Expected: 全部 PASS。

- [ ] **Step 6：提交**

```bash
git add prisma/schema.prisma prisma/migrations/20260721160000_material_library/migration.sql src/lib/materials/schema-integrity.test.ts
git commit -m "feat: add material library persistence"
```

---

## Task 2：定义素材、版本和选择契约

**Files:**
- Create: `src/lib/materials/types.ts`
- Create: `src/lib/materials/schemas.ts`
- Test: `src/lib/materials/schemas.test.ts`
- Modify: `src/lib/cards/schemas.ts`
- Modify: `src/lib/cards/schemas.test.ts`

- [ ] **Step 1：写失败测试，覆盖联合 Schema 与地点稳定引用**

测试至少包含：

```ts
expect(PlaceCardSchema.safeParse({
  ref: "place:jade-city",
  name: "玉京",
  aliases: [],
  kind: "神城",
  overview: "诸神会盟之地",
  allegiance: "中立",
}).success).toBe(true);

expect(MaterialVersionContentSchema.safeParse({
  schemaVersion: 1,
  kind: "ability",
  card: validDeckAbility,
  owner: { kind: "god", sourceRef: "god:star" },
}).success).toBe(true);
```

并断言无 `ref` 的新地点失败；不仅是 pre-ability 旧草稿，当前已持久化但仅缺地点 ref 的卡组也必须由 `parsePersistedWorldDeck` 兼容正规化为确定性 `place-N` ref。

- [ ] **Step 2：运行测试确认失败**

Run:

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/lib/materials/schemas.test.ts src/lib/cards/schemas.test.ts"
```

Expected: FAIL，`PlaceCardSchema` 不接受/不要求 `ref`，素材模块不存在。

- [ ] **Step 3：实现类型契约**

在 `types.ts` 定义：

```ts
export const MaterialKindSchema = z.enum([
  "player_god", "major_god", "character", "race", "faction", "place",
  "ability", "cosmology", "fusion_axiom", "epoch_conflict", "style", "theme",
]);
export const ReuseModeSchema = z.enum(["remix", "inherit", "locked"]); // 融合改写 / 原样继承 / 完全锁定
export const DependencyDecisionSchema = z.enum(["include", "rebuild", "omit"]);
export const AbilityOwnerTargetSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("selected"), materialVersionId: z.string().min(1) }),
  z.object({ mode: z.literal("model"), allowCreateOwner: z.boolean() }),
]);
export const MaterialSelectionItemSchema = z.object({
  materialCardId: z.string().min(1),
  materialVersionId: z.string().min(1),
  mode: ReuseModeSchema,
  fullLock: z.boolean().default(false),
  dependencyDecisions: z.record(z.string(), DependencyDecisionSchema),
  abilityOwner: AbilityOwnerTargetSchema.nullable(),
  priority: z.number().int().nonnegative(),
});
export const GenesisMaterialSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  items: z.array(z.object({ selection: MaterialSelectionItemSchema, card: z.unknown(), version: z.unknown() })),
  estimatedChars: z.number().int().nonnegative(),
});
```

- [ ] **Step 4：实现素材内容联合 Schema 与迁移入口**

`schemas.ts` 使用 `kind` 判别联合；每项含 `origin: "deck" | "runtime" | "edited"`，canonical payload 能完整承载创世卡字段及运行态 sections/relations/memberships/ability state。创世来源优先复用现有 `PlayerGodCardSchema`、`MajorGodCardSchema`、`MajorCharacterCardSchema`、`RaceCardSchema`、`FactionCardSchema`、`PlaceCardSchema`、`DeckAbilitySchema` 和整体卡 Schema。导出：

```ts
export const MATERIAL_SCHEMA_VERSION = 1;
export const MaterialVersionContentSchema = z.discriminatedUnion("kind", [
  PlayerGodMaterialSchema, MajorGodMaterialSchema, CharacterMaterialSchema,
  RaceMaterialSchema, FactionMaterialSchema, PlaceMaterialSchema, AbilityMaterialSchema,
  CosmologyMaterialSchema, FusionAxiomMaterialSchema, EpochConflictMaterialSchema,
  StyleMaterialSchema, ThemeMaterialSchema,
]);
export function parseMaterialVersionContent(raw: unknown) {
  const migrated = migrateMaterialVersion(raw);
  return MaterialVersionContentSchema.parse(migrated);
}
export function migrateMaterialVersion(raw: unknown): unknown {
  // version 1 原样返回；未知未来版本明确报错，绝不覆盖历史 JSON。
}
```

- [ ] **Step 5：为地点添加 `ref` 和旧数据正规化**

`PlaceCardSchema` 增加 `ref: StableRefSchema`；把地点纳入引用唯一性扫描；新增 `normalizeMissingPlaceRefs`，让当前能力版旧草稿在仅缺地点 ref 时也可安全迁移；`normalizeLegacyWorldDeck` 同样为地点补 `place-${index + 1}`。更新测试夹具中所有地点。

- [ ] **Step 6：运行测试和类型检查**

Run:

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/lib/materials/schemas.test.ts src/lib/cards/schemas.test.ts"
cmd.exe /c "cd /d C:\创世 && pnpm.cmd exec tsc --noEmit"
```

Expected: PASS。

- [ ] **Step 7：提交**

```bash
git add src/lib/materials/types.ts src/lib/materials/schemas.ts src/lib/materials/schemas.test.ts src/lib/cards/schemas.ts src/lib/cards/schemas.test.ts src/lib/abilities/embark.test-fixtures.ts
git commit -m "feat: define immutable material contracts"
```

---

## Task 3：从最终卡组拆分素材和依赖

**Files:**
- Create: `src/lib/materials/extract-deck.ts`
- Test: `src/lib/materials/extract-deck.test.ts`

- [ ] **Step 1：写失败测试**

使用 `completeDeck()` 断言：

```ts
const materials = extractDeckMaterials(completeDeck());
expect(materials.filter((item) => item.kind === "major_god")).toHaveLength(deck.majorGods.length);
expect(materials.filter((item) => item.kind === "ability")).toHaveLength(totalAbilityCount);
expect(materials.find((item) => item.sourceRef === character.ref)?.dependencies)
  .toEqual(expect.arrayContaining([
    expect.objectContaining({ relation: "race", targetRef: character.raceRef }),
  ]));
```

还要覆盖人物势力、传统能力来源、能力 owner、融合公理为 null 时不生成素材。

- [ ] **Step 2：运行测试确认模块不存在**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/lib/materials/extract-deck.test.ts"
```

Expected: FAIL，找不到 `extractDeckMaterials`。

- [ ] **Step 3：实现纯函数拆分器**

导出：

```ts
export type ExtractedMaterial = {
  kind: MaterialKind;
  sourceKind: string;
  sourceRef: string;
  name: string;
  summary: string;
  content: MaterialVersionContent;
  dependencies: MaterialDependency[];
};

export function extractDeckMaterials(deck: WorldDeck): ExtractedMaterial[];
```

规则：

- 玩家神、每位主神、人物、种族、势力、地点逐项拆分。
- 能力以其自身 `ref` 拆成独立卡，内容带 owner kind/sourceRef。
- 宇宙论等单卡稳定来源键使用 `world:cosmology`、`world:theme` 等；仓储层会再加世界 ID 形成全局来源键。
- 所属对象快照保留嵌入能力；独立能力同时存在。
- 隐藏议程、隐藏能力及时代暗流不得裁剪。

- [ ] **Step 4：运行测试**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/lib/materials/extract-deck.test.ts"
```

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add src/lib/materials/extract-deck.ts src/lib/materials/extract-deck.test.ts
git commit -m "feat: extract reusable cards from world decks"
```

---

## Task 4：实现幂等初始收录与不可变版本仓储

**Files:**
- Create: `src/lib/materials/repository.ts`
- Test: `src/lib/materials/repository.integration.test.ts`

- [ ] **Step 1：写 PostgreSQL 失败测试**

覆盖：

1. 同一世界同一卡组调用 `archiveInitialDeck` 两次，只产生一张素材卡和一个初始版本。
2. 收藏/隐藏更新只改变卡片索引。
3. `createVersionCopy` 产生 `version + 1`，旧 JSON 不变并记录 `parentVersionId`。
4. 默认版本必须属于同一素材卡。
5. 删除来源世界后素材仍存在，`sourceWorldId === null` 且来源名称保留。
6. 最后一个版本不能删除。

- [ ] **Step 2：运行集成测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && set TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test&& pnpm.cmd exec vitest run --config vitest.integration.config.ts src/lib/materials/repository.integration.test.ts"
```

Expected: FAIL，仓储不存在。

- [ ] **Step 3：实现仓储 API**

导出：

```ts
export async function archiveInitialDeck(
  tx: Prisma.TransactionClient,
  input: { worldId: string; worldName: string; deck: WorldDeck },
): Promise<void>;

export async function createMaterialVersion(input: {
  cardId: string;
  name: string;
  note?: string;
  content: MaterialVersionContent;
  dependencies: MaterialDependency[];
  parentVersionId?: string;
  setDefault?: boolean;
}): Promise<MaterialVersion>;

export async function updateMaterialCardIndex(
  cardId: string,
  patch: { favorite?: boolean; hidden?: boolean; lastUsedAt?: Date | null },
): Promise<void>;
export async function setDefaultMaterialVersion(cardId: string, versionId: string): Promise<void>;
export async function deleteMaterialVersion(versionId: string): Promise<void>;
```

`archiveInitialDeck` 使用来源键 `${worldId}:${sourceKind}:${sourceRef}` upsert 卡片，并在事务内创建一次 `isInitial=true` 的版本。版本号分配在 `Serializable` 事务中完成，唯一约束作为并发最后防线。

- [ ] **Step 4：运行集成测试**

```bash
cmd.exe /c "cd /d C:\创世 && set TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test&& pnpm.cmd exec vitest run --config vitest.integration.config.ts src/lib/materials/repository.integration.test.ts"
```

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add src/lib/materials/repository.ts src/lib/materials/repository.integration.test.ts
git commit -m "feat: persist immutable material versions"
```

---

## Task 5：在开局后自动归档最终编辑卡组

**Files:**
- Modify: `src/lib/embark/mutations.ts`
- Modify: `src/app/api/worlds/[id]/embark/route.ts`
- Create: `src/lib/materials/archive-world.ts`
- Create: `src/app/api/worlds/[id]/materials/archive/route.ts`
- Modify: `src/lib/abilities/embark.integration.test.ts`
- Test: `src/lib/materials/archive-world.integration.test.ts`

- [ ] **Step 1：写失败集成测试**

覆盖：

```ts
const result = await runClaimedEmbarkTransaction(prisma, world.id, async () => deck);
await archiveWorldMaterials(world.id);
const cards = await prisma.materialCard.findMany({
  where: { sourceWorldId: world.id },
  include: { versions: true },
});
expect(cards.length).toBeGreaterThan(0);
expect(cards.every((card) => card.versions.some((version) => version.isInitial))).toBe(true);
```

再验证：

- materialize 后 God/Entity/Ability 的 `materialRef` 与卡组 ref 一致。
- 重复归档只产生一套素材。
- 注入归档失败时，世界仍为 `playing`，`materialArchiveStatus="failed"` 且记录可读错误。
- 调用重试入口后变为 `completed`。
- 并发 embark 仍只有一个世界和一套素材。

- [ ] **Step 2：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && set TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test&& pnpm.cmd exec vitest run --config vitest.integration.config.ts src/lib/abilities/embark.integration.test.ts src/lib/materials/archive-world.integration.test.ts"
```

Expected: FAIL，没有素材卡和归档状态。

- [ ] **Step 3：物化时延续稳定素材引用**

`materializeEmbarkDeck` 创建 God、Entity、Ability 时写入其卡组 `ref` 到 `materialRef`；`materializeDeckAbilities` 同步接受并写入能力 ref。地点使用 Task 2 新增的 ref。

- [ ] **Step 4：实现非阻塞归档协调器**

`archive-world.ts` 导出：

```ts
export async function archiveWorldMaterials(worldId: string): Promise<void>;
```

它读取最终 `draftDeck`，在独立 `Serializable` 事务内调用 `archiveInitialDeck`，成功写 `completed`；失败写 `failed` 和安全截断错误后重新抛出。embark 路由先完成世界物化，再调用归档；归档异常只记录日志，不把已成功的开局响应改成失败。

- [ ] **Step 5：实现本地重试路由**

`POST /api/worlds/[id]/materials/archive` 仅允许本地世界且状态为 `failed|pending`，调用同一协调器；成功 200，正在/已完成返回 409/幂等 200。

- [ ] **Step 6：运行开局与归档集成测试**

运行 Step 2 命令，Expected: PASS。

- [ ] **Step 7：提交**

```bash
git add src/lib/embark/mutations.ts src/lib/abilities/embark.ts src/app/api/worlds/[id]/embark/route.ts src/lib/materials/archive-world.ts src/app/api/worlds/[id]/materials/archive/route.ts src/lib/abilities/embark.integration.test.ts src/lib/materials/archive-world.integration.test.ts
git commit -m "feat: archive initial materials after embark"
```

---

## Task 6：实现素材列表、收藏、隐藏和版本 API

**Files:**
- Create: `src/app/api/materials/route.ts`
- Create: `src/app/api/materials/[id]/route.ts`
- Create: `src/app/api/materials/[id]/versions/route.ts`
- Create: `src/app/api/materials/versions/[id]/route.ts`
- Test: `src/app/api/materials/route.integration.test.ts`
- Test: `src/app/api/materials/[id]/route.test.ts`

- [ ] **Step 1：重读 Next Route Handler 文档**

```bash
sed -n '1,180p' node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
```

确认 GET 默认不缓存，动态段参数使用 `params: Promise<{ id: string }>`。

- [ ] **Step 2：写失败测试**

覆盖：

- `GET /api/materials?kind=character&q=岚&showHidden=false`。
- 排序为收藏、最近使用、最近更新。
- `PATCH /api/materials/[id]` 仅接受 `favorite`、`hidden`、`defaultVersionId`。
- `POST /api/materials/[id]/versions` 必须携父版本，创建新版本而非覆盖。
- 删除最后版本返回 409。
- 非本地用户素材不可访问。

- [ ] **Step 3：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && set TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test&& pnpm.cmd exec vitest run --config vitest.integration.config.ts src/app/api/materials/route.integration.test.ts"
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/app/api/materials/[id]/route.test.ts"
```

Expected: FAIL，路由不存在。

- [ ] **Step 4：实现列表与变更路由**

`GET` 返回轻量 DTO：卡片、默认版本摘要、版本数、来源状态。所有查询显式限定 `userId: "local"`。关键词匹配 `name/summary/sourceWorldName`；隐藏默认排除。

`PATCH` 通过 Zod：

```ts
const PatchMaterialCardSchema = z.object({
  favorite: z.boolean().optional(),
  hidden: z.boolean().optional(),
  defaultVersionId: z.string().nullable().optional(),
}).strict();
```

版本 POST 使用 `parseMaterialVersionContent` 校验，调用仓储创建新版本。

- [ ] **Step 5：运行测试**

运行 Step 3 的两个命令，Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add src/app/api/materials src/lib/materials/repository.ts
git commit -m "feat: expose material library APIs"
```

---

## Task 7：建立万象藏库页面

**Files:**
- Create: `src/app/materials/page.tsx`
- Create: `src/components/materials/MaterialLibrary.tsx`
- Create: `src/components/materials/MaterialDetail.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/archives/page.tsx`
- Modify: `src/app/api/worlds/route.ts`
- Test: `src/components/materials/material-library-state.test.ts`
- Create: `src/components/materials/material-library-state.ts`

- [ ] **Step 1：重读 Server/Client Component 文档**

```bash
sed -n '1,170p' node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
```

`page.tsx` 保持 Server Component 外壳；交互放入 `MaterialLibrary.tsx` 的 client boundary。

- [ ] **Step 2：写失败的状态纯函数测试**

测试：收藏优先、隐藏默认过滤、来源世界已删除标签、类型/关键词筛选、选中版本后详情保持稳定。

```ts
expect(sortMaterials([normal, favorite]).map((x) => x.id)).toEqual([favorite.id, normal.id]);
expect(filterMaterials([hidden, visible], {
  showHidden: false,
  favoriteOnly: false,
  kind: null,
  sourceWorldName: null,
  query: "",
})).toEqual([visible]);
```

- [ ] **Step 3：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/components/materials/material-library-state.test.ts"
```

Expected: FAIL，模块不存在。

- [ ] **Step 4：实现状态函数和页面 UI**

页面必须提供：

- 类型、来源、收藏、隐藏、版本类别和关键词筛选。
- 收藏、隐藏按钮立即乐观更新，失败回滚。
- 详情展示完整 JSON 的结构化字段，而不是只显示原始文本。
- 版本时间线、默认版本选择、复制编辑、删除版本/素材。
- 来源 ID 为空时显示“来源世界已删除”。

往昔诸界列表显示 `materialArchiveStatus=failed` 的提示和“重试收录”按钮，调用 Task 5 的本地重试路由。首页 footer 增加：

```tsx
<Link href="/materials">✦ 万象藏库</Link>
```

- [ ] **Step 5：运行单测、lint 和构建**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/components/materials/material-library-state.test.ts"
cmd.exe /c "cd /d C:\创世 && pnpm.cmd lint"
cmd.exe /c "cd /d C:\创世 && pnpm.cmd build"
```

Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add src/app/materials src/components/materials src/app/page.tsx
git commit -m "feat: add the myriad material library"
```

---

## Task 8：实现依赖、能力拥有者、冲突和预算纯逻辑

**Files:**
- Create: `src/lib/materials/selection.ts`
- Test: `src/lib/materials/selection.test.ts`

- [ ] **Step 1：写失败测试**

覆盖：

- 选人物返回种族、势力、能力来源依赖。
- `include/rebuild/omit` 决定不会留下悬空旧 ref。
- `divine/personal/racial_*` 对拥有者类型约束。
- 无合法拥有者且 `allowCreateOwner=false` 为阻断错误。
- locked×locked 显式字段冲突阻断。
- inherit 冲突产生“必须由玩家指定优先级”的阻断项。
- remix×remix 产生 `fusionAxiomRequired=true`。
- 预算按序列化字符数估算并列出最大素材。
- 确定性核心摘要保留 ref、名称、核心字段、能力效果/代价/限制和隐藏可见性。

- [ ] **Step 2：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/lib/materials/selection.test.ts"
```

Expected: FAIL。

- [ ] **Step 3：实现选择校验 API**

导出：

```ts
export function resolveDependencies(items: SelectedMaterial[]): DependencyResolution[];
export function validateAbilityOwners(items: SelectedMaterial[]): SelectionIssue[];
export function detectMaterialConflicts(items: SelectedMaterial[]): MaterialConflict[];
export function estimateMaterialBudget(items: SelectedMaterial[]): MaterialBudget;
export function summarizeMaterialLocally(version: MaterialVersionContent): MaterialVersionContent;
export function validateSelection(items: SelectedMaterial[]): SelectionValidation;
```

显式冲突只比较同一规范字段路径的不同标量/枚举值；不使用脆弱的自然语言相似度猜测。

- [ ] **Step 4：运行测试**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/lib/materials/selection.test.ts"
```

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add src/lib/materials/selection.ts src/lib/materials/selection.test.ts
git commit -m "feat: validate material selections locally"
```

---

## Task 9：构建创世素材选择器

**Files:**
- Create: `src/components/materials/MaterialPicker.tsx`
- Create: `src/components/materials/DependencyDialog.tsx`
- Create: `src/components/materials/ConflictPanel.tsx`
- Modify: `src/app/page.tsx`
- Test: `src/components/materials/material-picker-state.test.ts`
- Create: `src/components/materials/material-picker-state.ts`

- [ ] **Step 1：写失败的选择状态测试**

测试逐张选择、切换版本、三种模式、完全锁定开关、依赖弹窗决定、能力拥有者、冲突优先级、移除素材和预算超限阻止提交。

- [ ] **Step 2：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/components/materials/material-picker-state.test.ts"
```

Expected: FAIL。

- [ ] **Step 3：实现选择器和首页集成**

首页增加“引用创世素材（已选 N 项）”。选择器：

- 默认隐藏隐藏项，收藏优先。
- 每项选择具体版本及 `remix/inherit/locked`。
- inherit 默认核心锁定；`fullLock` 明确显示。
- 选择有依赖素材时必须完成 `DependencyDialog` 才加入。
- 独立能力可指定所选合法 owner 或允许模型创建/分配。
- `ConflictPanel` 展示阻断项和优先级选择。
- 显示字符预算和最大占用卡；超限时提供“本地核心摘要”。

提交任务的 body 增加：

```ts
materialSelections: selection.items
```

- [ ] **Step 4：运行测试、lint**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/components/materials/material-picker-state.test.ts"
cmd.exe /c "cd /d C:\创世 && pnpm.cmd lint"
```

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add src/components/materials src/app/page.tsx
git commit -m "feat: select reusable cards during genesis"
```

---

## Task 10：在创建任务时冻结素材快照

**Files:**
- Modify: `src/app/api/genesis/tasks/route.ts`
- Modify: `src/app/api/genesis/tasks/route.test.ts`
- Modify: `src/app/api/genesis/tasks/route.integration.test.ts`

- [ ] **Step 1：写失败测试**

覆盖：

- 空选择仍存 `materialSelection=null`。
- 请求只提交卡/版本 ID 与决定；服务端从数据库装载完整版本。
- 不存在、隐藏但未显式允许、非本地用户或版本不属于卡片时返回 400/404。
- 创建任务后删除素材版本，任务内 JSON 快照仍完整。
- 服务端重新执行依赖、拥有者、冲突和预算校验，不能信任客户端。

- [ ] **Step 2：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/app/api/genesis/tasks/route.test.ts"
cmd.exe /c "cd /d C:\创世 && set TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test&& pnpm.cmd exec vitest run --config vitest.integration.config.ts src/app/api/genesis/tasks/route.integration.test.ts"
```

Expected: FAIL，Schema 不接受素材选择。

- [ ] **Step 3：扩展创建任务路由**

`CreateGenesisTaskSchema` 增加 `materialSelections`。新增私有装载函数：

```ts
async function buildGenesisMaterialSnapshot(
  selections: MaterialSelectionItem[],
): Promise<GenesisMaterialSnapshot | null>
```

用事务查询卡片和版本，解析每个内容，运行 `validateSelection`，将完整版本内容和所有决定写入 `GenesisTask.materialSelection`。同时更新被使用卡片的 `lastUsedAt`。

- [ ] **Step 4：运行测试**

运行 Step 2 两条命令，Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add src/app/api/genesis/tasks/route.ts src/app/api/genesis/tasks/route.test.ts src/app/api/genesis/tasks/route.integration.test.ts
git commit -m "feat: freeze material snapshots in genesis tasks"
```

---

## Task 11：把素材约束加入唯一一次流式创世请求

**Files:**
- Create: `src/lib/materials/prompt.ts`
- Test: `src/lib/materials/prompt.test.ts`
- Modify: `src/lib/prompts/genesis.ts`
- Modify: `src/lib/genesis/task-runner.ts`
- Modify: `src/lib/genesis/task-runner.test.ts`

- [ ] **Step 1：写失败测试**

断言序列化内容含：

- 版本快照和来源标签。
- 每项模式、核心锁定/完全锁定路径。
- 依赖 include/rebuild/omit 决定。
- 能力 owner 决定。
- 冲突优先级。
- 隐藏内容“只作幕后约束，不公开泄露”。

任务运行器测试注入一项素材，断言：

```ts
expect(stream).toHaveBeenCalledTimes(1);
expect(stream).toHaveBeenCalledWith("narrative", expect.objectContaining({
  task: "genesis",
  messages: expect.arrayContaining([
    expect.objectContaining({ role: "user", content: expect.stringContaining("GENESIS MATERIALS") }),
  ]),
}));
expect(completeStructured).not.toHaveBeenCalled(); // 有效首轮输出
```

- [ ] **Step 2：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/lib/materials/prompt.test.ts src/lib/genesis/task-runner.test.ts"
```

Expected: FAIL。

- [ ] **Step 3：实现素材 Prompt 序列化**

导出：

```ts
export function materialConstraintsPrompt(snapshot: GenesisMaterialSnapshot | null): string;
```

按 `priority` 稳定排序；输出 JSON 约束块而不是模糊自然语言；完全锁定列出完整字段，inherit 列出核心字段，remix 标记灵感来源。

扩展：

```ts
export function genesisUserPrompt(
  decree: string,
  lorebookExcerpts?: string,
  materialConstraints?: string,
): string;
```

- [ ] **Step 4：任务运行器只追加输入，不增加调用**

解析 `task.materialSelection`，生成一次 `materialText`，传入首轮 `genesisUserPrompt` 和修复 Prompt。不得新增循环、逐卡 `completeStructured` 或额外预处理模型调用。

- [ ] **Step 5：运行测试**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/lib/materials/prompt.test.ts src/lib/genesis/task-runner.test.ts src/lib/genesis/generate.test.ts"
```

Expected: PASS，首轮有效输出只有一次 `stream`。

- [ ] **Step 6：提交**

```bash
git add src/lib/materials/prompt.ts src/lib/materials/prompt.test.ts src/lib/prompts/genesis.ts src/lib/genesis/task-runner.ts src/lib/genesis/task-runner.test.ts
git commit -m "feat: apply materials in one genesis request"
```

---

## Task 12：实现生成结果继承约束校验

**Files:**
- Create: `src/lib/materials/validate-result.ts`
- Test: `src/lib/materials/validate-result.test.ts`
- Modify: `src/lib/genesis/generate.ts`
- Modify: `src/lib/genesis/generate.test.ts`
- Modify: `src/lib/prompts/genesis.ts`

- [ ] **Step 1：写失败测试**

覆盖：

- 完全锁定卡逐字段变化时报具体路径。
- inherit 的名称、身份、核心背景和能力机制变化时报错；地域/关系适配允许。
- remix 不做等值限制。
- 独立能力必须存在且 owner 类型正确。
- rebuild 依赖不能保留旧悬空 ref。
- 隐藏能力不得被改为 `known`，除非选择明确允许。
- 两个 remix 宇宙规则冲突时结果需要非空 `fusionAxiom`。

- [ ] **Step 2：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/lib/materials/validate-result.test.ts src/lib/genesis/generate.test.ts"
```

Expected: FAIL。

- [ ] **Step 3：实现结果校验器**

导出：

```ts
export type MaterialConstraintIssue = { code: string; materialVersionId: string; path: string; message: string };
export function validateMaterializedDeck(
  deck: WorldDeck,
  snapshot: GenesisMaterialSnapshot | null,
): MaterialConstraintIssue[];
```

采用稳定 ref 和选材映射查找对象；完全锁定做深度字段比较；inherit 只比较 `coreLockedPaths(kind)`；能力 owner 检查复用 `AbilityKindSchema` 规则。

- [ ] **Step 4：接入现有验证/修复流程**

`generateGenesisDeck` 在 `WorldDeckSchema` 与 `validateDeckReferences` 后运行素材校验。首轮违反约束时，把 issues 放入现有一次修复 Prompt；修复结果再次验证。不得新增第三次重试。

`genesisRepairPrompt` 增加素材约束文本和违反项，要求只修复报告的继承约束。

- [ ] **Step 5：运行测试**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/lib/materials/validate-result.test.ts src/lib/genesis/generate.test.ts src/lib/genesis/task-runner.test.ts"
```

Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add src/lib/materials/validate-result.ts src/lib/materials/validate-result.test.ts src/lib/genesis/generate.ts src/lib/genesis/generate.test.ts src/lib/prompts/genesis.ts
git commit -m "feat: validate inherited genesis materials"
```

---

## Task 13：实现运行态剧情版本快照

**Files:**
- Create: `src/lib/materials/runtime-snapshot.ts`
- Test: `src/lib/materials/runtime-snapshot.integration.test.ts`
- Create: `src/app/api/materials/snapshot/route.ts`
- Test: `src/app/api/materials/snapshot/route.test.ts`

- [ ] **Step 1：写失败测试**

创建运行态世界，覆盖：

- God 快照含 persona、voice、agenda、relations、全部能力（包括 hidden）。
- Character 快照含 sections、race、memberships、个人/来源能力与可见性。
- Race/Faction/Place 快照含 sections 与能力。
- Ability 可独立快照，保留原 owner、sourceAbility 和历史状态。
- API 要求 `sourceType` + `sourceId` + 版本名；可设默认版本。
- 普通玩家 Codex API 仍隐藏隐私，但素材快照服务端能保存完整内容。

- [ ] **Step 2：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && set TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test&& pnpm.cmd exec vitest run --config vitest.integration.config.ts src/lib/materials/runtime-snapshot.integration.test.ts"
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/app/api/materials/snapshot/route.test.ts"
```

Expected: FAIL。

- [ ] **Step 3：实现服务端快照构造**

导出：

```ts
export async function snapshotRuntimeMaterial(input: {
  sourceType: "god" | "entity" | "ability";
  sourceId: string;
}): Promise<{
  cardIdentity: {
    kind: MaterialKind;
    sourceKind: "god" | "entity" | "ability";
    sourceRef: string;
    name: string;
    summary: string;
    sourceWorldId: string;
    sourceWorldName: string;
  };
  content: MaterialVersionContent;
  dependencies: MaterialDependency[];
}>;
```

查询必须限定对象属于 `userId="local"` 的世界；返回完整幕后数据，不能复用玩家投影后的 Codex DTO。优先用运行态 `materialRef` 找到初始素材卡；剧情中新对象没有 `materialRef` 时使用 `${worldId}:runtime:${sourceType}:${sourceId}` 新建稳定来源键。运行态记录映射到 Task 2 的 canonical material payload，并以 `origin: "runtime"` 区分创世卡快照。

- [ ] **Step 4：实现保存 API**

Zod body：

```ts
z.object({
  sourceType: z.enum(["god", "entity", "ability"]),
  sourceId: z.string().min(1),
  versionName: z.string().trim().min(1).max(80),
  note: z.string().max(500).optional(),
  setDefault: z.boolean().default(false),
}).strict()
```

根据稳定来源键查找/新建素材卡，调用 `createMaterialVersion`。

- [ ] **Step 5：运行测试**

执行 Step 2 命令，Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add src/lib/materials/runtime-snapshot.ts src/lib/materials/runtime-snapshot.integration.test.ts src/app/api/materials/snapshot
git commit -m "feat: save runtime cards as material versions"
```

---

## Task 14：在神明、众生和能力详情中加入保存入口

**Files:**
- Create: `src/components/materials/SaveMaterialVersionButton.tsx`
- Modify: `src/components/play/CodexPanel.tsx`
- Modify: `src/components/play/GodPanel.tsx`
- Modify: `src/components/play/AbilityList.tsx`
- Modify: `src/components/play/PlayDrawer.tsx`
- Modify: `src/app/play/[worldId]/page.tsx`
- Test: `src/components/materials/save-material-version-state.test.ts`

- [ ] **Step 1：写失败状态测试**

覆盖弹窗开关、版本名必填、提交 pending、防重复点击、成功关闭、失败保留输入和“设为默认版本”。

- [ ] **Step 2：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/components/materials/save-material-version-state.test.ts"
```

Expected: FAIL。

- [ ] **Step 3：实现通用保存按钮**

组件 props：

```ts
type SaveMaterialVersionButtonProps = {
  sourceType: "god" | "entity" | "ability";
  sourceId: string;
  compact?: boolean;
};
```

点击后收集版本名称、备注和默认版本开关，POST `/api/materials/snapshot`。

- [ ] **Step 4：接入三个详情位置**

- `CodexPanel` 实体详情 header：保存实体版本。
- `GodPanel` 玩家神/主神卡：保存神版本。
- `AbilityList` 每个已知/传闻能力卡：保存独立能力版本；组件增加 `allowMaterialSave`，隐藏能力不会抵达玩家 UI，但可随所属卡快照保存。
- `PlayDrawer` 与 play page 传递必要的 world/timeline 上下文（API 最终仍以 source ID 反查授权）。

- [ ] **Step 5：运行测试、lint、build**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/components/materials/save-material-version-state.test.ts src/components/play/AbilityList.test.ts"
cmd.exe /c "cd /d C:\创世 && pnpm.cmd lint"
cmd.exe /c "cd /d C:\创世 && pnpm.cmd build"
```

Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add src/components/materials/SaveMaterialVersionButton.tsx src/components/play src/app/play/[worldId]/page.tsx
git commit -m "feat: save story cards to the material library"
```

---

## Task 15：完善删除、来源删除和草稿引用规则

**Files:**
- Modify: `src/app/api/worlds/[id]/route.ts`
- Modify: `src/app/api/materials/[id]/route.ts`
- Modify: `src/app/api/materials/versions/[id]/route.ts`
- Test: `src/app/api/materials/deletion.integration.test.ts`

- [ ] **Step 1：写失败集成测试**

覆盖：

- 删除世界后素材 `sourceWorldId` 自动为 null、名称和版本仍在。
- 已启动 GenesisTask 的素材快照不受素材/版本删除影响。
- 尚未启动的“选择”不存服务器草稿，因此客户端重新打开时发现版本不存在并标失效。
- 删除素材卡不影响已经生成的新世界。
- 删除默认版本时自动拒绝，需先切换默认版本。

- [ ] **Step 2：运行测试确认失败**

```bash
cmd.exe /c "cd /d C:\创世 && set TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test&& pnpm.cmd exec vitest run --config vitest.integration.config.ts src/app/api/materials/deletion.integration.test.ts"
```

Expected: FAIL。

- [ ] **Step 3：实现清晰的删除返回**

依赖数据库 `ON DELETE SET NULL` 保留素材。版本删除路由检查：

```ts
if (card.defaultVersionId === version.id) return 409;
if (card.versions.length <= 1) return 409;
```

卡片删除只删除素材域记录，不遍历或修改世界。

- [ ] **Step 4：运行测试**

执行 Step 2，Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add src/app/api/worlds/[id]/route.ts src/app/api/materials src/app/api/materials/deletion.integration.test.ts
git commit -m "fix: preserve material snapshots across deletions"
```

---

## Task 16：端到端回归与文档收尾

**Files:**
- Modify: `docs/01-产品需求文档.md`（若该文档存在对应导航/功能章节）
- Modify: `docs/03-数据模型.md`
- Modify: `docs/04-提示词模板.md`
- Test: all unit/integration suites

- [ ] **Step 1：增加最终回归测试**

在任务运行器/创世集成测试中串联：

1. 旧世界开局自动收录。
2. 收藏一张人物卡、选择某版本为 inherit。
3. 确认 race 为 rebuild，独立 divine 能力允许模型创建神 owner。
4. 创建 GenesisTask 后删除来源世界。
5. 任务仍使用冻结快照。
6. 模型主流请求恰好一次。
7. 结果通过继承约束并产生新世界。
8. 新世界修改不改变旧素材版本。

- [ ] **Step 2：运行目标回归**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test src/lib/materials src/lib/genesis src/components/materials"
cmd.exe /c "cd /d C:\创世 && set TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test&& pnpm.cmd test:integration"
```

Expected: PASS。

- [ ] **Step 3：更新项目文档**

记录：

- `MaterialCard`/`MaterialVersion` 数据关系。
- 三种复用模式和三级冲突规则。
- 素材任务快照与一次流式模型请求。
- 隐藏内容仅幕后使用。
- API 路由和错误码。

- [ ] **Step 4：运行完整验证**

```bash
cmd.exe /c "cd /d C:\创世 && pnpm.cmd test"
cmd.exe /c "cd /d C:\创世 && set TEST_DATABASE_URL=postgresql://genesis:genesis_dev@localhost:5433/genesis_test&& pnpm.cmd test:integration"
cmd.exe /c "cd /d C:\创世 && pnpm.cmd exec tsc --noEmit"
cmd.exe /c "cd /d C:\创世 && pnpm.cmd lint"
cmd.exe /c "cd /d C:\创世 && pnpm.cmd build"
git diff --check
```

Expected:

- 所有单元和集成测试通过。
- TypeScript、ESLint、Next production build 通过。
- `git diff --check` 无输出。
- `grep -R "stream(\"narrative\"" src/lib/genesis` 显示创世主请求仍只有任务运行器中的一条生产调用。

- [ ] **Step 5：按验收清单手测**

1. 创建世界并开局，万象藏库出现独立神、人物、种族、势力、地点、能力和整体设定。
2. 收藏置顶、隐藏默认消失、显示隐藏恢复。
3. 复制版本不改变旧版本。
4. 创世选择人物触发依赖确认。
5. 能力 owner 类型不合法时无法开始。
6. 完全锁定硬冲突阻止开始。
7. 刷新进度页后任务继续使用相同素材。
8. 删除旧世界后素材仍可复用。
9. 新世界生成后与旧素材独立演化。

- [ ] **Step 6：提交**

```bash
git add docs/01-产品需求文档.md docs/03-数据模型.md docs/04-提示词模板.md
git add src/lib/materials src/components/materials src/app/api/materials src/app/materials
git add src/app/api/genesis src/lib/genesis src/lib/prompts/genesis.ts src/app/page.tsx src/app/archives/page.tsx
git add src/lib/embark src/lib/abilities/embark.ts src/components/play src/app/play/[worldId]/page.tsx
git add prisma/schema.prisma prisma/migrations/20260721160000_material_library/migration.sql
git commit -m "feat: complete the genesis material library"
```

---

## 实施顺序与风险控制

1. **Task 1–5** 先完成数据库、内容契约和自动收录，交付一个可通过 API 验证的只读素材底座。
2. **Task 6–7** 交付独立万象藏库，不触碰创世模型路径。
3. **Task 8–12** 才接入新创世选择、任务快照和模型约束；每一步保持“无选择时行为不变”。
4. **Task 13–15** 补运行态版本与生命周期操作。
5. **Task 16** 做完整回归和文档。

主要风险与对应测试：

- **地点缺稳定 ref**：Task 2 先迁移 Schema 和旧数据正规化。
- **自动收录使用了模型初稿而非玩家最终编辑版**：Task 5 明确在 embark 时收录。
- **素材版本删除导致运行中任务漂移**：Task 10 冻结完整 JSON 快照。
- **多素材导致额外模型调用**：Task 11 断言有效首轮仅一次 `stream`。
- **隐藏内容泄露**：Task 12 校验可见性，Task 13 使用服务端完整快照但不改变玩家投影 API。
- **版本号并发重复**：Task 4 使用 Serializable + 唯一键。
- **来源世界删除级联素材**：Task 1 使用 `ON DELETE SET NULL`，Task 15 做真实数据库验证。
