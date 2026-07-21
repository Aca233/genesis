import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("./gateway", () => ({ complete: mocks.complete }));

import { completeStructured } from "./structured";

describe("completeStructured attempts", () => {
  it("maxAttempts=1 时结构错误也只调用模型一次", async () => {
    mocks.complete.mockResolvedValue('{"wrong":true}');

    await expect(completeStructured("backstage", {
      task: "extract",
      system: "system",
      user: "user",
      schema: z.object({ ok: z.boolean() }),
      maxAttempts: 1,
    })).rejects.toThrow("1 次尝试");

    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
  it("将单次传输限制透传到模型网关", async () => {
    mocks.complete.mockResolvedValue('{"ok":true}');

    await completeStructured("backstage", {
      task: "settlement",
      system: "system",
      user: "user",
      schema: z.object({ ok: z.boolean() }),
      maxAttempts: 1,
      transportMaxAttempts: 1,
      allowTransportFallback: false,
    });

    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.complete).toHaveBeenCalledWith(
      "backstage",
      expect.objectContaining({ task: "settlement" }),
      { maxAttempts: 1, allowFallback: false },
    );
  });

});
