import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  markGenerationFailed,
  markGenerationStage,
  prepareGenerationRequest,
  storeGenerationOutput,
} from "./request";
import { emptyContinuousMeta } from "./continuous-meta";

it("GenerationRequest 和内部检查点持久化真实任务阶段", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  expect(schema).toContain("stage             String   @default(\"reserved\")");
  expect(schema).toContain("outputSnapshot    Json?    @map(\"output_snapshot\")");
  expect(schema).toContain("retryable         Boolean  @default(true)");
  expect(schema).toContain("safeError         String?  @map(\"safe_error\")");
  expect(schema).toContain("stageUpdatedAt    DateTime @default(now()) @map(\"stage_updated_at\")");
  expect(schema).toMatch(/settleError\s+String\?\s+@map\("settle_error"\)/);
  expect(schema).toMatch(/settleRetryable\s+Boolean\s+@default\(true\)\s+@map\("settle_retryable"\)/);
});

function fixture() {
  const messages = new Map<string, Record<string, unknown>>();
  const requests = new Map<string, Record<string, unknown>>();
  const tx = {
    world: { findUnique: vi.fn().mockResolvedValue({ activeTimelineId: "timeline-1" }) },
    generationRequest: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => requests.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (requests.has(String(data.id))) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row = { ...data };
        requests.set(String(data.id), row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: {
        where: { id: string; status?: string; attempt?: number; stage?: string };
        data: Record<string, unknown>;
      }) => {
        const row = requests.get(where.id);
        if (!row || (where.status && row.status !== where.status) ||
            (where.stage && row.stage !== where.stage) ||
            (where.attempt !== undefined && row.attempt !== where.attempt)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    message: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => messages.get(where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (messages.has(String(data.id))) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row = { ...data };
        messages.set(String(data.id), row);
        return row;
      }),
    },
  };
  return {
    messages,
    requests,
    tx,
    client: { $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)) },
  };
}

const input = {
  generationId: "generation-1",
  chapterId: "chapter-1",
  worldId: "world-1",
  expectedActiveTimelineId: "timeline-1",
  mode: "say" as const,
  scale: "scene" as const,
  content: "神谕",
  playerIndex: 3,
  narratorIndex: 4,
};

describe("prepareGenerationRequest", () => {
  it.each(["say", "continue", "opening"] as const)(
    "%s 在调用 LLM 前创建 durable reservation",
    async (mode) => {
      const { client, tx } = fixture();
      const result = await prepareGenerationRequest(client as never, {
        ...input,
        mode,
        content: mode === "say" ? input.content : undefined,
        playerIndex: mode === "say" ? 3 : null,
        narratorIndex: mode === "say" ? 4 : mode === "opening" ? 1 : 3,
      });

      expect(result.state).toBe("owner");
      expect(tx.generationRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: "generation-1",
          chapterId: "chapter-1",
          mode,
          status: "pending",
          stage: "reserved",
          attempt: 1,
          leaseExpiresAt: expect.any(Date),
        }),
      });
      expect(tx.message.create).not.toHaveBeenCalled();
    },
  );

  it("首次 opening 在章内已有消息时不留下 pending reservation", async () => {
    const { client, requests } = fixture();

    await expect(prepareGenerationRequest(client as never, {
      ...input,
      mode: "opening",
      content: undefined,
      playerIndex: null,
      narratorIndex: 1,
      chapterHasMessages: true,
    })).rejects.toThrow(/已有开场/);

    expect(requests.size).toBe(0);
  });

  it("相同 ID 并发 loser 复用 pending reservation，分类前不写玩家消息", async () => {
    const { client, tx } = fixture();
    const first = await prepareGenerationRequest(client as never, input);
    const second = await prepareGenerationRequest(client as never, {
      ...input,
      playerIndex: 9,
      narratorIndex: 10,
    });

    expect(first.state).toBe("owner");
    expect(second).toMatchObject({ state: "pending", meta: { playerIndex: 3, narratorIndex: 4 } });
    expect(tx.message.create).not.toHaveBeenCalled();
  });

  it.each([
    { status: "failed", leaseExpiresAt: null },
    { status: "pending", leaseExpiresAt: new Date(0) },
  ])("$status 或过期 lease 可原子接管且不提前写玩家消息", async (state) => {
    const { client, tx, requests } = fixture();
    const first = await prepareGenerationRequest(client as never, input);
    Object.assign(requests.get(input.generationId)!, state);

    const takeover = await prepareGenerationRequest(client as never, input);

    expect(first).toMatchObject({ state: "owner", attempt: 1 });
    expect(takeover).toMatchObject({ state: "owner", attempt: 2 });
    expect(tx.generationRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: input.generationId, attempt: 1 }),
      data: expect.objectContaining({ status: "pending", attempt: 2, error: null }),
    }));
    expect(tx.message.create).not.toHaveBeenCalled();
  });

  it("owner 失败只按当前 attempt 标记 failed，旧 owner 不覆盖接管者", async () => {
    const { client, tx, requests } = fixture();
    await prepareGenerationRequest(client as never, input);

    await markGenerationFailed(client as never, input.generationId, 1, new Error("LLM failed"));

    expect(requests.get(input.generationId)).toMatchObject({
      status: "failed",
      error: "LLM failed",
      leaseExpiresAt: null,
    });
    requests.get(input.generationId)!.attempt = 2;
    requests.get(input.generationId)!.status = "pending";
    await markGenerationFailed(client as never, input.generationId, 1, new Error("stale"));
    expect(tx.generationRequest.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: input.generationId, status: "pending", attempt: 1 },
    }));
    expect(requests.get(input.generationId)!.status).toBe("pending");
  });

  it("相同 ID 不同语义请求被拒绝", async () => {
    const { client } = fixture();
    await prepareGenerationRequest(client as never, input);
    await expect(
      prepareGenerationRequest(client as never, { ...input, content: "另一神谕" }),
    ).rejects.toThrow(/参数不一致|占用/);
  });

  it("output_stored 重试复用保存输出而不回到生成阶段", async () => {
    const { client, requests } = fixture();
    await prepareGenerationRequest(client as never, input);
    const row = requests.get(input.generationId)!;
    Object.assign(row, {
      status: "failed",
      stage: "output_stored",
      leaseExpiresAt: null,
      outputSnapshot: {
        prose: "潮声已抵达王城。",
        parsedMeta: emptyContinuousMeta(),
        generatedAt: "2026-07-23T00:00:00.000Z",
        contractVersion: 1,
      },
    });

    const result = await prepareGenerationRequest(client as never, input);

    expect(result).toMatchObject({
      state: "owner",
      attempt: 2,
      resumeFrom: "output_stored",
      outputSnapshot: { prose: "潮声已抵达王城。" },
    });
  });

  it("保存完整输出使用阶段和 attempt CAS 且不写公开消息", async () => {
    const { client, tx } = fixture();
    await prepareGenerationRequest(client as never, input);
    await markGenerationStage(client as never, input.generationId, 1, "generating");

    const output = await storeGenerationOutput(client as never, input.generationId, 1, {
      prose: "潮声已抵达王城。",
      parsedMeta: emptyContinuousMeta(),
      generatedAt: "2026-07-23T00:00:00.000Z",
      contractVersion: 1,
    });

    expect(output.prose).toBe("潮声已抵达王城。");
    expect(tx.generationRequest.updateMany).toHaveBeenLastCalledWith({
      where: { id: input.generationId, attempt: 1, status: "pending", stage: "generating" },
      data: expect.objectContaining({
        stage: "output_stored",
        outputSnapshot: output,
        error: null,
        safeError: null,
      }),
    });
    expect(tx.message.create).not.toHaveBeenCalled();
  });

  it("任务阶段只能向前推进且旧 owner 不能推进新 attempt", async () => {
    const { client, requests } = fixture();
    await prepareGenerationRequest(client as never, input);
    await markGenerationStage(client as never, input.generationId, 1, "context_ready");
    await expect(markGenerationStage(
      client as never,
      input.generationId,
      1,
      "reserved",
    )).rejects.toThrow("任务阶段不可倒退");
    requests.get(input.generationId)!.attempt = 2;
    await expect(markGenerationStage(
      client as never,
      input.generationId,
      1,
      "generating",
    )).rejects.toThrow("叙事任务阶段已被接管");
  });

  it("completed reservation 只在 narrator 与请求绑定一致时返回可重放结果", async () => {
    const { client, requests, messages } = fixture();
    await prepareGenerationRequest(client as never, input);
    const request = requests.get(input.generationId)!;
    request.status = "completed";
    request.resultMeta = { suggestions: ["继续"], chapterBreakHint: false };
    messages.set(input.generationId, {
      id: input.generationId,
      chapterId: input.chapterId,
      index: input.narratorIndex,
      role: "narrator",
      scale: input.scale,
      meta: { generationRequest: { type: "chat-generation-request", ...request, narratorMessageId: input.generationId } },
    });

    const result = await prepareGenerationRequest(client as never, input);

    expect(result).toMatchObject({
      state: "completed",
      completion: {
        messageId: "generation-1",
        meta: { suggestions: ["继续"] },
        followUp: { kind: "none" },
      },
    });
  });

  it("does not reserve or write the player message after the reality is frozen", async () => {
    const { client, tx, requests } = fixture();
    tx.world.findUnique.mockResolvedValue({ activeTimelineId: "timeline-new" });

    await expect(prepareGenerationRequest(client as never, input)).rejects.toThrow("该现实已被冻结");
    expect(requests.size).toBe(0);
    expect(tx.message.create).not.toHaveBeenCalled();
  });

  it("rechecks the active reality in unique-conflict recovery", async () => {
    const { client, tx } = fixture();
    await prepareGenerationRequest(client as never, input);
    tx.world.findUnique.mockClear();
    tx.generationRequest.findUnique.mockResolvedValueOnce(null);
    tx.world.findUnique
      .mockResolvedValueOnce({ activeTimelineId: "timeline-1" })
      .mockResolvedValueOnce({ activeTimelineId: "timeline-new" });

    await expect(prepareGenerationRequest(client as never, input)).rejects.toThrow("该现实已被冻结");
    expect(tx.world.findUnique).toHaveBeenCalledTimes(2);
  });

});
