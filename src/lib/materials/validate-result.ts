import type { WorldDeck } from "@/lib/cards/schemas";
import { parseMaterialVersionContent, type MaterialVersionContent } from "./schemas";
import { validateAbilityOwner } from "./selection";
import { coreLockedPaths } from "./prompt";
import type { GenesisMaterialSnapshot, GenesisMaterialSnapshotItem, MaterialDependency, MaterialKind } from "./types";

export type MaterialConstraintIssue = {
  code: string;
  materialVersionId: string;
  path: string;
  message: string;
};

type JsonRecord = Record<string, unknown>;
type LocatedCard = { card: JsonRecord; ownerKind?: MaterialKind; ownerRef?: string };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function abilitiesOf(deck: WorldDeck): LocatedCard[] {
  return [
    ...deck.playerGod.abilities.map((card) => ({ card: card as unknown as JsonRecord, ownerKind: "player_god" as const, ownerRef: deck.playerGod.ref })),
    ...deck.majorGods.flatMap((god) => god.abilities.map((card) => ({ card: card as unknown as JsonRecord, ownerKind: "major_god" as const, ownerRef: god.ref }))),
    ...deck.races.flatMap((race) => race.abilities.map((card) => ({ card: card as unknown as JsonRecord, ownerKind: "race" as const, ownerRef: race.ref }))),
    ...deck.majorCharacters.flatMap((character) => [...character.abilities, ...character.racialOverrides].map((card) => ({ card: card as unknown as JsonRecord, ownerKind: "character" as const, ownerRef: character.ref }))),
  ];
}

function sourceRef(content: MaterialVersionContent): string | undefined {
  const card: unknown = content.card;
  return isRecord(card) && typeof card.ref === "string" ? card.ref : undefined;
}

function locateDeckCard(deck: WorldDeck, kind: MaterialKind, content: MaterialVersionContent): LocatedCard | undefined {
  const ref = sourceRef(content);
  switch (kind) {
    case "player_god": return ref === deck.playerGod.ref ? { card: deck.playerGod as unknown as JsonRecord } : undefined;
    case "major_god": return deck.majorGods.find((card) => card.ref === ref) ? { card: deck.majorGods.find((card) => card.ref === ref)! as unknown as JsonRecord } : undefined;
    case "character": return deck.majorCharacters.find((card) => card.ref === ref) ? { card: deck.majorCharacters.find((card) => card.ref === ref)! as unknown as JsonRecord } : undefined;
    case "race": return deck.races.find((card) => card.ref === ref) ? { card: deck.races.find((card) => card.ref === ref)! as unknown as JsonRecord } : undefined;
    case "faction": return deck.factions.find((card) => card.ref === ref) ? { card: deck.factions.find((card) => card.ref === ref)! as unknown as JsonRecord } : undefined;
    case "place": return deck.places.find((card) => card.ref === ref) ? { card: deck.places.find((card) => card.ref === ref)! as unknown as JsonRecord } : undefined;
    case "ability": return abilitiesOf(deck).find(({ card }) => card.ref === ref);
    case "cosmology": return { card: deck.cosmology as unknown as JsonRecord };
    case "fusion_axiom": return deck.fusionAxiom ? { card: deck.fusionAxiom as unknown as JsonRecord } : undefined;
    case "epoch_conflict": return { card: deck.epochConflict as unknown as JsonRecord };
    case "style": return { card: deck.style as unknown as JsonRecord };
    case "theme": return { card: deck.theme as unknown as JsonRecord };
  }
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffPaths(expected: unknown, actual: unknown, path: string): string[] {
  if (equal(expected, actual)) return [];
  if (Array.isArray(expected) || Array.isArray(actual) || !isRecord(expected) || !isRecord(actual)) return [path];
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  return [...keys].flatMap((key) => diffPaths(expected[key], actual[key], `${path}.${key}`));
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, value);
}

function issue(item: GenesisMaterialSnapshotItem, code: string, path: string, message: string): MaterialConstraintIssue {
  return { code, materialVersionId: item.version.id, path, message };
}

function dependencyStillUses(card: JsonRecord, dependency: MaterialDependency): string | null {
  switch (dependency.relation) {
    case "race": return card.raceRef === dependency.targetRef ? "card.raceRef" : null;
    case "faction": return Array.isArray(card.factionMemberships) && card.factionMemberships.some((entry) => isRecord(entry) && entry.factionRef === dependency.targetRef) ? "card.factionMemberships" : null;
    case "ability_source": {
      if (card.sourceAbilityRef === dependency.targetRef) return "card.sourceAbilityRef";
      return Array.isArray(card.learnedTraditionRefs) && card.learnedTraditionRefs.some((entry) => isRecord(entry) && entry.sourceAbilityRef === dependency.targetRef) ? "card.learnedTraditionRefs" : null;
    }
    case "card_ref": return Array.isArray(card.keyCharacterRefs) && card.keyCharacterRefs.some((entry) => isRecord(entry) && entry.ref === dependency.targetRef) ? "card.keyCharacterRefs" : null;
    case "owner": return null;
  }
}

function hasConflictingRemixCards(items: GenesisMaterialSnapshotItem[], kind: MaterialKind): boolean {
  const cards = items
    .filter((item) => item.card.kind === kind && item.selection.mode === "remix")
    .map((item) => parseMaterialVersionContent(item.version.content).card);
  return cards.length > 1 && cards.some((card) => !equal(card, cards[0]));
}

export function validateMaterializedDeck(
  deck: WorldDeck,
  snapshot: GenesisMaterialSnapshot | null,
): MaterialConstraintIssue[] {
  if (!snapshot || snapshot.items.length === 0) return [];
  const issues: MaterialConstraintIssue[] = [];
  const versionItems = new Map(snapshot.items.map((item) => [item.version.id, item]));

  for (const item of snapshot.items) {
    const content = parseMaterialVersionContent(item.version.content);
    const located = locateDeckCard(deck, item.card.kind, content);
    if (!located) {
      if (item.selection.mode !== "remix") issues.push(issue(item, "material_missing", "card", `未找到复用素材“${item.card.name}”`));
      continue;
    }

    const fullLock = item.selection.mode === "locked" || item.selection.fullLock;
    if (fullLock) {
      for (const path of diffPaths(content.card, located.card, "card")) {
        issues.push(issue(item, "locked_mismatch", path, `完全锁定字段发生变化：${path}`));
      }
    } else if (item.selection.mode === "inherit") {
      for (const corePath of coreLockedPaths(item.card.kind)) {
        if (!equal(getPath(content.card, corePath), getPath(located.card, corePath))) {
          issues.push(issue(item, "inherit_mismatch", `card.${corePath}`, `继承核心字段发生变化：card.${corePath}`));
        }
      }
    }

    if (item.card.kind === "ability") {
      const abilityKind = typeof located.card.kind === "string" ? located.card.kind : "";
      const ownerTarget = item.selection.abilityOwner;
      if (!located.ownerKind || !validateAbilityOwner(abilityKind, located.ownerKind)) {
        issues.push(issue(item, "ability_owner_kind", "abilityOwner", "独立能力的实际拥有者类型不合法"));
      }
      if (ownerTarget?.mode === "selected") {
        const selectedOwner = versionItems.get(ownerTarget.materialVersionId);
        const selectedContent = selectedOwner ? parseMaterialVersionContent(selectedOwner.version.content) : null;
        const expectedRef = selectedContent ? sourceRef(selectedContent) : undefined;
        if (!selectedOwner || !validateAbilityOwner(abilityKind, selectedOwner.card.kind) || (expectedRef && located.ownerRef !== expectedRef)) {
          issues.push(issue(item, "ability_owner_kind", "abilityOwner", "能力未分配给指定且合法的拥有者"));
        }
      }
      const contentCard: unknown = content.card;
      const sourceVisibility = isRecord(contentCard) ? contentCard.visibility : undefined;
      if (sourceVisibility === "hidden" && located.card.visibility === "known") {
        issues.push(issue(item, "hidden_visibility", "card.visibility", "隐藏能力不得变为公开已知"));
      }
    }

    for (const dependency of item.version.dependencies) {
      if (item.selection.dependencyDecisions[dependency.key] !== "rebuild") continue;
      if (dependency.relation === "owner" && item.card.kind === "ability") {
        if (located.ownerRef === dependency.targetRef) issues.push(issue(item, "dependency_not_rebuilt", "abilityOwner", "重建拥有者仍使用旧引用"));
        continue;
      }
      const retainedPath = dependencyStillUses(located.card, dependency);
      if (retainedPath) issues.push(issue(item, "dependency_not_rebuilt", retainedPath, `重建依赖仍保留旧引用 ${dependency.targetRef}`));
    }
  }

  if (!deck.fusionAxiom && (hasConflictingRemixCards(snapshot.items, "cosmology") || hasConflictingRemixCards(snapshot.items, "fusion_axiom"))) {
    const anchor = snapshot.items.find((item) => item.card.kind === "cosmology" || item.card.kind === "fusion_axiom")!;
    issues.push(issue(anchor, "fusion_axiom_required", "fusionAxiom", "多个冲突的融合改写规则需要生成非空 fusionAxiom"));
  }
  return issues;
}

export function assertMaterializedDeck(deck: WorldDeck, snapshot: GenesisMaterialSnapshot | null): void {
  const issues = validateMaterializedDeck(deck, snapshot);
  if (issues.length) {
    const error = new Error(`素材继承约束验证失败：${JSON.stringify(issues, null, 2)}`);
    Object.assign(error, { issues });
    throw error;
  }
}
