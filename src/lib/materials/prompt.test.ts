import { describe, expect, it } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { extractDeckMaterials } from "./extract-deck";
import { materialConstraintsPrompt } from "./prompt";
import type { GenesisMaterialSnapshot } from "./types";

function snapshot(): GenesisMaterialSnapshot {
  const material = extractDeckMaterials(completeDeck()).find((item) => item.kind === "ability")!;
  return {
    schemaVersion: 1,
    estimatedChars: 1024,
    items: [{
      selection: {
        materialCardId: "card-1",
        materialVersionId: "version-1",
        mode: "inherit",
        fullLock: false,
        dependencyDecisions: { [material.dependencies[0]!.key]: "rebuild" },
        abilityOwner: { mode: "model", allowCreateOwner: true },
        priority: 3,
        compressed: false,
      },
      card: {
        id: "card-1", kind: material.kind, name: material.name, summary: material.summary,
        sourceWorldName: "旧世界", sourceKind: material.sourceKind, sourceRef: material.sourceRef,
      },
      version: {
        id: "version-1", version: 2, name: "剧情版", content: material.content,
        dependencies: material.dependencies, schemaVersion: 1,
      },
    }],
  };
}

describe("materialConstraintsPrompt", () => {
  it("serializes immutable versions, modes, dependency and owner decisions", () => {
    const text = materialConstraintsPrompt(snapshot());
    expect(text).toContain("== GENESIS MATERIALS ==");
    expect(text).toContain("旧世界");
    expect(text).toContain('"mode": "inherit"');
    expect(text).toContain('"lockScope": "core"');
    expect(text).toContain('"decision": "rebuild"');
    expect(text).toContain('"allowCreateOwner": true');
    expect(text).toContain('"priority": 3');
    expect(text).toContain("只作幕后约束，不得向玩家公开泄露");
  });

  it("sorts higher priority first and returns empty text without materials", () => {
    const base = snapshot();
    const low = structuredClone(base.items[0]!);
    low.card.id = "low";
    low.card.name = "低优先";
    low.selection.materialCardId = "low";
    low.selection.priority = 1;
    const high = structuredClone(base.items[0]!);
    high.card.id = "high";
    high.card.name = "高优先";
    high.selection.materialCardId = "high";
    high.selection.priority = 9;
    expect(materialConstraintsPrompt({ ...base, items: [low, high] }).indexOf("高优先"))
      .toBeLessThan(materialConstraintsPrompt({ ...base, items: [low, high] }).indexOf("低优先"));
    expect(materialConstraintsPrompt(null)).toBe("");
  });
  it("Creator 在构建生成约束前明确拒绝玩家神素材", () => {
    const base = snapshot();
    const playerGod = extractDeckMaterials(completeDeck()).find((item) => item.kind === "player_god")!;
    const item = structuredClone(base.items[0]!);
    item.card.kind = "player_god";
    item.card.name = playerGod.name;
    item.version.content = playerGod.content;
    expect(() => materialConstraintsPrompt({ ...base, items: [item] }, "creator"))
      .toThrow("创世主模式不能引用玩家神素材");
  });
});
