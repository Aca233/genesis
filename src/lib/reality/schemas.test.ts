import { describe, expect, it } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";
import {
  AbilityPatchSchema,
  ChroniclePatchSchema,
  EntityPatchSchema,
  GodPatchSchema,
  OmenPatchSchema,
  ObserverActionSchema,
  ObserverPatchSchema,
  ObserverStateSchema,
  RealityCardPatchSchema,
  RealityStateSchema,
  RewritePlanSchema,
  normalizeRewriteScope,
  initialBranchSummary,
  initialObserverState,
  initialRealityState,
} from "./schemas";

describe("initial reality and observer state", () => {
  it.each([completeDeck, completeCreatorDeck])(
    "freezes the genesis cards and current era as JSON-safe root state",
    (makeDeck) => {
      const deck = makeDeck();
      const reality = initialRealityState(deck);
      const observer = initialObserverState(deck);

      expect(RealityStateSchema.parse(reality)).toEqual({
        theme: deck.theme,
        style: deck.style,
        cosmology: deck.cosmology,
        fusionAxiom: deck.fusionAxiom,
        currentEra: deck.epochConflict.epochName,
        establishedFacts: [],
      });
      expect(ObserverStateSchema.parse(observer)).toEqual({
        focusType: "world",
        focusId: null,
        timeLabel: deck.epochConflict.yearLabel,
        viewpoint: "omniscient",
        activeAvatarId: null,
        focusedEventId: null,
      });
      expect(JSON.parse(JSON.stringify({ reality, observer }))).toEqual({ reality, observer });
    },
  );

  it("builds a deterministic root branch summary from every public epoch conflict", () => {
    const deck = completeCreatorDeck();
    deck.epochConflict.overtConflicts = ["诸神争夺信仰", "星门正在崩塌"];
    expect(initialBranchSummary(deck)).toBe(
      "裂光纪 · 裂光元年：诸神争夺信仰；星门正在崩塌",
    );
  });

  it("rejects unknown keys at the state and established-fact boundaries", () => {
    expect(RealityStateSchema.safeParse({
      ...initialRealityState(completeCreatorDeck()),
      unexpected: true,
    }).success).toBe(false);
    expect(RealityStateSchema.safeParse({
      ...initialRealityState(completeCreatorDeck()),
      establishedFacts: [{
        ref: "fact-1",
        text: "星海已经点燃",
        establishedByRewriteId: null,
        unexpected: true,
      }],
    }).success).toBe(false);
    expect(ObserverStateSchema.safeParse({
      ...initialObserverState(completeCreatorDeck()),
      unexpected: true,
    }).success).toBe(false);
  });

  it("validates established facts and non-root observer variants", () => {
    expect(RealityStateSchema.safeParse({
      ...initialRealityState(completeCreatorDeck()),
      establishedFacts: [{ ref: "fact-1", text: "星海已经点燃", establishedByRewriteId: null }],
    }).success).toBe(true);
    expect(RealityStateSchema.safeParse({
      ...initialRealityState(completeCreatorDeck()),
      establishedFacts: [{ ref: "fact-1", text: "", establishedByRewriteId: null }],
    }).success).toBe(false);
    expect(ObserverStateSchema.safeParse({
      focusType: "avatar",
      focusId: "entity-1",
      timeLabel: "裂光元年",
      viewpoint: "limited",
      activeAvatarId: "entity-1",
    }).success).toBe(true);
    expect(ObserverStateSchema.safeParse({
      focusType: "timeline",
      focusId: null,
      timeLabel: "裂光元年",
      viewpoint: "omniscient",
      activeAvatarId: null,
    }).success).toBe(false);
  });

  it("defaults a missing focused event in legacy observer state to null", () => {
    expect(ObserverStateSchema.parse({
      focusType: "world",
      focusId: null,
      timeLabel: "裂光元年",
      viewpoint: "omniscient",
      activeAvatarId: null,
    }).focusedEventId).toBeNull();
  });
});

const emptyRewritePlan = {
  scope: "prospective" as const,
  interpretation: "令月亮从此变为两轮",
  effectivePoint: "当前时刻",
  branchName: "双月新纪",
  realityCardPatches: [],
  godPatches: [],
  entityPatches: [],
  abilityPatches: [],
  chroniclePatches: [],
  memoryPatches: [],
  omenPatches: [],
  observerPatch: null,
  causalConsequences: ["潮汐从今以后受双月共同牵引"],
  narrationFocus: "双月第一次同时升起",
  subcommands: [{
    decree: "从现在起天空有两轮月亮",
    scope: "prospective" as const,
    effectivePoint: "当前时刻",
  }],
};

describe("absolute reality rewrite schemas", () => {
  it.each([
    ["prospective", "当前时刻"],
    ["retroactive", "世界诞生之初"],
    ["memory_only", "众生现有记忆"],
  ] as const)("accepts a %s plan", (scope, effectivePoint) => {
    expect(RewritePlanSchema.safeParse({
      ...emptyRewritePlan,
      scope,
      effectivePoint,
      subcommands: [{ decree: "执行对应敕令", scope, effectivePoint }],
    }).success).toBe(true);
  });

  it("accepts mixed subcommands and normalizes to the deepest scope", () => {
    const subcommands = [
      { decree: "从今以后魔法消耗记忆", scope: "prospective" as const, effectivePoint: "当前时刻" },
      { decree: "众生忘记旧王朝", scope: "memory_only" as const, effectivePoint: "现有记忆" },
      { decree: "旧王朝从未存在", scope: "retroactive" as const, effectivePoint: "王朝建立之前" },
    ];

    expect(RewritePlanSchema.safeParse({
      ...emptyRewritePlan,
      scope: "retroactive",
      subcommands,
    }).success).toBe(true);
    expect(normalizeRewriteScope(subcommands.map(({ scope }) => scope))).toBe("retroactive");
    expect(normalizeRewriteScope(["prospective", "memory_only"])).toBe("memory_only");
    expect(normalizeRewriteScope(["prospective"])).toBe("prospective");
    expect(normalizeRewriteScope(undefined)).toBe("prospective");

    const { scope: _scope, ...withoutScope } = emptyRewritePlan;
    void _scope;
    const defaulted = RewritePlanSchema.parse({
      ...withoutScope,
      subcommands: [{ decree: "让风停下", effectivePoint: "当前时刻" }],
    });
    expect(defaulted.scope).toBe("prospective");
    expect(defaulted.subcommands[0]?.scope).toBe("prospective");
  });

  it.each([
    ["reality card", { realityCardPatches: [{ section: "currentEra", value: "伪造纪元" }] }],
    ["god fact", { godPatches: [{ op: "update", targetId: "god-existing", changes: { domains: ["伪造神域"] } }] }],
    ["entity fact", { entityPatches: [{ op: "remove", targetId: "entity-existing" }] }],
    ["ability fact", { abilityPatches: [{ op: "remove", targetId: "ability-existing" }] }],
    ["chronicle fact", { chroniclePatches: [{ op: "remove", targetId: "chronicle-existing" }] }],
    ["omen fact", { omenPatches: [{ op: "remove", targetId: "omen-existing" }] }],
    ["observer state", { observerPatch: { viewpoint: "limited" } }],
  ])("rejects %s patches when every subcommand is memory_only", (_label, patches) => {
    expect(RewritePlanSchema.safeParse({
      ...emptyRewritePlan,
      scope: "memory_only",
      subcommands: [
        { decree: "众生忘记旧王", scope: "memory_only", effectivePoint: "现有记忆" },
        { decree: "旧王被误认为贤君", scope: "memory_only", effectivePoint: "现有认知" },
      ],
      ...patches,
    }).success).toBe(false);
  });

  it("allows subjective memory and god agenda patches in a pure memory_only plan", () => {
    expect(RewritePlanSchema.safeParse({
      ...emptyRewritePlan,
      scope: "memory_only",
      subcommands: [{ decree: "众生忘记旧王", scope: "memory_only", effectivePoint: "现有记忆" }],
      memoryPatches: [{ entityId: "entity-witness", operation: "replace", text: "只记得群星议庭" }],
      godPatches: [{ op: "update", targetId: "god-existing", changes: { agenda: { belief: "旧王从未存在" } } }],
    }).success).toBe(true);
  });

  it("allows explicit objective patches when a memory_only top-level plan contains an objective subcommand", () => {
    expect(RewritePlanSchema.safeParse({
      ...emptyRewritePlan,
      scope: "memory_only",
      subcommands: [
        { decree: "众生忘记旧王", scope: "memory_only", effectivePoint: "现有记忆" },
        { decree: "从现在起拆除旧王像", scope: "prospective", effectivePoint: "当前时刻" },
      ],
      entityPatches: [{ op: "remove", targetId: "entity-old-statue" }],
    }).success).toBe(true);
  });

  it("rejects a top-level scope that is shallower than its normalized subcommands", () => {
    expect(RewritePlanSchema.safeParse({
      ...emptyRewritePlan,
      scope: "prospective",
      subcommands: [
        { decree: "从今以后群星倒行", scope: "prospective", effectivePoint: "当前时刻" },
        { decree: "群星自古便倒行", scope: "retroactive", effectivePoint: "世界诞生之初" },
      ],
    }).success).toBe(false);

    const { scope: _scope, ...withoutScope } = emptyRewritePlan;
    void _scope;
    expect(RewritePlanSchema.safeParse({
      ...withoutScope,
      subcommands: [{ decree: "众生忘记旧星", scope: "memory_only", effectivePoint: "现有记忆" }],
    }).success).toBe(false);
  });

  it("accepts strict omen and observer patches that use stable refs", () => {
    expect(RewritePlanSchema.safeParse({
      ...emptyRewritePlan,
      omenPatches: [
        { op: "create", tempRef: "new-omen", value: { godRef: "new-god", text: "双月将升", consumed: false } },
        { op: "update", targetId: "omen-existing", changes: { godRef: "god-existing", consumed: true } },
        { op: "remove", targetId: "omen-obsolete" },
      ],
      observerPatch: {
        focus: { focusType: "avatar", focusRef: "new-avatar" },
        viewpoint: "limited",
        activeAvatarRef: "new-avatar",
      },
    }).success).toBe(true);
  });

  it.each([
    [OmenPatchSchema, { op: "update", targetId: "omen-1", changes: { arbitrary: true } }],
    [OmenPatchSchema, { op: "create", tempRef: "new-omen", value: { godRef: "god-1", text: "", consumed: false } }],
    [ObserverPatchSchema, { focus: { focusType: "world", focusRef: "entity-1" } }],
    [ObserverPatchSchema, { focus: { focusType: "god", focusRef: null } }],
    [ObserverPatchSchema, { viewpoint: "omniscient", activeAvatarId: "wrong-field" }],
    [ObserverPatchSchema, { timeLabel: "越权修改时间标签" }],
    [ObserverPatchSchema, {}],
  ])("rejects invalid or non-whitelisted rewrite state patches", (schema, patch) => {
    expect(schema.safeParse(patch).success).toBe(false);
  });

  it("rejects duplicate temp refs across create patches", () => {
    expect(RewritePlanSchema.safeParse({
      ...emptyRewritePlan,
      godPatches: [{
        op: "create",
        tempRef: "new-shared-ref",
        value: {
          name: "新神", aliases: [], tier: "minor", rank: "nascent", domains: [],
          persona: null, voice: null, agenda: null, relations: [], faithScope: null,
        },
      }],
      entityPatches: [{
        op: "create",
        tempRef: "new-shared-ref",
        value: {
          type: "place", name: "新地", aliases: [], summary: "新地点", raceRef: null,
          heat: "active", isMajorCharacter: false, isCreatorAvatar: false, sections: [],
        },
      }],
    }).success).toBe(false);
  });

  it("accepts explicit create/update/remove patches across record kinds", () => {
    const parsed = RewritePlanSchema.safeParse({
      ...emptyRewritePlan,
      realityCardPatches: [{ section: "currentEra", value: "双月元年" }],
      godPatches: [
        {
          op: "create", tempRef: "new-god-moon", value: {
            name: "双月神", aliases: [], tier: "major", rank: "ascended",
            domains: ["月亮"], persona: "沉静", voice: null, agenda: null,
            relations: [], faithScope: "观星者",
          },
        },
        { op: "update", targetId: "god-existing", changes: { domains: ["潮汐", "双月"] } },
        { op: "remove", targetId: "god-obsolete" },
      ],
      entityPatches: [
        {
          op: "create", tempRef: "new-entity-observatory", value: {
            type: "place", name: "双月台", aliases: [], summary: "观测双月的高台",
            raceRef: null, heat: "active", isMajorCharacter: false,
            isCreatorAvatar: false, sections: [],
          },
        },
        { op: "update", targetId: "entity-existing", changes: { summary: "已适应双月潮汐" } },
        { op: "remove", targetId: "entity-obsolete" },
      ],
      abilityPatches: [
        {
          op: "create", tempRef: "new-ability-twin-tide", ownerRef: "new-god-moon",
          value: {
            name: "双潮", kind: "divine", effect: "牵引双重潮汐", trigger: "双月升起",
            cost: "无", limitations: "仅影响潮汐", mastery: "adept", state: "normal",
            visibility: "known", rumorText: null, bloodlineJustification: null,
            sourceAbilityRef: null, lockedFields: [],
          },
        },
        { op: "update", targetId: "ability-existing", changes: { state: "enhanced" } },
        { op: "remove", targetId: "ability-obsolete" },
      ],
      chroniclePatches: [
        {
          op: "create", tempRef: "new-chronicle-twin-moons", value: {
            chapterIndex: 3, yearLabel: "双月元年", text: "双月同升。",
            entityRefs: ["new-entity-observatory"], godRefs: ["new-god-moon"],
            revealed: true, revealedAtChapter: null, source: "rewrite",
          },
        },
        { op: "update", targetId: "chronicle-existing", changes: { revealed: false } },
        { op: "remove", targetId: "chronicle-obsolete" },
      ],
      memoryPatches: [{ entityId: "entity-witness", operation: "append", text: "记得双月一直存在" }],
      omenPatches: [{
        op: "create", tempRef: "new-omen-twin-moons",
        value: { godRef: "new-god-moon", text: "双潮将至", consumed: false },
      }],
      observerPatch: {
        focus: { focusType: "place", focusRef: "new-entity-observatory" },
        viewpoint: "omniscient",
      },
    });

    expect(parsed.success).toBe(true);
  });

  it.each([
    [RealityCardPatchSchema, { path: "world.theme", value: "任意写库" }],
    [RealityCardPatchSchema, { section: "database", value: "任意写库" }],
    [GodPatchSchema, { op: "update", targetId: "god-1", changes: { rank: "ascended" }, path: "agenda.secret" }],
    [EntityPatchSchema, { op: "remove", targetId: "entity-1", path: "../../world" }],
    [AbilityPatchSchema, { op: "remove", targetId: "ability-1", arbitraryPath: "lockedFields" }],
    [ChroniclePatchSchema, { op: "remove", targetId: "chronicle-1", path: "text" }],
    [OmenPatchSchema, { op: "remove", targetId: "omen-1", path: "text" }],
  ])("rejects arbitrary paths outside the patch whitelist", (schema, patch) => {
    expect(schema.safeParse(patch).success).toBe(false);
  });

  it("requires tempRef only for creates and targetId only for existing records", () => {
    const create = {
      op: "create", tempRef: "new-god", value: {
        name: "新神", aliases: [], tier: "minor", rank: "nascent", domains: [],
        persona: null, voice: null, agenda: null, relations: [], faithScope: null,
      },
    };
    expect(GodPatchSchema.safeParse(create).success).toBe(true);
    expect(GodPatchSchema.safeParse({ ...create, targetId: "god-existing" }).success).toBe(false);
    expect(GodPatchSchema.safeParse({ op: "update", tempRef: "god-temp", changes: { name: "改名" } }).success).toBe(false);
    expect(GodPatchSchema.safeParse({ op: "update", targetId: "god-existing", changes: {} }).success).toBe(false);
    expect(GodPatchSchema.safeParse({ op: "remove", tempRef: "god-temp" }).success).toBe(false);
  });

  it.each([
    ["双月新纪", true],
    ["无王之历史", true],
    ["三字名", false],
    ["这是一个超过十个汉字的现实名", false],
    ["双月-新纪", false],
    ["TwinMoon", false],
  ])("enforces a 4-10 Chinese-character branch name: %s", (branchName, accepted) => {
    expect(RewritePlanSchema.safeParse({ ...emptyRewritePlan, branchName }).success).toBe(accepted);
  });
});

describe("creator observer action schemas", () => {
  it.each([
    { action: "set_focus", focusType: "world", focusId: null },
    { action: "set_focus", focusType: "place", focusId: "place-1" },
    { action: "set_viewpoint", viewpoint: "limited" },
    { action: "enter_avatar", avatarId: "avatar-1" },
    { action: "exit_avatar" },
    { action: "withdraw_avatar", avatarId: "avatar-1" },
  ])("accepts a strict observer action", (action) => {
    expect(ObserverActionSchema.safeParse(action).success).toBe(true);
  });

  it("accepts a bounded avatar definition with rewrite abilities", () => {
    expect(ObserverActionSchema.safeParse({
      action: "create_avatar",
      name: "星行者",
      identity: "群星在人间的无名旅者",
      appearance: "银发，瞳中映着星轨",
      raceId: null,
      abilities: [{
        name: "化星为刃",
        kind: "personal",
        effect: "凝聚星光",
        trigger: "主动",
        cost: "短暂疲惫",
        limitations: "仅在星空下",
        mastery: "adept",
        state: "normal",
        visibility: "hidden",
        rumorText: null,
        bloodlineJustification: null,
        sourceAbilityRef: null,
        lockedFields: [],
      }],
    }).success).toBe(true);
  });

  it.each([
    { action: "set_focus", focusType: "world", focusId: "entity-1" },
    { action: "set_focus", focusType: "god", focusId: null },
    { action: "set_viewpoint", viewpoint: "player" },
    { action: "create_avatar", name: "", identity: "", appearance: "", raceId: null, abilities: [] },
    { action: "exit_avatar", avatarId: "unexpected" },
  ])("rejects an invalid or ambiguous observer action", (action) => {
    expect(ObserverActionSchema.safeParse(action).success).toBe(false);
  });
});
