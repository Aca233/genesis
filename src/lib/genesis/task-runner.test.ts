import { describe, expect, it, vi } from "vitest";
import {
  buildGenesisRepairRequest,
  buildGenesisRequest,
  claimGenesisTask,
  persistWorld,
  renewGenesisLease,
  resolveLorebookExcerpts,
  safeError,
  toGenesisTaskDto,
} from "./task-runner";
import { CreatorWorldDeckSchema, PantheonWorldDeckSchema } from "@/lib/cards/schemas";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import {
  LORE_INDEX_UNAVAILABLE_NOTICE,
  lorebookExcerpts,
  type ParsedLorebookEntry,
} from "@/lib/lorebook/st-import";
import { LORE_GENESIS_BUDGET_CHARS, selectLoreForGenesis } from "@/lib/lore-index/selection";
import type { LoreIndexRow } from "@/lib/lore-index/schemas";

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

function loreEntry(keys: string[], content: string, enabled = true): ParsedLorebookEntry {
  return { keys, content, enabled, stExtra: {} };
}

function loreRow(
  sourceKey: string,
  category: LoreIndexRow["category"],
  title: string,
  priority: number,
  excerpt: string,
): LoreIndexRow {
  return {
    sourceKey,
    title,
    keywords: [title],
    category,
    temporalHints: { eraGuess: "", relativeToMainline: "unknown" },
    priority,
    excerpt,
  };
}

describe("resolveLorebookExcerpts（§11 T4b 创世注入切换）", () => {
  const entries = [
    loreEntry(["轶闻"], "边角轶闻内容，上传序第一。"),
    loreEntry(["编年史"], "主线前十年大事记，上传序第二。"),
  ];

  it("分类成功：用类别预算选择（8000 字符）替代原始上传序截取", async () => {
    const rows = [
      loreRow("k-anec", "other", "边角轶闻", 10, "边角轶闻摘录"),
      loreRow("k-tl", "timeline", "主线编年史", 90, "主线前十年大事记摘录"),
    ];
    const classify = vi.fn(async () => rows);
    const select = vi.fn(selectLoreForGenesis);

    const result = await resolveLorebookExcerpts(entries, "test-user", { classify, select });

    expect(classify).toHaveBeenCalledWith(entries, "backstage", { userId: "test-user" });
    expect(select).toHaveBeenCalledWith(rows, LORE_GENESIS_BUDGET_CHARS);
    expect(LORE_GENESIS_BUDGET_CHARS).toBe(8000);
    expect(result).toBe(selectLoreForGenesis(rows, LORE_GENESIS_BUDGET_CHARS).excerpt);
    // 注入顺序由预算选择器决定（timeline 先于 other），不再是上传顺序
    expect(result).toBe("[timeline|主线编年史]\n主线前十年大事记摘录\n---\n[other|边角轶闻]\n边角轶闻摘录");
    expect(result).not.toContain(LORE_INDEX_UNAVAILABLE_NOTICE);
  });

  it("分类失败：回退摘录与既有 lorebookExcerpts 逐字节一致，仅前置一行说明", async () => {
    const classify = vi.fn(async () => null);
    const select = vi.fn(selectLoreForGenesis);

    const result = await resolveLorebookExcerpts(entries, "test-user", { classify, select });

    expect(select).not.toHaveBeenCalled();
    expect(result).toBe(`资料索引不可用，按原始顺序注入\n${lorebookExcerpts(entries)}`);
    expect(result).toBe(
      "资料索引不可用，按原始顺序注入\n" +
        "[keys: 轶闻]\n边角轶闻内容，上传序第一。\n---\n[keys: 编年史]\n主线前十年大事记，上传序第二。",
    );
  });

  it("无世界书条目：不触发分类，返回 undefined", async () => {
    const classify = vi.fn(async () => null);
    const select = vi.fn(selectLoreForGenesis);

    await expect(resolveLorebookExcerpts([], "test-user", { classify, select })).resolves.toBeUndefined();
    expect(classify).not.toHaveBeenCalled();
  });

  it("分类成功但无可用行：返回 undefined（与原路径对空摘录的语义一致）", async () => {
    const classify = vi.fn(async () => [] as LoreIndexRow[]);
    const select = vi.fn(selectLoreForGenesis);

    await expect(
      resolveLorebookExcerpts([loreEntry(["禁"], "全部禁用", false)], "test-user", { classify, select }),
    ).resolves.toBeUndefined();
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
      mode: "pantheon",
      status: "running",
      stage: "gods",
      completedKeys: ["worldName", "cosmology", "fusionAxiom"],
      error: null,
      worldId: null,
      createdAt: "2026-07-21T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:10.000Z",
      auditReport: null,
    });
    expect(dto).not.toHaveProperty("rawOutput");
    expect(dto).not.toHaveProperty("decree");
  });

  it("DTO 暴露报告型审计结果；形状不符的历史脏数据按无审计处理（§10.4）", () => {
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
    expect(toGenesisTaskDto(task({ auditReport: report }) as never).auditReport).toEqual(report);
    expect(toGenesisTaskDto(task({ auditReport: { verdict: "block" } }) as never).auditReport)
      .toBeNull();
    expect(toGenesisTaskDto(task() as never).auditReport).toBeNull();
  });

  it("DTO 通过世界模式 schema 解析持久化值", () => {
    expect(toGenesisTaskDto(task({ mode: "creator" }) as never)).toMatchObject({ mode: "creator" });
    expect(() => toGenesisTaskDto(task({ mode: "absolute" }) as never)).toThrow();
  });

  it("长时间修补期间只由当前 lease token 续租并刷新心跳", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const db = { genesisTask: { updateMany } };

    await expect(renewGenesisLease(db, "task-1", "lease-current", new Date("2026-07-21T00:00:00Z")))
      .resolves.toBe(true);
    await expect(renewGenesisLease(db, "task-1", "lease-stale", new Date("2026-07-21T00:00:00Z")))
      .resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-1", leaseToken: "lease-current", status: { in: ["running", "repairing"] } },
      data: { leaseExpiresAt: new Date("2026-07-21T00:01:00.000Z") },
    }));
  });

  it("只有 queued 或租约过期的运行任务能被原子认领", async () => {
    const db = {
      genesisTask: {
        updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue(task({ decree: "神谕", lorebook: null })),
      },
    };

    await expect(claimGenesisTask(db, "task-1", new Date("2026-07-21T00:00:00Z")))
      .resolves.toMatchObject({ id: "task-1" });
    await expect(claimGenesisTask(db, "task-1", new Date("2026-07-21T00:00:00Z")))
      .resolves.toBeNull();

    expect(db.genesisTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "task-1",
        OR: expect.arrayContaining([
          { status: "queued" },
          expect.objectContaining({ status: { in: ["running", "repairing"] } }),
        ]),
      }),
      data: expect.objectContaining({ status: "running" }),
    }));
    expect(db.genesisTask.updateMany.mock.calls[0]![0].where).not.toHaveProperty("userId");
  });

  it("按冻结模式构造生成 system、user 与精确 schema", () => {
    const creator = buildGenesisRequest({
      mode: "creator",
      decree: "创造自行运转的星海",
      lorebookExcerpts: "星海法则",
      materialConstraints: "锁定素材",
    });
    expect(creator.mode).toBe("creator");
    expect(creator.system).toContain('mode="creator"');
    expect(creator.user).toContain('mode="creator"');
    expect(creator.schema).toBe(CreatorWorldDeckSchema);

    const pantheon = buildGenesisRequest({ mode: "pantheon", decree: "我是群星之神" });
    expect(pantheon.system).toContain('mode="pantheon"');
    expect(pantheon.user).toContain('mode="pantheon"');
    expect(pantheon.schema).toBe(PantheonWorldDeckSchema);
  });

  it("创世整套修补只允许一次语义尝试，避免在外层修补轮内重复生成三套长 JSON", () => {
    const request = buildGenesisRepairRequest({
      mode: "pantheon",
      userId: "test-user",
      decree: "创造测试界",
      invalidOutput: "{\"mode\":\"pantheon\"}",
      validationError: "races.0.abilities 至少需要两项",
    });

    expect(request).toMatchObject({
      task: "genesis",
      userId: "test-user",
      schema: PantheonWorldDeckSchema,
      maxTokens: 4096,
      maxAttempts: 1,
      transportMaxAttempts: 1,
      allowTransportFallback: false,
      maxInputBytes: 262144,
      maxOutputBytes: 2097152,
    });
  });

  it("创世初稿使用短轮输出上限，由续写接力完成整套卡组", () => {
    const request = buildGenesisRequest({
      mode: "pantheon",
      decree: "创造测试界",
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
        findFirst: vi.fn().mockResolvedValue({ id: "task-1" }),
        updateMany,
      },
      world: { create },
    };
    const db = { $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };

    await persistWorld(db, task({
      mode: "creator",
      decree: "创造星海",
      leaseToken: "lease-1",
    }) as never, "lease-1", creator, []);

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: "creator" }),
    }));
    const completedKeys = updateMany.mock.calls[0]![0].data.completedKeys as string[];
    expect(completedKeys).toEqual(Object.keys(creator));
    expect(completedKeys).not.toContain("playerGod");
  });

  it("持久化前拒绝任务模式与卡组模式不一致", async () => {
    const db = { $transaction: vi.fn() };
    await expect(persistWorld(
      db,
      task({ mode: "creator", decree: "创造星海" }) as never,
      "lease-1",
      completeDeck(),
      [],
    )).rejects.toThrow("创世卡组模式不匹配");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
