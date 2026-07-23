import { describe, expect, it, vi } from "vitest";
import {
  createEmbarkFlow,
  openingGenerationId,
} from "./embark-flow";

describe("createEmbarkFlow", () => {
  it("物化完成后立即生成 opening", async () => {
    const calls: string[] = [];
    const flow = createEmbarkFlow({
      worldId: "world-1",
      materialize: async () => {
        calls.push("embark");
        return { chapterId: "segment-1" };
      },
      generateOpening: async () => {
        calls.push("opening");
      },
    });

    await flow.start();

    expect(calls).toEqual(["embark", "opening"]);
    expect(openingGenerationId("world-1")).toBe("opening:world-1");
  });

  it("opening 失败后重试不再次物化", async () => {
    const materialize = vi.fn().mockResolvedValue({ chapterId: "segment-1" });
    const generateOpening = vi.fn()
      .mockRejectedValueOnce(new Error("开篇未成"))
      .mockResolvedValueOnce(undefined);
    const flow = createEmbarkFlow({
      worldId: "world-1",
      materialize,
      generateOpening,
    });

    await expect(flow.start()).rejects.toThrow("开篇未成");
    await expect(flow.retryOpening()).resolves.toMatchObject({
      chapterId: "segment-1",
    });

    expect(materialize).toHaveBeenCalledTimes(1);
    expect(generateOpening).toHaveBeenCalledTimes(2);
  });
});

