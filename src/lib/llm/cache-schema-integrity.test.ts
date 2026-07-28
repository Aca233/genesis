import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("LlmCall prompt cache schema", () => {
  it("persists nullable usage and transport flags", () => {
    const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schema).toMatch(/^\s*inputTokens\s+Int\?/m);
    expect(schema).toMatch(/^\s*cacheReadTokens\s+Int\?/m);
    expect(schema).toMatch(/^\s*cacheWriteTokens\s+Int\?/m);
    expect(schema).toMatch(/^\s*cacheRequested\s+Boolean/m);
    expect(schema).toMatch(/^\s*cacheFallback\s+Boolean/m);
    expect(schema).toMatch(/^\s*cacheCapability\s+String\?/m);
    expect(schema).toMatch(/^\s*logicalCallId\s+String\?/m);
    expect(schema).toMatch(/^\s*physicalAttemptIndex\s+Int\?/m);
    expect(schema).toMatch(/^\s*transportOutcome\s+String\?/m);
    expect(schema).toMatch(/^\s*terminalEvidence\s+String\?/m);
    expect(schema).toMatch(/^\s*stableErrorCode\s+String\?/m);
  });
});
