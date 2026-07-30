import { describe, expect, it, vi } from "vitest";
import type { GenesisMaterialSnapshot } from "@/lib/materials/types";
import { runDeterministicPreflight } from "./preflight";

function materialSnapshot(): GenesisMaterialSnapshot {
  return {
    schemaVersion: 1,
    estimatedChars: 2048,
    items: [
      {
        selection: {
          materialCardId: "card-locked",
          materialVersionId: "version-locked",
          mode: "locked",
          fullLock: false,
          dependencyDecisions: {},
          abilityOwner: null,
          priority: 0,
          compressed: false,
        },
        card: {
          id: "card-locked",
          kind: "major_god",
          name: "灰烬女神",
          summary: "守护熄灭恒星的余烬",
          sourceWorldName: "旧日星海",
          sourceKind: "deck",
          sourceRef: "major-god-ash",
        },
        version: {
          id: "version-locked",
          version: 3,
          name: "灰烬女神 v3",
          schemaVersion: 1,
          dependencies: [],
          content: {
            schemaVersion: 1,
            origin: "deck",
            kind: "major_god",
            card: { ref: "major-god-ash", name: "灰烬女神", domain: "余烬" },
          },
        },
      },
      {
        selection: {
          materialCardId: "card-inherit",
          materialVersionId: "version-inherit",
          mode: "inherit",
          fullLock: false,
          dependencyDecisions: {},
          abilityOwner: null,
          priority: 1,
          compressed: false,
        },
        card: {
          id: "card-inherit",
          kind: "race",
          name: "潮痕族",
          summary: "以潮汐记忆传承历史",
          sourceWorldName: "旧日星海",
          sourceKind: "deck",
          sourceRef: "race-tide",
        },
        version: {
          id: "version-inherit",
          version: 2,
          name: "潮痕族 v2",
          schemaVersion: 1,
          dependencies: [],
          content: {
            schemaVersion: 1,
            origin: "deck",
            kind: "race",
            card: { ref: "race-tide", name: "潮痕族", summary: "以潮汐记忆传承历史" },
          },
        },
      },
      {
        selection: {
          materialCardId: "card-remix",
          materialVersionId: "version-remix",
          mode: "remix",
          fullLock: false,
          dependencyDecisions: {},
          abilityOwner: null,
          priority: 2,
          compressed: false,
        },
        card: {
          id: "card-remix",
          kind: "style",
          name: "青铜史诗",
          summary: "沉重、克制的青铜时代叙事",
          sourceWorldName: "旧日星海",
          sourceKind: "edited",
          sourceRef: "style-bronze",
        },
        version: {
          id: "version-remix",
          version: 1,
          name: "青铜史诗 v1",
          schemaVersion: 1,
          dependencies: [],
          content: {
            schemaVersion: 1,
            origin: "edited",
            kind: "style",
            card: { ref: "style-bronze", tone: "沉重、克制" },
          },
        },
      },
    ],
  };
}

describe("deterministic genesis v2 preflight", () => {
  it("returns byte-stable manifests and hashes for identical snapshots", () => {
    const input = {
      mode: "pantheon" as const,
      decree: "群星已经熄灭。凡人必须争夺最后的恒星火种！\n\n不要让死者无代价复生。",
      lorebook: {
        entries: {
          "2": { uid: 2, key: ["火种"], content: "恒星火种只能被凡人携带。" },
          "1": { uid: 1, key: ["死亡"], content: "死者复生必须献出同等寿命。" },
        },
      },
      materialSelection: materialSnapshot(),
    };

    const first = runDeterministicPreflight(input);
    const second = runDeterministicPreflight(structuredClone(input));

    expect(second).toEqual(first);
    expect(first.preflightHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.structuralManifest.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sourceObligationManifest.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("creates stable paragraph and punctuation source obligations without dropping hard prose", () => {
    const result = runDeterministicPreflight({
      mode: "creator",
      decree: "第一纪元必须由凡人开启。第二纪元，诸神只能旁观！\r\n\r\n禁止时间倒流？可以留下失落王朝的遗迹。",
      lorebook: null,
      materialSelection: null,
    });

    const decree = result.sourceObligationManifest.obligations.filter((item) => item.sourceType === "decree");
    expect(decree.map((item) => item.sourcePointer)).toEqual([
      "decree:/paragraphs/0/sentences/0",
      "decree:/paragraphs/0/sentences/1",
      "decree:/paragraphs/1/sentences/0",
      "decree:/paragraphs/1/sentences/1",
    ]);
    expect(decree.map((item) => item.sourceText)).toEqual([
      "第一纪元必须由凡人开启。",
      "第二纪元，诸神只能旁观！",
      "禁止时间倒流？",
      "可以留下失落王朝的遗迹。",
    ]);
    expect(decree.every((item) => item.strength === "semantic" && item.criticality === "core_required")).toBe(true);
    expect(decree[2]?.polarity).toBe("forbid");
  });

  it("preserves locked/fullLock as exact, inherit as semantic, and keeps source refs in bound slots", () => {
    const snapshot = materialSnapshot();
    snapshot.items[1]!.selection.fullLock = true;
    const result = runDeterministicPreflight({
      mode: "pantheon",
      decree: "守住余烬。",
      lorebook: null,
      materialSelection: snapshot,
    });

    const byVersion = new Map(result.sourceObligationManifest.obligations
      .filter((item) => item.sourceType === "material")
      .map((item) => [item.sourcePointer, item]));
    expect(byVersion.get("material:/versions/version-locked/content")).toMatchObject({
      strength: "exact",
      criticality: "core_required",
      verificationMode: "canonical_json_exact",
    });
    expect(byVersion.get("material:/versions/version-inherit/content")).toMatchObject({
      strength: "exact",
      criticality: "core_required",
      verificationMode: "canonical_json_exact",
    });
    expect(byVersion.get("material:/versions/version-remix/content")).toMatchObject({
      strength: "inspirational",
      criticality: "core_preferred",
    });

    const locked = result.structuralManifest.slots.find((slot) => slot.materialVersionId === "version-locked");
    const inherited = result.structuralManifest.slots.find((slot) => slot.materialVersionId === "version-inherit");
    expect(locked).toMatchObject({ canonicalRef: "major-god-ash", binding: "locked" });
    expect(inherited).toMatchObject({ canonicalRef: "race-tide", binding: "full_lock" });
  });

  it("keeps an ordinary inherit binding semantic while preserving its source ref", () => {
    const result = runDeterministicPreflight({
      mode: "pantheon",
      decree: "守住潮痕族的记忆传统。",
      lorebook: null,
      materialSelection: materialSnapshot(),
    });

    const obligation = result.sourceObligationManifest.obligations.find(
      (item) => item.sourcePointer === "material:/versions/version-inherit/content",
    );
    const slot = result.structuralManifest.slots.find((item) => item.materialVersionId === "version-inherit");
    expect(obligation).toMatchObject({
      strength: "semantic",
      criticality: "core_required",
      verificationMode: "semantic_core",
    });
    expect(slot).toMatchObject({ canonicalRef: "race-tide", sourceRef: "race-tide", binding: "inherit" });
  });

  it("uses no clock or random source and always creates a bounded five-call budget", () => {
    const now = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("clock forbidden"); });
    const random = vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("random forbidden"); });
    try {
      const result = runDeterministicPreflight({
        mode: "pantheon",
        decree: "建立一个海洋吞没大陆、众神争夺潮汐权柄的世界。",
        lorebook: null,
        materialSelection: materialSnapshot(),
      });
      expect(result.budgetPlan).toMatchObject({ maxCalls: 5, taskClass: "genesis_shadow", priority: "lowest" });
      expect(result.budgetPlan.maxInputTokens).toBeGreaterThan(0);
      expect(result.budgetPlan.maxInputTokens).toBeLessThanOrEqual(50_000);
      expect(result.budgetPlan.maxOutputTokens).toBeGreaterThan(0);
      expect(result.budgetPlan.maxOutputTokens).toBeLessThanOrEqual(32_000);
      expect(result.complexityPlan.kind).toMatch(/^(standard|extended)$/);
    } finally {
      now.mockRestore();
      random.mockRestore();
    }
  });
});
