import { describe, expect, it } from "vitest";
import { validateGenesisV2ShadowOutput } from "./validation";

const manifest = {
  schemaVersion: 1 as const,
  mode: "pantheon" as const,
  counts: {},
  manifestHash: "hash",
  slots: [
    {
      slotId: "race-1",
      category: "entity" as const,
      kind: "race",
      order: 0,
      canonicalRef: "race:tide",
      ownerSlotId: null,
      role: null,
      binding: "generated" as const,
      materialVersionId: null,
      sourceRef: null,
    },
    {
      slotId: "god-locked",
      category: "entity" as const,
      kind: "major_god",
      order: 1,
      canonicalRef: "god:locked",
      ownerSlotId: null,
      role: null,
      binding: "locked" as const,
      materialVersionId: "version-1",
      sourceRef: "god:locked",
    },
  ],
};

describe("Genesis V2 shadow hard validation", () => {
  it("拒绝未注册槽、locked 改写与 World 投影字段", () => {
    const result = validateGenesisV2ShadowOutput({
      stageId: "pantheon_domain",
      structuralManifest: manifest,
      output: {
        draftDeck: {},
        slots: { "god:locked": {}, "god:invented": {} },
      },
    });
    expect(result).toEqual({
      valid: false,
      issues: [
        "FORBIDDEN_WORLD_PROJECTION:draftDeck",
        "IMMUTABLE_SLOT_WRITE:god:locked",
        "UNREGISTERED_SLOT:god:invented",
      ],
    });
  });

  it("锁定种族能力槽不足两项事故", () => {
    expect(validateGenesisV2ShadowOutput({
      stageId: "civilizations",
      structuralManifest: manifest,
      output: { slots: { "race:tide": { abilities: { innate: {} } } } },
    })).toEqual({
      valid: false,
      issues: ["RACE_ABILITY_SLOTS_TOO_SMALL:race:tide"],
    });
  });

  it("强类型阶段输出必须精确覆盖本阶段注册 ref", () => {
    expect(validateGenesisV2ShadowOutput({
      stageId: "civilizations",
      structuralManifest: manifest,
      output: {
        mode: "pantheon",
        races: [{ ref: "race:invented", abilities: [] }],
        factions: [],
        places: [],
      },
    })).toEqual({
      valid: false,
      issues: [
        "MISSING_REGISTERED_REF:race:tide",
        "UNREGISTERED_REF:race:invented",
      ],
    });
  });
});
