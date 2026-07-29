import { describe, expect, it, vi } from "vitest";
import { isTransientLlmError } from "@/lib/llm/gateway";
import { GenesisIntentContractSchema, type GenesisIntentContract } from "./intent";
import {
  GenesisIntentGenerationError,
  generateGenesisIntent,
  type IntentGeneratorDeps,
} from "./intent-generator";

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

const input = {
  mode: "pantheon" as const,
  decree: "无职转生，但是鲁迪是托尼斯塔克转生",
  userId: "user-1",
  lorebookExcerpts: "布耶纳村资料",
  owner: {
    kind: "genesis_job",
    id: "job-1",
    genesisTaskId: "task-1",
    genesisJobId: "job-1",
    leaseEpoch: 3,
  },
};

describe("generateGenesisIntent", () => {
  it("通过 backstage/extract 生成并再次校验意图契约", async () => {
    const complete = vi.fn<IntentGeneratorDeps["complete"]>(
      async () => crossoverIntent,
    );

    await expect(generateGenesisIntent(input, { complete })).resolves.toEqual(crossoverIntent);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith("backstage", expect.objectContaining({
      task: "extract",
      userId: "user-1",
      owner: input.owner,
      schema: GenesisIntentContractSchema,
      temperature: 0.1,
      maxTokens: 3000,
      maxAttempts: 1,
      transportMaxAttempts: 1,
      allowTransportFallback: false,
      failOnTruncation: false,
    }));
    const request = complete.mock.calls[0]![1];
    expect(request.user).toContain("布耶纳村资料");
  });

  it("瞬时失败后只重试一次", async () => {
    const complete = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 503: upstream overloaded"))
      .mockResolvedValueOnce(crossoverIntent);

    await expect(generateGenesisIntent(input, { complete })).resolves.toEqual(crossoverIntent);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls.length).toBeLessThanOrEqual(2);
    expect(complete.mock.calls.every(([, options]) => options.failOnTruncation === false)).toBe(true);
  });

  it("模式不匹配的结果会占用一次尝试并重新提取", async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce({
        ...crossoverIntent,
        playerRole: {
          type: "external_creator",
          narrativeFunction: "external_author",
          mustNotReplaceProtagonist: true,
        },
      })
      .mockResolvedValueOnce(crossoverIntent);

    await expect(generateGenesisIntent(input, { complete })).resolves.toEqual(crossoverIntent);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("两次失败后抛出安全且非瞬时的领域错误", async () => {
    const firstError = new Error("HTTP 503: first failure");
    const finalError = new Error("HTTP 503: second failure");
    const complete = vi.fn()
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(finalError);

    let caught: unknown;
    try {
      await generateGenesisIntent(input, { complete });
    } catch (error) {
      caught = error;
    }

    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls.length).toBeLessThanOrEqual(2);
    expect(caught).toBeInstanceOf(GenesisIntentGenerationError);
    expect(caught).toMatchObject({
      message: "创世意图提取失败，请稍后重试",
      cause: finalError,
    });
    expect(isTransientLlmError(caught)).toBe(false);
  });
});
