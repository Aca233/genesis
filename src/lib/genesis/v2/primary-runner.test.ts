import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import type { WorldDeck } from "@/lib/cards/schemas";
import { LlmCircuitOpenError } from "@/lib/llm/permits";
import { StructuredOutputValidationError } from "@/lib/llm/structured";
import type { GenesisIntentContract } from "../intent";
import { GenesisSemanticGateError } from "../semantic-gate";
import type { GenesisV2StageOutputs } from "./stage-output";

const mocks = vi.hoisted(() => ({
  candidate: vi.fn(),
  acceptedCount: vi.fn(),
  jobUpdateMany: vi.fn(),
  claimedJob: vi.fn(),
  ownedJob: vi.fn(),
  taskUpdate: vi.fn(),
  taskUpdateMany: vi.fn(),
  taskFindFirst: vi.fn(),
  taskFindUnique: vi.fn(),
  artifactFindMany: vi.fn(),
  artifactFindFirst: vi.fn(),
  artifactUpdateMany: vi.fn(),
  artifactCreate: vi.fn(),
  outboxCreate: vi.fn(),
  worldCreate: vi.fn(),
  completeStructured: vi.fn(),
  generateIntent: vi.fn(),
  validateOutput: vi.fn(),
  validateDeck: vi.fn(),
  enforceQuality: vi.fn(),
  compileBundle: vi.fn(),
  recordQualityEvent: vi.fn(),
  wakeScheduler: vi.fn(),
  transaction: vi.fn(),
}));

const tx = {
  genesisJob: {
    findUnique: mocks.candidate,
    updateMany: mocks.jobUpdateMany,
    findUniqueOrThrow: mocks.claimedJob,
    findFirst: mocks.ownedJob,
  },
  genesisArtifact: {
    count: mocks.acceptedCount,
    updateMany: mocks.artifactUpdateMany,
    create: mocks.artifactCreate,
  },
  genesisTask: {
    update: mocks.taskUpdate,
    updateMany: mocks.taskUpdateMany,
    findFirst: mocks.taskFindFirst,
  },
  genesisOutbox: { create: mocks.outboxCreate },
  world: { create: mocks.worldCreate },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    genesisJob: { updateMany: mocks.jobUpdateMany },
    genesisTask: { updateMany: mocks.taskUpdateMany, findUnique: mocks.taskFindUnique },
    genesisArtifact: { findMany: mocks.artifactFindMany, findFirst: mocks.artifactFindFirst },
  },
}));

vi.mock("@/lib/llm/structured", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/llm/structured")>(),
  completeStructured: mocks.completeStructured,
}));
vi.mock("../intent-generator", async (importOriginal) => ({
  ...await importOriginal<typeof import("../intent-generator")>(),
  generateGenesisIntent: mocks.generateIntent,
}));
vi.mock("../generate", async (importOriginal) => ({
  ...await importOriginal<typeof import("../generate")>(),
  validateGenesisDeck: mocks.validateDeck,
}));
vi.mock("../semantic-gate", async (importOriginal) => ({
  ...await importOriginal<typeof import("../semantic-gate")>(),
  enforceGenesisQuality: mocks.enforceQuality,
}));
vi.mock("../quality-observability", () => ({
  countGenesisSemanticIssues: vi.fn(() => ({})),
  recordGenesisQualityEvent: mocks.recordQualityEvent,
}));
vi.mock("./validation", () => ({ validateGenesisV2ShadowOutput: mocks.validateOutput }));
vi.mock("./prompt-bundle", async (importOriginal) => ({
  ...await importOriginal<typeof import("./prompt-bundle")>(),
  compileGenesisV2PromptBundle: mocks.compileBundle,
}));
vi.mock("../scheduler", () => ({ wakeGenesisScheduler: mocks.wakeScheduler }));

import { claimGenesisV2PrimaryJob, runGenesisV2PrimaryJob } from "./primary-runner";

const intent: GenesisIntentContract = {
  sourceBasis: "original",
  sourceIps: [],
  explicitPremise: ["测试世界必须保持一致"],
  narrativeCenter: { identity: "见证者", role: "主角", startState: "苏醒" },
  playerRole: {
    type: "independent_god",
    narrativeFunction: "limited_intervener",
    mustNotReplaceProtagonist: true,
  },
  forbiddenExpansions: [],
  factsAtAnchor: [],
  futureOnly: [],
  fusionBoundaries: [],
  uncertaintyPolicy: "omit_or_generalize",
  corePressures: ["秩序与自由冲突"],
};

function splitDeck(deck: WorldDeck): GenesisV2StageOutputs {
  return {
    blueprint: {
      mode: deck.mode,
      worldName: deck.worldName,
      cosmology: deck.cosmology,
      fusionAxiom: deck.fusionAxiom,
      style: deck.style,
      theme: deck.theme,
      ...(deck.temporalAnchor ? { temporalAnchor: deck.temporalAnchor } : {}),
      canonBrief: "保持测试世界核心设定。",
      slotBriefs: {},
    },
    pantheon_domain: {
      mode: "pantheon",
      playerGod: deck.mode === "pantheon" ? deck.playerGod : completeDeck().playerGod,
      majorGods: deck.majorGods,
      minorGods: deck.minorGods,
    },
    civilizations: {
      mode: deck.mode,
      races: deck.races,
      factions: deck.factions,
      places: deck.places,
    },
    eras: {
      mode: deck.mode,
      epochConflict: deck.epochConflict,
      ...(deck.openingChapterBrief ? { openingChapterBrief: deck.openingChapterBrief } : {}),
      ...(deck.canonEvents ? { canonEvents: deck.canonEvents } : {}),
    },
    characters: {
      mode: deck.mode,
      majorCharacters: deck.majorCharacters,
      ...(deck.relationsAtAnchor ? { relationsAtAnchor: deck.relationsAtAnchor } : {}),
    },
  } as GenesisV2StageOutputs;
}

function task(stageId: keyof GenesisV2StageOutputs, intentContract: unknown = intent) {
  return {
    id: "task-1",
    userId: "user-1",
    mode: "pantheon",
    decree: "创造一个测试世界",
    status: "running",
    engineVersion: "dag-v2",
    intentContract,
    preflight: {
      preflightHash: "preflight-1",
      structuralManifest: { manifestHash: "manifest-1", slots: [] },
      sourceObligationManifest: { obligations: [] },
      budgetPlan: { stages: [{ stage: stageId, maxOutputTokens: 4096 }] },
    },
    preflightHash: "preflight-1",
    lorebook: null,
    materialSelection: null,
    aggregateVersion: 3,
  };
}

function configureJob(stageId: keyof GenesisV2StageOutputs, intentContract: unknown = intent): void {
  const taskRecord = task(stageId, intentContract);
  const baseJob = {
    id: `job-${stageId}`,
    genesisTaskId: "task-1",
    nodeKey: `v2:${stageId}`,
    engineVersion: "dag-v2",
    status: "queued",
    error: null,
    leaseToken: "lease-1",
    leaseEpoch: 2,
    leaseExpiresAt: new Date("2026-07-29T12:01:00.000Z"),
    attempt: 1,
    task: taskRecord,
  };
  mocks.candidate.mockResolvedValue(baseJob);
  mocks.claimedJob.mockResolvedValue(baseJob);
}

describe("Genesis V2 primary runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.taskUpdate.mockResolvedValue({});
    mocks.taskUpdateMany.mockResolvedValue({ count: 1 });
    mocks.taskFindFirst.mockResolvedValue({ aggregateVersion: 4, worldId: null, stage: "laws", status: "running" });
    mocks.taskFindUnique.mockResolvedValue({ intentContract: intent });
    mocks.claimedJob.mockResolvedValue({});
    mocks.ownedJob.mockResolvedValue({ id: "owned" });
    mocks.acceptedCount.mockResolvedValue(0);
    mocks.artifactFindMany.mockResolvedValue([]);
    mocks.artifactFindFirst.mockResolvedValue(null);
    mocks.artifactUpdateMany.mockResolvedValue({ count: 0 });
    mocks.artifactCreate.mockResolvedValue({ id: "artifact-1" });
    mocks.outboxCreate.mockResolvedValue({});
    mocks.worldCreate.mockResolvedValue({ id: "world-1" });
    mocks.generateIntent.mockResolvedValue(intent);
    mocks.validateOutput.mockReturnValue({ valid: true, issues: [] });
    mocks.validateDeck.mockImplementation((deck) => deck);
    mocks.compileBundle.mockReturnValue({
      blocks: {
        globalCommon: "global",
        globalWave: "wave",
        worldCommon: "world",
        stageWave: "stage-wave",
        worldStage: "world-stage",
        dynamicTail: "dynamic",
      },
      hashes: { bundleHash: "bundle-hash" },
      routingNamespace: "genesis-v2:test",
    });
  });

  it("只在三个 primary 依赖 Artifact accepted 后领取人物汇合节点", async () => {
    configureJob("characters");
    mocks.candidate.mockResolvedValue({
      ...await mocks.candidate(),
      error: "上次阶段输出缺少引用",
    });
    mocks.acceptedCount.mockResolvedValue(3);

    const claimed = await claimGenesisV2PrimaryJob(
      "job-characters",
      new Date("2026-07-29T12:00:00.000Z"),
    );

    expect(mocks.acceptedCount).toHaveBeenCalledWith({
      where: expect.objectContaining({
        stageKey: { in: ["pantheon_domain", "civilizations", "eras"] },
        visibility: "primary",
      }),
    });
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ engineVersion: "dag-v2" }),
      data: expect.objectContaining({ status: "running", attempt: { increment: 1 } }),
    }));
    expect(claimed).toMatchObject({ previousError: "上次阶段输出缺少引用" });
  });

  it("依赖不完整时不领取节点", async () => {
    configureJob("characters");
    mocks.acceptedCount.mockResolvedValue(2);

    await expect(claimGenesisV2PrimaryJob("job-characters")).resolves.toBeNull();
    expect(mocks.jobUpdateMany).not.toHaveBeenCalled();
  });

  it("蓝图节点冻结意图并原子接受中间 Artifact", async () => {
    configureJob("blueprint", null);
    const blueprint = splitDeck(completeDeck()).blueprint;
    mocks.completeStructured.mockResolvedValue(blueprint);

    await runGenesisV2PrimaryJob("job-blueprint");

    expect(mocks.generateIntent).toHaveBeenCalledOnce();
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({ intentContract: expect.any(Object) }),
        ]),
      }),
      data: expect.objectContaining({ intentContract: intent, stage: "laws" }),
    }));
    expect(mocks.artifactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ stageKey: "blueprint", status: "accepted", visibility: "primary" }),
    });
    expect(mocks.worldCreate).not.toHaveBeenCalled();
    expect(mocks.outboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "v2_stage_completed" }),
    });
  });

  it("人物汇合通过质量门后在同一事务封存 core、创建世界并完成任务", async () => {
    const deck = completeDeck();
    const outputs = splitDeck(deck);
    configureJob("characters");
    mocks.acceptedCount.mockResolvedValue(3);
    mocks.completeStructured.mockResolvedValue(outputs.characters);
    mocks.artifactFindMany.mockResolvedValue([
      { stageKey: "pantheon_domain", outputHash: "pantheon-hash", content: outputs.pantheon_domain },
      { stageKey: "civilizations", outputHash: "civilizations-hash", content: outputs.civilizations },
      { stageKey: "eras", outputHash: "eras-hash", content: outputs.eras },
    ]);
    mocks.artifactFindFirst.mockResolvedValue({ content: outputs.blueprint, outputHash: "blueprint-hash" });
    mocks.enforceQuality.mockResolvedValue({
      deck,
      report: {
        valid: true,
        issues: [],
        meta: { initialErrorCount: 0, initialWarningCount: 0, repaired: false, auditPasses: 1, durationMs: 10 },
      },
    });

    await runGenesisV2PrimaryJob("job-characters");

    expect(mocks.validateDeck).toHaveBeenCalledWith(deck, "pantheon", null);
    expect(mocks.artifactUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ stageKey: "playable_core", visibility: "primary" }),
    }));
    expect(mocks.artifactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ stageKey: "playable_core", status: "sealed", sealedAt: expect.any(Date) }),
    });
    expect(mocks.worldCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "draft", draftDeck: deck }),
    });
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ worldId: null, aggregateVersion: 4 }),
      data: expect.objectContaining({ status: "completed", worldId: "world-1" }),
    }));
    expect(mocks.outboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "task_completed" }),
    });
  });

  it("阶段硬门失败只重排当前 job，并保留已接受的上游 Artifact", async () => {
    configureJob("blueprint");
    mocks.completeStructured.mockResolvedValue({ mode: "pantheon" });
    mocks.validateOutput.mockReturnValue({ valid: false, issues: ["缺少 slot 引用"] });

    await runGenesisV2PrimaryJob("job-blueprint");

    expect(mocks.artifactUpdateMany).not.toHaveBeenCalled();
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "job-blueprint", leaseToken: "lease-1" }),
      data: expect.objectContaining({ status: "queued", error: expect.stringContaining("缺少 slot 引用") }),
    }));
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "running" }),
    }));
    expect(mocks.wakeScheduler).toHaveBeenCalledOnce();
  });

  it("结构化校验耗尽时按当前阶段重排，而不是直接终止整个任务", async () => {
    configureJob("blueprint");
    mocks.completeStructured.mockRejectedValue(new StructuredOutputValidationError(
      2,
      "temporalAnchor.source 缺少对象",
    ));

    await runGenesisV2PrimaryJob("job-blueprint");

    expect(mocks.jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "job-blueprint", leaseToken: "lease-1" }),
      data: expect.objectContaining({
        status: "queued",
        error: expect.stringContaining("temporalAnchor.source 缺少对象"),
      }),
    }));
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "running" }),
    }));
    expect(mocks.wakeScheduler).toHaveBeenCalledOnce();
  });

  it("世界硬门失败只重排人物节点，并把精确问题带入下一次生成", async () => {
    const deck = completeDeck();
    const outputs = splitDeck(deck);
    configureJob("characters");
    mocks.acceptedCount.mockResolvedValue(3);
    mocks.completeStructured.mockResolvedValue(outputs.characters);
    mocks.artifactFindMany.mockResolvedValue([
      { stageKey: "pantheon_domain", outputHash: "p", content: outputs.pantheon_domain },
      { stageKey: "civilizations", outputHash: "c", content: outputs.civilizations },
      { stageKey: "eras", outputHash: "e", content: outputs.eras },
    ]);
    mocks.artifactFindFirst.mockResolvedValue({ content: outputs.blueprint, outputHash: "b" });
    mocks.validateDeck.mockImplementation(() => {
      throw new Error("时间一致性校验失败：[T4 FUTURE_ABILITY_HELD] 锚点人物持有 future 能力");
    });

    await runGenesisV2PrimaryJob("job-characters");

    expect(mocks.enforceQuality).not.toHaveBeenCalled();
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "job-characters", leaseToken: "lease-1" }),
      data: expect.objectContaining({
        status: "queued",
        error: expect.stringContaining("FUTURE_ABILITY_HELD"),
      }),
    }));
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "running", error: null }),
    }));
    expect(mocks.wakeScheduler).toHaveBeenCalledOnce();
  });

  it("provider 熔断时进入 waiting_for_provider 而不是误判为内容失败", async () => {
    configureJob("blueprint");
    mocks.completeStructured.mockRejectedValue(new LlmCircuitOpenError());

    await runGenesisV2PrimaryJob("job-blueprint");

    expect(mocks.jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting_for_provider", error: null }),
    }));
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting_for_provider", error: null }),
    }));
    expect(mocks.outboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "task_waiting_for_provider" }),
    });
  });

  it("语义门终止时持久化审计详情，且不创建世界", async () => {
    const deck = completeDeck();
    const outputs = splitDeck(deck);
    const report = {
      valid: false,
      issues: [{ severity: "error", code: "premise_drift", path: "theme", message: "偏离前提" }],
    };
    configureJob("characters");
    mocks.acceptedCount.mockResolvedValue(3);
    mocks.completeStructured.mockResolvedValue(outputs.characters);
    mocks.artifactFindMany.mockResolvedValue([
      { stageKey: "pantheon_domain", outputHash: "p", content: outputs.pantheon_domain },
      { stageKey: "civilizations", outputHash: "c", content: outputs.civilizations },
      { stageKey: "eras", outputHash: "e", content: outputs.eras },
    ]);
    mocks.artifactFindFirst.mockResolvedValue({ content: outputs.blueprint, outputHash: "b" });
    mocks.enforceQuality.mockRejectedValue(new GenesisSemanticGateError(report as never));

    await runGenesisV2PrimaryJob("job-characters");

    expect(mocks.worldCreate).not.toHaveBeenCalled();
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed", auditReport: report }),
    }));
    expect(mocks.taskUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting_for_provider" }),
    }));
  });

  it("已有 worldId 时拒绝第二次世界落库", async () => {
    const deck = completeDeck();
    const outputs = splitDeck(deck);
    configureJob("characters");
    mocks.acceptedCount.mockResolvedValue(3);
    mocks.completeStructured.mockResolvedValue(outputs.characters);
    mocks.artifactFindMany.mockResolvedValue([
      { stageKey: "pantheon_domain", outputHash: "p", content: outputs.pantheon_domain },
      { stageKey: "civilizations", outputHash: "c", content: outputs.civilizations },
      { stageKey: "eras", outputHash: "e", content: outputs.eras },
    ]);
    mocks.artifactFindFirst.mockResolvedValue({ content: outputs.blueprint, outputHash: "b" });
    mocks.enforceQuality.mockResolvedValue({ deck, report: { valid: true, issues: [] } });
    mocks.taskFindFirst.mockResolvedValue({
      aggregateVersion: 4,
      worldId: "world-existing",
      stage: "saving",
      status: "running",
    });

    await runGenesisV2PrimaryJob("job-characters");

    expect(mocks.artifactUpdateMany).not.toHaveBeenCalled();
    expect(mocks.worldCreate).not.toHaveBeenCalled();
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" }),
    }));
  });

  it("世界事务中途失败时不发完成事件，并转入明确失败状态", async () => {
    const deck = completeDeck();
    const outputs = splitDeck(deck);
    configureJob("characters");
    mocks.acceptedCount.mockResolvedValue(3);
    mocks.completeStructured.mockResolvedValue(outputs.characters);
    mocks.artifactFindMany.mockResolvedValue([
      { stageKey: "pantheon_domain", outputHash: "p", content: outputs.pantheon_domain },
      { stageKey: "civilizations", outputHash: "c", content: outputs.civilizations },
      { stageKey: "eras", outputHash: "e", content: outputs.eras },
    ]);
    mocks.artifactFindFirst.mockResolvedValue({ content: outputs.blueprint, outputHash: "b" });
    mocks.enforceQuality.mockResolvedValue({ deck, report: { valid: true, issues: [] } });
    mocks.worldCreate.mockRejectedValue(new Error("database write failed"));

    await runGenesisV2PrimaryJob("job-characters");

    expect(mocks.outboxCreate).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "task_completed" }),
    });
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" }),
    }));
  });
});
