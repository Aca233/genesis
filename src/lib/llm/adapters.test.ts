import { afterEach, describe, expect, it, vi } from "vitest";
import { adapters } from "./adapters";

const slot = {
  provider: "openai-compatible" as const,
  baseUrl: "https://models.test/v1",
  model: "test-model",
};
const req = {
  task: "narrative" as const,
  messages: [{ role: "user" as const, content: "hello" }],
};

afterEach(() => vi.unstubAllGlobals());

describe("provider adapter cancellation", () => {
  it("将 AbortSignal 传入上游 fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("data: [DONE]\n\n", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();

    const chunks = [];
    for await (const chunk of adapters["openai-compatible"].stream(
      slot,
      req,
      "key",
      { signal: abort.signal },
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toContainEqual({ type: "done" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://models.test/v1/chat/completions",
      expect.objectContaining({ signal: abort.signal }),
    );
  });
});
