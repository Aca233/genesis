import { describe, expect, it } from "vitest";
import { PayloadLimitError, readUtf8Body, takeUtf8Prefix, utf8Bytes } from "./limits";

describe("genesis byte limits", () => {
  it("counts UTF-8 bytes instead of JavaScript code units", () => {
    expect(utf8Bytes("星A🌌")).toBe(8);
  });

  it("cuts only at complete Unicode code point boundaries", () => {
    expect(takeUtf8Prefix("星A🌌界", 8)).toBe("星A🌌");
    expect(takeUtf8Prefix("星A🌌界", 7)).toBe("星A");
  });

  it("stops reading a request body once the byte limit is crossed", async () => {
    const request = new Request("http://localhost", { method: "POST", body: "界".repeat(10) });
    await expect(readUtf8Body(request, 12)).rejects.toMatchObject({
      code: "INPUT_LIMIT_EXCEEDED",
      limitBytes: 12,
    } satisfies Partial<PayloadLimitError>);
  });
});
