import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  complete: vi.fn(),
  settingsFindUnique: vi.fn(),
  llmCallCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    settings: { findUnique: mocks.settingsFindUnique },
    llmCall: { create: mocks.llmCallCreate },
  },
}));
vi.mock("@/lib/crypto", () => ({ decryptSecret: () => "secret" }));
vi.mock("./adapters", () => ({
  adapters: {
    "openai-compatible": {
      stream: mocks.stream,
      complete: mocks.complete,
    },
  },
}));

import { complete, stream } from "./gateway";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settingsFindUnique.mockResolvedValue({
    narrativeSlot: {
      provider: "openai-compatible",
      baseUrl: "https://models.test/v1",
      model: "test-model",
      apiKeyEncrypted: "encrypted",
    },
    backstageSlot: null,
  });
  mocks.llmCallCreate.mockResolvedValue({});
});

describe("prompt cache call logging", () => {
  it("persists normalized usage and cache transport metadata", async () => {
    mocks.stream.mockImplementation(async function* () {
      yield { type: "text", text: "answer" };
      yield {
        type: "usage",
        usage: {
          inputTokens: 12000,
          outputTokens: 500,
          cacheReadTokens: 8000,
          cacheWriteTokens: null,
        },
        cacheRequested: true,
        cacheFallback: false,
      };
      yield { type: "done" };
    });

    await expect(complete("narrative", {
      task: "narrative",
      messages: [{ role: "user", content: "continue" }],
    }, { maxAttempts: 1, allowFallback: false })).resolves.toBe("answer");

    expect(mocks.llmCallCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      provider: "openai-compatible",
      model: "test-model",
      inputTokens: 12000,
      outputTokens: 500,
      cacheReadTokens: 8000,
      cacheWriteTokens: null,
      cacheRequested: true,
      cacheFallback: false,
    }) });
  });

  it("intercepts usage chunks from direct streams", async () => {
    mocks.stream.mockImplementation(async function* () {
      yield { type: "text", text: "answer" };
      yield {
        type: "usage",
        usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null },
        cacheRequested: false,
        cacheFallback: true,
      };
      yield { type: "done" };
    });
    const chunks = [];
    for await (const chunk of stream("narrative", {
      task: "narrative",
      messages: [{ role: "user", content: "continue" }],
    })) chunks.push(chunk);
    expect(chunks).toEqual([{ type: "text", text: "answer" }, { type: "done" }]);
    expect(mocks.llmCallCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      inputTokens: null,
      cacheReadTokens: null,
      cacheFallback: true,
    }) });
  });
});

describe("complete transport attempts", () => {
  it("可将一次模型调用限制为一次上游请求且禁止非流式回落", async () => {
    mocks.stream.mockImplementation(async function* () {
      throw new Error("fetch failed");
    });
    mocks.complete.mockResolvedValue("fallback response");

    await expect(complete("backstage", {
      task: "settlement",
      messages: [{ role: "user", content: "settle" }],
    }, {
      maxAttempts: 1,
      allowFallback: false,
    })).rejects.toThrow("fetch failed");

    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
