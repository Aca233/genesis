# Creator Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $team (coordinated parallel execution) or $ralph (persistent single-owner completion) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immutable 「诸神共世」 and 「创世主」 world modes, including creator-only omniscient observation, avatars, absolute reality rewrites, and a persistent reversible reality tree.

**Architecture:** Keep one shared live-world model, but route creation, visibility, and interaction through explicit mode policies. A creator rewrite is a leased task: an LLM produces a validated white-list plan, one serializable transaction clones the active timeline and applies deterministic patches, and narration is completed afterward with idempotent recovery. Every rewrite creates a child timeline; switching or undoing changes only `World.activeTimelineId`, never destroys the prior reality.

**Tech Stack:** Next.js 16.2 App Router route handlers, React 19 client components, TypeScript 5, Zod 4, Prisma 7/PostgreSQL, Vitest 4, Tailwind CSS 4, existing SSE/LLM gateway.

**Authoritative design:** `docs/omx/specs/2026-07-21-creator-mode-design.md`

**Next.js guidance already checked:** `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` and `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`. Keep database access in route handlers/server libraries and interactive state in narrowly scoped client components.

---

## File map

### New domain and persistence files

- `src/lib/world-mode.ts` — shared mode schema, labels, and mode guards.
- `src/lib/reality/schemas.ts` — `RealityState`, `ObserverState`, rewrite plan, and patch schemas.
- `src/lib/reality/operation-lock.ts` — world-wide leased mutex shared by chat, settlement, rewrite, and switching.
- `src/lib/reality/clone.ts` — complete timeline graph cloning with old-to-new ID maps.
- `src/lib/reality/apply.ts` — deterministic white-list rewrite patch executor.
- `src/lib/reality/task-runner.ts` — rewrite claim/plan/apply/narrate/recovery state machine.
- `src/lib/reality/tree.ts` — reality-tree validation, switch, rename, and subtree delete operations.
- `src/lib/reality/visibility.ts` — omniscient versus fog-observation projection policy.
- `src/lib/prompts/rewrite.ts` — rewrite planner and result-narration prompts.
- `src/app/api/worlds/[id]/rewrites/route.ts` — create/list rewrite tasks.
- `src/app/api/rewrites/[id]/route.ts` — poll/retry one rewrite task.
- `src/app/api/worlds/[id]/realities/route.ts` — reality tree read/update/delete.
- `src/app/api/worlds/[id]/observer/route.ts` — observer settings and avatar lifecycle.
- `src/components/play/CreatorInputDeck.tsx` — observation/rewrite dual-channel input.
- `src/components/play/CreatorViewPanel.tsx` — current focus, omniscience toggle, avatar controls, recent rewrite.
- `src/components/play/RealityTreePanel.tsx` — branch tree, switch, undo, rename, and delete UI.

### Existing files with focused changes

- `prisma/schema.prisma` and a new migration — mode, branch state, observer state, rewrite tasks, avatar marker, and operation lease.
- `src/lib/cards/schemas.ts`, `src/lib/prompts/genesis.ts`, `src/lib/genesis/*`, genesis APIs — discriminated creator/pantheon decks and mode-frozen generation.
- `src/app/page.tsx`, `src/app/genesis/[worldId]/page.tsx`, genesis components — mode selection and creator-safe deck editing/ceremony.
- `src/lib/materials/*` — creator decks omit player-god materials while all shared materials still validate.
- `src/lib/embark/mutations.ts` and embark tests — creator worlds materialize no player god and initialize branch state.
- `src/lib/prompts/narrator.ts`, `src/lib/context/builder.ts`, `src/app/api/chat/route.ts` — creator observer perspective and active-reality write guards.
- state/codex/chronicle APIs and play types — omniscient projection and mode-aware payloads.
- play drawer/rune rail/page — creator-only panels and reality workflow.
- settlement pipeline — operation mutex, current-reality guard, and creator-safe no-player-god context.
- export/import/archive APIs and docs — version 3 round-trip and old archive compatibility.

---

### Task 1: Persist immutable world mode and reality metadata

**Files:**
- Create: `src/lib/world-mode.ts`
- Create: `src/lib/world-mode.test.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260721210000_creator_mode_foundation/migration.sql`
- Modify: `src/lib/genesis/task-runner.ts`

- [ ] **Step 1: Write the failing mode tests**

Create `src/lib/world-mode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WorldModeSchema, assertModeTransition, worldModeLabel } from "./world-mode";

describe("world mode", () => {
  it("accepts only pantheon and creator", () => {
    expect(WorldModeSchema.parse("pantheon")).toBe("pantheon");
    expect(WorldModeSchema.parse("creator")).toBe("creator");
    expect(() => WorldModeSchema.parse("absolute")).toThrow();
  });

  it("does not allow a persisted world to change modes", () => {
    expect(() => assertModeTransition("pantheon", "creator")).toThrow("世界模式不可更改");
    expect(assertModeTransition("creator", "creator")).toBeUndefined();
  });

  it("provides stable Chinese labels", () => {
    expect(worldModeLabel("pantheon")).toBe("诸神共世");
    expect(worldModeLabel("creator")).toBe("创世主");
  });
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `pnpm vitest run src/lib/world-mode.test.ts`  
Expected: FAIL because `src/lib/world-mode.ts` does not exist.

- [ ] **Step 3: Add the mode domain module**

Create `src/lib/world-mode.ts`:

```ts
import { z } from "zod";

export const WORLD_MODES = ["pantheon", "creator"] as const;
export const WorldModeSchema = z.enum(WORLD_MODES);
export type WorldMode = z.infer<typeof WorldModeSchema>;

const LABELS: Record<WorldMode, string> = {
  pantheon: "诸神共世",
  creator: "创世主",
};

export function worldModeLabel(mode: WorldMode): string {
  return LABELS[mode];
}

export function assertModeTransition(current: WorldMode, next: WorldMode): void {
  if (current !== next) throw new Error("世界模式不可更改");
}
```

- [ ] **Step 4: Extend Prisma models and create the SQL migration**

Add these fields/relations to `prisma/schema.prisma`:

```prisma
model World {
  mode                    String            @default("pantheon")
  operationKind           String?           @map("operation_kind")
  operationToken          String?           @map("operation_token")
  operationLeaseExpiresAt DateTime?         @map("operation_lease_expires_at")
  rewrites                RealityRewrite[]
}

model GenesisTask {
  mode String @default("pantheon")
}

model Timeline {
  branchName      String            @default("原初现实") @map("branch_name")
  branchSummary   String?           @map("branch_summary")
  realityState    Json?             @map("reality_state")
  observerState   Json?             @map("observer_state")
  forkRewriteId   String?           @unique @map("fork_rewrite_id")
  forkRewrite     RealityRewrite?   @relation("TimelineForkRewrite", fields: [forkRewriteId], references: [id], onDelete: SetNull)
  sourceRewrites  RealityRewrite[]  @relation("RewriteSource")
  resultRewrite   RealityRewrite?   @relation("RewriteResult")
  updatedAt       DateTime          @updatedAt @map("updated_at")
}

model Entity {
  isCreatorAvatar Boolean @default(false) @map("is_creator_avatar")
}

model RealityRewrite {
  id                 String    @id @default(cuid())
  worldId            String    @map("world_id")
  world              World     @relation(fields: [worldId], references: [id], onDelete: Cascade)
  sourceTimelineId   String    @map("source_timeline_id")
  sourceTimeline     Timeline  @relation("RewriteSource", fields: [sourceTimelineId], references: [id], onDelete: Restrict)
  resultTimelineId   String?   @unique @map("result_timeline_id")
  resultTimeline     Timeline? @relation("RewriteResult", fields: [resultTimelineId], references: [id], onDelete: SetNull)
  forkedTimeline     Timeline? @relation("TimelineForkRewrite")
  sourceChapterId    String    @map("source_chapter_id")
  decree             String    @db.Text
  scope              String    @default("prospective")
  status             String    @default("planning")
  plan               Json?
  summary            String?
  idempotencyKey     String    @unique @map("idempotency_key")
  leaseToken         String?   @map("lease_token")
  leaseExpiresAt     DateTime? @map("lease_expires_at")
  error              String?
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  @@index([worldId, createdAt])
  @@index([status, leaseExpiresAt])
  @@map("reality_rewrites")
}
```

The migration must add defaults so existing rows become `pantheon`, add the new table and indexes, and add foreign keys with the same delete behavior as the Prisma schema. Do not backfill an invented player god or rewrite record.

- [ ] **Step 5: Regenerate Prisma and verify migration/schema integrity**

Run: `pnpm prisma generate && pnpm prisma validate && pnpm vitest run src/lib/world-mode.test.ts`  
Expected: Prisma commands succeed and 3 tests pass.

- [ ] **Step 6: Add mode to genesis task DTOs without changing behavior yet**

Update `GenesisTaskDto` and `PublicTask` in `src/lib/genesis/task-runner.ts` to include `mode`, parsed through `WorldModeSchema`; return it from `toGenesisTaskDto`. Existing database rows return `pantheon` due to the migration default.

- [ ] **Step 7: Commit the foundation**

```bash
git add prisma/schema.prisma prisma/migrations/20260721210000_creator_mode_foundation src/lib/world-mode.ts src/lib/world-mode.test.ts src/lib/genesis/task-runner.ts
git commit -m "feat: persist immutable world modes"
```

---

### Task 2: Introduce discriminated pantheon and creator deck contracts

**Files:**
- Modify: `src/lib/cards/schemas.ts`
- Modify: `src/lib/cards/schemas.test.ts`
- Modify: `src/lib/abilities/validator.ts`
- Modify: `src/lib/abilities/validator.test.ts`
- Modify: `src/lib/prompts/genesis.ts`
- Modify: `src/lib/genesis/generate.ts`
- Modify: `src/lib/genesis/json-progress.ts`
- Modify: `src/lib/genesis/stages.ts`

- [ ] **Step 1: Add failing schema tests for both deck modes**

Extend `src/lib/cards/schemas.test.ts` with assertions that:

```ts
const pantheon = WorldDeckSchema.parse({ ...validDeck, mode: "pantheon" });
expect(pantheon.mode).toBe("pantheon");
expect(pantheon.playerGod.name).toBeTruthy();

const { playerGod: _removed, ...shared } = validDeck;
const creator = WorldDeckSchema.parse({
  ...shared,
  mode: "creator",
  majorGods: validDeck.majorGods.map(({ agenda, initialRelationToPlayer, ...god }) => ({
    ...god,
    agenda: {
      longTermGoal: agenda.longTermGoal,
      shortTermGoals: agenda.shortTermGoals,
      methods: agenda.methods,
      schemes: agenda.schemes,
    },
    relations: [],
  })),
});
expect(creator.mode).toBe("creator");
expect("playerGod" in creator).toBe(false);
expect(() => WorldDeckSchema.parse({ ...creator, playerGod: validDeck.playerGod })).toThrow();
```

Also test that persisted pre-mode decks normalize to `mode: "pantheon"`.

- [ ] **Step 2: Run the focused tests**

Run: `pnpm vitest run src/lib/cards/schemas.test.ts src/lib/abilities/validator.test.ts`  
Expected: FAIL because `mode` is not part of the deck contract and creator decks require `playerGod`.

- [ ] **Step 3: Split shared and mode-specific schemas**

In `src/lib/cards/schemas.ts`:

```ts
export const CreatorGodAgendaSchema = GodAgendaSchema.omit({ stanceToPlayer: true });
export const CreatorMajorGodCardSchema = MajorGodCardSchema
  .omit({ agenda: true, initialRelationToPlayer: true })
  .extend({
    agenda: CreatorGodAgendaSchema,
    relations: z.array(z.object({
      targetGodRef: StableRefSchema,
      label: RelationLabelSchema,
      note: z.string(),
    })).default([]),
  });

const SharedWorldDeckShape = {
  worldName: z.string(),
  cosmology: CosmologyCardSchema,
  fusionAxiom: FusionAxiomCardSchema.nullable(),
  minorGods: z.array(MinorGodSchema),
  factions: z.array(FactionCardSchema).min(2).max(8),
  races: z.array(RaceCardSchema),
  majorCharacters: z.array(MajorCharacterCardSchema).min(6).max(12),
  places: z.array(PlaceCardSchema),
  epochConflict: EpochConflictCardSchema,
  style: StyleCardSchema,
  theme: ThemeCardSchema,
};

export const PantheonWorldDeckSchema = z.object({
  mode: z.literal("pantheon"),
  ...SharedWorldDeckShape,
  playerGod: PlayerGodCardSchema,
  majorGods: z.array(MajorGodCardSchema).min(4).max(10),
});

export const CreatorWorldDeckSchema = z.object({
  mode: z.literal("creator"),
  ...SharedWorldDeckShape,
  majorGods: z.array(CreatorMajorGodCardSchema).min(4).max(10),
}).strict();

export const WorldDeckSchema = z.discriminatedUnion("mode", [
  PantheonWorldDeckSchema,
  CreatorWorldDeckSchema,
]).superRefine(validateModeAwareDeckReferenceUniqueness);

export type WorldDeck = z.infer<typeof WorldDeckSchema>;
export type PantheonWorldDeck = z.infer<typeof PantheonWorldDeckSchema>;
export type CreatorWorldDeck = z.infer<typeof CreatorWorldDeckSchema>;
```

Change reference-uniqueness and `validateDeckReferences` traversal to include `playerGod` only when `deck.mode === "pantheon"`; creator `relations[].targetGodRef` must resolve to another major god ref. Preserve the existing legacy detector and normalize all legacy/pre-mode decks to `{ mode: "pantheon", ...raw }` before strict parsing.

- [ ] **Step 4: Generate separate genesis systems**

In `src/lib/prompts/genesis.ts`, export:

```ts
export function genesisSystem(mode: WorldMode): string;
export function genesisUserPrompt(mode: WorldMode, decree: string, lorebookExcerpts?: string, materialConstraints?: string): string;
export function genesisRepairPrompt(opts: { mode: WorldMode; decree: string; lorebookExcerpts?: string; invalidOutput: string; validationError: string; materialConstraints?: string }): string;
```

The `pantheon` system retains every existing player-god rule and uses `PantheonWorldDeckSchema`. The `creator` system uses `CreatorWorldDeckSchema` and includes these hard constraints verbatim in meaning:

```text
The player is outside the world and is not a god, character, faction, force, hidden entity, or worship target inside it. Never create playerGod. Build the pantheon for tensions among world-internal gods. Their agendas and relations may reference only world-internal objects. All strings are Chinese. Output mode="creator".
```

Both prompts emit `mode` first. Update JSON progress/stage keys so `mode` is observable and `playerGod` is optional for creator tasks.

- [ ] **Step 5: Make generation validation mode-specific**

Pass `mode` through `GenesisGenerationOptions` and `RepairInput`. Parse with `WorldDeckSchema`, then reject a completion whose `deck.mode !== options.mode` before material validation. Select the exact mode schema for structured repair so a creator repair cannot reintroduce `playerGod`.

- [ ] **Step 6: Run schema, generator, and prompt tests**

Run: `pnpm vitest run src/lib/cards/schemas.test.ts src/lib/abilities/validator.test.ts src/lib/genesis/generate.test.ts src/lib/genesis/json-progress.test.ts src/lib/genesis/stages.test.ts`  
Expected: PASS, including creator output with no `playerGod` and old persisted decks normalized to `pantheon`.

- [ ] **Step 7: Commit deck contracts**

```bash
git add src/lib/cards/schemas.ts src/lib/cards/schemas.test.ts src/lib/abilities/validator.ts src/lib/abilities/validator.test.ts src/lib/prompts/genesis.ts src/lib/genesis/generate.ts src/lib/genesis/json-progress.ts src/lib/genesis/stages.ts
git commit -m "feat: add creator genesis deck contract"
```

---

### Task 3: Freeze mode through task creation, generation, and homepage selection

**Files:**
- Modify: `src/app/api/genesis/tasks/route.ts`
- Modify: `src/app/api/genesis/tasks/route.test.ts`
- Modify: `src/app/api/genesis/tasks/route.integration.test.ts`
- Modify: `src/lib/genesis/task-runner.ts`
- Modify: `src/lib/genesis/task-runner.test.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/api/worlds/route.ts`
- Modify: `src/app/archives/page.tsx`

- [ ] **Step 1: Write failing route and runner tests**

Test that `POST /api/genesis/tasks` accepts `{ mode: "creator" }`, persists it, rejects unknown modes, and defaults omitted mode to `pantheon`. Test that `persistWorld` copies `task.mode` into `World.mode`, and generation calls `genesisSystem(task.mode)` plus the matching schema.

- [ ] **Step 2: Run focused tests**

Run: `pnpm vitest run src/app/api/genesis/tasks/route.test.ts src/lib/genesis/task-runner.test.ts`  
Expected: FAIL because request/runner mode is not wired.

- [ ] **Step 3: Wire mode through the server path**

Add `mode: WorldModeSchema.default("pantheon")` to `CreateGenesisTaskSchema`, persist it, include it in task DTOs/events, and pass it to generation/repair. In `persistWorld`, set `World.mode = task.mode` and validate `deck.mode === task.mode` immediately before creation. Completed keys are derived from the actual deck keys rather than a hard-coded list containing `playerGod`.

Update the legacy synchronous `POST /api/worlds` endpoint to accept `mode`, use mode-aware prompts/schemas, and persist the same mode so it cannot create a mismatched world.

- [ ] **Step 4: Add the two homepage mode cards**

In `src/app/page.tsx`, keep `const [worldMode, setWorldMode] = useState<WorldMode>("pantheon")`. Render two accessible radio-style buttons above the textarea with the approved labels/descriptions. Change subtitle, placeholder, validation nouns, and request body by mode:

```ts
body: JSON.stringify({
  mode: worldMode,
  decree: text,
  ...(lorebook ? { lorebook: lorebook.data, lorebookName: lorebook.name } : {}),
  materialSelections,
})
```

Pantheon placeholder describes “我是谁”；creator placeholder describes only the world. Disable mode cards while creating.

- [ ] **Step 5: Show mode in archive summaries**

Add `mode` to `GET /api/worlds` select and `WorldItem`. Render a small 「诸神共世」/「创世主」 badge next to status so users do not enter a world under the wrong expectation.

- [ ] **Step 6: Run route tests, lint touched UI, and build types**

Run:

```bash
pnpm vitest run src/app/api/genesis/tasks/route.test.ts src/app/api/genesis/tasks/route.integration.test.ts src/lib/genesis/task-runner.test.ts
pnpm eslint src/app/page.tsx src/app/archives/page.tsx src/app/api/genesis/tasks/route.ts src/lib/genesis/task-runner.ts
pnpm tsc --noEmit
```

Expected: all commands succeed.

- [ ] **Step 7: Commit mode-frozen creation**

```bash
git add src/app/page.tsx src/app/archives/page.tsx src/app/api/genesis/tasks/route.ts src/app/api/genesis/tasks/route.test.ts src/app/api/genesis/tasks/route.integration.test.ts src/app/api/worlds/route.ts src/lib/genesis/task-runner.ts src/lib/genesis/task-runner.test.ts
git commit -m "feat: select and freeze world mode at genesis"
```

---

### Task 4: Make deck editing and materials mode-aware

**Files:**
- Modify: `src/app/genesis/[worldId]/page.tsx`
- Modify: `src/components/genesis/deck-utils.ts`
- Modify: `src/components/genesis/deck-utils.test.ts`
- Modify: `src/components/genesis/card-editors.tsx`
- Modify: `src/components/genesis/AbilityEditor.tsx`
- Modify: `src/components/genesis/GenesisCeremony.tsx`
- Modify: `src/lib/materials/extract-deck.ts`
- Modify: `src/lib/materials/extract-deck.test.ts`
- Modify: `src/lib/materials/validate-result.ts`
- Modify: `src/lib/materials/validate-result.test.ts`
- Modify: `src/lib/materials/prompt.ts`
- Modify: `src/app/api/worlds/[id]/reroll/route.ts`
- Modify: `src/app/api/worlds/[id]/route.ts`

- [ ] **Step 1: Add failing creator editor/material tests**

Create a creator fixture from Task 2 and test:

- deck section order omits `playerGod`;
- ceremony stamps omit 「汝之神格」;
- extracted materials contain no `player_god` and still include every major god/ability;
- player-god material selection is rejected for creator generation with a clear error;
- PATCH/reroll refuse changing the deck discriminator away from `world.mode`.

- [ ] **Step 2: Run the focused tests**

Run: `pnpm vitest run src/components/genesis/deck-utils.test.ts src/lib/materials/extract-deck.test.ts src/lib/materials/validate-result.test.ts`  
Expected: FAIL on direct `deck.playerGod` access.

- [ ] **Step 3: Narrow deck unions before player-god access**

Use `deck.mode === "pantheon"` guards in deck utilities, card editor dispatch, ability-owner lists, ceremony stamps, extraction, validation, and material prompt construction. The creator card wall begins with cosmology/major gods and still allows editing all world-internal cards.

For creator material validation, throw:

```ts
if (deck.mode === "creator" && snapshot.items.some((item) => item.kind === "player_god")) {
  throw new Error("创世主模式不能引用玩家神素材");
}
```

- [ ] **Step 4: Enforce immutable mode in edit/reroll APIs**

Load `world.mode` before parsing updates. Parse the submitted result, then require `deck.mode === world.mode`; return 409 with `世界模式不可更改` on mismatch. Reroll prompts receive mode-specific JSON schema and never add a missing player god to creator decks.

- [ ] **Step 5: Run all affected tests and TypeScript**

Run:

```bash
pnpm vitest run src/components/genesis/deck-utils.test.ts src/lib/materials/extract-deck.test.ts src/lib/materials/validate-result.test.ts src/lib/materials/prompt.test.ts
pnpm tsc --noEmit
```

Expected: PASS with no unsafe player-god union access.

- [ ] **Step 6: Commit creator-safe deck tooling**

```bash
git add src/app/genesis/[worldId]/page.tsx src/components/genesis/deck-utils.ts src/components/genesis/deck-utils.test.ts src/components/genesis/card-editors.tsx src/components/genesis/AbilityEditor.tsx src/components/genesis/GenesisCeremony.tsx src/lib/materials/extract-deck.ts src/lib/materials/extract-deck.test.ts src/lib/materials/validate-result.ts src/lib/materials/validate-result.test.ts src/lib/materials/prompt.ts src/app/api/worlds/[id]/reroll/route.ts src/app/api/worlds/[id]/route.ts
git commit -m "feat: make deck tooling creator aware"
```

---

### Task 5: Materialize creator worlds without a player god

**Files:**
- Create: `src/lib/reality/schemas.ts`
- Create: `src/lib/reality/schemas.test.ts`
- Modify: `src/lib/embark/mutations.ts`
- Modify: `src/lib/abilities/embark.ts`
- Modify: `src/lib/abilities/embark.test.ts`
- Modify: `src/lib/abilities/embark.integration.test.ts`
- Modify: `src/app/api/worlds/[id]/embark/route.ts`

- [ ] **Step 1: Define and test initial reality/observer state**

Create schemas with these exact public shapes:

```ts
export const RealityStateSchema = z.object({
  theme: ThemeCardSchema,
  style: StyleCardSchema,
  cosmology: CosmologyCardSchema,
  fusionAxiom: FusionAxiomCardSchema.nullable(),
  currentEra: z.string(),
  establishedFacts: z.array(z.object({
    ref: StableRefSchema,
    text: z.string().min(1),
    establishedByRewriteId: z.string().nullable(),
  })),
});

export const ObserverStateSchema = z.object({
  focusType: z.enum(["world", "place", "entity", "god", "avatar"]),
  focusId: z.string().nullable(),
  timeLabel: z.string(),
  viewpoint: z.enum(["omniscient", "limited"]),
  activeAvatarId: z.string().nullable(),
});
```

Add `initialRealityState(deck)` and `initialObserverState(deck)` helpers. `currentEra` uses `epochConflict.yearLabel`; initial focus is world/omniscient/no avatar.

- [ ] **Step 2: Run schema tests**

Run: `pnpm vitest run src/lib/reality/schemas.test.ts`  
Expected: FAIL until the new module is implemented, then PASS.

- [ ] **Step 3: Branch embark materialization by deck mode**

In `materializeEmbarkDeck`:

- create root timeline with `branchName`, `branchSummary`, `realityState`, and `observerState`;
- create player god and its divine abilities only inside `if (deck.mode === "pantheon")`;
- create creator major-god relations from stable god refs after all major gods exist;
- creator major-god agendas are persisted without synthesized `stanceToPlayer`;
- continue materializing races, factions, places, characters, abilities, memberships, and chapter 1 identically.

Update `materializeDeckAbilities` to conditionally traverse `playerGod` and to accept both major-god card types.

- [ ] **Step 4: Add integration assertions**

For creator embark assert:

```ts
expect(createdGods.every((god) => !god.isPlayer && god.tier !== "player")).toBe(true);
expect(createdAbilities.filter((ability) => ability.godId === null)).toBeDefined();
expect(timeline.realityState).toMatchObject({ currentEra: creatorDeck.epochConflict.yearLabel });
expect(world.activeTimelineId).toBe(timeline.id);
```

Retain the existing pantheon assertion that exactly one player god is created.

- [ ] **Step 5: Run embark suites**

Run: `pnpm vitest run src/lib/abilities/embark.test.ts src/lib/abilities/embark.integration.test.ts src/lib/abilities/embark-unit-boundary.test.ts`  
Expected: PASS for both modes and rollback behavior.

- [ ] **Step 6: Commit creator embark**

```bash
git add src/lib/reality/schemas.ts src/lib/reality/schemas.test.ts src/lib/embark/mutations.ts src/lib/abilities/embark.ts src/lib/abilities/embark.test.ts src/lib/abilities/embark.integration.test.ts src/lib/abilities/embark-unit-boundary.test.ts src/app/api/worlds/[id]/embark/route.ts
git commit -m "feat: embark creator worlds without player gods"
```

---

### Task 6: Add creator observation perspective to narration

**Files:**
- Modify: `src/lib/prompts/narrator.ts`
- Modify: `src/lib/prompts/narrator.test.ts`
- Modify: `src/lib/context/builder.ts`
- Modify: `src/lib/context/builder.test.ts`
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/lib/chat/request.ts`
- Modify: `src/lib/chat/request.test.ts`
- Modify: `src/lib/settle/pipeline.ts`
- Modify: `src/lib/prompts/settlement.ts`
- Modify: `src/lib/prompts/settlement.test.ts`

- [ ] **Step 1: Write failing prompt/context tests**

Test creator context for these invariants:

- second-person refers to the world-external observer, not a player god;
- ordinary input is an observation request, not an established fact;
- the narrator may reveal hidden author data while NPC knowledge remains bounded;
- creator opening unveils the world without a descent/player-god scene;
- `realityState` from the active timeline overrides world-level cards;
- pantheon prompt text remains unchanged in meaning.

- [ ] **Step 2: Run focused tests**

Run: `pnpm vitest run src/lib/prompts/narrator.test.ts src/lib/context/builder.test.ts src/lib/prompts/settlement.test.ts`  
Expected: FAIL because narration assumes the player is always a god.

- [ ] **Step 3: Make narrator policies explicit**

Change prompt functions to accept `mode: WorldMode` and produce separate core agency rules:

```ts
const creatorAgency = `The player is the world-external Creator and omniscient observer. Their ordinary OBSERVATION REQUEST controls focus, time span, and what to show; it does not itself rewrite established facts. Never invent a body, god-card, worship, rank, limitation, or in-world identity for the Creator. World-internal characters do not know the Creator exists unless established facts say so.`;
```

Export mode-specific `openingDirective(mode)`. Creator opening is a world tableau at the present era and ends on an unfolding world-internal tension; pantheon opening retains the descent/player-god hook.

- [ ] **Step 4: Read branch reality and observer state in context builder**

Load the chapter timeline and require it equals `world.activeTimelineId` before context assembly. Parse `timeline.realityState`/`observerState`, falling back to world cards only for old pantheon timelines. In creator mode:

- inject complete god agendas, hidden chronicle entries, and full abilities as author-only context;
- label user content `【天外观测】`;
- inject focus/time/viewpoint/active avatar;
- do not consume hidden events as a probe mechanism;
- retain NPC knowledge boundaries.

- [ ] **Step 5: Guard chat and settlement writes to the active reality**

Before reservation and again in finalization/settlement application, require `chapter.timelineId === world.activeTimelineId`. Return 409 `该现实已被冻结` for a stale branch. Creator settlement does not expect a player god; proactive events may target world-internal gods/entities and should never fabricate `stanceToPlayer`.

- [ ] **Step 6: Run narrator/chat/settlement tests**

Run:

```bash
pnpm vitest run src/lib/prompts/narrator.test.ts src/lib/context/builder.test.ts src/lib/chat/request.test.ts src/lib/prompts/settlement.test.ts src/lib/settle/pipeline.integration.test.ts
```

Expected: PASS for creator no-player context, pantheon regression coverage, and frozen-branch rejection.

- [ ] **Step 7: Commit observation narration**

```bash
git add src/lib/prompts/narrator.ts src/lib/prompts/narrator.test.ts src/lib/prompts/settlement.ts src/lib/prompts/settlement.test.ts src/lib/context/builder.ts src/lib/context/builder.test.ts src/lib/chat/request.ts src/lib/chat/request.test.ts src/lib/settle/pipeline.ts src/lib/settle/pipeline.integration.test.ts src/app/api/chat/route.ts
git commit -m "feat: narrate creator observation perspective"
```

---

### Task 7: Centralize omniscient versus fog projections

**Files:**
- Create: `src/lib/reality/visibility.ts`
- Create: `src/lib/reality/visibility.test.ts`
- Modify: `src/lib/abilities/visibility.ts`
- Modify: `src/app/api/worlds/[id]/state/route.ts`
- Modify: `src/app/api/codex/route.ts`
- Modify: `src/app/api/codex/[id]/route.ts`
- Modify: `src/app/api/chronicle/route.ts`
- Modify: `src/components/play/types.ts`

- [ ] **Step 1: Write failing projection policy tests**

Test a creator in omniscient view receives hidden abilities, unrevealed sections, agendas, and hidden chronicles; creator limited view receives the existing player-safe projection; pantheon always receives its current projection regardless of a spoofed query parameter.

- [ ] **Step 2: Run the tests**

Run: `pnpm vitest run src/lib/reality/visibility.test.ts src/lib/abilities/visibility.test.ts`  
Expected: FAIL because no viewer policy exists.

- [ ] **Step 3: Implement a server-owned viewer policy**

Create:

```ts
export type RealityViewer = "pantheon_player" | "creator_omniscient" | "creator_limited";

export function realityViewer(mode: WorldMode, observer: ObserverState): RealityViewer {
  if (mode === "pantheon") return "pantheon_player";
  return observer.viewpoint === "limited" ? "creator_limited" : "creator_omniscient";
}
```

Add `projectAbilitiesForOmniscient` as full known projections. Never choose omniscience from a raw client query; APIs derive mode and observer state from the entity/timeline/world relation.

- [ ] **Step 4: Apply policy to state, codex, and chronicle APIs**

State payload gains:

```ts
world: { mode: WorldMode; /* existing fields */ }
timeline: { id: string; branchName: string; branchSummary: string | null; observerState: ObserverState }
recentRewrite: RealityRewriteSummary | null
```

For omniscient creator state, send all god agendas and full abilities. Codex detail sends unrevealed sections and complete ability events. Chronicle list/detail includes `revealed: false` entries with a `worldVisible: false` marker. Limited creator view reuses existing filtering.

- [ ] **Step 5: Run API/unit tests and typecheck**

Run:

```bash
pnpm vitest run src/lib/reality/visibility.test.ts src/lib/abilities/visibility.test.ts src/components/play/AbilityList.test.ts src/components/play/codex-detail-state.test.ts
pnpm tsc --noEmit
```

Expected: PASS; no hidden mechanics leak to pantheon responses.

- [ ] **Step 6: Commit projection policy**

```bash
git add src/lib/reality/visibility.ts src/lib/reality/visibility.test.ts src/lib/abilities/visibility.ts src/app/api/worlds/[id]/state/route.ts src/app/api/codex/route.ts src/app/api/codex/[id]/route.ts src/app/api/chronicle/route.ts src/components/play/types.ts
git commit -m "feat: add creator omniscient projections"
```

---

### Task 8: Add a world-wide operation lease

**Files:**
- Create: `src/lib/reality/operation-lock.ts`
- Create: `src/lib/reality/operation-lock.test.ts`
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/lib/context/sse.ts`
- Modify: `src/app/api/chapters/[id]/settle/route.ts`
- Modify: `src/lib/settle/pipeline.ts`

- [ ] **Step 1: Write failing lock tests**

Cover claim, same-token renew, wrong-token release, expired takeover, and conflict between `chat`, `settlement`, `rewrite`, and `switch`.

```ts
expect(await claimWorldOperation(db, "w1", "rewrite", "r1", now)).toMatchObject({ acquired: true });
expect(await claimWorldOperation(db, "w1", "chat", "g1", now)).toMatchObject({ acquired: false, activeKind: "rewrite" });
expect(await claimWorldOperation(db, "w1", "chat", "g1", laterThanLease)).toMatchObject({ acquired: true });
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run src/lib/reality/operation-lock.test.ts`  
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement CAS-based lease helpers**

Implement `claimWorldOperation`, `renewWorldOperation`, `releaseWorldOperation`, and `assertNoLiveWorldOperation` with `world.updateMany` predicates over null/expired lease or matching token. Lease duration is five minutes; streaming chat and rewrite runners renew every lease-duration/3. Release clears fields only when kind and token still match.

- [ ] **Step 4: Integrate chat and settlement**

Chat claims before generation reservation, renews while SSE is open, and releases in both `onDone` and `onFailure`; a duplicate generation ID reuses its existing operation token. Settlement claims once per chapter runner and releases in `finally`. Conflict responses are HTTP 409 and name the active operation in Chinese without exposing tokens.

- [ ] **Step 5: Run concurrency suites**

Run:

```bash
pnpm vitest run src/lib/reality/operation-lock.test.ts src/app/api/chat/route.test.ts src/lib/settle/pipeline.integration.test.ts
```

Expected: PASS, including expired takeover and release-after-failure.

- [ ] **Step 6: Commit shared operation locking**

```bash
git add src/lib/reality/operation-lock.ts src/lib/reality/operation-lock.test.ts src/app/api/chat/route.ts src/lib/context/sse.ts src/app/api/chapters/[id]/settle/route.ts src/lib/settle/pipeline.ts
git commit -m "feat: serialize world mutations with leases"
```

---

### Task 9: Define the rewrite plan and absolute-authority prompts

**Files:**
- Modify: `src/lib/reality/schemas.ts`
- Modify: `src/lib/reality/schemas.test.ts`
- Create: `src/lib/prompts/rewrite.ts`
- Create: `src/lib/prompts/rewrite.test.ts`

- [ ] **Step 1: Add failing rewrite schema tests**

Test prospective, retroactive, and memory-only plans; mixed subcommands; default scope normalization; rejection of arbitrary paths; target rules (`targetId` for existing, `tempRef` for create); and branch names of 4–10 Chinese characters.

- [ ] **Step 2: Implement white-list patch schemas**

Use explicit operations rather than JSON paths:

```ts
export const RewriteScopeSchema = z.enum(["prospective", "retroactive", "memory_only"]);
export const RealityCardPatchSchema = z.object({
  section: z.enum(["theme", "style", "cosmology", "fusionAxiom", "currentEra", "establishedFacts"]),
  value: z.unknown(),
});
export const GodPatchSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), tempRef: StableRefSchema, value: RewriteGodSchema }),
  z.object({ op: z.literal("update"), targetId: z.string(), changes: RewriteGodSchema.partial().refine(hasKeys) }),
  z.object({ op: z.literal("remove"), targetId: z.string() }),
]);
export const EntityPatchSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), tempRef: StableRefSchema, value: RewriteEntitySchema }),
  z.object({ op: z.literal("update"), targetId: z.string(), changes: RewriteEntitySchema.partial().refine(hasKeys) }),
  z.object({ op: z.literal("remove"), targetId: z.string() }),
]);
export const AbilityPatchSchema = /* create/update/remove with explicit ownerRef and ability fields */;
export const ChroniclePatchSchema = /* create/update/remove with explicit ids and visibility */;
export const MemoryPatchSchema = z.object({
  entityId: z.string(),
  operation: z.enum(["replace", "append", "remove"]),
  text: z.string(),
});
```

`RewritePlanSchema` contains interpretation, effective point, branch name, each patch array, causal consequences, narration focus, and subcommands. `normalizeRewriteScope` chooses `retroactive` over `memory_only` over `prospective`; absent scope becomes `prospective`.

- [ ] **Step 3: Add absolute-authority planner and narration prompts**

Planner prompt requirements:

- the decree is always achievable;
- no power/resource/success check;
- resolve conflicts by elevating the decree;
- perform the smallest sufficient changes;
- use only supplied IDs for existing records and unique temp refs for new records;
- mark prior messages as old-reality evidence for retroactive plans rather than rewriting their text;
- default ambiguity to current-time prospective effect;
- output only the schema.

Result prompt receives source/new reality summaries plus applied consequences and must narrate what is now true without questioning or weakening the decree.

- [ ] **Step 4: Run rewrite schema/prompt tests**

Run: `pnpm vitest run src/lib/reality/schemas.test.ts src/lib/prompts/rewrite.test.ts`  
Expected: PASS, including no arbitrary database path accepted.

- [ ] **Step 5: Commit rewrite contracts**

```bash
git add src/lib/reality/schemas.ts src/lib/reality/schemas.test.ts src/lib/prompts/rewrite.ts src/lib/prompts/rewrite.test.ts
git commit -m "feat: define absolute reality rewrite plans"
```

---

### Task 10: Clone a complete timeline graph safely

**Files:**
- Create: `src/lib/reality/clone.ts`
- Create: `src/lib/reality/clone.integration.test.ts`
- Modify: `src/test/require-test-database.ts`

- [ ] **Step 1: Write the failing graph-clone integration test**

Seed one timeline with two chapters/messages, gods, entities/sections/race links, abilities/source links/events, memberships, chronicles, and omens. Clone it and assert:

- every cloned row has a new ID and child timeline ID;
- message/chapter, entity/race, ability/source, event evidence, membership, chronicle entity/god arrays, and omen god refs point to cloned IDs;
- `realityState` and `observerState` are deep-copied;
- generation requests and task leases are not cloned;
- source rows are byte-for-byte unchanged.

- [ ] **Step 2: Run the integration test**

Run: `pnpm vitest run --config vitest.integration.config.ts src/lib/reality/clone.integration.test.ts`  
Expected: FAIL because `cloneTimelineGraph` does not exist.

- [ ] **Step 3: Implement two-pass graph cloning**

Export:

```ts
export type TimelineCloneMaps = {
  chapterIds: Map<string, string>;
  messageIds: Map<string, string>;
  godIds: Map<string, string>;
  entityIds: Map<string, string>;
  abilityIds: Map<string, string>;
};

export async function cloneTimelineGraph(
  tx: Prisma.TransactionClient,
  input: { sourceTimelineId: string; worldId: string; rewriteId: string; branchName: string; branchSummary: string },
): Promise<{ timelineId: string; maps: TimelineCloneMaps }>;
```

Pass 1 creates child timeline, chapters, gods, and entities to build ID maps. Pass 2 creates messages, sections, abilities, memberships, events, chronicles, and omens with remapped references. Throw on every unmapped required reference; do not silently preserve a source-timeline ID. Mark cloned messages `{ ...meta, realityOrigin: "previous", sourceMessageId }` only when the caller later requests retroactive marking, not during the neutral clone.

- [ ] **Step 4: Run clone and existing import integration tests**

Run:

```bash
pnpm vitest run --config vitest.integration.config.ts src/lib/reality/clone.integration.test.ts src/app/api/worlds/import/route.integration.test.ts
```

Expected: PASS with all foreign keys resolving.

- [ ] **Step 5: Commit graph cloning**

```bash
git add src/lib/reality/clone.ts src/lib/reality/clone.integration.test.ts src/test/require-test-database.ts
git commit -m "feat: clone complete reality timelines"
```

---

### Task 11: Apply validated rewrite plans deterministically

**Files:**
- Create: `src/lib/reality/apply.ts`
- Create: `src/lib/reality/apply.integration.test.ts`
- Modify: `src/lib/abilities/validator.ts`

- [ ] **Step 1: Write failing patch-application tests**

Cover:

1. prospective cosmology/entity update plus visible rewrite chronicle;
2. retroactive removal and replacement, old messages marked `previousReality: true`, rewritten history summary created, dependent refs repaired or rejected;
3. memory-only update writes an entity `memory` section while objective chronicle text remains unchanged;
4. create via temp refs resolves a new god/entity/ability relationship;
5. attempts to remove an entity still required by an unpatched race/membership fail and roll back;
6. creator mode rejects creating `isPlayer: true` or tier `player`.

- [ ] **Step 2: Run the integration test**

Run: `pnpm vitest run --config vitest.integration.config.ts src/lib/reality/apply.integration.test.ts`  
Expected: FAIL because the executor does not exist.

- [ ] **Step 3: Implement the executor in fixed order**

Export:

```ts
export async function applyRewritePlan(
  tx: Prisma.TransactionClient,
  input: { worldId: string; timelineId: string; rewriteId: string; plan: RewritePlan },
): Promise<{ summary: string; consequenceLines: string[] }>;
```

Implementation order is exactly: reality cards → gods/relations → entities/sections → abilities → chronicles/memories → agendas → omens → observer state. Use Zod-parsed field objects for every create/update. Resolve existing IDs only inside `timelineId`; resolve temp refs from maps built during this call. For retroactive scope, annotate cloned message meta and create a new current-state history summary without changing message prose. For memory-only scope, do not update objective chronicle rows unless an explicit chronicle patch is present and the plan scope is not `memory_only`.

After application, run cross-reference checks for ability owner/source, entity race, memberships, chronicle arrays, god relations, active avatar, and “creator has zero player gods”. Throwing leaves the enclosing transaction untouched.

- [ ] **Step 4: Run apply/ability tests**

Run:

```bash
pnpm vitest run --config vitest.integration.config.ts src/lib/reality/apply.integration.test.ts
pnpm vitest run src/lib/abilities/validator.test.ts
```

Expected: PASS, including rollback on a dangling reference.

- [ ] **Step 5: Commit deterministic application**

```bash
git add src/lib/reality/apply.ts src/lib/reality/apply.integration.test.ts src/lib/abilities/validator.ts src/lib/abilities/validator.test.ts
git commit -m "feat: apply validated reality patches"
```

---

### Task 12: Build the idempotent rewrite task runner and APIs

**Files:**
- Create: `src/lib/reality/task-runner.ts`
- Create: `src/lib/reality/task-runner.test.ts`
- Create: `src/lib/reality/task-runner.integration.test.ts`
- Create: `src/app/api/worlds/[id]/rewrites/route.ts`
- Create: `src/app/api/rewrites/[id]/route.ts`
- Create: `src/app/api/rewrites/[id]/events/route.ts`

- [ ] **Step 1: Write failing runner state-machine tests**

Test:

- only creator worlds can create rewrites;
- `idempotencyKey` replay returns the same task;
- live lease prevents a second runner; expired lease is reclaimed;
- source timeline must still be active at transaction commit;
- plan/apply failure leaves active reality unchanged and no child branch;
- transaction success followed by narration failure retains one result branch and retry only narrates;
- completed retry returns the existing result without cloning again.

- [ ] **Step 2: Run unit tests**

Run: `pnpm vitest run src/lib/reality/task-runner.test.ts`  
Expected: FAIL because the runner and routes do not exist.

- [ ] **Step 3: Implement create/claim DTO and task states**

Expose:

```ts
export type RealityRewriteDto = {
  id: string;
  worldId: string;
  sourceTimelineId: string;
  resultTimelineId: string | null;
  decree: string;
  scope: RewriteScope;
  status: "planning" | "applying" | "narrating" | "completed" | "failed";
  interpretation: string | null;
  branchName: string | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
```

`POST /api/worlds/[id]/rewrites` validates decree length 1–4000 and idempotency key 8–128, confirms creator mode/current chapter, stores source IDs, and returns 202. `GET /api/rewrites/[id]` returns sanitized DTO; retry of failed/narrating tasks re-arms the lease without changing semantic input. SSE events report `planning`, `branching`, `applying`, `narrating`, and `completed`.

- [ ] **Step 4: Implement plan/apply transaction and narration recovery**

Runner sequence:

1. claim rewrite lease and world operation lease;
2. if `plan` is null, call `completeStructured` with `RewritePlanSchema` and persist it;
3. in a serializable transaction re-read world/source/current IDs, create the child via `cloneTimelineGraph`, apply patches, create a new chapter at previous max index + 1, set both rewrite result IDs/fork IDs, and switch active timeline;
4. set status `narrating`, generate result prose, and create the first narrator message in the new chapter with rewrite metadata;
5. mark completed and release leases.

A retry with `resultTimelineId` skips steps 2–3. All failure messages are sanitized with the existing key-redaction pattern.

- [ ] **Step 5: Run unit and integration suites**

Run:

```bash
pnpm vitest run src/lib/reality/task-runner.test.ts
pnpm vitest run --config vitest.integration.config.ts src/lib/reality/task-runner.integration.test.ts
```

Expected: PASS with exactly one child branch under all retry paths.

- [ ] **Step 6: Commit rewrite orchestration**

```bash
git add src/lib/reality/task-runner.ts src/lib/reality/task-runner.test.ts src/lib/reality/task-runner.integration.test.ts src/app/api/worlds/[id]/rewrites/route.ts src/app/api/rewrites/[id]/route.ts src/app/api/rewrites/[id]/events/route.ts
git commit -m "feat: execute idempotent reality rewrites"
```

---

### Task 13: Implement reality-tree operations

**Files:**
- Create: `src/lib/reality/tree.ts`
- Create: `src/lib/reality/tree.test.ts`
- Create: `src/lib/reality/tree.integration.test.ts`
- Create: `src/app/api/worlds/[id]/realities/route.ts`

- [ ] **Step 1: Write failing tree tests**

Cover unique root, no cycles, same-world parents, active ID existence, rewrite source/result consistency, immediate switch, undo-to-parent, conditional active-ID conflict, 1–80 character rename, root/current delete rejection, and recursive deletion of a non-current subtree.

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run src/lib/reality/tree.test.ts`  
Expected: FAIL because tree helpers do not exist.

- [ ] **Step 3: Implement tree DTO and validators**

```ts
export type RealityNodeDto = {
  id: string;
  parentId: string | null;
  branchName: string;
  branchSummary: string | null;
  forkChapter: number | null;
  rewriteId: string | null;
  rewriteDecree: string | null;
  childCount: number;
  isActive: boolean;
  updatedAt: string;
};
```

`buildRealityTree` validates membership/cycles before returning nodes. `switchReality` claims a short `switch` operation lease and uses `world.updateMany({ where: { id, activeTimelineId: expectedActiveId }})`; the target must belong to the world and have no live generation/settlement. `undoReality` calls the same operation with the active node parent. `deleteRealitySubtree` computes descendants server-side and rejects if the set includes the root or active node.

- [ ] **Step 4: Add route methods**

- `GET` returns nodes and active ID.
- `POST { action: "switch"|"undo", targetTimelineId?, expectedActiveId }` performs conditional switching.
- `PATCH { timelineId, branchName }` renames.
- `DELETE { timelineId, expectedActiveId }` removes a validated frozen subtree.

All creator-only mutation methods return 403 for pantheon worlds.

- [ ] **Step 5: Run tree suites**

Run:

```bash
pnpm vitest run src/lib/reality/tree.test.ts
pnpm vitest run --config vitest.integration.config.ts src/lib/reality/tree.integration.test.ts
```

Expected: PASS, including no partial subtree deletion.

- [ ] **Step 6: Commit reality tree operations**

```bash
git add src/lib/reality/tree.ts src/lib/reality/tree.test.ts src/lib/reality/tree.integration.test.ts src/app/api/worlds/[id]/realities/route.ts
git commit -m "feat: manage reversible reality branches"
```

---

### Task 14: Add observer settings and avatar lifecycle

**Files:**
- Create: `src/app/api/worlds/[id]/observer/route.ts`
- Create: `src/app/api/worlds/[id]/observer/route.test.ts`
- Modify: `src/lib/reality/schemas.ts`
- Modify: `src/app/api/worlds/[id]/state/route.ts`

- [ ] **Step 1: Write failing observer/avatar route tests**

Test creator-only operations:

- set focus to existing place/entity/god;
- toggle omniscient/limited without changing any database `revealed` or ability visibility value;
- create a character avatar with name, identity, appearance, optional race ID, and abilities;
- enter only a creator-avatar in the active timeline;
- exit clears active avatar and returns focus to world;
- withdraw marks/removes the avatar only after clearing focus;
- an avatar death does not modify world mode or creator permissions.

- [ ] **Step 2: Run route tests**

Run: `pnpm vitest run src/app/api/worlds/[id]/observer/route.test.ts`  
Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement observer and avatar actions**

Use a discriminated request schema:

```ts
z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_focus"), focusType: FocusTypeSchema, focusId: z.string().nullable() }),
  z.object({ action: z.literal("set_viewpoint"), viewpoint: z.enum(["omniscient", "limited"]) }),
  z.object({ action: z.literal("create_avatar"), name: z.string().min(1).max(80), identity: z.string().max(500), appearance: z.string().max(1000), raceId: z.string().nullable(), abilities: z.array(RewriteAbilitySchema).max(12) }),
  z.object({ action: z.literal("enter_avatar"), avatarId: z.string() }),
  z.object({ action: z.literal("exit_avatar") }),
  z.object({ action: z.literal("withdraw_avatar"), avatarId: z.string() }),
]);
```

Create avatars as `Entity(type: "character", isCreatorAvatar: true)` with explicit `overview`, `identity`, and `appearance` sections. Entering updates observer focus/active ID only. Withdrawing sets heat to dormant and adds a `withdrawn` section rather than deleting historical references. Validate all target IDs belong to the active timeline.

- [ ] **Step 4: Run route and visibility tests**

Run: `pnpm vitest run src/app/api/worlds/[id]/observer/route.test.ts src/lib/reality/visibility.test.ts`  
Expected: PASS; limited mode changes only projection.

- [ ] **Step 5: Commit observer/avatar support**

```bash
git add src/app/api/worlds/[id]/observer/route.ts src/app/api/worlds/[id]/observer/route.test.ts src/lib/reality/schemas.ts src/app/api/worlds/[id]/state/route.ts
git commit -m "feat: add creator observation and avatars"
```

---

### Task 15: Build creator play UI and reality tree UI

**Files:**
- Create: `src/components/play/CreatorInputDeck.tsx`
- Create: `src/components/play/creator-input-state.ts`
- Create: `src/components/play/creator-input-state.test.ts`
- Create: `src/components/play/CreatorViewPanel.tsx`
- Create: `src/components/play/RealityTreePanel.tsx`
- Create: `src/components/play/reality-tree-state.ts`
- Create: `src/components/play/reality-tree-state.test.ts`
- Modify: `src/app/play/[worldId]/page.tsx`
- Modify: `src/components/play/InputDeck.tsx`
- Modify: `src/components/play/RuneRail.tsx`
- Modify: `src/components/play/PlayDrawer.tsx`
- Modify: `src/components/play/types.ts`
- Modify: `src/components/play/MessageBlock.tsx`

- [ ] **Step 1: Write failing pure-state tests**

Test that:

- observation submission calls chat and never rewrite;
- rewrite submission creates an idempotency key and preserves input on error;
- a completed rewrite causes full state/entity-index refresh and shows the decree card;
- undo chooses the current node parent;
- switching is disabled while chat/settlement/rewrite is busy;
- creator drawer tabs replace `god` with `creator` and add `realities`; pantheon tabs remain unchanged.

- [ ] **Step 2: Run state tests**

Run: `pnpm vitest run src/components/play/creator-input-state.test.ts src/components/play/reality-tree-state.test.ts`  
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement dual-channel creator input**

`CreatorInputDeck` keeps `channel: "observe" | "rewrite"`. Observe preserves the scale dial and sends to existing chat. Rewrite changes border/accent/placeholder, hides AI suggestions and chapter settlement actions, and posts to `/api/worlds/${worldId}/rewrites`; it follows rewrite SSE until completion. Do not show a confirmation dialog. Keep the decree text if planning fails; clear it only after accepted task creation.

- [ ] **Step 4: Implement creator panels**

`CreatorViewPanel` shows branch/focus/time/viewpoint, active avatar, recent rewrite, and calls observer actions. `RealityTreePanel` renders an indented accessible tree from parent IDs, marks current reality, and offers enter, undo, rename, inspect decree, and delete-subtree actions. It reloads play state after a successful switch.

- [ ] **Step 5: Integrate mode-aware play composition**

In `PlayPage`:

- choose `InputDeck` for pantheon and `CreatorInputDeck` for creator;
- suppress automatic player-god descent wording through the already mode-aware opening API;
- reload complete state after rewrite/switch/undo;
- reset chapter/opening refs when timeline changes;
- render rewrite-result messages as an 「天外敕令」 card containing decree, interpretation, scope, branch, and return action;
- pass world mode to `RuneRail`/`PlayDrawer`.

Creator rune labels are `星图 / 编年史 / 天外视界 / 现实树 / 设定集 / 众生录`; there is no `本尊神格`. Pantheon labels remain exactly as before.

- [ ] **Step 6: Run component state tests, lint, and typecheck**

Run:

```bash
pnpm vitest run src/components/play/creator-input-state.test.ts src/components/play/reality-tree-state.test.ts src/components/play/AbilityList.test.ts src/components/play/codex-detail-state.test.ts
pnpm eslint src/app/play/[worldId]/page.tsx src/components/play
pnpm tsc --noEmit
```

Expected: all commands succeed.

- [ ] **Step 7: Commit creator play UI**

```bash
git add src/app/play/[worldId]/page.tsx src/components/play/CreatorInputDeck.tsx src/components/play/creator-input-state.ts src/components/play/creator-input-state.test.ts src/components/play/CreatorViewPanel.tsx src/components/play/RealityTreePanel.tsx src/components/play/reality-tree-state.ts src/components/play/reality-tree-state.test.ts src/components/play/InputDeck.tsx src/components/play/RuneRail.tsx src/components/play/PlayDrawer.tsx src/components/play/types.ts src/components/play/MessageBlock.tsx
git commit -m "feat: add creator controls and reality tree UI"
```

---

### Task 16: Upgrade export/import to preserve modes and reality trees

**Files:**
- Modify: `src/app/api/worlds/[id]/export/route.ts`
- Modify: `src/app/api/worlds/import/route.ts`
- Modify: `src/app/api/worlds/import/route.test.ts`
- Modify: `src/app/api/worlds/import/route.integration.test.ts`
- Modify: `src/lib/materials/runtime-snapshot.ts`
- Modify: `src/lib/materials/runtime-snapshot.integration.test.ts`

- [ ] **Step 1: Add failing version 3 round-trip tests**

Build a creator archive with two sibling branches, rewrites, observer state, an avatar, hidden facts, and active second branch. Assert export/import preserves tree topology and semantic IDs after remapping. Add negative tests for a cycle, cross-world parent, missing active node, mismatched rewrite result, and a creator archive containing a player god. Keep v1/v2 fixtures importing as pantheon.

- [ ] **Step 2: Run import/export suites**

Run:

```bash
pnpm vitest run src/app/api/worlds/import/route.test.ts
pnpm vitest run --config vitest.integration.config.ts src/app/api/worlds/import/route.integration.test.ts
```

Expected: FAIL because version 3 fields are not accepted/exported.

- [ ] **Step 3: Export version 3**

Change payload to `version: 3` and include mode, complete timeline branch/reality/observer fields, `isCreatorAvatar`, and all rewrite records. Exclude operation/lease tokens and errors that may contain provider details. Preserve hidden/private content because archive export is owner-private.

- [ ] **Step 4: Import with full ID remapping and graph validation**

Accept versions 1, 2, and 3. Before any writes, validate collection bounds and reality graph. Create world/timelines first, then chapters/messages/gods/entities, abilities/memberships/events, chronicles/omens, rewrites, and finally repair parent/fork/result/active IDs. Set old versions to pantheon and derive missing root reality/observer state from world cards. Run creator/pantheon invariant validation before commit.

- [ ] **Step 5: Keep runtime material snapshots mode-safe**

Creator runtime snapshots classify all gods as major/minor and never synthesize `player_god`; avatars are character material only when normal runtime snapshot rules select them.

- [ ] **Step 6: Run round-trip and material tests**

Run:

```bash
pnpm vitest run src/app/api/worlds/import/route.test.ts
pnpm vitest run --config vitest.integration.config.ts src/app/api/worlds/import/route.integration.test.ts src/lib/materials/runtime-snapshot.integration.test.ts
```

Expected: PASS for v1/v2 compatibility and v3 tree round-trip.

- [ ] **Step 7: Commit archive version 3**

```bash
git add src/app/api/worlds/[id]/export/route.ts src/app/api/worlds/import/route.ts src/app/api/worlds/import/route.test.ts src/app/api/worlds/import/route.integration.test.ts src/lib/materials/runtime-snapshot.ts src/lib/materials/runtime-snapshot.integration.test.ts
git commit -m "feat: archive creator reality trees"
```

---

### Task 17: Update product documentation and perform full verification

**Files:**
- Modify: `README.md`
- Modify: `docs/00-总览.md`
- Modify: `docs/01-产品设计.md`
- Modify: `docs/02-技术架构.md`
- Modify: `docs/03-数据模型.md`
- Modify: `docs/04-Prompt体系.md`
- Modify: `docs/05-UI设计.md`
- Modify: `docs/06-里程碑计划.md`

- [ ] **Step 1: Update user and architecture documentation**

Document the approved names, immutable creation choice, creator’s no-player-god invariant, observation/rewrite channels, all-knowing/limited projection, avatars, rewrite scope semantics, automatic branching, undo/switch behavior, world mutex, version 3 archive, and explicit non-goals (parallel simulation, merge, multiplayer, mode conversion).

- [ ] **Step 2: Run migration and generated-client checks**

Run:

```bash
pnpm prisma validate
pnpm prisma generate
pnpm prisma migrate status
```

Expected: schema valid, client generated, migration history consistent with the configured database.

- [ ] **Step 3: Run all unit tests**

Run: `pnpm test`  
Expected: all Vitest unit suites pass.

- [ ] **Step 4: Run all integration tests**

Run: `pnpm test:integration`  
Expected: all PostgreSQL-backed suites pass; no skipped creator rewrite/tree round-trip coverage.

- [ ] **Step 5: Run static verification and production build**

Run:

```bash
pnpm lint
pnpm tsc --noEmit
pnpm build
```

Expected: all commands exit 0 with no Next.js route-handler or client/server boundary errors.

- [ ] **Step 6: Perform browser acceptance in both modes**

Start `pnpm dev` and verify with the browser:

1. Homepage shows two mode cards and mode-specific placeholders.
2. Pantheon creation still creates/edits/embarks exactly one player god.
3. Creator creation edits/embarks with no player god or GodPanel.
4. Creator opening is world observation, and ordinary input creates no branch.
5. Omniscient mode displays a hidden agenda; limited mode hides it without changing stored visibility.
6. Create/enter/exit/withdraw an avatar; creator rewrite remains available throughout.
7. Submit one prospective, one retroactive, and one memory-only decree and inspect their result cards.
8. Undo, enter an older branch, create a sibling branch, rename it, and verify frozen branches do not advance.
9. Export the branched creator world, import it, and verify the same active branch/tree.
10. At mobile width, select mode, submit a rewrite, and switch realities without clipped controls.

Save screenshots under `.playwright-mcp/` only; do not commit generated screenshots/logs.

- [ ] **Step 7: Review the final diff for secrets and unrelated edits**

Run:

```bash
git diff --check
git status --short
git diff --stat
git diff | rg -n 'sk-|AIza|BEGIN (RSA|OPENSSH|PRIVATE)|operationToken|leaseToken' || true
```

Expected: no whitespace errors or credentials; operation/lease tokens appear only as field names and are never serialized to client/archive DTOs.

- [ ] **Step 8: Commit docs and final verification fixes**

```bash
git add README.md docs/00-总览.md docs/01-产品设计.md docs/02-技术架构.md docs/03-数据模型.md docs/04-Prompt体系.md docs/05-UI设计.md docs/06-里程碑计划.md
git commit -m "docs: document creator mode and reality branching"
```

---

## Implementation order and checkpoints

- **Checkpoint A — selectable working mode:** Tasks 1–5. A creator world can be generated, edited, and embarked with no player god.
- **Checkpoint B — safe creator observation:** Tasks 6–8. Creator narration, omniscience, fog observation, frozen-reality guards, and operation locking work before destructive rewrite code exists.
- **Checkpoint C — rewrite engine:** Tasks 9–13. Structured planning, graph cloning, deterministic application, idempotent tasks, undo, and branching are complete.
- **Checkpoint D — complete product surface:** Tasks 14–17. Avatars, play UI, archive compatibility, documentation, and full acceptance are complete.

Do not start creator UI against mocked rewrite behavior before Checkpoint C. Do not enable a rewrite endpoint before graph-clone rollback and idempotent-retry integration tests pass.
