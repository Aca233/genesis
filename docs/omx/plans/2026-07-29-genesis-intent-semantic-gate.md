# Genesis Intent Contract and Semantic Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $team (coordinated parallel execution) or $ralph (persistent single-owner completion) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a frozen Genesis intent contract and a blocking semantic quality gate so premise drift, false divinity classification, unsupported canon claims, anchor-state leaks, and unearned power shortcuts cannot enter a newly saved world.

**Architecture:** A short structured call first converts the decree into a persisted `GenesisIntentContract`. The existing deck generator consumes that contract, deterministic validators run as they do today, and a broader semantic auditor either passes the deck, returns non-blocking warnings, or drives one targeted repair followed by one re-audit. The same contract and gate are reused by rerolls, while old persisted decks and old fusion-axiom shapes remain readable.

**Tech Stack:** TypeScript 5, Next.js 16 App Router, React 19, Zod 4, Prisma 7/PostgreSQL JSONB, Vitest 4, existing structured LLM gateway.

## Global Constraints

- Keep `pantheon` as god-roleplay: the player is an independent god and never becomes the reincarnated mortal protagonist.
- The decree-designated reincarnated protagonist is the sole narrative center; the player god is an observer, patron, or limited intervener.
- IP uncertainty policy is exactly `omit_or_generalize`; uncertain canon facts must be omitted or generalized, never asserted as canon.
- A semantic `error` must not be persisted; one semantic repair and one re-audit are the hard maximum.
- Preserve all player-locked paths during reroll and semantic repair.
- Old worlds remain readable; no background rewrite or destructive backfill.
- Do not add dependencies.
- Use the session `apply_patch` helper for every source edit.
- Before changing Next.js route handlers or client pages, read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`.
- Leave unrelated dirty files in `C:\创世` untouched; stage only files named by the current task.

## File Structure Map

### New focused modules

- `src/lib/genesis/intent.ts` — intent contract schema, type, persisted parsing, and mode invariants.
- `src/lib/prompts/genesis-intent.ts` — intent extraction system/user prompts.
- `src/lib/genesis/intent-generator.ts` — structured intent call and retry boundary.
- `src/lib/genesis/semantic-audit.ts` — broad semantic issue schema, prompt, severity normalization, and audit call.
- `src/lib/prompts/genesis-quality.ts` — targeted semantic repair prompt.
- `src/lib/genesis/semantic-gate.ts` — audit → one repair → validate → one re-audit orchestration.
- `src/lib/genesis/locked-paths.ts` — deterministic locked-field preservation shared by reroll and semantic repair.
- `src/lib/genesis/quality-observability.ts` — content-free structured quality events for aggregation.
- `src/components/genesis/GenesisIntentSummary.tsx` — read-only intent summary.
- `src/components/genesis/GenesisAuditWarnings.tsx` — warning-only confirmation-page report.

### Existing integration points

- `src/lib/cards/schemas.ts` — new fusion-axiom shape, legacy normalization, and lower IP pantheon count floor.
- `src/lib/prompts/genesis.ts` — inject contract into generation/repair/reroll and tighten pantheon/fusion rules.
- `src/lib/genesis/generate.ts` — export the existing deterministic deck validator for semantic repair reuse.
- `src/lib/genesis/task-runner.ts` — generate/persist intent, run quality gate, persist report, and refuse residual errors.
- `src/lib/genesis/stages.ts` — expose intent/audit/semantic-repair progress.
- `src/app/api/worlds/[id]/reroll/route.ts` — lazy intent generation and quality-gated reroll.
- `src/app/api/worlds/[id]/route.ts` — owner DTO with parsed intent and audit warning report.
- `src/app/genesis/[worldId]/page.tsx` — render intent summary and warnings; use new fusion fields.
- `src/components/genesis/card-editors.tsx` — edit new fusion fields.
- `src/components/genesis/deck-utils.ts` — source-aware minimum major-god count.
- `src/lib/archive/v2.ts`, export/import routes — archive intent without changing archive version.
- `prisma/schema.prisma` and one additive migration — nullable JSONB on worlds and Genesis tasks.

---

### Task 1: Intent Contract Domain, Prompt, Generator, and Persistence Columns

**Files:**
- Create: `src/lib/genesis/intent.ts`
- Create: `src/lib/genesis/intent.test.ts`
- Create: `src/lib/prompts/genesis-intent.ts`
- Create: `src/lib/prompts/genesis-intent.test.ts`
- Create: `src/lib/genesis/intent-generator.ts`
- Create: `src/lib/genesis/intent-generator.test.ts`
- Modify: `prisma/schema.prisma:87-151`
- Create: `prisma/migrations/20260729150000_genesis_intent_quality_gate/migration.sql`

**Interfaces:**
- Produces: `GenesisIntentContractSchema`, `GenesisIntentContract`, `parseGenesisIntent`, `assertGenesisIntentForMode`.
- Produces: `genesisIntentSystem(mode)` and `genesisIntentUserPrompt(input)`.
- Produces: `generateGenesisIntent(input, deps?) => Promise<GenesisIntentContract>`.
- Produces: non-transient `GenesisIntentGenerationError` after the two allowed intent attempts are exhausted.
- Persists: `World.genesisIntent` and `GenesisTask.intentContract`, both nullable JSONB.

- [ ] **Step 1: Write failing schema and invariant tests**

Add tests that construct the exact approved contract and reject mode drift:

```ts
const crossoverIntent = {
  sourceBasis: "multi_ip",
  sourceIps: ["无职转生", "钢铁侠"],
  explicitPremise: ["鲁迪乌斯由托尼·斯塔克转生"],
  narrativeCenter: {
    identity: "托尼·斯塔克转生后的鲁迪乌斯",
    role: "转生主角",
    startState: "刚出生，仅保留人格、记忆与工程思维",
  },
  playerRole: {
    type: "independent_god",
    narrativeFunction: "limited_intervener",
    mustNotReplaceProtagonist: true,
  },
  forbiddenExpansions: ["独立贾维斯神格", "开局已有钢铁装甲"],
  factsAtAnchor: ["鲁迪乌斯刚出生"],
  futureOnly: ["建立工坊", "验证魔力能否驱动机械"],
  fusionBoundaries: ["工程知识只能提出假设，不能直接改写世界物理规律"],
  uncertaintyPolicy: "omit_or_generalize",
  corePressures: ["婴儿身体限制", "隐瞒成年意识"],
} as const;

expect(GenesisIntentContractSchema.parse(crossoverIntent)).toEqual(crossoverIntent);
expect(() => assertGenesisIntentForMode(crossoverIntent, "creator")).toThrow(/external_creator/);
expect(() => GenesisIntentContractSchema.parse({
  ...crossoverIntent,
  factsAtAnchor: ["建立工坊"],
})).toThrow(/futureOnly/);
```

- [ ] **Step 2: Run the intent tests and verify they fail**

Run:

```powershell
pnpm exec vitest run src/lib/genesis/intent.test.ts
```

Expected: FAIL because `intent.ts` and its exports do not exist.

- [ ] **Step 3: Implement the contract schema and deterministic invariants**

Use bounded arrays and a cross-field refinement:

```ts
export const GenesisIntentContractSchema = z.object({
  sourceBasis: z.enum(["original", "single_ip", "multi_ip"]),
  sourceIps: z.array(z.string().min(1)).max(6),
  explicitPremise: z.array(z.string().min(1)).min(1).max(8),
  narrativeCenter: z.object({
    identity: z.string().min(1),
    role: z.string().min(1),
    startState: z.string().min(1),
  }).strict(),
  playerRole: z.object({
    type: z.enum(["independent_god", "external_creator"]),
    narrativeFunction: z.enum(["observer_patron", "limited_intervener", "external_author"]),
    mustNotReplaceProtagonist: z.boolean(),
  }).strict(),
  forbiddenExpansions: z.array(z.string().min(1)).max(12),
  factsAtAnchor: z.array(z.string().min(1)).max(12),
  futureOnly: z.array(z.string().min(1)).max(12),
  fusionBoundaries: z.array(z.string().min(1)).max(10),
  uncertaintyPolicy: z.literal("omit_or_generalize"),
  corePressures: z.array(z.string().min(1)).min(1).max(8),
}).strict().superRefine((intent, ctx) => {
  const future = new Set(intent.futureOnly.map((item) => item.trim()));
  intent.factsAtAnchor.forEach((item, index) => {
    if (future.has(item.trim())) ctx.addIssue({
      code: "custom",
      path: ["factsAtAnchor", index],
      message: "锚点事实与 futureOnly 重复",
    });
  });
});

export type GenesisIntentContract = z.infer<typeof GenesisIntentContractSchema>;

export function parseGenesisIntent(value: unknown): GenesisIntentContract | null {
  const parsed = GenesisIntentContractSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
```

`assertGenesisIntentForMode` must require `independent_god/true` for pantheon and `external_creator` for creator.

- [ ] **Step 4: Write failing prompt and generator tests**

The prompt test must assert the exact policy phrases and source inputs are present. The generator test injects a fake `complete` function and verifies `task: "extract"`, `temperature: 0.1`, the intent schema, and one retry after a transient rejection.

```ts
expect(genesisIntentSystem("pantheon")).toContain("exactly one narrative center");
expect(genesisIntentSystem("pantheon")).toContain("independent god");
expect(genesisIntentSystem("pantheon")).toContain("omit_or_generalize");
expect(genesisIntentUserPrompt({
  mode: "pantheon",
  decree: "无职转生，但是鲁迪是托尼斯塔克转生",
  lorebookExcerpts: "布耶纳村资料",
})).toContain("布耶纳村资料");
```

- [ ] **Step 5: Implement the prompt and structured generator**

Use this public signature:

```ts
export type GenerateGenesisIntentInput = {
  mode: WorldMode;
  decree: string;
  userId: string;
  lorebookExcerpts?: string;
};

export async function generateGenesisIntent(
  input: GenerateGenesisIntentInput,
  deps: IntentGeneratorDeps = { complete: completeStructured },
): Promise<GenesisIntentContract>;
```

Call the `backstage` slot with `task: "extract"`, `maxTokens: 3000`, and at most two attempts. Parse the result again with `GenesisIntentContractSchema` and call `assertGenesisIntentForMode` before returning. After the second failure, throw `GenesisIntentGenerationError` with a safe Chinese message and the original error as `cause`; this wrapper must not satisfy `isTransientLlmError`, preventing the outer task runner from multiplying the approved retry budget. Do not fall back to a guessed contract.

- [ ] **Step 6: Add the additive Prisma migration**

Modify the Prisma models and add exactly this migration:

```sql
ALTER TABLE "worlds" ADD COLUMN "genesis_intent" JSONB;
ALTER TABLE "genesis_tasks" ADD COLUMN "intent_contract" JSONB;
```

Use these Prisma fields:

```prisma
genesisIntent  Json? @map("genesis_intent")
intentContract Json? @map("intent_contract")
```

- [ ] **Step 7: Verify Task 1**

Run:

```powershell
pnpm exec vitest run src/lib/genesis/intent.test.ts src/lib/prompts/genesis-intent.test.ts src/lib/genesis/intent-generator.test.ts
pnpm exec prisma generate
pnpm exec prisma validate
```

Expected: all tests pass; Prisma generate and validate exit 0.

- [ ] **Step 8: Commit Task 1**

```powershell
git add -- src/lib/genesis/intent.ts src/lib/genesis/intent.test.ts src/lib/prompts/genesis-intent.ts src/lib/prompts/genesis-intent.test.ts src/lib/genesis/intent-generator.ts src/lib/genesis/intent-generator.test.ts prisma/schema.prisma prisma/migrations/20260729150000_genesis_intent_quality_gate/migration.sql
git commit -m "feat(genesis): add persisted intent contract"
```

---

### Task 2: Fusion-Axiom Compatibility, Pantheon Count Floor, and Prompt Rules

**Files:**
- Modify: `src/lib/cards/schemas.ts:286-298,559-623,1012-1029`
- Modify: `src/lib/cards/schemas.test.ts`
- Modify: `src/lib/abilities/embark.test-fixtures.ts`
- Modify: `src/lib/genesis/generate.test.ts`
- Modify: `src/lib/prompts/genesis.ts:14-48,63-139`
- Modify: `src/lib/prompts/genesis.test.ts`
- Modify: `src/components/genesis/card-editors.tsx:68-82`
- Modify: `src/components/genesis/card-editors.test.tsx`
- Modify: `src/components/genesis/deck-utils.ts`
- Modify: `src/components/genesis/deck-utils.test.ts`
- Modify: `src/app/genesis/[worldId]/page.tsx:193-250,440-455`

**Interfaces:**
- Produces canonical `FusionAxiomCardSchema` with `establishedRules`, `openQuestions`, `hardLimits`, and `conflictRule`.
- Produces `normalizePersistedFusionAxiom(value)` for old `axioms/powerMapping` data.
- Produces `minimumMajorGodCount(deck) => 1 | 4`.
- Updates all Genesis prompt functions to consume an optional `intentContract` string/object.

- [ ] **Step 1: Write failing schema compatibility tests**

Add tests proving new decks require the new fields while `parsePersistedWorldDeck` normalizes old data:

```ts
const legacyFusion = {
  sourceIps: ["甲", "乙"],
  axioms: ["旧公理"],
  powerMapping: "旧力量对标",
  conflictRule: "以甲为准",
};

const parsed = parsePersistedWorldDeck({ ...completeDeck(), fusionAxiom: legacyFusion });
expect(parsed.fusionAxiom).toEqual({
  sourceIps: ["甲", "乙"],
  establishedRules: ["旧公理"],
  openQuestions: ["旧力量对标"],
  hardLimits: ["旧版融合公理未记录明确限制"],
  conflictRule: "以甲为准",
});
expect(PantheonWorldDeckSchema.safeParse({
  ...completeDeck(),
  fusionAxiom: legacyFusion,
}).success).toBe(false);
```

Also test that a current IP deck with one major god parses, while zero major gods does not.

- [ ] **Step 2: Run schema tests and verify failure**

```powershell
pnpm exec vitest run src/lib/cards/schemas.test.ts
```

Expected: FAIL because the new fusion shape and one-god floor do not exist.

- [ ] **Step 3: Implement canonical and legacy fusion schemas**

Define the current schema:

```ts
export const FusionAxiomCardSchema = z.object({
  sourceIps: z.array(z.string()).min(2),
  establishedRules: z.array(z.string()).min(1).max(8),
  openQuestions: z.array(z.string()).min(1).max(8),
  hardLimits: z.array(z.string()).min(1).max(8),
  conflictRule: z.string().min(1),
}).strict();
```

Keep the legacy shape private and normalize it before strict persisted parsing, including the `normalizeLegacyWorldDeck` path for pre-ability drafts. Change both current major-god arrays from `.min(4)` to `.min(1)`; do not lower the maximum. Add a deck-level refinement that requires at least four major gods only when `temporalAnchor.source.basis === "original"`. Decks without a temporal anchor remain readable, while the UI utility keeps their editing floor at four. Update shared fixtures to the new fusion shape.

- [ ] **Step 4: Write failing prompt and UI utility tests**

Assert the system prompt includes all approved boundaries:

```ts
const system = genesisSystem("pantheon");
expect(system).toContain("1-5");
expect(system).toContain("never pad the pantheon");
expect(system).toContain("a title containing 神 is not evidence of divinity");
expect(system).toContain("establishedRules");
expect(system).toContain("openQuestions");
expect(system).toContain("hardLimits");
expect(system).toContain("anchor-time asset test");
expect(system).toContain("decree deletion test");
```

Test `minimumMajorGodCount` returns 1 for `single_ip/multi_ip` and 4 for `original` or old decks without a temporal anchor.

- [ ] **Step 5: Inject the intent contract and tighten generation/reroll prompts**

Extend these prompt inputs with `intentContract?: GenesisIntentContract`:

```ts
genesisUserPrompt(opts)
genesisRepairPrompt(opts)
rerollUserPrompt(opts)
rerollReferenceRepairPrompt(opts)
```

Serialize the contract under a clearly delimited `FROZEN GENESIS INTENT CONTRACT` section. The system rules must state:

- IP pantheons use 1–5 high-confidence divine entities and never pad to quota.
- Original worlds may still target 4–9 major gods.
- Names or martial titles containing “神” are not divinity evidence.
- Player god abilities, faith, and relationships need anchor-time causes and cannot borrow the protagonist equipment or assistant.
- Fusion facts are separated into established rules, open questions, hard limits, and conflict rule.
- Every current asset must answer why it exists at the anchor.
- Core conflicts must fail the decree-deletion test.

- [ ] **Step 6: Update fusion editor, card preview, and count guard**

Render/edit the three lists:

```tsx
<ListField label="已确立规则" path="fusionAxiom.establishedRules" values={f.establishedRules} {...common} />
<ListField label="待验证问题" path="fusionAxiom.openQuestions" values={f.openQuestions} {...common} />
<ListField label="硬性限制" path="fusionAxiom.hardLimits" values={f.hardLimits} {...common} />
```

The card preview should show one line from each group. Replace the hard-coded `majorGods.length <= 4` guard with `majorGods.length <= minimumMajorGodCount(deck)`.

- [ ] **Step 7: Verify Task 2**

```powershell
pnpm exec vitest run src/lib/cards/schemas.test.ts src/lib/prompts/genesis.test.ts src/components/genesis/card-editors.test.tsx src/components/genesis/deck-utils.test.ts src/lib/genesis/generate.test.ts
```

Expected: all selected tests pass and persisted old fusion data normalizes to the canonical shape.

- [ ] **Step 8: Commit Task 2**

```powershell
git add -- src/lib/cards/schemas.ts src/lib/cards/schemas.test.ts src/lib/abilities/embark.test-fixtures.ts src/lib/genesis/generate.test.ts src/lib/prompts/genesis.ts src/lib/prompts/genesis.test.ts src/components/genesis/card-editors.tsx src/components/genesis/card-editors.test.tsx src/components/genesis/deck-utils.ts src/components/genesis/deck-utils.test.ts src/app/genesis/[worldId]/page.tsx
git commit -m "feat(genesis): constrain pantheons and fusion axioms"
```

---

### Task 3: Broad Semantic Auditor and Legacy Report Compatibility

**Files:**
- Create: `src/lib/genesis/semantic-audit.ts`
- Create: `src/lib/genesis/semantic-audit.test.ts`
- Retain until Task 5: `src/lib/genesis/temporal-audit.ts`

**Interfaces:**
- Produces: `GenesisSemanticIssueTypeSchema`, `GenesisSemanticIssueSchema`, `GenesisSemanticAuditResultSchema`.
- Produces: `GenesisQualityReportSchema`, `GenesisQualityReport`, and `parseGenesisQualityReport` for persisted old/new reports.
- Produces: `auditGenesisSemantics(deck, opts, deps?)` and `hasBlockingIssues(report)`.
- Produces: non-transient `GenesisSemanticAuditError` after two audit attempts are exhausted.

- [ ] **Step 1: Write failing issue-schema and normalization tests**

Cover every required issue type and legacy warning parsing:

```ts
expect(GenesisSemanticIssueTypeSchema.options).toEqual(expect.arrayContaining([
  "future_identity_leak",
  "continuity_mix",
  "death_conflict",
  "causality_conflict",
  "unsupported_canon_claim",
  "premise_drift",
  "narrative_center_duplication",
  "ontology_mismatch",
  "anchor_state_leak",
  "power_shortcut",
  "unsupported_fusion_rule",
  "causal_disconnect",
  "information_leak",
]));

expect(parseGenesisQualityReport({
  verdict: "warnings",
  issues: [{
    severity: "warning",
    path: "majorCharacters.0.background",
    type: "future_identity_leak",
    explanation: "旧报告",
    evidenceRefs: [],
  }],
})?.issues[0]?.repairInstruction).toBe("按原报告说明检查并修复该字段");
```

- [ ] **Step 2: Run the semantic-audit tests and verify failure**

```powershell
pnpm exec vitest run src/lib/genesis/semantic-audit.test.ts
```

Expected: FAIL because `semantic-audit.ts` does not exist.

- [ ] **Step 3: Implement model-result and persisted-report schemas**

Use separate schemas so model output cannot set metrics:

```ts
export const GenesisSemanticIssueSchema = z.object({
  severity: z.enum(["warning", "error"]),
  path: z.string().min(1),
  type: GenesisSemanticIssueTypeSchema,
  explanation: z.string().min(1),
  evidenceRefs: z.array(z.string()).max(8),
  repairInstruction: z.string().min(1),
}).strict();

export const GenesisSemanticAuditResultSchema = z.object({
  verdict: z.enum(["pass", "warnings", "errors"]),
  issues: z.array(GenesisSemanticIssueSchema).max(16),
}).strict();

export const GenesisQualityReportSchema = GenesisSemanticAuditResultSchema.extend({
  meta: z.object({
    initialErrorCount: z.number().int().min(0),
    initialWarningCount: z.number().int().min(0),
    repaired: z.boolean(),
    auditPasses: z.number().int().min(1).max(2),
    durationMs: z.number().int().min(0),
  }).strict().optional(),
}).strict();
```

Export `type GenesisQualityReport = z.infer<typeof GenesisQualityReportSchema>`. Normalize verdict from the final issue list. Force these types to at least `error`: premise drift, narrative-center duplication, ontology mismatch, anchor-state leak, power shortcut, unsupported fusion rule, future identity leak, death conflict, and causality conflict. Preserve model severity for unsupported canon claims, causal disconnect, continuity mix, and information leaks so low-impact ambiguity can remain a warning. Parse legacy reports through a separate legacy schema and supply the non-empty default repair instruction shown in Step 1.

- [ ] **Step 4: Write failing prompt and retry tests**

The exact regression prompt must mention the malformed world symptoms:

```ts
const prompt = semanticAuditUserPrompt(badDeck, {
  decree: "无职转生，但是鲁迪是托尼斯塔克转生",
  intent: crossoverIntent,
});
expect(prompt).toContain("独立贾维斯神格");
expect(prompt).toContain("水神雷妲");
expect(prompt).toContain("地下秘密实验工坊");
expect(prompt).toContain("FROZEN GENESIS INTENT CONTRACT");
```

Inject a fake completion that rejects once then returns a report; assert exactly two calls. Also assert original worlds are audited rather than skipped.

- [ ] **Step 5: Implement the semantic audit prompt and call**

Use this signature:

```ts
export async function auditGenesisSemantics(
  deck: WorldDeck,
  opts: {
    userId: string;
    decree: string;
    intent: GenesisIntentContract;
    lorebookExcerpts?: string;
    slot?: SlotName;
  },
  deps: SemanticAuditDeps = { complete: completeStructured },
): Promise<GenesisSemanticAuditResult>;
```

The system prompt must explicitly compare the deck against the decree, contract, temporal anchor, provenance, and lorebook. Call `completeStructured` with `task: "extract"`, `temperature: 0.1`, `maxTokens: 8000`, and at most two attempts. Do not catch and return `null`; after the second failure throw `GenesisSemanticAuditError` with a safe Chinese message and `cause`. The wrapper must be non-transient so `runGenesisTask` does not retry the whole task and exceed the audit budget.

- [ ] **Step 6: Verify Task 3**

```powershell
pnpm exec vitest run src/lib/genesis/semantic-audit.test.ts
```

Expected: all semantic schema, retry, severity, legacy-normalization, IP, and original-world tests pass.

- [ ] **Step 7: Commit Task 3**

```powershell
git add -- src/lib/genesis/semantic-audit.ts src/lib/genesis/semantic-audit.test.ts
git commit -m "feat(genesis): add semantic world auditor"
```

---

### Task 4: Semantic Repair Prompt and One-Repair Quality Gate

**Files:**
- Create: `src/lib/prompts/genesis-quality.ts`
- Create: `src/lib/prompts/genesis-quality.test.ts`
- Create: `src/lib/genesis/locked-paths.ts`
- Create: `src/lib/genesis/locked-paths.test.ts`
- Create: `src/lib/genesis/semantic-gate.ts`
- Create: `src/lib/genesis/semantic-gate.test.ts`
- Modify: `src/lib/genesis/generate.ts:49-64`
- Modify: `src/lib/genesis/generate.test.ts`

**Interfaces:**
- Produces: `preserveLockedPaths(generated, current, lockedPaths, mode) => WorldDeck`.
- Produces: `semanticRepairPrompt(input)`.
- Produces: `enforceGenesisQuality(input, deps?) => Promise<{ deck, report }>`.
- Produces: `GenesisSemanticGateError` carrying the final report and a safe Chinese summary.
- Exposes: `validateGenesisDeck(rawDeck, expectedMode, materialSnapshot) => WorldDeck` from `generate.ts`.

- [ ] **Step 1: Move locked-field behavior behind failing shared tests**

Extract the reroll route behavior without changing semantics:

```ts
const generated = completeCreatorDeck();
generated.worldName = "模型新名字";
const current = completeCreatorDeck();
current.worldName = "玩家锁定名字";

expect(preserveLockedPaths(
  generated,
  current,
  ["worldName"],
  "creator",
).worldName).toBe("玩家锁定名字");
```

Also test an invalid merged deck throws instead of returning unvalidated JSON.

- [ ] **Step 2: Export the deterministic deck validator**

Rename the private `validateParsedDeck` export without changing its body:

```ts
export function validateGenesisDeck(
  rawDeck: unknown,
  expectedMode: WorldMode,
  materialSnapshot: GenesisMaterialSnapshot | null,
): WorldDeck;
```

Keep `parseAndValidate` calling this function so existing generation behavior remains covered.

- [ ] **Step 3: Write failing semantic-gate tests**

Cover four flows with injected `audit`, `repair`, and `validate` dependencies:

```ts
it("persists warning-only output without repair", async () => {
  const result = await enforceGenesisQuality(input, {
    audit: vi.fn().mockResolvedValue(warningReport),
    repair: vi.fn(),
    validate: vi.fn(),
  });
  expect(result.deck).toBe(input.deck);
  expect(result.report.verdict).toBe("warnings");
});

it("repairs one error and re-audits once", async () => {
  const audit = vi.fn()
    .mockResolvedValueOnce(errorReport)
    .mockResolvedValueOnce(passReport);
  const result = await enforceGenesisQuality(input, { audit, repair, validate });
  expect(audit).toHaveBeenCalledTimes(2);
  expect(repair).toHaveBeenCalledTimes(1);
  expect(result.report.meta?.repaired).toBe(true);
});
```

The other two flows are audit failure propagation and residual-error rejection.

- [ ] **Step 4: Implement the targeted repair prompt**

The prompt input is exact and bounded:

```ts
export type SemanticRepairPromptInput = {
  mode: WorldMode;
  decree: string;
  intent: GenesisIntentContract;
  invalidDeck: WorldDeck;
  issues: GenesisSemanticIssue[];
  lockedPaths?: string[];
  lorebookExcerpts?: string;
  materialConstraints?: string;
};
```

The prompt must say to edit only listed paths and necessary references, preserve stable refs and locked paths, remove unsupported details rather than invent replacements, and return the complete corrected deck.

- [ ] **Step 5: Implement the one-repair gate**

Use this signature:

```ts
export async function enforceGenesisQuality(
  input: {
    deck: WorldDeck;
    mode: WorldMode;
    decree: string;
    intent: GenesisIntentContract;
    userId: string;
    lorebookExcerpts?: string;
    materialSnapshot: GenesisMaterialSnapshot | null;
    materialConstraints?: string;
    lockedPaths?: string[];
    currentDeck?: WorldDeck;
    onStage?: (stage: "audit" | "semantic_repair") => Promise<void> | void;
  },
  deps: GenesisQualityGateDeps = defaultGenesisQualityGateDeps,
): Promise<{ deck: WorldDeck; report: GenesisQualityReport }>;
```

Algorithm:

1. Call `onStage?.("audit")`, then audit once.
2. If no error, return the original deck plus metrics.
3. Call `onStage?.("semantic_repair")`, then complete one structured repair using the mode-specific current deck schema.
4. Reapply locked paths when `currentDeck` exists.
5. Call `validateGenesisDeck` on the repair result.
6. Audit once more.
7. Throw non-transient `GenesisSemanticGateError` with the final report and a safe Chinese summary if any error remains.

- [ ] **Step 6: Verify Task 4**

```powershell
pnpm exec vitest run src/lib/genesis/locked-paths.test.ts src/lib/prompts/genesis-quality.test.ts src/lib/genesis/semantic-gate.test.ts src/lib/genesis/generate.test.ts
```

Expected: all tests pass; quality gate performs no more than one repair and two audits.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- src/lib/prompts/genesis-quality.ts src/lib/prompts/genesis-quality.test.ts src/lib/genesis/locked-paths.ts src/lib/genesis/locked-paths.test.ts src/lib/genesis/semantic-gate.ts src/lib/genesis/semantic-gate.test.ts src/lib/genesis/generate.ts src/lib/genesis/generate.test.ts
git commit -m "feat(genesis): block invalid worlds with semantic repair"
```

---

### Task 5: Task Runner, Durable Stages, and No-Persist Quality Gate

**Files:**
- Modify: `src/lib/genesis/stages.ts`
- Modify: `src/lib/genesis/stages.test.ts`
- Modify: `src/lib/genesis/task-runner.ts`
- Modify: `src/lib/genesis/task-runner.test.ts`
- Create: `src/lib/genesis/quality-observability.ts`
- Create: `src/lib/genesis/quality-observability.test.ts`
- Delete: `src/lib/genesis/temporal-audit.ts`
- Delete: `src/lib/genesis/temporal-audit.test.ts`
- Modify: `src/components/genesis/GenesisProgress.tsx`

**Interfaces:**
- Consumes: `generateGenesisIntent`, `parseGenesisIntent`, `enforceGenesisQuality`.
- Changes: `buildGenesisRequest` and `buildGenesisRepairRequest` require `intentContract`.
- Changes: `persistWorld(db, task, leaseToken, deck, intent, parsedEntries)` persists the frozen contract.
- Produces stages: `intent`, `audit`, and `semantic_repair` in addition to existing stages.
- Produces content-free events through `recordGenesisQualityEvent(event)`.

- [ ] **Step 1: Write failing stage-order tests**

Require this monotonic order:

```ts
expect(GENESIS_STAGES.map((stage) => stage.id)).toEqual([
  "oracle",
  "intent",
  "laws",
  "gods",
  "peoples",
  "characters",
  "conflict",
  "validation",
  "repair",
  "audit",
  "semantic_repair",
  "saving",
  "completed",
]);
expect(furthestStage("audit", "repair")).toBe("audit");
expect(furthestStage("audit", "semantic_repair")).toBe("semantic_repair");
```

Update progress copy to “冻结神谕理解”, “审阅世界语义”, and “纠正世界偏移”.

- [ ] **Step 2: Write failing task-runner intent reuse tests**

Add injected mocks for intent generation and quality enforcement. Cover:

1. A task with `intentContract=null` calls `generateGenesisIntent` once, persists it before deck streaming, and passes it to `buildGenesisRequest`.
2. A reclaimed task with a valid `intentContract` does not call intent generation.
3. An invalid persisted contract causes the task to fail rather than silently regenerate a different interpretation.

The core assertion is:

```ts
expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({
    stage: "intent",
    intentContract: crossoverIntent,
  }),
}));
expect(buildRequestSpy).toHaveBeenCalledWith(expect.objectContaining({
  intentContract: crossoverIntent,
}));
```

- [ ] **Step 3: Integrate durable intent generation before deck generation**

Inside `runGenesisTask`, after lore/material resolution and mode parsing:

```ts
let intent = task.intentContract === null
  ? null
  : parseGenesisIntent(task.intentContract);

if (task.intentContract !== null && intent === null) {
  throw new Error("已冻结的创世意图契约已损坏");
}

if (intent === null) {
  await updateOwnedTask({ stage: "intent" });
  intent = await generateGenesisIntent({
    mode,
    decree: task.decree,
    userId: task.userId,
    lorebookExcerpts: excerpts,
  });
  await updateOwnedTask({
    intentContract: intent as unknown as Prisma.InputJsonValue,
  });
}
```

Pass `intentContract: intent` into initial generation and both structural repair requests.

- [ ] **Step 4: Write failing no-persist semantic-gate tests**

Cover three outcomes:

```ts
it("saves the repaired deck and quality report", async () => {
  qualityGate.mockResolvedValue({ deck: repairedDeck, report: repairedReport });
  await runGenesisTaskForTest();
  expect(worldCreate).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ draftDeck: repairedDeck, genesisIntent: crossoverIntent }),
  }));
});

it("does not persist a world when residual semantic errors remain", async () => {
  qualityGate.mockRejectedValue(new GenesisSemanticGateError(errorReport));
  await runGenesisTaskForTest();
  expect(worldCreate).not.toHaveBeenCalled();
  expect(taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: "failed" }),
  }));
});
```

Also verify an exhausted audit call fails the task and is not treated as a semantic pass.

- [ ] **Step 5: Run the quality gate before saving**

After deterministic generation returns:

```ts
const quality = await enforceGenesisQuality({
  deck,
  mode,
  decree: task.decree,
  intent,
  userId: task.userId,
  lorebookExcerpts: excerpts,
  materialSnapshot,
  materialConstraints: materialText,
  onStage: async (stage) => {
    await updateOwnedTask({
      stage,
      ...(stage === "semantic_repair" ? { status: "repairing" } : {}),
    });
  },
});
```

Persist `quality.report` to `GenesisTask.auditReport`, then pass `quality.deck` and `intent` to `persistWorld`. Update `persistWorld` to set `World.genesisIntent` in the same serializable transaction as `draftDeck`.

- [ ] **Step 6: Replace temporal-audit DTO parsing with quality-report parsing**

Keep the JSON column name `auditReport`, but change `GenesisTaskDto.auditReport` to `GenesisQualityReport | null` and parse with `parseGenesisQualityReport`. Delete the superseded temporal-audit module and its tests after all imports move to `semantic-audit.ts`.

- [ ] **Step 7: Add content-free quality observability**

Define a closed event union that never accepts decree, lorebook, deck, issue explanation, or other world prose:

```ts
export type GenesisQualityEvent =
  | { kind: "intent_generated"; taskId: string; durationMs: number }
  | { kind: "intent_failed"; taskId: string; durationMs: number }
  | {
      kind: "semantic_gate_completed";
      taskId: string;
      initialErrorCount: number;
      initialWarningCount: number;
      repaired: boolean;
      auditPasses: number;
      durationMs: number;
    }
  | { kind: "semantic_gate_rejected"; taskId: string; errorCount: number };
```

`recordGenesisQualityEvent` emits one structured `console.info("genesis_quality", event)`. Tests spy on `console.info`, assert the event values, and assert serialized output does not contain the decree or malformed card text. Call it around intent generation and after quality-gate completion/rejection.

- [ ] **Step 8: Verify Task 5**

```powershell
pnpm exec vitest run src/lib/genesis/stages.test.ts src/lib/genesis/task-runner.test.ts src/lib/genesis/quality-observability.test.ts src/lib/genesis/semantic-audit.test.ts src/lib/genesis/semantic-gate.test.ts
```

Expected: all tests pass; residual errors and audit exhaustion produce failed tasks with no world creation.

- [ ] **Step 9: Commit Task 5**

```powershell
git add -- src/lib/genesis/stages.ts src/lib/genesis/stages.test.ts src/lib/genesis/task-runner.ts src/lib/genesis/task-runner.test.ts src/lib/genesis/quality-observability.ts src/lib/genesis/quality-observability.test.ts src/lib/genesis/temporal-audit.ts src/lib/genesis/temporal-audit.test.ts src/components/genesis/GenesisProgress.tsx
git commit -m "feat(genesis): enforce quality gate before persistence"
```

---

### Task 6: Quality-Gated Rerolls and Lazy Contracts for Old Worlds

**Files:**
- Modify: `src/app/api/worlds/[id]/reroll/route.ts`
- Modify: `src/app/api/worlds/[id]/reroll/route.test.ts`
- Modify: `src/lib/genesis/locked-paths.ts`
- Modify: `src/lib/genesis/locked-paths.test.ts`

**Interfaces:**
- Consumes: `generateGenesisIntent`, `resolveLorebookExcerpts`, `preserveLockedPaths`, `enforceGenesisQuality`.
- Returns: `{ deck, updatedAt, auditReport }` from successful rerolls.
- Persists: a lazily generated `World.genesisIntent` in the same optimistic transaction as the rerolled deck.

- [ ] **Step 1: Read the local Next.js route-handler guide**

```powershell
Get-Content -LiteralPath node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md -Raw
```

Confirm the current `withAuth` route pattern and `params: Promise<{ id: string }>` convention remain valid before editing.

- [ ] **Step 2: Write failing old-world lazy-contract tests**

Extend the mocked world with `genesisIntent` and `lorebookEntries`. Test:

```ts
it("generates and stores an intent contract on the first old-world reroll", async () => {
  worldFindFirst.mockResolvedValue({
    ...draftWorld,
    genesisIntent: null,
    lorebookEntries: [],
  });
  generateIntent.mockResolvedValue(crossoverIntent);

  const response = await POST(request, context);

  expect(response.status).toBe(200);
  expect(generateIntent).toHaveBeenCalledTimes(1);
  expect(worldUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ genesisIntent: crossoverIntent }),
  }));
});
```

Also test a valid existing contract is reused and an invalid non-null contract returns 500/502 without generating a replacement.

- [ ] **Step 3: Replace route-local locked-path helpers with the shared module**

Remove `getPath`, `setPath`, `parseForMode`, and `applyLockedPaths` from the route. Import `preserveLockedPaths` and keep route behavior unchanged. Run the existing reroll tests before adding semantic behavior.

- [ ] **Step 4: Write failing reroll quality-gate tests**

Test all of these:

- the intent is present in `rerollUserPrompt` and `rerollReferenceRepairPrompt`;
- a warning-only result updates the deck and returns the report;
- a repair re-applies locked paths;
- a residual error returns 502 and does not call `world.updateMany`;
- a semantic repair cannot change mode;
- the quality report updates the related Genesis task when one exists.

```ts
expect(qualityGate).toHaveBeenCalledWith(expect.objectContaining({
  mode: "pantheon",
  intent: crossoverIntent,
  lockedPaths: ["playerGod.name"],
  currentDeck,
}));
```

- [ ] **Step 5: Integrate lazy intent and quality gating**

Load the world with `lorebookEntries`. Resolve intent as follows:

```ts
const persistedIntent = parseGenesisIntent(world.genesisIntent);
if (world.genesisIntent !== null && persistedIntent === null) {
  return NextResponse.json({ error: "创世意图契约已损坏" }, { status: 500 });
}
const intent = persistedIntent ?? await generateGenesisIntent({
  mode,
  decree: world.genesisInput,
  userId,
  lorebookExcerpts: await resolveLorebookExcerpts(world.lorebookEntries, userId),
});
```

After reference repair and locked-field merging, call `enforceGenesisQuality` with `currentDeck` and `lockedPaths`. In the existing optimistic transaction, persist the gated deck, `genesisIntent: intent`, and update any `GenesisTask` related by `worldId` with the latest `auditReport`. Do not make intent persistence a separate transaction.

- [ ] **Step 6: Verify Task 6**

```powershell
pnpm exec vitest run src/app/api/worlds/[id]/reroll/route.test.ts src/lib/genesis/locked-paths.test.ts src/lib/prompts/genesis.test.ts
```

Expected: existing reroll tests plus lazy-contract, locked-path, and residual-error tests all pass.

- [ ] **Step 7: Commit Task 6**

```powershell
git add -- src/app/api/worlds/[id]/reroll/route.ts src/app/api/worlds/[id]/reroll/route.test.ts src/lib/genesis/locked-paths.ts src/lib/genesis/locked-paths.test.ts
git commit -m "feat(genesis): quality gate world rerolls"
```

---

### Task 7: Owner API, Intent Summary, and Warning UI

**Files:**
- Modify: `src/app/api/worlds/[id]/route.ts`
- Modify: `src/app/api/worlds/[id]/route.test.ts`
- Create: `src/components/genesis/GenesisIntentSummary.tsx`
- Create: `src/components/genesis/GenesisIntentSummary.test.tsx`
- Create: `src/components/genesis/GenesisAuditWarnings.tsx`
- Create: `src/components/genesis/GenesisAuditWarnings.test.tsx`
- Modify: `src/app/genesis/[worldId]/page.tsx`

**Interfaces:**
- GET owner response adds `world.genesisIntent: GenesisIntentContract | null` and `world.genesisAuditReport: GenesisQualityReport | null`.
- `GenesisIntentSummary` consumes `{ intent: GenesisIntentContract }`.
- `GenesisAuditWarnings` consumes `{ report: GenesisQualityReport | null }` and renders warnings only.

- [ ] **Step 1: Read the local Next.js client-component guide**

```powershell
Get-Content -LiteralPath node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md -Raw
```

Keep both new components presentation-only; network loading remains in the existing client page.

- [ ] **Step 2: Write failing owner-route projection tests**

Mock a world with `genesisIntent` and one related task audit report. Assert the route parses both and does not leak the raw `genesisTasks` relation:

```ts
expect(await response.json()).toMatchObject({
  world: {
    genesisIntent: crossoverIntent,
    genesisAuditReport: warningReport,
  },
});
expect(body.world.genesisTasks).toBeUndefined();
```

Invalid old JSON must normalize to `null` rather than make an otherwise readable world return 500.

- [ ] **Step 3: Implement the owner response projection**

Include the newest related Genesis task:

```ts
genesisTasks: {
  select: { auditReport: true },
  orderBy: { createdAt: "desc" },
  take: 1,
},
```

Before returning, destructure `genesisTasks` away and add parsed `genesisIntent` plus `genesisAuditReport`. Continue parsing `draftDeck` through `parsePersistedWorldDeck`.

- [ ] **Step 4: Write failing component tests**

The summary test must find all six approved sections:

```tsx
render(<GenesisIntentSummary intent={crossoverIntent} />);
expect(screen.getByText("神谕理解")).toBeInTheDocument();
expect(screen.getByText(/托尼·斯塔克转生后的鲁迪乌斯/)).toBeInTheDocument();
expect(screen.getByText(/独立.*神/)).toBeInTheDocument();
expect(screen.getByText(/禁止扩张/)).toBeInTheDocument();
expect(screen.getByText(/核心压力/)).toBeInTheDocument();
```

The warning component must render warning explanations, render nothing for pass/null, and never render error issues because errors must not reach a saved world.

- [ ] **Step 5: Implement summary and warning components**

Use semantic HTML (`section`, `h2`, `dl`, `details`) and existing parchment tokens. Do not make the contract editable. Keep long arrays clipped to their schema maximum and preserve full text in expanded details.

- [ ] **Step 6: Load and render the new owner fields**

Add page state:

```ts
const [genesisIntent, setGenesisIntent] = useState<GenesisIntentContract | null>(null);
const [genesisAuditReport, setGenesisAuditReport] = useState<GenesisQualityReport | null>(null);
```

Set both after GET, refresh `genesisAuditReport` from a successful reroll response, and render the intent summary above `TemporalCalibrationCard` with warnings directly below it.

- [ ] **Step 7: Verify Task 7**

```powershell
pnpm exec vitest run src/app/api/worlds/[id]/route.test.ts src/components/genesis/GenesisIntentSummary.test.tsx src/components/genesis/GenesisAuditWarnings.test.tsx
```

Expected: owner projection and both UI component suites pass.

- [ ] **Step 8: Commit Task 7**

```powershell
git add -- src/app/api/worlds/[id]/route.ts src/app/api/worlds/[id]/route.test.ts src/components/genesis/GenesisIntentSummary.tsx src/components/genesis/GenesisIntentSummary.test.tsx src/components/genesis/GenesisAuditWarnings.tsx src/components/genesis/GenesisAuditWarnings.test.tsx src/app/genesis/[worldId]/page.tsx
git commit -m "feat(genesis): show frozen intent and audit warnings"
```

---

### Task 8: Archive, Import, and Reality-Clone Lifecycle Preservation

**Files:**
- Modify: `src/lib/archive/v2.ts:61-65`
- Modify: `src/app/api/worlds/[id]/export/route.test.ts`
- Modify: `src/app/api/worlds/import/route.ts:415-439,1587-1606`
- Modify: `src/app/api/worlds/import/route.test.ts`
- Modify: `src/app/api/worlds/import/route.integration.test.ts`
- Modify: `src/lib/reality/clone.integration.test.ts`

**Interfaces:**
- Archive version remains exactly `4`.
- Adds optional owner-private `world.genesisIntent` JSON to export/import.
- No ID remapping is applied inside the contract because it contains textual commitments, not database IDs.

- [ ] **Step 1: Write failing export preservation test**

Add `genesisIntent: crossoverIntent` to the mocked world and assert the version-4 payload preserves it:

```ts
expect(payload).toMatchObject({
  version: 4,
  world: {
    genesisIntent: crossoverIntent,
  },
});
```

Also retain the existing assertions that runtime leases, provider errors, and credentials are absent.

- [ ] **Step 2: Add `genesisIntent` to the explicit archive projection**

Add only `genesisIntent` to `WORLD_KEYS` in `src/lib/archive/v2.ts`. Do not export `GenesisTask.intentContract`; the world copy is the durable owner archive field.

- [ ] **Step 3: Write failing import schema and persistence tests**

Unit test valid optional intent and invalid oversized/arbitrary intent data:

```ts
const archive = versionFourArchive();
archive.world.genesisIntent = crossoverIntent;
const response = await POST(importRequest(archive));
expect(response.status).toBe(201);
expect(worldCreate).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ genesisIntent: crossoverIntent }),
}));
```

Use `GenesisIntentContractSchema.optional()` in the import schema rather than a generic unbounded JSON slot. Archives without the field must remain valid.

- [ ] **Step 4: Persist imported intent without remapping**

Add this field to `WorldSchema`:

```ts
genesisIntent: GenesisIntentContractSchema.optional(),
```

And to `tx.world.create`:

```ts
genesisIntent: json(w.genesisIntent),
```

Do not add the contract to the global ID remap pass.

- [ ] **Step 5: Add integration coverage for import and reality clone**

The import integration test creates a version-4 archive with the approved contract, imports it, reloads the world, and expects deep equality. The reality-clone integration test sets `world.genesisIntent`, clones a timeline, reloads the world, and confirms the world-level contract is unchanged while the new timeline IDs remain disjoint.

- [ ] **Step 6: Verify Task 8**

Run unit tests:

```powershell
pnpm exec vitest run src/app/api/worlds/[id]/export/route.test.ts src/app/api/worlds/import/route.test.ts
```

Run integration tests with the configured test database:

```powershell
pnpm exec vitest run --config vitest.integration.config.ts src/app/api/worlds/import/route.integration.test.ts src/lib/reality/clone.integration.test.ts
```

Expected: archives with and without intent import successfully, and the contract survives import and timeline cloning unchanged.

- [ ] **Step 7: Commit Task 8**

```powershell
git add -- src/lib/archive/v2.ts src/app/api/worlds/[id]/export/route.test.ts src/app/api/worlds/import/route.ts src/app/api/worlds/import/route.test.ts src/app/api/worlds/import/route.integration.test.ts src/lib/reality/clone.integration.test.ts
git commit -m "feat(genesis): preserve intent through world lifecycle"
```

---

### Task 9: Exact Regression Fixture, Full Verification, and Release Evidence

**Files:**
- Create: `src/lib/genesis/semantic-gate.regression.test.ts`
- Modify as failures require: only files already owned by Tasks 1–8
- Verify: `docs/omx/specs/2026-07-29-genesis-intent-semantic-gate-design.md`

**Interfaces:**
- Adds no production API.
- Provides one deterministic regression suite for the exact decree and malformed deck that triggered this work.

- [ ] **Step 1: Build the exact malformed regression fixture**

In the regression test, derive a valid deck fixture and inject these known failures:

```ts
const decree = "无职转生，但是鲁迪是托尼斯塔克转生";
const badDeck = {
  ...completeDeck(),
  fusionAxiom: {
    sourceIps: ["无职转生", "钢铁侠"],
    establishedRules: ["魔力回路即集成电路"],
    openQuestions: ["暂无"],
    hardLimits: ["暂无"],
    conflictRule: "斯塔克算法可以重构一切魔力",
  },
  minorGods: [
    { name: "水神雷妲", brief: "水神流现任宗师" },
    { name: "剑神加尔·法里翁", brief: "剑神流现任宗师" },
  ],
  places: completeDeck().places.map((place, index) => index === 0
    ? { ...place, name: "阿斯福德领地下秘密实验工坊" }
    : place),
  openingChapterBrief: {
    ...completeDeck().openingChapterBrief,
    objective: "让新生儿直接完成微型方舟反应堆",
  },
};
```

Include a generated-original “方舟智脑·贾维斯神格” major god and a generic tax conflict in the fixture.

- [ ] **Step 2: Assert the initial audit classifies every defect**

The fake audit result must include and the gate must preserve these types:

```ts
expect(initialTypes).toEqual(expect.arrayContaining([
  "narrative_center_duplication",
  "ontology_mismatch",
  "unsupported_canon_claim",
  "anchor_state_leak",
  "power_shortcut",
  "unsupported_fusion_rule",
  "causal_disconnect",
]));
```

All except the deliberately low-impact background `causal_disconnect` warning must normalize to `error` according to the minimum-severity policy.

- [ ] **Step 3: Assert the repaired fixture satisfies the approved outcome**

The fake repair output must have:

- exactly one narrative center: Tony-as-Rudeus;
- one separate limited player god;
- no independent Jarvis god;
- no Water God/Sword God martial-title entries in either god list;
- no workshop, armor, reactor, future mentor relation, or identified Orsted/Hitogami contact at birth;
- fusion `openQuestions` and `hardLimits` that keep magic/technology unproven;
- a main conflict directly caused by reincarnated adult consciousness, infant constraints, resources, secrecy, or cautious history changes.

Assert the gate calls repair once, audits twice, and returns this repaired deck.

- [ ] **Step 4: Run the complete targeted regression set**

```powershell
pnpm exec vitest run src/lib/genesis/intent.test.ts src/lib/prompts/genesis-intent.test.ts src/lib/genesis/intent-generator.test.ts src/lib/cards/schemas.test.ts src/lib/prompts/genesis.test.ts src/lib/genesis/semantic-audit.test.ts src/lib/prompts/genesis-quality.test.ts src/lib/genesis/locked-paths.test.ts src/lib/genesis/semantic-gate.test.ts src/lib/genesis/semantic-gate.regression.test.ts src/lib/genesis/stages.test.ts src/lib/genesis/task-runner.test.ts src/app/api/worlds/[id]/reroll/route.test.ts src/app/api/worlds/[id]/route.test.ts src/components/genesis/GenesisIntentSummary.test.tsx src/components/genesis/GenesisAuditWarnings.test.tsx src/components/genesis/card-editors.test.tsx src/components/genesis/deck-utils.test.ts src/app/api/worlds/[id]/export/route.test.ts src/app/api/worlds/import/route.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 5: Run static and Prisma verification**

```powershell
pnpm exec prisma generate
pnpm exec prisma validate
pnpm exec tsc --noEmit
pnpm exec eslint src/lib/genesis src/lib/prompts/genesis.ts src/lib/prompts/genesis-intent.ts src/lib/prompts/genesis-quality.ts src/lib/cards/schemas.ts src/app/api/worlds/[id]/route.ts src/app/api/worlds/[id]/reroll/route.ts src/app/api/worlds/[id]/export/route.ts src/app/api/worlds/import/route.ts src/app/genesis/[worldId]/page.tsx src/components/genesis/GenesisIntentSummary.tsx src/components/genesis/GenesisAuditWarnings.tsx src/components/genesis/card-editors.tsx src/components/genesis/deck-utils.ts
```

Expected: every command exits 0.

- [ ] **Step 6: Run full tests and production build**

```powershell
pnpm test
pnpm build
```

Expected: full unit suite and production build pass. If the known deploy-security parallel timeout recurs, run its file in isolation and record both the full-suite failure and isolated pass; do not hide any other failure.

- [ ] **Step 7: Verify migration and changed-file scope**

```powershell
git diff --check
git status --short
git diff --stat 6b91bac..HEAD
```

Expected: no whitespace errors; only plan-owned source, test, migration, and documentation files are staged or committed. Confirm unrelated pre-existing files remain untouched.

- [ ] **Step 8: Commit the regression test and any verification-only corrections**

```powershell
git add -- src/lib/genesis/semantic-gate.regression.test.ts
git commit -m "test(genesis): lock crossover quality regression"
```

Do not include unrelated workspace files or generated icon diffs in this commit.

---

## Execution Handoff

Plan complete and saved to `docs/omx/plans/2026-07-29-genesis-intent-semantic-gate.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, and use two-stage review.
2. **Inline Execution** — execute the plan in this session using executing-plans with batch checkpoints.
