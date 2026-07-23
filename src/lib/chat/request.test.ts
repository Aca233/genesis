import { describe, expect, it, vi } from "vitest";
import { markGenerationFailed, prepareGenerationRequest } from "./request";

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
        where: { id: string; status?: string; attempt?: number };
        data: Record<string, unknown>;
      }) => {
        const row = requests.get(where.id);
        if (!row || (where.status && row.status !== where.status) ||
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
          attempt: 1,
          leaseExpiresAt: expect.any(Date),
        }),
      });
      expect(tx.message.create).toHaveBeenCalledTimes(mode === "say" ? 1 : 0);
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

  it("相同 ID 并发 loser 复用 pending reservation，不重复玩家写入", async () => {
    const { client, tx } = fixture();
    const first = await prepareGenerationRequest(client as never, input);
    const second = await prepareGenerationRequest(client as never, {
      ...input,
      playerIndex: 9,
      narratorIndex: 10,
    });

    expect(first.state).toBe("owner");
    expect(second).toMatchObject({ state: "pending", meta: { playerIndex: 3, narratorIndex: 4 } });
    expect(tx.message.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: "failed", leaseExpiresAt: null },
    { status: "pending", leaseExpiresAt: new Date(0) },
  ])("$status 或过期 lease 可原子接管且不重复玩家消息", async (state) => {
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
    expect(tx.message.create).toHaveBeenCalledTimes(1);
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
