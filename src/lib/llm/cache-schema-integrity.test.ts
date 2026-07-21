import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("LlmCall prompt cache schema", () => {
  it("persists nullable usage and transport flags", () => {
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schema).toContain("inputTokens      Int?");
    expect(schema).toContain("cacheReadTokens  Int?");
    expect(schema).toContain("cacheWriteTokens Int?");
    expect(schema).toContain("cacheRequested   Boolean");
    expect(schema).toContain("cacheFallback    Boolean");
  });
});
