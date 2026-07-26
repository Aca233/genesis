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

describe("输出上限续写接力", () => {
  const usageChunk = (truncated: boolean) => ({
    type: "usage",
    usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: null, cacheWriteTokens: null },
    cacheRequested: false,
    cacheFallback: false,
    truncated,
  });

  it("complete: 截断结果自动续写并拼接,接缝重叠被去重", async () => {
    mocks.stream
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: '{"name":"星海' };
        yield usageChunk(true);
        yield { type: "done" };
      })
      .mockImplementationOnce(async function* () {
        // 续写开头重复了上一轮结尾的「星海」,应被裁掉
        yield { type: "text", text: '星海纪元"}' };
        yield usageChunk(false);
        yield { type: "done" };
      });

    await expect(complete("narrative", {
      task: "genesis",
      failOnTruncation: true,
      messages: [{ role: "user", content: "create" }],
    }, { maxAttempts: 1, allowFallback: false })).resolves.toBe('{"name":"星海纪元"}');

    expect(mocks.stream).toHaveBeenCalledTimes(2);
    const continuation = mocks.stream.mock.calls[1][1];
    expect(continuation.messages.at(-2)).toMatchObject({ role: "assistant", content: '{"name":"星海' });
    expect(continuation.messages.at(-1).content).toContain("从被截断的确切位置继续");
  });

  it("complete: 未要求完整输出时截断按原样返回,不追加请求", async () => {
    mocks.stream.mockImplementationOnce(async function* () {
      yield { type: "text", text: "partial prose" };
      yield usageChunk(true);
      yield { type: "done" };
    });

    await expect(complete("narrative", {
      task: "narrative",
      messages: [{ role: "user", content: "tell" }],
    }, { maxAttempts: 1, allowFallback: false })).resolves.toBe("partial prose");
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  it("stream: 截断后续写轮的文本继续吐出,拼接结果连续", async () => {
    mocks.stream
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: "第一段" };
        yield usageChunk(true);
        yield { type: "done" };
      })
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: "第二段" };
        yield usageChunk(false);
        yield { type: "done" };
      });

    let text = "";
    for await (const chunk of stream("narrative", {
      task: "genesis",
      failOnTruncation: true,
      messages: [{ role: "user", content: "create" }],
    })) {
      if (chunk.type === "text") text += chunk.text;
    }
    expect(text).toBe("第一段第二段");
    expect(mocks.stream).toHaveBeenCalledTimes(2);
  });

  it("complete: 上游谎报正常结束但 JSON 括号未闭合时,启发式判定截断并续写", async () => {
    mocks.stream
      .mockImplementationOnce(async function* () {
        // finish_reason 谎报 stop(truncated: false),但 JSON 明显被斩断
        yield { type: "text", text: '{"deck":{"name":"残卷' };
        yield usageChunk(false);
        yield { type: "done" };
      })
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: '世界"}}' };
        yield usageChunk(false);
        yield { type: "done" };
      });

    await expect(complete("narrative", {
      task: "genesis",
      failOnTruncation: true,
      messages: [{ role: "user", content: "create" }],
    }, { maxAttempts: 1, allowFallback: false })).resolves.toBe('{"deck":{"name":"残卷世界"}}');
    expect(mocks.stream).toHaveBeenCalledTimes(2);
  });

  it("complete: 完整 JSON 不触发启发式续写", async () => {
    mocks.stream.mockImplementationOnce(async function* () {
      yield { type: "text", text: '{"ok":true}' };
      yield usageChunk(false);
      yield { type: "done" };
    });

    await expect(complete("narrative", {
      task: "genesis",
      failOnTruncation: true,
      messages: [{ role: "user", content: "create" }],
    }, { maxAttempts: 1, allowFallback: false })).resolves.toBe('{"ok":true}');
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  it("stream: 连续截断超过轮数上限时报可操作错误", async () => {
    mocks.stream.mockImplementation(async function* () {
      yield { type: "text", text: "片段" };
      yield usageChunk(true);
      yield { type: "done" };
    });

    const consume = async () => {
      for await (const chunk of stream("narrative", {
        task: "genesis",
        failOnTruncation: true,
        messages: [{ role: "user", content: "create" }],
      })) void chunk;
    };
    await expect(consume()).rejects.toThrow("输出被上游截断且续写接力");
  });
});
