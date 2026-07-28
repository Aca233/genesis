import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("material library Prisma schema", () => {
  it("defines immutable material persistence and runtime source refs", () => {
    expect(schema).toContain("model MaterialCard {");
    expect(schema).toContain("model MaterialVersion {");
    expect(schema).toMatch(/materialSelection\s+Json\?/);
    expect(schema).toMatch(/materialArchiveStatus\s+String/);
    expect(schema).toMatch(/materialRef\s+String\?/);
    expect(schema).toContain("@@unique([userId, sourceKind, sourceRef])");
    expect(schema).toContain("@@unique([cardId, version])");
  });
});
