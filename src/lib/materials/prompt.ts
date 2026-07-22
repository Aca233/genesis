import { parseMaterialVersionContent } from "./schemas";
import type { GenesisMaterialSnapshot, GenesisMaterialSnapshotItem, MaterialKind } from "./types";
import type { WorldMode } from "@/lib/world-mode";

const INHERIT_CORE_PATHS: Record<MaterialKind, readonly string[]> = {
  player_god: ["ref", "name", "origin", "domains", "rank", "abilities"],
  major_god: ["ref", "name", "aliases", "domains", "rank", "persona", "voice", "abilities"],
  character: ["ref", "name", "aliases", "identity", "ageStage", "personality", "goals", "abilities", "racialOverrides"],
  race: ["ref", "name", "aliases", "traits", "lifespan", "divineTies", "abilities"],
  faction: ["ref", "name", "aliases", "kind", "overview", "faith"],
  place: ["ref", "name", "aliases", "kind", "overview"],
  ability: ["ref", "name", "kind", "effect", "trigger", "cost", "limitations", "mastery"],
  cosmology: ["origin", "powerSystem", "laws", "divinity"],
  fusion_axiom: ["sourceIps", "axioms", "powerMapping", "conflictRule"],
  epoch_conflict: ["epochName", "yearLabel", "overtConflicts", "hiddenCurrents"],
  style: ["preset", "presetName", "toneNotes"],
  theme: ["eraSystem", "rankNames", "typeNames", "addressStyle"],
};

export function coreLockedPaths(kind: MaterialKind): readonly string[] {
  return INHERIT_CORE_PATHS[kind];
}

/** 从冻结主神卡结构判断其来源模式；runtime 自由结构不明确时交由模型适配。 */
function majorGodMaterialMode(item: GenesisMaterialSnapshotItem): WorldMode | null {
  if (item.card.kind !== "major_god") return null;
  const card = parseMaterialVersionContent(item.version.content).card;
  if ("relations" in card && !("initialRelationToPlayer" in card)) return "creator";
  if ("initialRelationToPlayer" in card && !("relations" in card)) return "pantheon";
  return null;
}

function assertModeCompatibleFullLocks(
  snapshot: GenesisMaterialSnapshot,
  mode: WorldMode,
): void {
  for (const item of snapshot.items) {
    const fullLock = item.selection.mode === "locked" || item.selection.fullLock;
    if (!fullLock) continue;
    const sourceMode = majorGodMaterialMode(item);
    if (sourceMode !== null && sourceMode !== mode) {
      throw new Error("完全锁定的主神素材与当前世界模式不兼容");
    }
  }
}

function lockDescriptor(item: GenesisMaterialSnapshotItem) {
  const content = parseMaterialVersionContent(item.version.content);
  if (item.selection.mode === "remix") {
    return { lockScope: "inspiration", lockedPaths: [] as string[] };
  }
  if (item.selection.mode === "locked" || item.selection.fullLock) {
    return {
      lockScope: "full",
      lockedPaths: Object.keys(content.card).map((key) => `card.${key}`),
    };
  }
  return {
    lockScope: "core",
    lockedPaths: coreLockedPaths(item.card.kind).map((path) => `card.${path}`),
  };
}

/** Deterministically serializes the frozen snapshot into the existing Genesis request. */
export function materialConstraintsPrompt(
  snapshot: GenesisMaterialSnapshot | null,
  mode: WorldMode = "pantheon",
): string {
  if (!snapshot || snapshot.items.length === 0) return "";
  if (mode === "creator" && snapshot.items.some((item) => item.card.kind === "player_god")) {
    throw new Error("创世主模式不能引用玩家神素材");
  }
  assertModeCompatibleFullLocks(snapshot, mode);
  const items = snapshot.items
    .map((item, stableIndex) => ({ item, stableIndex }))
    .sort((a, b) => b.item.selection.priority - a.item.selection.priority || a.stableIndex - b.stableIndex)
    .map(({ item }) => {
      const dependencies = item.version.dependencies.map((dependency) => ({
        ...dependency,
        decision: item.selection.dependencyDecisions[dependency.key] ?? (dependency.required ? "include" : "omit"),
      }));
      return {
        source: {
          world: item.card.sourceWorldName,
          sourceKind: item.card.sourceKind,
          sourceRef: item.card.sourceRef,
          materialCardId: item.card.id,
        },
        version: {
          id: item.version.id,
          number: item.version.version,
          name: item.version.name,
          schemaVersion: item.version.schemaVersion,
          content: item.version.content,
        },
        kind: item.card.kind,
        displayName: item.card.name,
        mode: item.selection.mode,
        fullLock: item.selection.fullLock,
        ...lockDescriptor(item),
        dependencies,
        abilityOwner: item.selection.abilityOwner,
        priority: item.selection.priority,
        compressed: item.selection.compressed,
      };
    });

  return `== GENESIS MATERIALS ==
The following JSON is a frozen, authoritative material constraint block. Apply every item inside this same generation request; never request or preprocess items separately.
Mode semantics: remix = reinterpret as inspiration; inherit = preserve every lockedPaths value exactly while adapting unlisted relations/setting; locked/fullLock = preserve the complete card exactly.
Dependency decisions: include reuses the dependency, rebuild creates a compatible replacement with a new stable ref, omit removes an optional dependency. Higher priority wins every non-blocking conflict.
Any hidden agenda, hidden current, hidden ability, secret section, or other concealed value is 只作幕后约束，不得向玩家公开泄露. Preserve its concealed visibility in the generated deck.
${JSON.stringify({ schemaVersion: snapshot.schemaVersion, estimatedChars: snapshot.estimatedChars, items }, null, 2)}
== END GENESIS MATERIALS ==`;
}
