import { describe, expect, it, vi } from "vitest";
import { emptyContinuousMeta } from "@/lib/chat/continuous-meta";

const mocks = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("@/lib/llm/gateway", () => ({ stream: mocks.stream }));

import { narratorCompletionSSE, narratorSSE } from "./sse";

async function events(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.replace(/^data: /, "")));
}

describe("narratorSSE", () => {
  it("完整但 JSON 损坏的 META 会作为正文流出并以相同正文持久化", async () => {
    const full = "正文\n<<<META\n{ broken json\nMETA>>>";
    mocks.stream.mockImplementation(async function* () {
      yield { type: "text", text: full.slice(0, 13) };
      yield { type: "text", text: full.slice(13) };
    });
    const onDone = vi.fn().mockResolvedValue({ messageId: "message-1", meta: emptyContinuousMeta(), followUp: { kind: "none" } });

    const output = await events(narratorSSE({ messages: [], userId: "test-user", onDone }));
    const streamed = output
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join("");

    expect(streamed).toBe(full);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({
      prose: streamed,
      meta: emptyContinuousMeta(),
    }));
    // 归因:narratorSSE 把 userId 转发进网关请求
    expect(mocks.stream).toHaveBeenCalledWith(
      "narrative",
      expect.objectContaining({ task: "narrative", userId: "test-user" }),
      expect.anything(),
    );
  });

  it("不会因正文中的 inline/早期 META marker 提前抑制内容", async () => {
    mocks.stream.mockImplementation(async function* () {
      yield { type: "text", text: "正文 <<<ME" };
      yield { type: "text", text: "TA 仍是正文\n下一段" };
      yield { type: "done" };
    });
    const onDone = vi.fn().mockResolvedValue({ messageId: "message-1", meta: emptyContinuousMeta(), followUp: { kind: "none" } });

    const output = await events(narratorSSE({ messages: [], userId: "test-user", onDone }));

    expect(output.filter((event) => event.type === "text").map((event) => event.text).join(""))
      .toBe("正文 <<<META 仍是正文\n下一段");
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({
      prose: "正文 <<<META 仍是正文\n下一段",
      meta: emptyContinuousMeta(),
      signal: expect.any(AbortSignal),
    }));
  });

  it("流打开期间按配置周期续租，并在完成后停止续租", async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      mocks.stream.mockImplementation(async function* () {
        yield { type: "text", text: "第一段足够长以便立即稳定流出正文内容" };
        await new Promise<void>((resolve) => { finish = resolve; });
      });
      const onHeartbeat = vi.fn().mockResolvedValue(undefined);
      const response = narratorSSE({
        messages: [],
        userId: "test-user",
        onDone: vi.fn().mockResolvedValue({ messageId: "message-1", meta: emptyContinuousMeta(), followUp: { kind: "none" } }),
        onHeartbeat,
        heartbeatMs: 100,
      });
      const reader = response.body!.getReader();
      await reader.read();

      await vi.advanceTimersByTimeAsync(250);
      expect(onHeartbeat).toHaveBeenCalledTimes(2);
      finish();
      while (!(await reader.read()).done) { /* drain */ }
      await vi.runAllTimersAsync();
      expect(onHeartbeat).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("续租失败会执行单次失败回调并关闭响应流", async () => {
    vi.useFakeTimers();
    try {
      mocks.stream.mockImplementation(async function* (_slot, _req, opts) {
        yield { type: "text", text: "第一段足够长以便立即稳定流出正文内容" };
        await new Promise<void>((resolve) => {
          opts?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      });
      let finishFailure!: () => void;
      const onFailure = vi.fn(() => new Promise<void>((resolve) => { finishFailure = resolve; }));
      const response = narratorSSE({
        messages: [],
        userId: "test-user",
        onDone: vi.fn().mockResolvedValue({ messageId: "message-1", meta: emptyContinuousMeta(), followUp: { kind: "none" } }),
        onFailure,
        onHeartbeat: vi.fn().mockRejectedValue(new Error("世界操作租约已失效")),
        heartbeatMs: 100,
      });
      const reader = response.body!.getReader();
      await reader.read();
      let ended = false;
      const ending = reader.read().then((result) => { ended = result.done; return result; });

      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(ended).toBe(false);
      finishFailure();
      await ending;
      expect(ended).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("取消响应会 abort 上游且不执行持久化回调", async () => {
    let upstreamSignal: AbortSignal | undefined;
    mocks.stream.mockImplementation(async function* (_slot, _req, opts) {
      upstreamSignal = opts?.signal;
      yield { type: "text", text: "第一段足够长以便立即流出" };
      await new Promise<void>((resolve) => {
        opts?.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      if (opts?.signal?.aborted) return;
      yield { type: "text", text: "不应到达" };
    });
    const onDone = vi.fn().mockResolvedValue({ messageId: "message-1", meta: emptyContinuousMeta(), followUp: { kind: "none" } });
    const onFailure = vi.fn().mockResolvedValue(undefined);
    const response = narratorSSE({ messages: [], userId: "test-user", onDone, onFailure });
    const reader = response.body!.getReader();

    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(upstreamSignal?.aborted).toBe(true);
    expect(onDone).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("narratorCompletionSSE", () => {
  it("以 SSE done 重放已有 messageId 与 meta", async () => {
    const completion = {
      messageId: "message-existing",
      meta: { ...emptyContinuousMeta(), suggestions: ["继续"] },
      followUp: { kind: "settlement" as const, segmentId: "segment-1" },
    };

    const output = await events(narratorCompletionSSE({ completion }));

    expect(output).toEqual([{ type: "done", ...completion }]);
  });

  it("pending 等待超过上限后发送 SSE error 并停止轮询", async () => {
    const waitForCompletion = vi.fn().mockResolvedValue(null);

    const output = await events(narratorCompletionSSE({
      waitForCompletion,
      maxWaitMs: 1,
      pollIntervalMs: 1,
    }));

    expect(output).toEqual([{ type: "error", message: "叙事生成仍在处理中，请重试" }]);
    expect(waitForCompletion.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

it.each([
  `<<<META\n{"suggestions":[],"operation":"continue","immediate_changes":[],"significant_event":false,"settlement_reasons":[]}\nMETA>>>`,
  `正文\r\n<<<META\r\n{"suggestions":[],"operation":"continue","immediate_changes":[],"significant_event":false,"settlement_reasons":[]}\r\nMETA>>>`,
  `正文\n<<<META {"suggestions":[],"operation":"continue","temporal_state":{"era":"时空崩毁之纪元","time":"两百年重置中"},"immediate_changes":[],"world_actions":[],"activity_entries":[{"actorId":"god-dragon","action":"death","targetIds":[],"consequence":"龙神死亡。"}],"important_event_mutation":null,"significant_event":true,"settlement_reasons":["important_death"],"revealed_event_ids":[],"ability_reveals":[]} META>>>`,
])("SSE 从不发送合法 META framing：%s", async (full) => {
  mocks.stream.mockImplementation(async function* () {
    yield { type: "text", text: full.slice(0, 7) };
    yield { type: "text", text: full.slice(7) };
  });
  const output = await events(narratorSSE({
    messages: [],
    userId: "test-user",
    onDone: vi.fn().mockResolvedValue({ messageId: "message-1", meta: emptyContinuousMeta(), followUp: { kind: "none" } }),
  }));
  const text = output.filter((event) => event.type === "text").map((event) => event.text).join("");
  expect(text).not.toContain("<<<META");
  expect(text).not.toContain("META>>>");
});
