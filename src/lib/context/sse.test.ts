import { describe, expect, it, vi } from "vitest";

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
    const onDone = vi.fn().mockResolvedValue({ messageId: "message-1" });

    const output = await events(narratorSSE({ messages: [], onDone }));
    const streamed = output
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join("");

    expect(streamed).toBe(full);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({
      prose: streamed,
      meta: { suggestions: [], chapterBreakHint: false },
    }));
  });

  it("不会因正文中的 inline/早期 META marker 提前抑制内容", async () => {
    mocks.stream.mockImplementation(async function* () {
      yield { type: "text", text: "正文 <<<ME" };
      yield { type: "text", text: "TA 仍是正文\n下一段" };
      yield { type: "done" };
    });
    const onDone = vi.fn().mockResolvedValue({ messageId: "message-1" });

    const output = await events(narratorSSE({ messages: [], onDone }));

    expect(output.filter((event) => event.type === "text").map((event) => event.text).join(""))
      .toBe("正文 <<<META 仍是正文\n下一段");
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({
      prose: "正文 <<<META 仍是正文\n下一段",
      meta: { suggestions: [], chapterBreakHint: false },
      signal: expect.any(AbortSignal),
    }));
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
    const onDone = vi.fn().mockResolvedValue({ messageId: "message-1" });
    const response = narratorSSE({ messages: [], onDone });
    const reader = response.body!.getReader();

    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(upstreamSignal?.aborted).toBe(true);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("narratorCompletionSSE", () => {
  it("以 SSE done 重放已有 messageId 与 meta", async () => {
    const completion = {
      messageId: "message-existing",
      meta: { suggestions: ["继续"], chapterBreakHint: false },
    };

    const output = await events(narratorCompletionSSE({ completion }));

    expect(output).toEqual([{ type: "done", ...completion }]);
  });
});

it.each([
  `<<<META\n{"suggestions":[],"chapterBreakHint":false}\nMETA>>>`,
  `正文\r\n<<<META\r\n{"suggestions":[],"chapterBreakHint":false}\r\nMETA>>>`,
])("SSE 从不发送合法 META framing：%s", async (full) => {
  mocks.stream.mockImplementation(async function* () {
    yield { type: "text", text: full.slice(0, 7) };
    yield { type: "text", text: full.slice(7) };
  });
  const output = await events(narratorSSE({
    messages: [],
    onDone: vi.fn().mockResolvedValue({ messageId: "message-1" }),
  }));
  const text = output.filter((event) => event.type === "text").map((event) => event.text).join("");
  expect(text).not.toContain("<<<META");
  expect(text).not.toContain("META>>>");
});
