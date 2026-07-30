import { describe, expect, it, vi } from "vitest";
import {
  buildGenesisRepairRequest,
  buildGenesisRequest,
  claimGenesisTask,
  persistWorld,
  renewGenesisLease,
  resolveLorebookExcerpts,
  runGenesisTask,
  safeError,
  toGenesisTaskDto,
} from "./task-runner";
import { CreatorWorldDeckSchema, PantheonWorldDeckSchema } from "@/lib/cards/schemas";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { LlmBudgetError, LlmCapacityError } from "@/lib/llm/permits";
import {
  lorebookExcerpts,
  type ParsedLorebookEntry,
} from "@/lib/lorebook/st-import";
import type { GenesisIntentContract } from "./intent";
import type { GenesisQualityReport } from "./semantic-audit";

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    mode: "pantheon",
    status: "running",
    stage: "gods",
    completedKeys: ["worldName", "cosmology", "fusionAxiom"],
    error: null,
    worldId: null,
    createdAt: new Date("2026-07-21T00:00:00Z"),
    updatedAt: new Date("2026-07-21T00:00:10Z"),
    ...overrides,
  };
}

const crossoverIntent: GenesisIntentContract = {
  sourceBasis: "multi_ip",
  sourceIps: ["无职转生", "钢铁侠"],
  explicitPremise: ["托尼·斯塔克转生为鲁迪乌斯"],
  narrativeCenter: {
    identity: "托尼意识下的鲁迪乌斯",
    role: "唯一叙事中心",
    startState: "保留成年意识但受新生儿身体与资源约束",
  },
  playerRole: {
    type: "independent_god",
    narrativeFunction: "limited_intervener",
    mustNotReplaceProtagonist: true,
  },
  forbiddenExpansions: ["独立贾维斯神格", "开局完成方舟反应堆"],
  factsAtAnchor: ["鲁迪乌斯刚出生"],
  futureOnly: ["制造成熟装甲"],
  fusionBoundaries: ["魔法与科技的兼容性尚未证实"],
  uncertaintyPolicy: "omit_or_generalize",
  corePressures: ["婴儿身体限制", "资源与保密压力"],
};

const creatorIntent: GenesisIntentContract = {
  ...crossoverIntent,
  sourceBasis: "original",
  sourceIps: [],
  playerRole: {
    type: "external_creator",
    narrativeFunction: "external_author",
    mustNotReplaceProtagonist: false,
  },
};

const repairedReport: GenesisQualityReport = {
  verdict: "pass",
  issues: [],
  meta: {
    initialErrorCount: 2,
    initialWarningCount: 1,
    repaired: true,
    auditPasses: 2,
    durationMs: 87,
  },
};

function createRunnerHarness(overrides: {
  intentContract?: unknown;
  intentError?: Error;
  qualityError?: Error;
} = {}) {
  const generatedDeck = completeDeck();
  const repairedDeck = structuredClone(generatedDeck);
  repairedDeck.worldName = "语义修复后的世界";
  const order: string[] = [];
  const taskUpdateMany = vi.fn(async (args: { data?: Record<string, unknown> }) => {
    if (args.data?.intentContract !== undefined) order.push("intent_persisted");
    return { count: 1 };
  });
  const jobUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const worldCreate = vi.fn().mockResolvedValue({ id: "world-1" });
  const tx = {
    genesisTask: {
      findFirst: vi.fn().mockResolvedValue({ id: "task-1", aggregateVersion: 7 }),
      updateMany: taskUpdateMany,
    },
    genesisJob: { updateMany: jobUpdateMany },
    genesisOutbox: { create: vi.fn().mockResolvedValue({}) },
    world: { create: worldCreate },
  };
  const db = {
    genesisTask: { updateMany: taskUpdateMany },
    genesisJob: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "job-1",
        leaseEpoch: 4,
        leaseExpiresAt: new Date("2026-07-29T10:01:00.000Z"),
      }),
    },
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  const claimedTask = {
    ...task({
      userId: "user-1",
      decree: "无职转生，但是鲁迪是托尼斯塔克转生",
      lorebook: null,
      materialSelection: null,
      status: "running",
      stage: "oracle",
      completedKeys: [],
      attempt: 1,
      leaseToken: "lease-1",
      intentContract: overrides.intentContract ?? null,
    }),
  };
  const generateIntent = overrides.intentError
    ? vi.fn().mockRejectedValue(overrides.intentError)
    : vi.fn().mockResolvedValue(crossoverIntent);
  const qualityGate = overrides.qualityError
    ? vi.fn().mockRejectedValue(overrides.qualityError)
    : vi.fn().mockImplementation(async (input: { onStage?: (stage: "audit" | "semantic_repair") => unknown }) => {
      await input.onStage?.("audit");
      await input.onStage?.("semantic_repair");
      return { deck: repairedDeck, report: repairedReport };
    });
  const buildRequest = vi.fn((input) => buildGenesisRequest(input));
  const generateDeck = vi.fn().mockImplementation(async () => {
    order.push("deck_generation");
    return generatedDeck;
  });
  const recordQualityEvent = vi.fn();

  return {
    buildRequest,
    claimedTask,
    db,
    generateDeck,
    generateIntent,
    order,
    qualityGate,
    recordQualityEvent,
    repairedDeck,
    taskUpdateMany,
    worldCreate,
    deps: {
      db: db as never,
      claimTask: vi.fn().mockResolvedValue(claimedTask),
      resolveLorebook: vi.fn().mockResolvedValue(undefined),
      generateIntent,
      buildRequest,
      generateDeck,
      qualityGate,
      recordQualityEvent,
    },
  };
}

function loreEntry(keys: string[], content: string, enabled = true): ParsedLorebookEntry {
  return { keys, content, enabled, stExtra: {} };
}

describe("resolveLorebookExcerpts（7 月 24 日上传序）", () => {
  const entries = [
    loreEntry(["轶闻"], "边角轶闻内容，上传序第一。"),
    loreEntry(["编年史"], "主线前十年大事记，上传序第二。"),
  ];

  it("按上传顺序直接摘录，不运行后加的 AI 分类与重排", async () => {
    const result = await resolveLorebookExcerpts(entries);

    expect(result).toBe(lorebookExcerpts(entries));
    expect(result).toBe(
      "[keys: 轶闻]\n边角轶闻内容，上传序第一。\n---\n[keys: 编年史]\n主线前十年大事记，上传序第二。",
    );
  });

  it("无世界书条目返回 undefined", async () => {
    await expect(resolveLorebookExcerpts([])).resolves.toBeUndefined();
  });

  it("无可用行返回 undefined", async () => {
    await expect(resolveLorebookExcerpts([loreEntry(["禁"], "全部禁用", false)]))
      .resolves.toBeUndefined();
  });
});

describe("genesis task runner", () => {
  it("失败摘要移除 HTML 与凭证并限制长度", () => {
    const error = safeError(new Error(
      `HTTP 504 <html><body>openresty</body></html> authorization=secret-token ${"x".repeat(2000)}`,
    ));
    expect(error).not.toContain("<html>");
    expect(error).not.toContain("secret-token");
    expect(error).toContain("authorization=[已隐藏]");
    expect(error.length).toBeLessThanOrEqual(1000);
  });

  it("DTO 不会泄露神谕、世界书或模型原始输出", () => {
    const dto = toGenesisTaskDto({
      ...task(),
      decree: "秘密神谕",
      lorebook: { secret: true },
      rawOutput: "模型原文",
    } as never);

    expect(dto).toEqual({
      id: "task-1",
      engineVersion: "legacy-v1",
      mode: "pantheon",
      status: "running",
      stage: "gods",
      completedKeys: ["worldName", "cosmology", "fusionAxiom"],
      error: null,
      worldId: null,
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:10.000Z",
      auditReport: null,
      aggregateVersion: 0,
      snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(dto).not.toHaveProperty("rawOutput");
    expect(dto).not.toHaveProperty("decree");
  });

  it("DTO 迁移旧审计报告并归一化阻断等级；形状不符的历史脏数据按无审计处理", () => {
    const report = {
      verdict: "warnings",
      issues: [{
        severity: "warning",
        path: "majorCharacters.0.background",
        type: "future_identity_leak",
        explanation: "把截止点之后才获得的圣剑写成了现状",
        evidenceRefs: ["char:hero"],
      }],
    };
    expect(toGenesisTaskDto(task({ auditReport: report }) as never).auditReport).toEqual({
      verdict: "errors",
      issues: [{
        ...report.issues[0],
        severity: "error",
        repairInstruction: "按原报告说明检查并修复该字段",
      }],
    });
    expect(toGenesisTaskDto(task({ auditReport: { verdict: "block" } }) as never).auditReport)
      .toBeNull();
    expect(toGenesisTaskDto(task() as never).auditReport).toBeNull();
  });

  it("DTO 通过世界模式 schema 解析持久化值", () => {
    expect(toGenesisTaskDto(task({ mode: "creator" }) as never)).toMatchObject({ mode: "creator" });
    expect(() => toGenesisTaskDto(task({ mode: "absolute" }) as never)).toThrow();
  });

  it("legacy 主路径直接生成并持久化 deck，不运行后加的 intent 与语义重写", async () => {
    const harness = createRunnerHarness();

    await runGenesisTask("task-1", harness.deps as never);

    expect(harness.generateIntent).not.toHaveBeenCalled();
    expect(harness.qualityGate).not.toHaveBeenCalled();
    expect(harness.buildRequest).toHaveBeenCalledWith(expect.not.objectContaining({
      intentContract: expect.anything(),
    }));
    expect(harness.worldCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        draftDeck: completeDeck(),
      }),
    }));
    expect(harness.worldCreate.mock.calls[0]?.[0]?.data.genesisIntent).toBeUndefined();
    expect(harness.recordQualityEvent).not.toHaveBeenCalled();
  });

  it("legacy 恢复时忽略任务中遗留的 intent，不让它改变或阻断卡组", async () => {
    const harness = createRunnerHarness({ intentContract: creatorIntent });

    await runGenesisTask("task-1", harness.deps as never);

    expect(harness.generateIntent).not.toHaveBeenCalled();
    expect(harness.qualityGate).not.toHaveBeenCalled();
    expect(harness.generateDeck).toHaveBeenCalledTimes(1);
    expect(harness.worldCreate).toHaveBeenCalledTimes(1);
  });

  it("预算耗尽直接 failed，不进入 provider 探测循环", async () => {
    const harness = createRunnerHarness({ intentContract: crossoverIntent });
    harness.generateDeck.mockRejectedValue(new LlmBudgetError());

    await runGenesisTask("task-1", harness.deps as never);

    expect(harness.worldCreate).not.toHaveBeenCalled();
    expect(harness.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed",
        error: "创世任务已达到模型调用预算上限",
      }),
    }));
    expect(harness.taskUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "waiting_for_provider" }),
    }));
  });

  it("公平队列等待超时保持 queued，不写入终局错误", async () => {
    const harness = createRunnerHarness({ intentContract: crossoverIntent });
    harness.generateDeck.mockRejectedValue(new LlmCapacityError());

    await runGenesisTask("task-1", harness.deps as never);

    expect(harness.taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "queued", error: null }),
    }));
    expect(harness.taskUpdateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "failed" }),
    }));
  });

  it("后加语义门即使配置为失败也不再改写或阻断 legacy 卡组", async () => {
    const harness = createRunnerHarness({
      intentContract: crossoverIntent,
      qualityError: new Error("semantic gate must not run"),
    });

    await runGenesisTask("task-1", harness.deps as never);

    expect(harness.qualityGate).not.toHaveBeenCalled();
    expect(harness.worldCreate).toHaveBeenCalledTimes(1);
  });

  it("长时间修补期间只由当前 lease token 续租并刷新心跳", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const jobUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { genesisTask: { updateMany }, genesisJob: { updateMany: jobUpdateMany } };
    const db = { $transaction: vi.fn((callback) => callback(tx)) };

    await expect(renewGenesisLease(db, "task-1", "lease-current", new Date("2026-07-21T00:00:00Z")))
      .resolves.toBe(true);
    await expect(renewGenesisLease(db, "task-1", "lease-stale", new Date("2026-07-21T00:00:00Z")))
      .resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-1", leaseToken: "lease-current", status: { in: ["running", "repairing"] } },
      data: { leaseExpiresAt: new Date("2026-07-21T00:01:00.000Z") },
    }));
    expect(jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ leaseToken: "lease-current", status: "running" }),
    }));
  });

  it("只有 queued 或租约过期的运行任务能被原子认领", async () => {
    const tx = {
      genesisTask: {
        updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue(task({
          decree: "神谕",
          lorebook: null,
          attempt: 1,
          aggregateVersion: 2,
        })),
      },
      genesisJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      genesisOutbox: { create: vi.fn().mockResolvedValue({}) },
    };
    const db = { $transaction: vi.fn((callback) => callback(tx)) };

    await expect(claimGenesisTask(db, "task-1", new Date("2026-07-21T00:00:00Z")))
      .resolves.toMatchObject({ id: "task-1" });
    await expect(claimGenesisTask(db, "task-1", new Date("2026-07-21T00:00:00Z")))
      .resolves.toBeNull();

    expect(tx.genesisTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "task-1",
        OR: expect.arrayContaining([
          { status: "queued" },
          expect.objectContaining({ status: { in: ["running", "repairing"] } }),
        ]),
      }),
      data: expect.objectContaining({ status: "running" }),
    }));
    expect(tx.genesisTask.updateMany.mock.calls[0]![0].where).not.toHaveProperty("userId");
    expect(tx.genesisJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "running", attempt: 1 }),
    }));
    expect(tx.genesisOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ aggregateVersion: 2, eventType: "task_started" }),
    });
  });

  it("按冻结模式构造生成 system、user 与精确 schema", () => {
    const creator = buildGenesisRequest({
      mode: "creator",
      decree: "创造自行运转的星海",
      intentContract: creatorIntent,
      lorebookExcerpts: "星海法则",
      materialConstraints: "锁定素材",
    });
    expect(creator.mode).toBe("creator");
    expect(creator.system).toContain('mode="creator"');
    expect(creator.user).toContain('mode="creator"');
    expect(creator.user).not.toContain(creatorIntent.narrativeCenter.identity);
    expect(creator.schema).toBe(CreatorWorldDeckSchema);

    const pantheon = buildGenesisRequest({
      mode: "pantheon",
      decree: "我是群星之神",
      intentContract: crossoverIntent,
    });
    expect(pantheon.system).toContain('mode="pantheon"');
    expect(pantheon.user).toContain('mode="pantheon"');
    expect(pantheon.schema).toBe(PantheonWorldDeckSchema);
  });

  it("创世整套修补只允许一次语义尝试，避免在外层修补轮内重复生成三套长 JSON", () => {
    const owner = {
      kind: "genesis_job",
      id: "job-1",
      genesisTaskId: "task-1",
      genesisJobId: "job-1",
      leaseEpoch: 4,
      leaseExpiresAt: "2026-07-29T10:01:00.000Z",
      budgetScope: "primary" as const,
    };
    const request = buildGenesisRepairRequest({
      mode: "pantheon",
      userId: "test-user",
      owner,
      decree: "创造测试界",
      intentContract: crossoverIntent,
      invalidOutput: "{\"mode\":\"pantheon\"}",
      validationError: "races.0.abilities 至少需要两项",
    });

    expect(request).toMatchObject({
      task: "genesis",
      userId: "test-user",
      owner,
      schema: PantheonWorldDeckSchema,
      maxTokens: 4096,
      maxAttempts: 1,
      transportMaxAttempts: 1,
      allowTransportFallback: false,
      maxInputBytes: 262144,
      maxOutputBytes: 2097152,
    });
    expect(request.user).not.toContain(crossoverIntent.narrativeCenter.identity);
  });

  it("创世初稿使用短轮输出上限，由续写接力完成整套卡组", () => {
    const request = buildGenesisRequest({
      mode: "pantheon",
      decree: "创造测试界",
      intentContract: crossoverIntent,
    });

    expect(request.maxTokens).toBe(4096);
  });

  it("持久化世界复制任务模式并从实际 creator 卡组导出完成键", async () => {
    const pantheon = completeDeck();
    const { playerGod: _playerGod, ...shared } = pantheon;
    void _playerGod;
    const creator = CreatorWorldDeckSchema.parse({
      ...shared,
      mode: "creator",
      majorGods: shared.majorGods.map((majorGod, index, gods) => {
        const { agenda, initialRelationToPlayer, ...god } = majorGod;
        void initialRelationToPlayer;
        return {
          ...god,
          agenda: {
            longTermGoal: agenda.longTermGoal,
            shortTermGoals: agenda.shortTermGoals,
            methods: agenda.methods,
            schemes: agenda.schemes,
          },
          relations: [{
            targetGodRef: gods[(index + 1) % gods.length]!.ref,
            label: "rival",
            note: "世界内关系",
          }],
        };
      }),
    });
    const create = vi.fn().mockResolvedValue({ id: "world-creator" });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      genesisTask: {
        findFirst: vi.fn().mockResolvedValue({ id: "task-1", aggregateVersion: 3 }),
        updateMany,
      },
      genesisJob: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      genesisOutbox: { create: vi.fn().mockResolvedValue({}) },
      world: { create },
    };
    const db = { $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };

    await persistWorld(db, task({
      mode: "creator",
      decree: "创造星海",
      leaseToken: "lease-1",
    }) as never, "lease-1", creator, creatorIntent, []);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: "creator" }),
    }));
    const completedKeys = updateMany.mock.calls[0]![0].data.completedKeys as string[];
    expect(completedKeys).toEqual(Object.keys(creator));
    expect(completedKeys).not.toContain("playerGod");
    expect(tx.genesisOutbox.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      aggregateVersion: 4,
      eventType: "task_completed",
    }) });
    expect(tx.genesisJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ leaseToken: "lease-1" }),
      data: expect.objectContaining({ status: "completed" }),
    }));
  });

  it("持久化前拒绝任务模式与卡组模式不一致", async () => {
    const db = { $transaction: vi.fn() };
    await expect(persistWorld(
      db,
      task({ mode: "creator", decree: "创造星海" }) as never,
      "lease-1",
      completeDeck(),
      creatorIntent,
      [],
    )).rejects.toThrow("创世卡组模式不匹配");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
