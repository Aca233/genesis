import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(process.cwd(), "prisma/migrations/20260726143000_world_icon_system/migration.sql"),
  "utf8",
);

describe("world icon persistence", () => {
  it("stores a world theme and timeline-scoped unique assignments", () => {
    expect(schema).toMatch(/iconTheme\s+Json\?/);
    expect(schema).toContain("model IconAssignment {");
    expect(schema).toContain("iconAssignments IconAssignment[]");
    expect(schema).toContain("@@unique([timelineId, subjectType, subjectId])");
  });

  it("migrates theme and cascading assignment rows", () => {
    expect(migration).toContain("ADD COLUMN \"icon_theme\" JSONB");
    expect(migration).toContain("CREATE TABLE \"icon_assignments\"");
    expect(migration).toContain("ON DELETE CASCADE");
  });
});
