import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("@/lib/llm/gateway", () => ({ stream: mocks.stream }));

import { narratorSSE } from "./sse";

async function events(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.replace(/^data: /, "")));
}

describe("narratorSSE", () => {
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
