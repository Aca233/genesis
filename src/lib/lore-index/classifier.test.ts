import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    loreIndexEntry: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
  completeStructured: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/llm/structured", () => ({ completeStructured: mocks.completeStructured }));

import {
  CLASSIFY_BATCH_SIZE,
  LORE_CLASSIFIER_SYSTEM,
  classifyLoreEntries,
  loreSourceKey,
} from "./classifier";

function entry(content: string, keys: string[] = ["钥匙"]) {
  return { keys, content, enabled: true };
}

function classified(index: number, overrides: Record<string, unknown> = {}) {
  return {
    index,
    title: `标题${index}`,
    keywords: ["关键词"],
    category: "character",
    temporalHints: { eraGuess: "", relativeToMainline: "unknown" },
    priority: 40,
    excerpt: `摘录${index}`,
    ...overrides,
  };
}

function existingRow(content: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    userId: "local",
    sourceKey: loreSourceKey(content),
    title: "既有标题",
    keywords: ["既有"],
    category: "timeline",
    temporalHints: { eraGuess: "主线前夕", relativeToMainline: "before" },
    priority: 80,
    excerpt: "既有摘录",
    createdAt: new Date("2026-07-26T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.prisma.loreIndexEntry.findMany.mockResolvedValue([]);
  mocks.prisma.loreIndexEntry.createMany.mockResolvedValue({ count: 0 });
  mocks.completeStructured.mockResolvedValue({ entries: [] });
});

describe("loreSourceKey", () => {
  it("是内容的稳定 SHA-256 十六进制", () => {
    const key = loreSourceKey("同一份资料");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(loreSourceKey("同一份资料")).toBe(key);
    expect(loreSourceKey("另一份资料")).not.toBe(key);
  });
});

describe("分类提示词（提示词表面，改动需过测试）", () => {
  it("system 钉住闭合类别集与时间提示规则", () => {
    expect(LORE_CLASSIFIER_SYSTEM).toContain(
      "world_rule / timeline / character / faction / place / ability / other",
    );
    expect(LORE_CLASSIFIER_SYSTEM).toContain(
      'Use "unknown" whenever the entry carries no temporal signal',
    );
    expect(LORE_CLASSIFIER_SYSTEM).toContain("within 500 characters");
    expect(LORE_CLASSIFIER_SYSTEM).toContain("relativeToMainline");
  });
});

describe("classifyLoreEntries", () => {
  it("空输入与全禁用输入直接返回空数组，不发起任何调用", async () => {
    await expect(classifyLoreEntries([])).resolves.toEqual([]);
    await expect(
      classifyLoreEntries([
        { keys: [], content: "   ", enabled: true },
        { keys: [], content: "被禁用", enabled: false },
      ]),
    ).resolves.toEqual([]);
    expect(mocks.prisma.loreIndexEntry.findMany).not.toHaveBeenCalled();
    expect(mocks.completeStructured).not.toHaveBeenCalled();
  });

  it("已索引条目幂等跳过：不调用模型也不落库", async () => {
    mocks.prisma.loreIndexEntry.findMany.mockResolvedValue([existingRow("内容一")]);
    const result = await classifyLoreEntries([entry("内容一")]);
    expect(result).toEqual([
      {
        sourceKey: loreSourceKey("内容一"),
        title: "既有标题",
        keywords: ["既有"],
        category: "timeline",
        temporalHints: { eraGuess: "主线前夕", relativeToMainline: "before" },
        priority: 80,
        excerpt: "既有摘录",
      },
    ]);
    expect(mocks.prisma.loreIndexEntry.findMany).toHaveBeenCalledWith({
      where: { userId: "local", sourceKey: { in: [loreSourceKey("内容一")] } },
    });
    expect(mocks.completeStructured).not.toHaveBeenCalled();
    expect(mocks.prisma.loreIndexEntry.createMany).not.toHaveBeenCalled();
  });

  it("部分新条目：只把未索引者送去分类并落库，返回序与输入一致", async () => {
    mocks.prisma.loreIndexEntry.findMany.mockResolvedValue([existingRow("内容一")]);
    mocks.completeStructured.mockResolvedValue({ entries: [classified(0)] });

    const result = await classifyLoreEntries([entry("内容一"), entry("内容二")]);

    expect(mocks.completeStructured).toHaveBeenCalledTimes(1);
    const [slot, opts] = mocks.completeStructured.mock.calls[0];
    expect(slot).toBe("backstage");
    expect(opts.task).toBe("extract");
    expect(opts.userId).toBe("local"); // 归因:默认单用户,后续波换真值
    expect(opts.user).toContain("内容二");
    expect(opts.user).not.toContain("内容一");

    expect(mocks.prisma.loreIndexEntry.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: "local",
          sourceKey: loreSourceKey("内容二"),
          title: "标题0",
          category: "character",
        }),
      ],
      skipDuplicates: true,
    });

    expect(result).toHaveLength(2);
    expect(result?.[0].sourceKey).toBe(loreSourceKey("内容一"));
    expect(result?.[1]).toMatchObject({
      sourceKey: loreSourceKey("内容二"),
      title: "标题0",
      priority: 40,
    });
  });

  it("既有行的脏类别与脏时间提示被归一化，不抛错", async () => {
    mocks.prisma.loreIndexEntry.findMany.mockResolvedValue([
      existingRow("内容一", { category: "weird", temporalHints: null }),
    ]);
    const result = await classifyLoreEntries([entry("内容一")]);
    expect(result?.[0].category).toBe("other");
    expect(result?.[0].temporalHints).toEqual({ eraGuess: "", relativeToMainline: "unknown" });
  });

  it("同内容条目在输入内去重，只分类一次", async () => {
    mocks.completeStructured.mockResolvedValue({ entries: [classified(0)] });
    const result = await classifyLoreEntries([entry("重复内容"), entry("重复内容")]);
    expect(mocks.completeStructured).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result?.[0].sourceKey).toBe(loreSourceKey("重复内容"));
  });

  it("每批至多 20 条：45 条新条目分 3 批", async () => {
    expect(CLASSIFY_BATCH_SIZE).toBe(20);
    mocks.completeStructured.mockImplementation(
      async (_slot: string, opts: { user: string }) => {
        const count = [...opts.user.matchAll(/^#\d+ \[keys:/gm)].length;
        return { entries: Array.from({ length: count }, (_, i) => classified(i)) };
      },
    );
    const entries = Array.from({ length: 45 }, (_, i) => entry(`独立内容${i}`));
    const result = await classifyLoreEntries(entries);

    expect(mocks.completeStructured).toHaveBeenCalledTimes(3);
    const batchSizes = mocks.completeStructured.mock.calls.map(
      (call) => [...(call[1] as { user: string }).user.matchAll(/^#\d+ \[keys:/gm)].length,
    );
    expect(batchSizes).toEqual([20, 20, 5]);
    expect(mocks.prisma.loreIndexEntry.createMany).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(45);
  });

  it("模型缺条 → 整体回退 null", async () => {
    mocks.completeStructured.mockResolvedValue({ entries: [classified(0)] });
    await expect(
      classifyLoreEntries([entry("内容一"), entry("内容二")]),
    ).resolves.toBeNull();
  });

  it("模型编号越界 → null", async () => {
    mocks.completeStructured.mockResolvedValue({ entries: [classified(1)] });
    await expect(classifyLoreEntries([entry("内容一")])).resolves.toBeNull();
  });

  it("模型调用失败 → null，不抛错（§11 不阻断创世）", async () => {
    mocks.completeStructured.mockRejectedValue(new Error("上游超时"));
    await expect(classifyLoreEntries([entry("内容一")])).resolves.toBeNull();
  });

  it("落库失败 → null，不抛错", async () => {
    mocks.completeStructured.mockResolvedValue({ entries: [classified(0)] });
    mocks.prisma.loreIndexEntry.createMany.mockRejectedValue(new Error("数据库不可用"));
    await expect(classifyLoreEntries([entry("内容一")])).resolves.toBeNull();
  });

  it("超长摘录防御性截断到 800 字符", async () => {
    mocks.completeStructured.mockResolvedValue({
      entries: [classified(0, { excerpt: "长".repeat(1000) })],
    });
    const result = await classifyLoreEntries([entry("内容一")]);
    expect(result?.[0].excerpt).toHaveLength(800);
    const createArgs = mocks.prisma.loreIndexEntry.createMany.mock.calls[0][0];
    expect(createArgs.data[0].excerpt).toHaveLength(800);
  });
});
