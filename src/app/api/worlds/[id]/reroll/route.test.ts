import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { CreatorWorldDeckSchema } from "@/lib/cards/schemas";
import type { GenesisIntentContract } from "@/lib/genesis/intent";
import type { GenesisQualityReport } from "@/lib/genesis/semantic-audit";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  latestFindUnique: vi.fn(),
  updateMany: vi.fn(),
  genesisTaskUpdateMany: vi.fn(),
  txFindUnique: vi.fn(),
  transaction: vi.fn(),
  completeStructured: vi.fn(),
  generateIntent: vi.fn(),
  resolveLorebook: vi.fn(),
  qualityGate: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    world: { findFirst: mocks.findUnique, findUnique: mocks.latestFindUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUserId: vi.fn().mockResolvedValue("test-user"),
}));
vi.mock("@/lib/llm/structured", () => ({ completeStructured: mocks.completeStructured }));
vi.mock("@/lib/genesis/intent-generator", () => ({
  generateGenesisIntent: mocks.generateIntent,
}));
vi.mock("@/lib/genesis/task-runner", () => ({
  resolveLorebookExcerpts: mocks.resolveLorebook,
}));
vi.mock("@/lib/genesis/semantic-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/genesis/semantic-gate")>();
  return { ...actual, enforceGenesisQuality: mocks.qualityGate };
});

import { GenesisSemanticGateError } from "@/lib/genesis/semantic-gate";
import { POST } from "./route";

const crossoverIntent: GenesisIntentContract = {
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
};

const creatorIntent: GenesisIntentContract = {
  ...crossoverIntent,
  playerRole: {
    type: "external_creator",
    narrativeFunction: "external_author",
    mustNotReplaceProtagonist: true,
  },
};

const warningReport: GenesisQualityReport = {
  verdict: "warnings",
  issues: [{
    severity: "warning",
    path: "epochConflict.hiddenCurrents.0",
    type: "causal_disconnect",
    explanation: "背景暗流与核心压力关联较弱",
    evidenceRefs: [],
    repairInstruction: "保持泛化",
  }],
  meta: {
    initialErrorCount: 0,
    initialWarningCount: 1,
    repaired: false,
    auditPasses: 1,
    durationMs: 3,
  },
};

const residualReport: GenesisQualityReport = {
  verdict: "errors",
  issues: [{
    severity: "error",
    path: "openingChapterBrief.objective",
    type: "power_shortcut",
    explanation: "婴儿直接完成反应堆",
    evidenceRefs: [],
    repairInstruction: "删除成品能力",
  }],
  meta: {
    initialErrorCount: 1,
    initialWarningCount: 0,
    repaired: true,
    auditPasses: 2,
    durationMs: 9,
  },
};

const creatorWorldFields = {
  genesisIntent: creatorIntent,
  lorebookEntries: [],
};

const context = { params: Promise.resolve({ id: "world-1" }) };
function request(cardKey = "majorGods") {
  return new Request("http://localhost/api/worlds/world-1/reroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cardKey }),
  });
}

describe("POST /api/worlds/[id]/reroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.latestFindUnique.mockResolvedValue({ status: "draft" });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.genesisTaskUpdateMany.mockResolvedValue({ count: 1 });
    mocks.txFindUnique.mockResolvedValue({ updatedAt: new Date("2026-07-22T00:00:01.456Z") });
    mocks.resolveLorebook.mockResolvedValue(undefined);
    mocks.qualityGate.mockImplementation(async ({ deck }) => ({ deck, report: warningReport }));
    mocks.transaction.mockImplementation(async (run) => run({
      world: { updateMany: mocks.updateMany, findUnique: mocks.txFindUnique },
      genesisTask: { updateMany: mocks.genesisTaskUpdateMany },
    }));
  });

  it("Creator 使用准确 schema、prompt 和缓存命名空间重掷", async () => {
    const deck = completeCreatorDeck();
    mocks.findUnique.mockResolvedValue({
      ...creatorWorldFields,
      id: "world-1", mode: "creator", status: "draft", updatedAt: new Date("2026-07-22T00:00:00.123Z"), draftDeck: deck, lockedPaths: [], genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValue(deck);
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toMatchObject({
      updatedAt: "2026-07-22T00:00:01.456Z",
      auditReport: warningReport,
      genesisIntent: creatorIntent,
    });
    expect(mocks.generateIntent).not.toHaveBeenCalled();
    expect(mocks.completeStructured).toHaveBeenCalledWith("narrative", expect.objectContaining({
      schema: CreatorWorldDeckSchema,
      system: expect.stringContaining('mode="creator"'),
      user: expect.stringContaining(creatorIntent.narrativeCenter.identity),
      cache: { namespace: "reroll:v1:creator" },
    }));
    expect(mocks.genesisTaskUpdateMany).toHaveBeenCalledWith({
      where: { worldId: "world-1", userId: "test-user" },
      data: { auditReport: warningReport },
    });
  });

  it("首次重掷旧世界时归一 lorebook row，并在同一乐观事务持久化 deck、intent 与 report", async () => {
    const currentDeck = completeDeck();
    const updatedAt = new Date("2026-07-22T00:00:00.123Z");
    mocks.findUnique.mockResolvedValue({
      id: "world-1",
      mode: "pantheon",
      status: "draft",
      updatedAt,
      draftDeck: currentDeck,
      lockedPaths: [],
      genesisInput: "托尼转生鲁迪乌斯",
      genesisIntent: null,
      lorebookEntries: [
        { keys: ["鲁迪乌斯"], content: "刚出生", enabled: true, stExtra: null },
        { keys: ["禁用"], content: "忽略", enabled: false, stExtra: ["not", "a", "record"] },
        { keys: ["托尼"], content: "保留人格", enabled: true, stExtra: { comment: "锚点" } },
      ],
    });
    mocks.resolveLorebook.mockResolvedValue("权威摘录");
    mocks.generateIntent.mockResolvedValue(crossoverIntent);
    mocks.completeStructured.mockResolvedValue(currentDeck);

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { id: "world-1", userId: "test-user" },
      include: { lorebookEntries: true },
    });
    expect(mocks.resolveLorebook).toHaveBeenCalledWith([
      { keys: ["鲁迪乌斯"], content: "刚出生", enabled: true, stExtra: {} },
      { keys: ["禁用"], content: "忽略", enabled: false, stExtra: {} },
      { keys: ["托尼"], content: "保留人格", enabled: true, stExtra: { comment: "锚点" } },
    ], "test-user");
    expect(mocks.generateIntent).toHaveBeenCalledWith({
      mode: "pantheon",
      decree: "托尼转生鲁迪乌斯",
      userId: "test-user",
      lorebookExcerpts: "权威摘录",
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "world-1", userId: "test-user", mode: "pantheon", status: "draft", updatedAt },
      data: expect.objectContaining({
        draftDeck: currentDeck,
        genesisIntent: crossoverIntent,
      }),
    }));
    expect(mocks.genesisTaskUpdateMany).toHaveBeenCalledWith({
      where: { worldId: "world-1", userId: "test-user" },
      data: { auditReport: warningReport },
    });
    await expect(response.json()).resolves.toMatchObject({
      deck: currentDeck,
      auditReport: warningReport,
      genesisIntent: crossoverIntent,
    });
  });

  it("复用有效的既有 intent，不生成替代契约", async () => {
    const deck = completeDeck();
    mocks.findUnique.mockResolvedValue({
      id: "world-1",
      mode: "pantheon",
      status: "draft",
      updatedAt: new Date("2026-07-22T00:00:00.123Z"),
      draftDeck: deck,
      lockedPaths: [],
      genesisInput: "托尼转生鲁迪乌斯",
      genesisIntent: crossoverIntent,
      lorebookEntries: [],
    });
    mocks.completeStructured.mockResolvedValue(deck);

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.generateIntent).not.toHaveBeenCalled();
    expect(mocks.qualityGate).toHaveBeenCalledWith(expect.objectContaining({
      intent: crossoverIntent,
    }));
    await expect(response.json()).resolves.toMatchObject({ genesisIntent: crossoverIntent });
  });

  it("拒绝损坏的非空 intent，且不静默重生契约", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "world-1",
      mode: "pantheon",
      status: "draft",
      updatedAt: new Date("2026-07-22T00:00:00.123Z"),
      draftDeck: completeDeck(),
      lockedPaths: [],
      genesisInput: "托尼转生鲁迪乌斯",
      genesisIntent: { broken: true },
      lorebookEntries: [],
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "创世意图契约已损坏" });
    expect(mocks.generateIntent).not.toHaveBeenCalled();
    expect(mocks.completeStructured).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("拒绝与世界模式不匹配的非空 intent，且不生成或更新", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "world-1",
      mode: "pantheon",
      status: "draft",
      updatedAt: new Date("2026-07-22T00:00:00.123Z"),
      draftDeck: completeDeck(),
      lockedPaths: [],
      genesisInput: "托尼转生鲁迪乌斯",
      genesisIntent: creatorIntent,
      lorebookEntries: [],
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "创世意图契约与世界模式不匹配",
    });
    expect(mocks.generateIntent).not.toHaveBeenCalled();
    expect(mocks.completeStructured).not.toHaveBeenCalled();
    expect(mocks.qualityGate).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.genesisTaskUpdateMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("把冻结 intent、当前 deck、锁定路径与 lorebook 交给质量门", async () => {
    const currentDeck = completeDeck();
    currentDeck.playerGod.name = "玩家锁定神名";
    mocks.findUnique.mockResolvedValue({
      id: "world-1",
      mode: "pantheon",
      status: "draft",
      updatedAt: new Date("2026-07-22T00:00:00.123Z"),
      draftDeck: currentDeck,
      lockedPaths: ["playerGod.name"],
      genesisInput: "托尼转生鲁迪乌斯",
      genesisIntent: crossoverIntent,
      lorebookEntries: [],
    });
    mocks.resolveLorebook.mockResolvedValue("权威摘录");
    mocks.completeStructured.mockResolvedValue(currentDeck);

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.qualityGate).toHaveBeenCalledWith({
      deck: currentDeck,
      mode: "pantheon",
      decree: "托尼转生鲁迪乌斯",
      intent: crossoverIntent,
      userId: "test-user",
      lorebookExcerpts: "权威摘录",
      materialSnapshot: null,
      lockedPaths: ["playerGod.name"],
      currentDeck,
    });
    const rerollPrompt = (mocks.completeStructured.mock.calls[0]![1] as { user: string }).user;
    expect(rerollPrompt).toContain(crossoverIntent.narrativeCenter.identity);
  });

  it("质量门语义修复后重新应用玩家锁定路径", async () => {
    const currentDeck = completeCreatorDeck();
    currentDeck.cosmology.origin = "玩家锁定的起源";
    const generated = structuredClone(currentDeck);
    generated.cosmology.origin = "首轮重掷改写";
    const semanticRepair = structuredClone(currentDeck);
    semanticRepair.cosmology.origin = "语义修复再次改写";
    const audit = vi.fn()
      .mockResolvedValueOnce({
        verdict: "errors",
        issues: [{
          severity: "error",
          path: "openingChapterBrief.objective",
          type: "power_shortcut",
          explanation: "存在能力捷径",
          evidenceRefs: [],
          repairInstruction: "移除捷径",
        }],
      })
      .mockResolvedValueOnce({ verdict: "pass", issues: [] });
    const repair = vi.fn().mockResolvedValue(semanticRepair);
    const actualGate = (
      await vi.importActual<typeof import("@/lib/genesis/semantic-gate")>(
        "@/lib/genesis/semantic-gate",
      )
    ).enforceGenesisQuality;
    mocks.qualityGate.mockImplementation((input) => actualGate(input, {
      audit,
      repair,
      validate: (raw) => CreatorWorldDeckSchema.parse(raw),
    }));
    mocks.findUnique.mockResolvedValue({
      ...creatorWorldFields,
      id: "world-1",
      mode: "creator",
      status: "draft",
      updatedAt: new Date("2026-07-22T00:00:00.123Z"),
      draftDeck: currentDeck,
      lockedPaths: ["cosmology.origin"],
      genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValue(generated);

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(audit).toHaveBeenCalledTimes(2);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        draftDeck: expect.objectContaining({
          cosmology: expect.objectContaining({ origin: "玩家锁定的起源" }),
        }),
      }),
    }));
  });

  it("语义修复后仍有 error 时返回 502，且不更新世界或任务", async () => {
    const deck = completeDeck();
    mocks.findUnique.mockResolvedValue({
      id: "world-1",
      mode: "pantheon",
      status: "draft",
      updatedAt: new Date("2026-07-22T00:00:00.123Z"),
      draftDeck: deck,
      lockedPaths: [],
      genesisInput: "托尼转生鲁迪乌斯",
      genesisIntent: crossoverIntent,
      lorebookEntries: [],
    });
    mocks.completeStructured.mockResolvedValue(deck);
    mocks.qualityGate.mockRejectedValue(new GenesisSemanticGateError(residualReport));

    const response = await POST(request(), context);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "创世语义修复后仍有阻断问题，已安全终止生成",
      auditReport: residualReport,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.genesisTaskUpdateMany).not.toHaveBeenCalled();
  });

  it("拒绝质量门把卡组改离世界模式", async () => {
    const deck = completeCreatorDeck();
    mocks.findUnique.mockResolvedValue({
      ...creatorWorldFields,
      id: "world-1",
      mode: "creator",
      status: "draft",
      updatedAt: new Date("2026-07-22T00:00:00.123Z"),
      draftDeck: deck,
      lockedPaths: [],
      genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValue(deck);
    mocks.qualityGate.mockResolvedValue({ deck: completeDeck(), report: warningReport });

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界模式不可更改" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("拒绝重掷已开局世界且不调用模型", async () => {
    mocks.findUnique.mockResolvedValue({
      ...creatorWorldFields,
      id: "world-1",
      mode: "creator",
      status: "playing",
      updatedAt: new Date("2026-07-22T00:00:00.123Z"),
      draftDeck: null,
      lockedPaths: [],
      genesisInput: "创造星海",
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界已开局，不可修改卡组" });
    expect(mocks.completeStructured).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("Creator 明确拒绝 playerGod 重掷且不调用模型", async () => {
    mocks.findUnique.mockResolvedValue({
      ...creatorWorldFields,
      id: "world-1", mode: "creator", status: "draft", updatedAt: new Date("2026-07-22T00:00:00.123Z"), draftDeck: completeCreatorDeck(), lockedPaths: [], genesisInput: "创造星海",
    });
    const response = await POST(request("playerGod"), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "创世主模式不能重掷玩家神" });
    expect(mocks.completeStructured).not.toHaveBeenCalled();
  });

  it("重掷用加载时 updatedAt 原子更新并报告并发冲突", async () => {
    const loadedAt = new Date("2026-07-22T00:00:00.123Z");
    const deck = completeCreatorDeck();
    mocks.findUnique.mockResolvedValue({
      ...creatorWorldFields,
      id: "world-1", mode: "creator", status: "draft", updatedAt: loadedAt, draftDeck: deck, lockedPaths: [], genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValue(deck);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "卡组已被其他操作更新，请刷新后重试" });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "world-1", userId: "test-user", mode: "creator", status: "draft", updatedAt: loadedAt },
    }));
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.txFindUnique).not.toHaveBeenCalled();
  });

  it("模型生成期间世界开局时原子写入失败并返回已开局冲突", async () => {
    const loadedAt = new Date("2026-07-22T00:00:00.123Z");
    const deck = completeCreatorDeck();
    mocks.findUnique.mockResolvedValue({
      ...creatorWorldFields,
      id: "world-1", mode: "creator", status: "draft", updatedAt: loadedAt,
      draftDeck: deck, lockedPaths: [], genesisInput: "创造星海",
    });
    mocks.latestFindUnique.mockResolvedValue({ status: "playing" });
    mocks.completeStructured.mockResolvedValue(deck);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界已开局，不可修改卡组" });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "world-1", userId: "test-user", mode: "creator", status: "draft", updatedAt: loadedAt },
    }));
  });

  it("Creator 引用修补继续使用精确 schema/cache、保留锁定字段并拒绝修补改模式", async () => {
    const current = completeCreatorDeck();
    current.cosmology.origin = "玩家锁定的起源";
    const invalid = structuredClone(current);
    invalid.cosmology.origin = "模型改写的起源";
    invalid.majorGods[0]!.relations[0]!.targetGodRef = "missing-god";
    const oppositeMode = completeDeck();
    mocks.findUnique.mockResolvedValue({
      ...creatorWorldFields,
      id: "world-1", mode: "creator", status: "draft", updatedAt: new Date("2026-07-22T00:00:00.123Z"),
      draftDeck: current, lockedPaths: ["cosmology.origin"], genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValueOnce(invalid).mockResolvedValueOnce(oppositeMode);

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界模式不可更改" });
    expect(mocks.completeStructured).toHaveBeenCalledTimes(2);
    expect(mocks.completeStructured).toHaveBeenNthCalledWith(2, "narrative", expect.objectContaining({
      schema: CreatorWorldDeckSchema,
      system: expect.stringContaining('mode="creator"'),
      user: expect.stringContaining('mode="creator"'),
      cache: { namespace: "reroll:v1:creator" },
    }));
    const repairCall = mocks.completeStructured.mock.calls[1]![1] as { user: string };
    expect(repairCall.user).toContain("玩家锁定的起源");
    expect(repairCall.user).toContain(creatorIntent.narrativeCenter.identity);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("同模式 repair 篡改锁定字段时最终落库恢复玩家锁定值", async () => {
    const current = completeCreatorDeck();
    current.cosmology.origin = "玩家锁定的起源";
    const invalid = structuredClone(current);
    invalid.cosmology.origin = "首次生成篡改";
    invalid.majorGods[0]!.relations[0]!.targetGodRef = "missing-god";
    const repaired = structuredClone(current);
    repaired.cosmology.origin = "repair 再次篡改";
    mocks.findUnique.mockResolvedValue({
      ...creatorWorldFields,
      id: "world-1", mode: "creator", status: "draft", updatedAt: new Date("2026-07-22T00:00:00.123Z"),
      draftDeck: current, lockedPaths: ["cosmology.origin"], genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValueOnce(invalid).mockResolvedValueOnce(repaired);

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        draftDeck: expect.objectContaining({
          mode: "creator",
          cosmology: expect.objectContaining({ origin: "玩家锁定的起源" }),
        }),
      }),
    }));
    await expect(response.json()).resolves.toMatchObject({
      deck: { cosmology: { origin: "玩家锁定的起源" } },
    });
  });

  it("拒绝生成结果把卡组改离世界模式", async () => {
    mocks.findUnique.mockResolvedValue({
      ...creatorWorldFields,
      id: "world-1", mode: "creator", status: "draft", updatedAt: new Date("2026-07-22T00:00:00.123Z"), draftDeck: completeCreatorDeck(), lockedPaths: [], genesisInput: "创造星海",
    });
    mocks.completeStructured.mockResolvedValue(completeDeck());
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界模式不可更改" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
