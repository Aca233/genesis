import { describe, expect, it } from "vitest";
import {
  GENESIS_V2_STAGE_REGISTRY,
  GENESIS_V2_STAGE_WAVES,
  getGenesisV2StageContract,
} from "./stage-registry";

describe("Genesis V2 fixed stage registry", () => {
  it("defines exactly the five planned model calls", () => {
    expect(GENESIS_V2_STAGE_REGISTRY.map(({ id }) => id)).toEqual([
      "blueprint",
      "pantheon_domain",
      "civilizations",
      "eras",
      "characters",
    ]);
    expect(GENESIS_V2_STAGE_REGISTRY).toHaveLength(5);
  });

  it("keeps the three core branches parallel and joins them at characters", () => {
    expect(GENESIS_V2_STAGE_WAVES).toEqual([
      ["blueprint"],
      ["pantheon_domain", "civilizations", "eras"],
      ["characters"],
    ]);

    for (const stageId of ["pantheon_domain", "civilizations", "eras"] as const) {
      expect(getGenesisV2StageContract(stageId).dependencies).toEqual(["blueprint"]);
      expect(getGenesisV2StageContract(stageId).wave).toBe("core_parallel");
    }

    expect(getGenesisV2StageContract("characters").dependencies).toEqual([
      "pantheon_domain",
      "civilizations",
      "eras",
    ]);
  });

  it("exposes immutable contracts and rejects dynamic stage insertion", () => {
    expect(Object.isFrozen(GENESIS_V2_STAGE_REGISTRY)).toBe(true);
    expect(Object.isFrozen(getGenesisV2StageContract("blueprint"))).toBe(true);
    expect(Object.isFrozen(getGenesisV2StageContract("blueprint").dependencies)).toBe(true);

    expect(() => getGenesisV2StageContract("rogue" as never)).toThrowError(
      /Unknown Genesis V2 stage: rogue/,
    );
  });

  it("freezes each stage ownership and output schema contract", () => {
    for (const contract of GENESIS_V2_STAGE_REGISTRY) {
      expect(contract.contractVersion).toMatch(/^genesis-v2\/.+\/v1$/);
      expect(contract.outputSchemaId).toMatch(/^genesis-v2\/.+\/output-v1$/);
      expect(contract.ownedFields.length).toBeGreaterThan(0);
      expect(contract.allowedTargetKinds.length).toBeGreaterThan(0);
      expect(Object.isFrozen(contract.ownedFields)).toBe(true);
      expect(Object.isFrozen(contract.allowedTargetKinds)).toBe(true);
    }
  });

  it("assigns current WorldDeck top-level fields to exactly one stage", () => {
    const owners = new Map<string, string>();
    for (const contract of GENESIS_V2_STAGE_REGISTRY) {
      for (const field of contract.ownedFields) {
        expect(owners.has(field), `${field} is owned twice`).toBe(false);
        owners.set(field, contract.id);
      }
    }

    expect(Object.fromEntries(owners)).toMatchObject({
      worldName: "blueprint",
      cosmology: "blueprint",
      playerGod: "pantheon_domain",
      majorGods: "pantheon_domain",
      factions: "civilizations",
      races: "civilizations",
      places: "civilizations",
      epochConflict: "eras",
      canonEvents: "eras",
      majorCharacters: "characters",
      relationsAtAnchor: "characters",
    });
  });
});
