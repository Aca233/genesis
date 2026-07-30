import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  complete: vi.fn(),
  settingsFindUnique: vi.fn(),
  llmCallCreate: vi.fn(),
  acquirePermit: vi.fn(),
  settlePermit: vi.fn(),
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
vi.mock("./permits", () => ({
  acquireLlmPermit: mocks.acquirePermit,
  settleLlmPermit: mocks.settlePermit,
}));

import { complete, isTransientLlmError, stream } from "./gateway";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stream.mockReset();
  mocks.complete.mockReset();
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
  mocks.acquirePermit.mockImplementation((input) => Promise.resolve({
    attemptId: `attempt-${input.physicalAttemptIndex}`,
    slotNo: 1,
    slotEpoch: input.physicalAttemptIndex + 1,
    logicalCallId: input.logicalCallId,
    physicalAttemptIndex: input.physicalAttemptIndex,
    requestId: `request-${input.physicalAttemptIndex}`,
    budgetScope: input.req.owner?.budgetScope ?? "primary",
    reservedInputTokens: input.reservedInputTokens,
    reservedOutputTokens: input.req.maxTokens ?? 4096,
  }));
  mocks.settlePermit.mockResolvedValue(undefined);
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
      userId: "test-user",
      messages: [{ role: "user", content: "continue" }],
    }, { maxAttempts: 1, allowFallback: false })).resolves.toBe("answer");

    // 归因:请求 userId 落库,且槽位解析按同一用户读取 Settings
    expect(mocks.settingsFindUnique).toHaveBeenCalledWith({ where: { userId: "test-user" } });
    expect(mocks.llmCallCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      provider: "openai-compatible",
      model: "test-model",
      userId: "test-user",
      inputTokens: 12000,
      outputTokens: 500,
      cacheReadTokens: 8000,
      cacheWriteTokens: null,
      cacheRequested: true,
      cacheFallback: false,
      // 非缓存请求也带 runId/轮号;前缀 hash 仅在缓存计划启用时非空
      stablePrefixHash: null,
      agentRunId: expect.any(String),
      agentCallIndex: 0,
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
      userId: "test-user",
      messages: [{ role: "user", content: "continue" }],
    })) chunks.push(chunk);
    expect(chunks).toEqual([{ type: "text", text: "answer" }, { type: "done" }]);
    expect(mocks.llmCallCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      inputTokens: null,
      cacheReadTokens: null,
      cacheFallback: true,
    }) });
  });

  it("shares one run id across continuation rounds with ascending round indexes", async () => {
    const roundUsage = (truncated: boolean) => ({
      type: "usage",
      usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: null, cacheWriteTokens: null },
      cacheRequested: true,
      cacheFallback: false,
      truncated,
    });
    mocks.stream
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: '{"name":"星' };
        yield roundUsage(true);
        yield { type: "done" };
      })
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: '海"}' };
        yield roundUsage(false);
        yield { type: "done" };
      });

    await complete("narrative", {
      task: "genesis",
      userId: "test-user",
      cache: { namespace: "genesis:test" },
      failOnTruncation: true,
      messages: [
        { role: "system", content: "G".repeat(4100), cacheScope: "global" },
        { role: "user", content: "create" },
      ],
    }, { maxAttempts: 1, allowFallback: false });

    expect(mocks.llmCallCreate).toHaveBeenCalledTimes(2);
    const first = mocks.llmCallCreate.mock.calls[0][0].data;
    const second = mocks.llmCallCreate.mock.calls[1][0].data;
    expect(first.stablePrefixHash).toMatch(/^genesis:[a-f0-9]{64}$/);
    // 续写轮的稳定前缀未变:同 hash,可据此检测「应命中却未命中」
    expect(second.stablePrefixHash).toBe(first.stablePrefixHash);
    expect(second.agentRunId).toBe(first.agentRunId);
    expect(first.agentCallIndex).toBe(0);
    expect(second.agentCallIndex).toBe(1);
    expect(first).toEqual(expect.objectContaining({
      transportOutcome: "truncated",
      terminalEvidence: "stream_eof",
      stableErrorCode: "OUTPUT_TRUNCATED",
    }));
    expect(second).toEqual(expect.objectContaining({
      transportOutcome: "success",
      terminalEvidence: "stream_eof",
      stableErrorCode: null,
    }));
  });

  it("records cache intent and run metadata on failed rounds", async () => {
    mocks.stream.mockImplementation(async function* () {
      throw new Error("HTTP 401: bad key");
    });

    await expect(complete("narrative", {
      task: "genesis",
      userId: "test-user",
      cache: { namespace: "genesis:test" },
      messages: [
        { role: "system", content: "G".repeat(4100), cacheScope: "global" },
        { role: "user", content: "create" },
      ],
    }, { maxAttempts: 1, allowFallback: false })).rejects.toThrow("HTTP 401");

    expect(mocks.llmCallCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      ok: false,
      cacheRequested: true,
      stablePrefixHash: expect.stringMatching(/^genesis:/),
      agentRunId: expect.any(String),
      agentCallIndex: 0,
    }) });
  });
});

describe("complete transport attempts", () => {
  it("空流有 EOF 终局证据，可由任务级调度恢复", () => {
    expect(isTransientLlmError(new Error("流式响应为空"))).toBe(true);
  });

  it("将中转站 SSE 空闲超时 499 视为可重试的断流", () => {
    expect(isTransientLlmError(new Error(
      "HTTP 499: stream disconnected before completion: idle timeout waiting for SSE",
    ))).toBe(true);
  });

  it("可将一次模型调用限制为一次上游请求且禁止非流式回落", async () => {
    mocks.stream.mockImplementation(async function* () {
      throw new Error("fetch failed");
    });
    mocks.complete.mockResolvedValue("fallback response");

    await expect(complete("backstage", {
      task: "settlement",
      userId: "test-user",
      messages: [{ role: "user", content: "settle" }],
    }, {
      maxAttempts: 1,
      allowFallback: false,
    })).rejects.toThrow("fetch failed");

    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("终局未知的断流失败关闭端点且不启动第二个物理请求", async () => {
    mocks.stream.mockImplementationOnce(async function* () {
      throw new Error("terminated");
    });

    await expect(complete("narrative", {
      task: "genesis",
      userId: "test-user",
      messages: [{ role: "user", content: "create" }],
    }, { maxAttempts: 2, allowFallback: true })).rejects.toThrow("terminated");

    expect(mocks.llmCallCreate).toHaveBeenCalledTimes(1);
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.complete).not.toHaveBeenCalled();
    const rows = mocks.llmCallCreate.mock.calls.map(([call]) => call.data);
    expect(rows[0]).toEqual(expect.objectContaining({
      ok: false,
      transportOutcome: "network_terminated",
      terminalEvidence: "terminal_unknown",
      stableErrorCode: "NETWORK_TERMINATED",
    }));
    expect(mocks.settlePermit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ terminalEvidence: "terminal_unknown" }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("认证错误明确终局但不触发非流式回落", async () => {
    mocks.stream.mockImplementationOnce(async function* () {
      throw new Error("HTTP 401: bad key");
    });
    mocks.complete.mockResolvedValueOnce({
      text: "fallback response",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: null, cacheWriteTokens: null },
      cacheRequested: false,
      cacheFallback: false,
      truncated: false,
    });

    await expect(complete("narrative", {
      task: "genesis",
      userId: "test-user",
      messages: [{ role: "user", content: "create" }],
    }, { maxAttempts: 1, allowFallback: true })).rejects.toThrow("HTTP 401");

    expect(mocks.llmCallCreate).toHaveBeenCalledTimes(1);
    expect(mocks.complete).not.toHaveBeenCalled();
    const rows = mocks.llmCallCreate.mock.calls.map(([call]) => call.data);
    expect(rows[0]).toEqual(expect.objectContaining({
      ok: false,
      transportOutcome: "http_error",
      stableErrorCode: "AUTH_ERROR",
    }));
  });

  it("504 页面不会原样落库或返回给调用方", async () => {
    const raw = 'HTTP 504: <html><head><title>504 Gateway Time-out</title></head><body>openresty</body></html>';
    mocks.stream.mockImplementationOnce(async function* () {
      throw new Error(raw);
    });

    let rejected: Error | undefined;
    try {
      await complete("narrative", {
        task: "genesis",
        userId: "test-user",
        messages: [{ role: "user", content: "create" }],
      }, { maxAttempts: 1, allowFallback: false });
    } catch (error) {
      rejected = error as Error;
    }

    expect(rejected?.message).toBe("上游模型服务超时（HTTP 504）");
    const row = mocks.llmCallCreate.mock.calls[0][0].data;
    expect(row).toEqual(expect.objectContaining({
      transportOutcome: "upstream_timeout",
      terminalEvidence: "terminal_unknown",
      stableErrorCode: "UPSTREAM_TIMEOUT",
      error: "上游模型服务超时（HTTP 504）",
    }));
    expect(JSON.stringify(row)).not.toContain("<html>");
    expect(JSON.stringify(row)).not.toContain("openresty");
  });

  it("输入超过硬上限时不发起 Provider 请求", async () => {
    await expect(complete("narrative", {
      task: "genesis",
      userId: "test-user",
      messages: [{ role: "user", content: "界".repeat(200) }],
    }, { maxInputBytes: 100, maxAttempts: 1, allowFallback: false }))
      .rejects.toMatchObject({ code: "INPUT_LIMIT_EXCEEDED" });

    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.llmCallCreate).not.toHaveBeenCalled();
  });

  it("流式输出超过硬上限时中止且不交付越界块", async () => {
    mocks.stream.mockImplementationOnce(async function* () {
      yield { type: "text", text: "星".repeat(40) };
      yield { type: "done" };
    });

    await expect(complete("narrative", {
      task: "genesis",
      userId: "test-user",
      messages: [{ role: "user", content: "create" }],
    }, { maxOutputBytes: 60, maxAttempts: 1, allowFallback: false }))
      .rejects.toMatchObject({ code: "OUTPUT_LIMIT_EXCEEDED", observedBytes: 120, limitBytes: 60 });

    expect(mocks.llmCallCreate).toHaveBeenCalledTimes(1);
    expect(mocks.llmCallCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({
      ok: false,
      transportOutcome: "truncated",
      stableErrorCode: "OUTPUT_LIMIT_EXCEEDED",
      error: "模型输出超过安全上限（已读取 120 字节，上限 60 字节）",
    }));
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.stream.mock.calls[0][3].signal.aborted).toBe(true);
  });

  it("输出上限跨续写轮累计而不是每轮重置", async () => {
    const usage = (truncated: boolean) => ({
      type: "usage",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: null, cacheWriteTokens: null },
      cacheRequested: false,
      cacheFallback: false,
      truncated,
    });
    mocks.stream
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: '{"x":"星星星' };
        yield usage(true);
        yield { type: "done" };
      })
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: '月月月"}' };
        yield usage(false);
        yield { type: "done" };
      });

    await expect(complete("narrative", {
      task: "genesis",
      userId: "test-user",
      failOnTruncation: true,
      messages: [{ role: "user", content: "create" }],
    }, { maxOutputBytes: 24, maxAttempts: 1, allowFallback: false }))
      .rejects.toMatchObject({ code: "OUTPUT_LIMIT_EXCEEDED", limitBytes: 24 });

    expect(mocks.stream).toHaveBeenCalledTimes(2);
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
      userId: "test-user",
      failOnTruncation: true,
      messages: [{ role: "user", content: "create" }],
    }, { maxAttempts: 1, allowFallback: false })).resolves.toBe('{"name":"星海纪元"}');

    expect(mocks.stream).toHaveBeenCalledTimes(2);
    const continuation = mocks.stream.mock.calls[1][1];
    expect(continuation.messages.at(-2)).toMatchObject({ role: "assistant", content: '{"name":"星海' });
    expect(continuation.messages.at(-1).content).toContain("从被截断的确切位置继续");
    // F2: 稳定前缀末尾(原请求末条 user + 回填 assistant partial)携带内部断点标记
    expect(continuation.messages.at(-3)).toMatchObject({
      role: "user", content: "create", prefixStable: true,
    });
    expect(continuation.messages.at(-2).prefixStable).toBe(true);
    expect(continuation.messages.at(-1).prefixStable).toBeUndefined();
  });

  it("complete: 显式禁用截断续写时只发起一次物理请求", async () => {
    mocks.stream.mockImplementationOnce(async function* () {
      yield { type: "text", text: "partial prose" };
      yield usageChunk(true);
      yield { type: "done" };
    });

    await expect(complete("narrative", {
      task: "narrative",
      userId: "test-user",
      failOnTruncation: false,
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
      userId: "test-user",
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
      userId: "test-user",
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
      userId: "test-user",
      failOnTruncation: true,
      messages: [{ role: "user", content: "create" }],
    }, { maxAttempts: 1, allowFallback: false })).resolves.toBe('{"ok":true}');
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  it("stream: 终局未知时不续传", async () => {
    mocks.stream
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: '{"chapter":"上卷' };
        yield usageChunk(true);
        yield { type: "done" };
      })
      .mockImplementationOnce(async function* () {
        // 本轮在接缝缓冲尚未吐出时断线:未交付的片段应被丢弃,由下一轮重写
        yield { type: "text", text: "中卷片段" };
        throw new Error("fetch failed");
      })
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: '下卷"}' };
        yield usageChunk(false);
        yield { type: "done" };
      });

    const consume = async () => { for await (const chunk of stream("narrative", {
      task: "genesis",
      userId: "test-user",
      failOnTruncation: true,
      messages: [{ role: "user", content: "create" }],
    })) void chunk; };
    await expect(consume()).rejects.toThrow("fetch failed");
    expect(mocks.stream).toHaveBeenCalledTimes(2);
  });

  it("stream: 首字符前终局未知时不重试", async () => {
    mocks.stream
      .mockImplementationOnce(async function* () {
        throw new Error("terminated");
      })
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: "{\"ok\":true}" };
        yield usageChunk(false);
        yield { type: "done" };
      });

    const consume = async () => { for await (const chunk of stream("narrative", {
      task: "genesis",
      userId: "test-user",
      failOnTruncation: true,
      messages: [{ role: "user", content: "create" }],
    })) void chunk; };
    await expect(consume()).rejects.toThrow("terminated");
    expect(mocks.stream).toHaveBeenCalledTimes(1);
  });

  it("stream: 普通叙事在首字符前遇到 SSE 空闲超时 499 时重试", async () => {
    mocks.stream
      .mockImplementationOnce(async function* () {
        throw new Error(
          "HTTP 499: stream disconnected before completion: idle timeout waiting for SSE",
        );
      })
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: "重连成功" };
        yield usageChunk(false);
        yield { type: "done" };
      });

    let text = "";
    for await (const chunk of stream("narrative", {
      task: "narrative",
      userId: "test-user",
      messages: [{ role: "user", content: "continue" }],
    })) {
      if (chunk.type === "text") text += chunk.text;
    }

    expect(text).toBe("重连成功");
    expect(mocks.stream).toHaveBeenCalledTimes(2);
  });

  it("stream: 普通叙事在部分输出后遇到 SSE 空闲超时 499 时断点续传", async () => {
    mocks.stream
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: "第一段" };
        throw new Error(
          "HTTP 499: stream disconnected before completion: idle timeout waiting for SSE",
        );
      })
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: "第一段第二段" };
        yield usageChunk(false);
        yield { type: "done" };
      });

    let text = "";
    for await (const chunk of stream("narrative", {
      task: "narrative",
      userId: "test-user",
      messages: [{ role: "user", content: "continue" }],
    })) {
      if (chunk.type === "text") text += chunk.text;
    }

    expect(text).toBe("第一段第二段");
    expect(mocks.stream).toHaveBeenCalledTimes(2);
    expect(mocks.stream.mock.calls[1][1].messages.at(-2)).toMatchObject({
      role: "assistant",
      content: "第一段",
    });
  });

  it("stream: 上游正常结束却没有文本时在当前任务内重试", async () => {
    mocks.stream
      .mockImplementationOnce(async function* () {
        yield usageChunk(false);
        yield { type: "done" };
      })
      .mockImplementationOnce(async function* () {
        yield { type: "text", text: "{\"ok\":true}" };
        yield usageChunk(false);
        yield { type: "done" };
      });

    let text = "";
    for await (const chunk of stream("narrative", {
      task: "genesis",
      userId: "test-user",
      failOnTruncation: true,
      messages: [{ role: "user", content: "create" }],
    })) {
      if (chunk.type === "text") text += chunk.text;
    }

    expect(text).toBe("{\"ok\":true}");
    expect(mocks.stream).toHaveBeenCalledTimes(2);
    expect(mocks.llmCallCreate).toHaveBeenCalledTimes(2);
    const rows = mocks.llmCallCreate.mock.calls.map(([call]) => call.data);
    expect(rows.map((row) => row.physicalAttemptIndex)).toEqual([0, 1]);
    expect(rows[0]).toEqual(expect.objectContaining({
      ok: false,
      transportOutcome: "empty_response",
      terminalEvidence: "stream_eof",
      stableErrorCode: "EMPTY_RESPONSE",
    }));
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
        userId: "test-user",
        failOnTruncation: true,
        messages: [{ role: "user", content: "create" }],
      })) void chunk;
    };
    await expect(consume()).rejects.toThrow("输出被上游截断且续写接力");
  });
});
