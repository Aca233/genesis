import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schemaPath = resolve(process.cwd(), "prisma/schema.prisma");

describe("Ability persisted source uniqueness", () => {
  it("declares a database unique constraint for entityId + sourceAbilityId", () => {
    const schema = readFileSync(schemaPath, "utf8");
    expect(schema).toMatch(/@@unique\(\[entityId, sourceAbilityId\]\)/);
  });
});

it("migration creates a nullable-safe unique index for non-null entity source pairs", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "prisma/migrations/20260720111517_ability_source_uniqueness/migration.sql"),
    "utf8",
  );
  expect(migration).toMatch(
    /CREATE UNIQUE INDEX "abilities_entity_id_source_ability_id_key" ON "abilities"\("entity_id", "source_ability_id"\)/,
  );
});
