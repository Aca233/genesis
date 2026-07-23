import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("事件和动态归属 timeline 并由 timeline 级联删除", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");

  expect(schema).toContain("model WorldEvent");
  expect(schema).toContain("model WorldActivity");
  expect(schema).toMatch(/worldEvents\s+WorldEvent\[\]/);
  expect(schema).toMatch(/worldActivities\s+WorldActivity\[\]/);
  expect(schema).toMatch(
    /timeline\s+Timeline\s+@relation\(fields: \[timelineId\], references: \[id\], onDelete: Cascade\)/,
  );
  expect(schema).toMatch(
    /event\s+WorldEvent\?\s+@relation\(fields: \[eventId\], references: \[id\], onDelete: SetNull\)/,
  );
});

it("migration 为数组、稳定主键和外键建立完整 PostgreSQL 约束", () => {
  const migration = readFileSync(
    "prisma/migrations/20260723120000_world_activity/migration.sql",
    "utf8",
  );

  expect(migration).toContain('CREATE TABLE "world_events"');
  expect(migration).toContain('CREATE TABLE "world_activities"');
  expect(migration).toContain('"participant_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]');
  expect(migration).toContain('"target_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]');
  expect(migration).toContain('"subject_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]');
  expect(migration).toContain('ON DELETE CASCADE ON UPDATE CASCADE');
  expect(migration).toContain('ON DELETE SET NULL ON UPDATE CASCADE');
});
