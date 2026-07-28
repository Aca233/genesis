import { describe, expect, it } from "vitest";
import { compileGenesisV2PromptBundle } from "./prompt-bundle";

const commonInput = {
  engineVersion: "genesis-v2-shadow-1",
  globalContractVersion: "genesis-v2/global/v1",
  mode: "pantheon",
  normalizedDecree: "群星之下\r\n诸神守誓",
  rawUserIntentHash: "raw-intent-hash",
  manifestHash: "manifest-sha256",
  structuralManifestSummary: {
    slots: [{ canonicalRef: "god:storm", kind: "god" }],
    version: 1,
  },
  canonBrief: { conflict: "旧誓与新火", axioms: ["神力必有代价"] },
  slotBriefs: { "god:storm": { role: "守门者" } },
  obligations: [
    {
      obligationId: "obl-blueprint",
      targetStages: ["blueprint"],
      strength: "semantic",
      sourcePointer: "decree:0",
      requirement: "保留旧誓",
    },
    {
      obligationId: "obl-pantheon",
      targetStages: ["pantheon_domain"],
      strength: "exact",
      sourcePointer: "material:god:storm",
      requirement: "不得改名",
    },
    {
      obligationId: "obl-shared",
      targetStages: ["pantheon_domain", "civilizations", "eras"],
      strength: "semantic",
      sourcePointer: "lore:4",
      requirement: "旧誓影响三域",
    },
  ],
  acceptedDependencies: [{ stageId: "blueprint", artifactHash: "blueprint-accepted-hash" }],
  dynamic: {
    nodeKey: "task-1:pantheon_domain",
    attempt: 1,
    targetSlotRefs: ["god:storm"],
    issues: [],
  },
} as const;

describe("Genesis V2 Prompt Bundle compiler", () => {
  it("canonicalizes stable blocks and remains deterministic across key and set ordering", () => {
    const first = compileGenesisV2PromptBundle({
      ...commonInput,
      stageId: "pantheon_domain",
    });
    const second = compileGenesisV2PromptBundle({
      ...commonInput,
      stageId: "pantheon_domain",
      structuralManifestSummary: {
        version: 1,
        slots: [{ kind: "god", canonicalRef: "god:storm" }],
      },
      obligations: [...commonInput.obligations].reverse(),
      acceptedDependencies: [...commonInput.acceptedDependencies].reverse(),
    });

    expect(second.bytes).toBe(first.bytes);
    expect(second.hashes).toEqual(first.hashes);
    expect(first.blocks.worldCommon).toContain("群星之下\\n诸神守誓");
    expect(first.blocks.worldCommon).toContain("manifest-sha256");
  });

  it("shares bytes through world-common and first diverges at stage-wave for parallel branches", () => {
    const branches = (["pantheon_domain", "civilizations", "eras"] as const).map((stageId) =>
      compileGenesisV2PromptBundle({
        ...commonInput,
        stageId,
        dynamic: { ...commonInput.dynamic, nodeKey: `task-1:${stageId}` },
      }),
    );

    expect(new Set(branches.map(({ commonPrefixBytes }) => commonPrefixBytes)).size).toBe(1);
    expect(new Set(branches.map(({ hashes }) => hashes.commonPrefixHash)).size).toBe(1);
    expect(new Set(branches.map(({ blocks }) => blocks.globalWave))).toEqual(
      new Set([branches[0].blocks.globalWave]),
    );
    expect(new Set(branches.map(({ blocks }) => blocks.worldCommon))).toEqual(
      new Set([branches[0].blocks.worldCommon]),
    );
    expect(new Set(branches.map(({ blocks }) => blocks.stageWave)).size).toBe(3);
  });

  it("includes only obligations relevant to the current stage", () => {
    const bundle = compileGenesisV2PromptBundle({
      ...commonInput,
      stageId: "pantheon_domain",
    });

    expect(bundle.blocks.worldStage).toContain("obl-pantheon");
    expect(bundle.blocks.worldStage).toContain("obl-shared");
    expect(bundle.blocks.worldStage).not.toContain("obl-blueprint");
  });

  it("binds accepted dependency hashes and rejects missing or extra dependencies", () => {
    const bundle = compileGenesisV2PromptBundle({
      ...commonInput,
      stageId: "pantheon_domain",
    });
    expect(bundle.acceptedDependencyHashes).toEqual({
      blueprint: "blueprint-accepted-hash",
    });

    expect(() => compileGenesisV2PromptBundle({
      ...commonInput,
      stageId: "characters",
      acceptedDependencies: [],
    })).toThrowError(/Missing accepted dependency: pantheon_domain/);

    expect(() => compileGenesisV2PromptBundle({
      ...commonInput,
      stageId: "blueprint",
    })).toThrowError(/Unexpected accepted dependency: blueprint/);
  });

  it("keeps retry details in the dynamic tail without drifting the stable prefix", () => {
    const first = compileGenesisV2PromptBundle({
      ...commonInput,
      stageId: "pantheon_domain",
    });
    const retry = compileGenesisV2PromptBundle({
      ...commonInput,
      stageId: "pantheon_domain",
      dynamic: {
        ...commonInput.dynamic,
        attempt: 2,
        issues: ["MISSING_REQUIRED_SLOT:god:storm"],
      },
    });

    expect(retry.stablePrefixBytes).toBe(first.stablePrefixBytes);
    expect(retry.hashes.stablePrefixHash).toBe(first.hashes.stablePrefixHash);
    expect(retry.hashes.bundleHash).not.toBe(first.hashes.bundleHash);
    expect(retry.blocks.dynamicTail).toContain("MISSING_REQUIRED_SLOT:god:storm");
  });
});
