# 结构化能力系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $team (coordinated parallel execution) or $ralph (persistent single-owner completion) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为新世界建立可继承、可见性受控、可随章节演化的种族能力、神权与主要人物技能系统，同时保持现有手动章节结算流程不变。

**Architecture:** Prisma 新增能力、能力事件与人物势力成员关系；`src/lib/abilities/` 作为所有继承解析、可见性投影、校验、上下文和变更写入的唯一服务层。创世卡组通过稳定 `ref` 建立交叉引用，开局时在单事务中物化为数据库 ID；叙事与章末抽取只经能力服务读取和修改状态。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、Prisma 7/PostgreSQL、Zod 4、Vitest（新增）、Tailwind v4。

---

## 实施前约束

- 以 [设计规格](/mnt/c/创世/docs/omx/specs/2026-07-20-structured-ability-system-design.md) 为唯一产品规则来源。
- 不修改“同章多轮对话 → 玩家点击结束本章 → 集中结算”的流程；`InputDeck.tsx`、`SettleCeremony.tsx` 的交互语义必须保持。
- 不添加技能快捷栏、数值战斗、法力、冷却、伤害或成功率。
- 保留当前未提交的 `pnpm-workspace.yaml` 和 `.claude/` 改动，不暂存、不修改、不纳入任何提交。
- 每项实现先写测试，观察失败后写最小实现；每个任务完成后运行该任务命令并独立提交。

## 文件结构与职责

| 路径 | 变更 | 职责 |
| --- | --- | --- |
| `package.json`、`pnpm-lock.yaml`、`vitest.config.ts` | 修改/新建 | 引入并配置 Vitest，提供单元与数据库集成测试命令。 |
| `prisma/schema.prisma`、`prisma/migrations/<timestamp>_structured_abilities/migration.sql` | 修改/新建 | `Ability`、`AbilityEvent`、`EntityMembership` 和人物种族/主要人物字段。 |
| `src/lib/abilities/types.ts` | 新建 | 共享枚举、DTO、能力可见性与变更输入类型。 |
| `src/lib/abilities/resolver.ts` | 新建 | 默认种族继承与人物覆写合并。 |
| `src/lib/abilities/visibility.ts` | 新建 | `known`/`rumored`/`hidden` 服务端投影。 |
| `src/lib/abilities/validator.ts` | 新建 | 所有者、来源、时间线、锁定字段、状态跃迁和草稿引用校验。 |
| `src/lib/abilities/mutations.ts` | 新建 | 原子创建、更新、揭示与演化事件；幂等写入。 |
| `src/lib/abilities/context.ts` | 新建 | 叙事模型/诸神后台模型的能力上下文。 |
| `src/lib/cards/schemas.ts`、`src/lib/prompts/genesis.ts` | 修改 | 创世卡组、稳定 `ref`、能力和主要人物的 Zod/Prompt 契约。 |
| `src/app/api/worlds/route.ts`、`src/app/api/worlds/[id]/route.ts`、`src/app/api/worlds/[id]/reroll/route.ts` | 修改 | 生成、保存和重掷时执行草稿跨引用校验并保留锁定项。 |
| `src/components/genesis/*`、`src/app/genesis/[worldId]/page.tsx` | 修改/新建 | 创世卡片、人物名录、能力编辑、可引用势力人物和锁定字段。 |
| `src/app/api/worlds/[id]/embark/route.ts` | 修改 | 将草稿 `ref` 在单事务中物化为实体、关系和能力记录。 |
| `src/lib/context/builder.ts`、`src/lib/prompts/narrator.ts`、`src/lib/prompts/pantheon.ts`、`src/lib/context/sse.ts`、`src/app/api/chat/route.ts` | 修改 | 为公开叙事、幕后叙事与 SSE META 增加能力上下文和揭示信号。 |
| `src/lib/prompts/extractor.ts`、`src/lib/settle/pipeline.ts` | 修改 | 从章节正文提取、校验并幂等应用能力变化，保存消息尺度证据。 |
| `src/app/api/abilities/route.ts`、`src/app/api/abilities/[id]/route.ts`、`src/app/api/abilities/[id]/history/route.ts` | 新建 | 已知能力的新增、编辑、废止和沿革读取。 |
| `src/app/api/codex/[id]/route.ts`、`src/app/api/worlds/[id]/state/route.ts` | 修改 | 返回经服务端可见性过滤和解析后的能力数据。 |
| `src/components/play/types.ts`、`CodexPanel.tsx`、`GodPanel.tsx`、`PlayDrawer.tsx`、`AbilityList.tsx` | 修改/新建 | 众生录与神谱展示能力、来源与沿革。 |
| `src/app/api/worlds/[id]/export/route.ts`、`src/app/api/worlds/import/route.ts` | 修改 | 版本化导出导入能力、事件与成员关系，并映射所有 ID。 |
| `src/lib/abilities/*.test.ts`、`src/lib/cards/*.test.ts`、`src/app/api/**/*.test.ts` | 新建 | 规则、可见性、草稿引用、变更与序列化回归测试。 |

## Task 1: 建立测试基线

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `vitest.config.ts`
- Create: `src/lib/abilities/resolver.test.ts`

- [ ] **Step 1: 安装测试依赖并添加脚本。**

  运行：

  ```bash
  pnpm add -D vitest @vitest/coverage-v8
  ```

  在 `package.json` 的 `scripts` 中加入：

  ```json
  {
    "test": "vitest run",
    "test:watch": "vitest"
  }
  ```

- [ ] **Step 2: 新建 Vitest 配置。**

  创建 `vitest.config.ts`：

  ```ts
  import { defineConfig } from "vitest/config";
  import path from "node:path";

  export default defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      clearMocks: true,
    },
    resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  });
  ```

- [ ] **Step 3: 写入预期失败的解析器测试。**

  创建 `src/lib/abilities/resolver.test.ts`，先引用尚不存在的 `resolveEffectiveAbilities`，断言一个种族先天能力会被角色继承、族群技艺不会被继承：

  ```ts
  import { describe, expect, it } from "vitest";
  import { resolveEffectiveAbilities } from "./resolver";

  it("默认继承种族先天能力，但不自动继承族群技艺", () => {
    const result = resolveEffectiveAbilities({
      raceAbilities: [
        { id: "night-sight", kind: "racial_innate", name: "夜视", state: "normal", mastery: "adept" },
        { id: "shadow-step", kind: "racial_tradition", name: "影行", state: "normal", mastery: "adept" },
      ],
      characterAbilities: [],
    });
    expect(result.map((ability) => ability.name)).toEqual(["夜视"]);
  });
  ```

- [ ] **Step 4: 确认测试因模块不存在而失败。**

  运行：`pnpm test -- src/lib/abilities/resolver.test.ts`

  预期：失败信息包含 `Failed to resolve import "./resolver"`。

- [ ] **Step 5: 提交测试基线。**

  ```bash
  git add package.json pnpm-lock.yaml vitest.config.ts src/lib/abilities/resolver.test.ts
  git commit -m "test: 建立能力系统测试基线"
  ```

## Task 2: 数据库模型与共享能力类型

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_structured_abilities/migration.sql`
- Create: `src/lib/abilities/types.ts`
- Create: `src/lib/abilities/types.test.ts`

- [ ] **Step 1: 写入失败的共享枚举测试。**

  在 `src/lib/abilities/types.test.ts` 断言固定枚举：

  ```ts
  import { expect, it } from "vitest";
  import { AbilityKindSchema, AbilityStateSchema, AbilityVisibilitySchema } from "./types";

  it("只接受已定义的能力类型、状态和可见性", () => {
    expect(AbilityKindSchema.parse("racial_innate")).toBe("racial_innate");
    expect(AbilityStateSchema.parse("sealed")).toBe("sealed");
    expect(AbilityVisibilitySchema.parse("hidden")).toBe("hidden");
    expect(AbilityKindSchema.safeParse("spell").success).toBe(false);
  });
  ```

- [ ] **Step 2: 运行并确认失败。**

  运行：`pnpm test -- src/lib/abilities/types.test.ts`

  预期：失败，`./types` 尚不存在。

- [ ] **Step 3: 定义能力共享类型。**

  创建 `src/lib/abilities/types.ts`，导出下列 Zod 枚举及推导类型：

  ```ts
  export const AbilityKindSchema = z.enum(["racial_innate", "racial_tradition", "personal", "divine"]);
  export const AbilityMasterySchema = z.enum(["unawakened", "novice", "adept", "expert", "master"]);
  export const AbilityStateSchema = z.enum(["normal", "enhanced", "impaired", "sealed", "lost", "deprecated"]);
  export const AbilityVisibilitySchema = z.enum(["known", "rumored", "hidden"]);
  export const AbilityEventTypeSchema = z.enum(["awakened", "learned", "improved", "mutated", "impaired", "sealed", "restored", "lost", "revealed", "deprecated"]);
  ```

  同文件定义 `AbilityInput`、`AbilityProjection`、`AbilityChangeInput` 和 `EffectiveAbility`；所有能力携带 `id`、`name`、`kind`、`effect`、`trigger`、`cost`、`limitations`、`mastery`、`state`、`visibility`、`rumorText`、`sourceAbilityId`、`lockedFields`、`version`。

- [ ] **Step 4: 扩展 Prisma schema。**

  在 `Entity` 添加：

  ```prisma
  isMajorCharacter Boolean @default(false) @map("is_major_character")
  raceId           String? @map("race_id")
  race             Entity? @relation("CharacterRace", fields: [raceId], references: [id], onDelete: SetNull)
  raceMembers      Entity[] @relation("CharacterRace")
  abilities        Ability[] @relation("EntityAbilities")
  memberships      EntityMembership[] @relation("MembershipCharacter")
  membershipsAsFaction EntityMembership[] @relation("MembershipFaction")
  ```

  新建 `Ability`、`AbilityEvent`、`EntityMembership` 模型：`Ability` 同时拥有可空 `entityId`、`godId`、`sourceAbilityId`、唯一 `version @default(1)`；`AbilityEvent` 以 `dedupeKey @unique` 保证幂等并关联 `Chapter`、可空 `Message`；`EntityMembership` 对 `(characterId, factionId)` 加唯一约束并存储 `role`、`isPrimary`。在 `God` 添加 `abilities Ability[] @relation("GodAbilities")`，在 `Timeline`、`Chapter`、`Message` 添加对应反向关系。

- [ ] **Step 5: 生成并检查迁移。**

  运行：

  ```bash
  pnpm prisma migrate dev --name structured_abilities
  pnpm prisma generate
  pnpm exec tsc --noEmit
  ```

  预期：迁移创建、Prisma Client 再生成、TypeScript 无错误。

- [ ] **Step 6: 运行类型测试并提交。**

  运行：`pnpm test -- src/lib/abilities/types.test.ts`

  预期：`1 passed`。

  ```bash
  git add prisma/schema.prisma prisma/migrations src/lib/abilities/types.ts src/lib/abilities/types.test.ts
  git commit -m "feat: 添加能力与人物关系数据模型"
  ```

## Task 3: 实现继承解析与服务端可见性

**Files:**
- Create: `src/lib/abilities/resolver.ts`
- Create: `src/lib/abilities/visibility.ts`
- Modify: `src/lib/abilities/resolver.test.ts`
- Create: `src/lib/abilities/visibility.test.ts`

- [ ] **Step 1: 为个体覆写补充失败测试。**

  向 `resolver.test.ts` 加入：

  ```ts
  it("人物来源覆写替代种族能力，明确掌握的技艺才加入可用列表", () => {
    const result = resolveEffectiveAbilities({
      raceAbilities: [
        { id: "night-sight", kind: "racial_innate", name: "夜视", state: "normal", mastery: "adept" },
        { id: "shadow-step", kind: "racial_tradition", name: "影行", state: "normal", mastery: "adept" },
      ],
      characterAbilities: [
        { id: "blindness", sourceAbilityId: "night-sight", kind: "racial_innate", name: "夜视", state: "lost", mastery: "adept" },
        { id: "learned-shadow-step", sourceAbilityId: "shadow-step", kind: "racial_tradition", name: "影行", state: "normal", mastery: "novice" },
      ],
    });
    expect(result.map(({ id }) => id)).toEqual(["learned-shadow-step"]);
  });
  ```

- [ ] **Step 2: 实现 `resolveEffectiveAbilities`。**

  在 `resolver.ts`：

  ```ts
  export function resolveEffectiveAbilities(input: ResolveAbilityInput): EffectiveAbility[] {
    const overrides = new Map(input.characterAbilities.filter((a) => a.sourceAbilityId).map((a) => [a.sourceAbilityId!, a]));
    const inherited = input.raceAbilities
      .filter((a) => a.kind === "racial_innate")
      .map((template) => overrides.get(template.id) ?? { ...template, inherited: true, sourceAbilityId: template.id });
    const learnedTraditions = input.characterAbilities.filter((a) => a.kind === "racial_tradition");
    const owned = input.characterAbilities.filter((a) => a.kind === "personal");
    return [...inherited, ...learnedTraditions, ...owned].filter(isUsableAbility);
  }
  ```

  `isUsableAbility` 必须拒绝 `mastery === "unawakened"` 和 `state` 为 `sealed`、`lost`、`deprecated` 的项；`impaired` 保留。

- [ ] **Step 3: 写入可见性失败测试。**

  创建 `visibility.test.ts`：

  ```ts
  it("隐藏能力不产生玩家投影，传闻能力只泄露传闻文本", () => {
    expect(projectAbilityForPlayer(hidden)).toBeNull();
    expect(projectAbilityForPlayer(rumored)).toEqual({ id: "rumor", name: "未知秘法", visibility: "rumored", rumorText: "有人说她能借月色遁行" });
  });
  ```

- [ ] **Step 4: 实现 `projectAbilityForPlayer`。**

  `known` 返回完整 `AbilityProjection`；`rumored` 仅返回 `id`、`name`、`kind`、`visibility`、`rumorText`、`state`，不得返回 `effect`、`trigger`、`cost`、`limitations`；`hidden` 返回 `null`。实现 `projectAbilitiesForPlayer` 过滤空值。

- [ ] **Step 5: 验证并提交。**

  运行：

  ```bash
  pnpm test -- src/lib/abilities/resolver.test.ts src/lib/abilities/visibility.test.ts
  pnpm exec tsc --noEmit
  ```

  预期：全部通过。

  ```bash
  git add src/lib/abilities/resolver.ts src/lib/abilities/visibility.ts src/lib/abilities/*.test.ts
  git commit -m "feat: 解析继承能力并过滤迷雾"
  ```

## Task 4: 统一校验、锁定与原子变更

**Files:**
- Create: `src/lib/abilities/validator.ts`
- Create: `src/lib/abilities/mutations.ts`
- Create: `src/lib/abilities/validator.test.ts`
- Create: `src/lib/abilities/mutations.test.ts`

- [ ] **Step 1: 写入失败的引用和锁定测试。**

  覆盖以下数据：人物以 `racial_tradition` 引用另一个种族的模板会抛出 `AbilityValidationError`；更新 `lockedFields` 中的 `effect` 会被拒绝；`personal` 带 `sourceAbilityId` 会被拒绝。

  ```ts
  await expect(validateAbilityWrite(crossRaceTradition)).rejects.toThrow("族群技艺来源必须属于人物主种族");
  expect(() => assertUnlockedFields(existing, { effect: "改写" })).toThrow("effect 已被玩家锁定");
  ```

- [ ] **Step 2: 实现 `validator.ts`。**

  定义并导出：

  - `AbilityValidationError`；
  - `validateAbilityOwnership(tx, input)`：恰有一个所有者、同时间线、模板和派生项类型匹配；
  - `assertUnlockedFields(existing, patch)`：对 `lockedFields` 严格拒绝；
  - `assertValidTransition(before, after)`：`lost`/`deprecated` 不可直接恢复为 `normal`，恢复要经事件 `restored`；
  - `validateDeckReferences(deck)`：所有 `ref` 唯一、人物种族/势力/能力来源存在、势力人物引用存在。

- [ ] **Step 3: 写入失败的幂等变更测试。**

  用一个 mock `Prisma.TransactionClient`，同一个 `dedupeKey` 两次调用 `applyAbilityChange`，断言第二次只读取既有 `AbilityEvent` 而不创建第二个事件或再次更新能力。

- [ ] **Step 4: 实现 `mutations.ts`。**

  `applyAbilityChange(tx, change)` 流程必须为：

  1. 以 `dedupeKey` 查询 `abilityEvent`；找到则返回 `{ applied: false, event }`；
  2. 读取能力；调用 ownership、状态和 locked 字段校验；
  3. 用 `{ id, version }` 更新能力，`version: { increment: 1 }`；版本不匹配抛出可读并发错误；
  4. 写入前后 JSON、证据、`chapterId`、`messageId`、`scale` 的事件；
  5. 返回更新后的能力与事件。

  实现 `revealAbility`：`hidden → rumored` 必须有 `rumorText`，`hidden|rumored → known` 写入 `revealed` 事件。

- [ ] **Step 5: 验证并提交。**

  运行：

  ```bash
  pnpm test -- src/lib/abilities/validator.test.ts src/lib/abilities/mutations.test.ts
  pnpm exec tsc --noEmit
  ```

  预期：全部通过。

  ```bash
  git add src/lib/abilities/validator.ts src/lib/abilities/mutations.ts src/lib/abilities/*.test.ts
  git commit -m "feat: 校验并原子应用能力变化"
  ```

## Task 5: 扩展创世卡组、Prompt 与草稿接口

**Files:**
- Modify: `src/lib/cards/schemas.ts`
- Modify: `src/lib/prompts/genesis.ts`
- Modify: `src/app/api/worlds/route.ts`
- Modify: `src/app/api/worlds/[id]/route.ts`
- Modify: `src/app/api/worlds/[id]/reroll/route.ts`
- Create: `src/lib/cards/schemas.test.ts`

- [ ] **Step 1: 写入失败的卡组引用测试。**

  构造最小完整卡组，加入同一个 `raceRef`、`factionRef` 和 `abilityRef`；断言 `WorldDeckSchema.parse` 成功且 `validateDeckReferences` 成功。再将人物 `learnedTraditionRefs` 改为不存在的 ref，断言失败消息含“族群技艺引用不存在”。

- [ ] **Step 2: 扩展 Zod schema。**

  在 `schemas.ts` 新增 `DeckAbilitySchema`（带 `ref`、能力全字段）、`MajorCharacterCardSchema`、`FactionMembershipSchema`、`RacialOverrideSchema`。具体变更：

  - `RaceCardSchema` 增加 `ref`、`abilities`；
  - `FactionCardSchema` 增加 `ref`、`keyCharacterRefs` 并移除运行时使用的纯 `keyFigures`；为旧草稿兼容，允许 `keyFigures` 可选；
  - `PlayerGodCardSchema`、`MajorGodCardSchema` 增加 `abilities`；
  - `WorldDeckSchema` 增加 `majorCharacters: z.array(MajorCharacterCardSchema).min(6).max(12)`；
  - `DECK_CARD_KEYS` 增加 `majorCharacters`，并同步 `DeckCardKey`。

- [ ] **Step 3: 更新 Genesis Prompt。**

  在 `GENESIS_SYSTEM` 追加硬约束：种族产生 2–5 项先天/传承能力，玩家神和每位主神产生 3–6 项神权，生成 6–12 位人物且所有跨卡引用都用唯一 `ref`；明确角色不能掌握未引用的族群技艺，隐藏能力只在有剧情用途时生成。`rerollUserPrompt` 要求当重掷 `races`、`factions`、`majorCharacters` 时修复所有引用而不改变锁定字段。

- [ ] **Step 4: 在三条草稿写入路径运行引用校验。**

  `POST /api/worlds`、`PATCH /api/worlds/[id]` 与 `POST /reroll` 在 `WorldDeckSchema` 通过后调用 `validateDeckReferences`。校验失败返回 400 与 `issues`；重掷模型首次输出非法时附加一次仅描述无效引用的修复请求，修复仍失败返回 502，且不写入草稿。

- [ ] **Step 5: 运行测试、生成 TypeScript 并提交。**

  ```bash
  pnpm test -- src/lib/cards/schemas.test.ts src/lib/abilities/validator.test.ts
  pnpm exec tsc --noEmit
  git add src/lib/cards/schemas.ts src/lib/prompts/genesis.ts src/app/api/worlds src/lib/cards/schemas.test.ts
  git commit -m "feat: 扩展创世能力与人物卡组"
  ```

## Task 6: 创世编辑器的人物引用与能力字段

**Files:**
- Create: `src/components/genesis/AbilityEditor.tsx`
- Create: `src/components/genesis/MajorCharacterEditor.tsx`
- Modify: `src/components/genesis/card-editors.tsx`
- Modify: `src/components/genesis/deck-utils.ts`
- Modify: `src/app/genesis/[worldId]/page.tsx`

- [ ] **Step 1: 新建可复用能力编辑器。**

  `AbilityEditor` 接受 `{ abilities, basePath, lockedPaths, onEdit, allowedKinds }`，使用现有 `TextField`、`TextAreaField`、`SelectField`、`ListField`。每项编辑 `name`、`kind`、`effect`、`trigger`、`cost`、`limitations`、`mastery`、`state`、`visibility`、`rumorText`；隐藏项的 `effect` 等字段仅在当前卡的天机已破封时渲染。新增/删除需要改变数组，并走 `onEdit(basePath, next)`。

- [ ] **Step 2: 扩展现有编辑器。**

  - `PlayerGodEditor` 末尾添加“神权”。
  - `MajorGodEditor` 的天机区同时封装隐藏神权。
  - `RaceEditor` 添加“先天能力”和“族群技艺”两个过滤后的 `AbilityEditor`。
  - `FactionEditor` 将关键人物改为 `keyCharacterRefs` 多选：显示人物名称、职务和 `ref`，不允许自由输入不存在的人物。

- [ ] **Step 3: 实现主要人物编辑器。**

  `MajorCharacterEditor` 接受 `index` 与完整 `deck`，提供种族下拉、势力成员条目、人物目标/处境、`learnedTraditionRefs` 多选、`racialOverrides`、个人技能。种族切换时，过滤已不属于新种族的 `learnedTraditionRefs`，并提示“已移除旧种族技艺引用”。

- [ ] **Step 4: 把人物名录接入卡片墙。**

  在 `page.tsx`：

  - `OpenCard` 增加 `{ kind: "majorCharacter"; index: number }`；
  - 新增“主要人物”组，显示姓名、身份、种族、目标和技能数；
  - 在 Modal 中渲染 `MajorCharacterEditor`；
  - `modalTitle` 增加人物标题；
  - `CARD_KEY_LABELS`、重掷 warning 和 `DECK_CARD_KEYS` 同步 `majorCharacters`。

- [ ] **Step 5: 手动验证创世编辑器。**

  运行 `pnpm dev`，创建一个草稿并验证：种族能力可编辑并锁定、人物可选择已有种族/势力、势力关键人物只可引用人物名录、神权隐藏项默认封蜡。然后运行：

  ```bash
  pnpm lint
  pnpm exec tsc --noEmit
  ```

- [ ] **Step 6: 提交。**

  ```bash
  git add src/components/genesis src/app/genesis/[worldId]/page.tsx
  git commit -m "feat: 在创世页编辑能力与主要人物"
  ```

## Task 7: 在开局事务中物化人物、关系与能力

**Files:**
- Modify: `src/app/api/worlds/[id]/embark/route.ts`
- Create: `src/lib/abilities/embark.ts`
- Create: `src/lib/abilities/embark.test.ts`

- [ ] **Step 1: 写失败测试。**

  用 `WorldDeckSchema` 的固定卡组和假的事务客户端测试 `materializeDeckAbilities`：人物 `raceRef` 映射到新实体 ID；势力成员关系包含职务；玩家神、主神、种族和人物能力均创建；人物掌握技艺保留种族模板能力的新 `sourceAbilityId`。

- [ ] **Step 2: 实现 ID 映射物化辅助。**

  `materializeDeckAbilities(tx, timelineId, deck, ids)` 接受由 embark 生成的 `raceByRef`、`factionByRef`、`characterByRef`、`godByRef` 与 `abilityByRef` 映射，按以下顺序写入：

  1. 种族模板能力；
  2. 神权；
  3. 人物个人能力；
  4. 人物传承掌握与先天覆写；
  5. 人物—势力成员关系。

  每次派生项写入前调用 `validateAbilityOwnership`。无法解析任一 `ref` 抛出错误，由外层事务回滚。

- [ ] **Step 3: 重构 embark 路由。**

  将当前 `entityData` 拆为先创建种族、势力、地点、人物，再建立关系；`factionSections` 的 `keyFigures` 用人物名录解析生成展示文本。创建玩家神和主神时保留 `ref → godId` 映射；调用 `materializeDeckAbilities` 后再创建第一章和更新世界。

- [ ] **Step 4: 验证。**

  ```bash
  pnpm test -- src/lib/abilities/embark.test.ts
  pnpm exec tsc --noEmit
  ```

  使用开发数据库创建一份全新草稿并点击创世，确认事务后 `Ability`、`EntityMembership` 和 `Entity.raceId` 均有记录。

- [ ] **Step 5: 提交。**

  ```bash
  git add src/app/api/worlds/[id]/embark/route.ts src/lib/abilities/embark.ts src/lib/abilities/embark.test.ts
  git commit -m "feat: 开局物化人物关系与能力"
  ```

## Task 8: 能力 API、众生录和神谱接口投影

**Files:**
- Create: `src/app/api/abilities/route.ts`
- Create: `src/app/api/abilities/[id]/route.ts`
- Create: `src/app/api/abilities/[id]/history/route.ts`
- Modify: `src/app/api/codex/[id]/route.ts`
- Modify: `src/app/api/worlds/[id]/state/route.ts`
- Create: `src/app/api/abilities/[id]/route.test.ts`

- [ ] **Step 1: 写失败的 API 测试。**

  mock Prisma 和 `ability-visibility`，测试：GET 实体详情不含隐藏能力；PATCH 已知能力的未锁字段成功并递增 version；PATCH 锁定字段返回 409；history 不返回隐藏能力历史。

- [ ] **Step 2: 实现能力路由。**

  - `POST /api/abilities`：只接受当前时间线内、`visibility !== "hidden"` 的手动创建项，调用 validator/mutations。
  - `PATCH /api/abilities/[id]`：Zod 限定可编辑字段和 `expectedVersion`，只更新未锁字段；冲突返回 409。
  - `DELETE /api/abilities/[id]`：无事件时删除；有事件时将状态改为 `deprecated` 并写事件。
  - `GET /api/abilities/[id]/history`：先投影能力可见性；隐藏返回 404，传闻仅返回 `revealed` 时间和 `rumorText`，已知返回完整事件。

- [ ] **Step 3: 扩展现有读取 API。**

  `GET /api/codex/[id]`：种族实体返回投影后的模板能力；人物返回解析后的有效能力、种族摘要、成员关系和可见能力事件。`GET /api/worlds/[id]/state`：每位神返回可见神权；玩家神带全部神权。

- [ ] **Step 4: 运行验证并提交。**

  ```bash
  pnpm test -- src/app/api/abilities/[id]/route.test.ts
  pnpm exec tsc --noEmit
  git add src/app/api/abilities src/app/api/codex/[id]/route.ts src/app/api/worlds/[id]/state/route.ts
  git commit -m "feat: 提供能力 API 与可见性投影"
  ```

## Task 9: 对局中的能力与沿革界面

**Files:**
- Create: `src/components/play/AbilityList.tsx`
- Modify: `src/components/play/types.ts`
- Modify: `src/components/play/CodexPanel.tsx`
- Modify: `src/components/play/GodPanel.tsx`
- Modify: `src/components/play/PlayDrawer.tsx`

- [ ] **Step 1: 定义前端 DTO 并制作可复用列表。**

  在 `types.ts` 增加 `AbilityView`、`AbilityEventView`、`CharacterMembershipView`。`AbilityList` 按 `racial_innate`、`racial_tradition`、`personal`、`divine` 分组：`known` 项显示完整字段，`rumored` 项仅显示名称和传闻；隐藏数据没有渲染分支，因为服务端不下发。

- [ ] **Step 2: 扩展种族和人物详情。**

  `CodexPanel` 的实体详情：

  - 种族显示“先天能力（族人默认继承）”和“族群技艺（需学习或传承）”；
  - 人物显示种族跳转、势力与职务、继承来源、已掌握技艺、个人技能；
  - 请求并显示 `/api/abilities/:id/history` 中可见沿革；
  - 当旧世界能力集合为空时显示“尚无已载能力”，不显示错误。

- [ ] **Step 3: 扩展神谱。**

  `GodPanel` 的玩家神展示完整神权；主神仅渲染状态接口给出的已知/传闻神权。保持议程迷雾的既有行为不变。

- [ ] **Step 4: 手动与静态验证。**

  在新世界中检查：能力分组、传闻视觉、来源标识、沿革、神谱；在旧世界中检查空状态。运行：

  ```bash
  pnpm lint
  pnpm exec tsc --noEmit
  ```

- [ ] **Step 5: 提交。**

  ```bash
  git add src/components/play
  git commit -m "feat: 在众生录和神谱展示能力"
  ```

## Task 10: 叙事与诸神回合的能力上下文和揭示 META

**Files:**
- Create: `src/lib/abilities/context.ts`
- Modify: `src/lib/context/builder.ts`
- Modify: `src/lib/prompts/narrator.ts`
- Modify: `src/lib/prompts/pantheon.ts`
- Modify: `src/lib/context/sse.ts`
- Modify: `src/app/api/chat/route.ts`
- Create: `src/lib/abilities/context.test.ts`

- [ ] **Step 1: 写失败上下文测试。**

  测试 `buildAbilityContext`：玩家可知层包含玩家神全部神权、相关种族已知能力和人物已知能力，不包含隐藏项；后台模式仅为当前行动主神加入自己的隐藏神权。

- [ ] **Step 2: 实现 `ability-context`。**

  `buildAbilityContext({ timelineId, viewer: "player" | "backstage", subjectGodId?, searchText })` 查询当前场景/命中实体的实际能力，输出两个明确块：`KNOWN ABILITIES` 与只给后台的 `AUTHOR-ONLY HIDDEN ABILITIES`。上下文每项包含效果、触发、代价、限制、状态、掌握程度和来源，不包含无关隐藏能力。

- [ ] **Step 3: 更新 Narrator/Pantheon 提示词和 META。**

  `NarratorMeta` 增加：

  ```ts
  abilityReveals?: Array<{ abilityId: string; visibility: "rumored" | "known"; evidence: string }>;
  ```

  `splitMetaBlock` 解析 `ability_reveals`。输出契约要求：只有清楚见证或合理调查才返回；未知技能不能写进行动建议；叙事必须遵守技能边界。`pantheonUserPrompt` 接收并注入行动神自身能力。

- [ ] **Step 4: 在聊天完成回调中安全应用揭示。**

  `chat/route.ts` 落库 narrator 消息后，对每项 `abilityReveals` 查询能力是否属于当前 timeline；调用 `revealAbility`，证据引用刚保存的 message ID 与本轮 scale。非法 ID 只跳过该条并记录服务器日志，不能使整个叙事保存失败。

- [ ] **Step 5: 运行验证并提交。**

  ```bash
  pnpm test -- src/lib/abilities/context.test.ts src/lib/abilities/visibility.test.ts
  pnpm exec tsc --noEmit
  git add src/lib/abilities/context.ts src/lib/context src/lib/prompts src/app/api/chat/route.ts src/lib/abilities/context.test.ts
  git commit -m "feat: 在叙事中注入并揭示能力"
  ```

## Task 11: 章末抽取的能力演化

**Files:**
- Modify: `src/lib/prompts/extractor.ts`
- Modify: `src/lib/settle/pipeline.ts`
- Create: `src/lib/abilities/extraction.test.ts`

- [ ] **Step 1: 写失败的抽取验证测试。**

  测试 `applyAbilityExtraction`：有 `messageId`、`scale`、正文证据的 `learned` 变化能写事件；没有证据、跨种族技艺或修改锁定字段的变化被返回在 `rejected`，同章一个合法实体更新仍继续成功；相同 dedupe key 的续跑不会重复升级。

- [ ] **Step 2: 扩展 Extractor schema 与 Prompt。**

  在 `ExtractionSchema` 增加 `abilityChanges`，每项必须含：

  ```ts
  {
    abilityId?: string,
    ownerName: string,
    sourceAbilityId?: string,
    type: AbilityEventTypeSchema,
    patch: { mastery?, state?, visibility?, rumorText?, effect?, trigger?, cost?, limitations? },
    evidenceMessageIndex: z.number().int(),
    evidence: z.string().min(12)
  }
  ```

  提示词列出可变化类型、禁止无证据升级、禁止跨种族技艺，并向模型提供每条正文消息的 `[messageId | index | scale]` 标签而非只给拼接正文。

- [ ] **Step 3: 在结算流水线逐条应用。**

  将 `chapterProse` 改为同时返回 `{ prose, messages }`，保留现有编年史字符串接口。`runExtraction` 将本章能力、角色、种族与锁定字段传给 Prompt；用 `evidenceMessageIndex` 找到消息，校验其内容包含足以支撑的证据关键词，再调用 `applyAbilityChange`。单项失败收集到 `rejected` 并继续；合法项使用 `chapterId + abilityId + event type + messageId` 构建 `dedupeKey`。

  在 `pantheon` 循环调用 `pantheonUserPrompt` 时，通过 `buildAbilityContext({ viewer: "backstage", subjectGodId: god.id })` 提供当前神实际神权。

- [ ] **Step 4: 验证现有结算无回归。**

  ```bash
  pnpm test -- src/lib/abilities/extraction.test.ts src/lib/abilities/mutations.test.ts
  pnpm exec tsc --noEmit
  pnpm lint
  ```

  用 `scripts/mock-llm.mjs` 或配置的 mock 响应执行一章“人物习得族群技艺”的结算，确认能力事件的章节、消息和尺度字段正确。

- [ ] **Step 5: 提交。**

  ```bash
  git add src/lib/prompts/extractor.ts src/lib/settle/pipeline.ts src/lib/abilities/extraction.test.ts src/lib/prompts/pantheon.ts
  git commit -m "feat: 在章末结算演化能力"
  ```

## Task 12: 存档导出、导入与旧世界兼容

**Files:**
- Modify: `src/app/api/worlds/[id]/export/route.ts`
- Modify: `src/app/api/worlds/import/route.ts`
- Create: `src/app/api/worlds/import/route.test.ts`

- [ ] **Step 1: 写失败的存档兼容测试。**

  覆盖两个输入：旧 `version: 1` 存档（没有能力、事件、成员关系）可解析，新增集合为空；新版存档含能力来源、事件 `abilityId`、人物种族 `raceId` 与成员关系，导入映射后所有外键指向新 ID。

- [ ] **Step 2: 升级导出格式。**

  在 export query 的每个 timeline include `abilities`（含 events）、`memberships` 和人物种族关系；导出 `version: 2`。不要按可见性过滤：导出是完整私有存档。

- [ ] **Step 3: 让导入同时接受 v1 与 v2。**

  把版本门槛改为 `version === 1 || version === 2`。在 schema 中对 `abilities`、`abilityEvents`、`memberships` 使用 `.default([])`；预生成 `abilityMap`、`abilityEventMap`、`membershipMap`；在批量写入时修复 `entityId`、`godId`、`sourceAbilityId`、`chapterId`、`messageId`、`raceId`、成员关系和事件能力 ID。先写 entities/gods/chapters/messages，再写 abilities/memberships，最后写 events，以满足外键。

- [ ] **Step 4: 验证。**

  ```bash
  pnpm test -- src/app/api/worlds/import/route.test.ts
  pnpm exec tsc --noEmit
  ```

  手工导出新世界、导入后检查隐藏能力仍存在于私有导出，但众生录与状态接口均不泄露。

- [ ] **Step 5: 提交。**

  ```bash
  git add src/app/api/worlds/[id]/export/route.ts src/app/api/worlds/import/route.ts src/app/api/worlds/import/route.test.ts
  git commit -m "feat: 在存档中保留能力与关系"
  ```

## Task 13: 全量验证与文档同步

**Files:**
- Modify: `README.md`
- Modify: `docs/00-总览.md`
- Modify: `docs/01-产品设计.md`
- Modify: `docs/03-数据模型.md`
- Modify: `docs/04-Prompt体系.md`

- [ ] **Step 1: 更新用户可见文档。**

  文档必须准确说明：种族先天能力/族群技艺、玩家神和主神神权、6–12 主要人物、能力沿革、迷雾、旧世界渐进建档、手动结束本章保持不变；不宣称存在技能按钮或数值战斗。

- [ ] **Step 2: 执行完整静态与测试验证。**

  ```bash
  pnpm test
  pnpm lint
  pnpm exec tsc --noEmit
  pnpm build
  git diff --check
  ```

  预期：所有命令退出码为 0。若 `pnpm build` 因本地数据库、环境变量或第三方模型配置失败，保留完整输出，先修复与本变更相关的问题；不能将失败描述为通过。

- [ ] **Step 3: 执行端到端人工验收。**

  1. 新建世界，检查卡组有种族能力、神权和 6–12 位人物；编辑并锁定一项公开能力。
  2. 开局，检查人物继承先天能力、没有自动掌握族群技艺。
  3. 在神谱检查玩家全技能、主神仅已知/传闻技能。
  4. 通过剧情展示隐藏技能，检查 `hidden → rumored|known`、沿革及不泄露行为。
  5. 写入一次人物习得技艺的剧情并点击“结束本章”，检查事件含章节、消息、时之仪尺度和依据。
  6. 打开旧世界，确认没有自动补全、没有报错。
  7. 导出再导入新世界，确认关系、来源和历史仍有效。

- [ ] **Step 4: 提交。**

  ```bash
  git add README.md docs/00-总览.md docs/01-产品设计.md docs/03-数据模型.md docs/04-Prompt体系.md
  git commit -m "docs: 说明结构化能力系统"
  ```

## 最终完成检查清单

- [ ] 新世界创世生成 2–5 项每种族能力、3–6 项玩家/主神神权、6–12 位主要人物。
- [ ] 势力关键人物、人物种族、人物掌握技艺全部由稳定引用驱动。
- [ ] 继承解析不会自动给人物族群技艺，且正确处理覆写、封印、受损和失去。
- [ ] 玩家接口不返回隐藏能力的名称、ID、效果、触发、代价或限制。
- [ ] AI 上下文仅向玩家侧提供已知信息，后台神仅接收自身必要秘密。
- [ ] 能力揭示、章末演化和断点续跑写入正确且幂等。
- [ ] 旧世界保持空能力数据并可继续游玩；新旧存档均可导入。
- [ ] “结束本章”、时之仪和现有章末结算 UX 没有改动。
