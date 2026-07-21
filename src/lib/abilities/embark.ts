import type { WorldDeck } from "@/lib/cards/schemas";
import {
  type AbilityOwnershipInput,
  type AbilityValidationTx,
  validateAbilityOwnership,
} from "./validator";

type AbilityDeck = WorldDeck;

type AbilityCreateData = {
  timelineId: string;
  entityId: string | null;
  godId: string | null;
  sourceAbilityId: string | null;
  name: string;
  kind: string;
  effect: string;
  trigger: string;
  cost: string;
  limitations: string;
  mastery: string;
  state: string;
  visibility: string;
  rumorText: string | null;
  bloodlineJustification: string | null;
  lockedFields: string[];
  materialRef: string | null;
};

export interface MaterializeDeckAbilitiesTx extends AbilityValidationTx {
  ability: AbilityValidationTx["ability"] & {
    create(args: { data: AbilityCreateData }): Promise<{ id: string }>;
  };
  entityMembership: {
    create(args: {
      data: {
        characterId: string;
        factionId: string;
        role: string;
        isPrimary: boolean;
      };
    }): Promise<unknown>;
  };
}

export interface DeckEmbarkIds {
  raceByRef: Map<string, string>;
  factionByRef: Map<string, string>;
  characterByRef: Map<string, string>;
  godByRef: Map<string, string>;
  abilityByRef: Map<string, string>;
}

type DeckAbility = AbilityDeck["races"][number]["abilities"][number];
type DerivedInnate = AbilityDeck["majorCharacters"][number]["racialOverrides"][number];

function requireId(ids: ReadonlyMap<string, string>, ref: string, label: string): string {
  const id = ids.get(ref);
  if (id === undefined) {
    throw new Error(`无法解析${label}引用 "${ref}"`);
  }
  return id;
}

function abilityData(
  timelineId: string,
  ability: DeckAbility | DerivedInnate,
  owner: Pick<AbilityCreateData, "entityId" | "godId" | "sourceAbilityId">,
  bloodlineJustification: string | null = null,
): AbilityCreateData {
  return {
    timelineId,
    ...owner,
    name: ability.name,
    kind: ability.kind,
    effect: ability.effect,
    trigger: ability.trigger,
    cost: ability.cost,
    limitations: ability.limitations,
    mastery: ability.mastery,
    state: ability.state,
    visibility: ability.visibility,
    rumorText: ability.rumorText,
    bloodlineJustification,
    lockedFields: ability.lockedFields,
    materialRef: ability.ref,
  };
}

async function createValidatedAbility(
  tx: MaterializeDeckAbilitiesTx,
  data: AbilityCreateData,
  ref?: string,
): Promise<string> {
  const ownership: AbilityOwnershipInput = {
    id: `embark:${ref ?? data.name}`,
    timelineId: data.timelineId,
    entityId: data.entityId,
    godId: data.godId,
    sourceAbilityId: data.sourceAbilityId,
    kind: data.kind as AbilityOwnershipInput["kind"],
    bloodlineJustification: data.bloodlineJustification,
  };
  await validateAbilityOwnership(tx, ownership);
  const created = await tx.ability.create({ data });
  return created.id;
}

/**
 * Persists the reference-bearing portions of a WorldDeck after the embark route
 * has created its owners. Every cross-card reference is resolved to an ID within
 * the caller's transaction; a missing reference deliberately throws to roll it
 * back as one unit.
 */
export async function materializeDeckAbilities(
  tx: MaterializeDeckAbilitiesTx,
  timelineId: string,
  deck: AbilityDeck,
  ids: DeckEmbarkIds,
): Promise<void> {
  // 1. 种族模板能力必须先写入，以便后续人物传承可以引用真实 ID。
  for (const race of deck.races) {
    const entityId = requireId(ids.raceByRef, race.ref, "种族");
    for (const ability of race.abilities) {
      const id = await createValidatedAbility(
        tx,
        abilityData(timelineId, ability, { entityId, godId: null, sourceAbilityId: null }),
        ability.ref,
      );
      ids.abilityByRef.set(ability.ref, id);
    }
  }

  // 2. 当前模式实际存在的诸神神权。
  const gods = deck.mode === "pantheon"
    ? [deck.playerGod, ...deck.majorGods]
    : deck.majorGods;
  for (const god of gods) {
    const godId = requireId(ids.godByRef, god.ref, "神明");
    for (const ability of god.abilities) {
      const id = await createValidatedAbility(
        tx,
        abilityData(timelineId, ability, { entityId: null, godId, sourceAbilityId: null }),
        ability.ref,
      );
      ids.abilityByRef.set(ability.ref, id);
    }
  }

  // 3. 人物个人能力。
  for (const character of deck.majorCharacters) {
    const entityId = requireId(ids.characterByRef, character.ref, "人物");
    for (const ability of character.abilities) {
      const id = await createValidatedAbility(
        tx,
        abilityData(timelineId, ability, { entityId, godId: null, sourceAbilityId: null }),
        ability.ref,
      );
      ids.abilityByRef.set(ability.ref, id);
    }
  }

  // 4. 人物传承掌握与先天覆写。传承项沿用种族模板描述，只改变归属与来源。
  for (const character of deck.majorCharacters) {
    const entityId = requireId(ids.characterByRef, character.ref, "人物");
    for (const learned of character.learnedTraditionRefs) {
      const sourceAbilityId = requireId(ids.abilityByRef, learned.sourceAbilityRef, "能力");
      const source = deck.races
        .flatMap((race) => race.abilities)
        .find((ability) => ability.ref === learned.sourceAbilityRef);
      if (source === undefined) {
        throw new Error(`无法解析能力模板引用 "${learned.sourceAbilityRef}"`);
      }
      await createValidatedAbility(
        tx,
        { ...abilityData(timelineId, source, { entityId, godId: null, sourceAbilityId }), materialRef: null },
      );
    }

    for (const override of character.racialOverrides) {
      const sourceAbilityId = requireId(ids.abilityByRef, override.sourceAbilityRef, "能力");
      const id = await createValidatedAbility(
        tx,
        abilityData(
          timelineId,
          override,
          { entityId, godId: null, sourceAbilityId },
          override.bloodlineJustification,
        ),
        override.ref,
      );
      ids.abilityByRef.set(override.ref, id);
    }
  }

  // 5. 人物—势力成员关系。
  for (const character of deck.majorCharacters) {
    const characterId = requireId(ids.characterByRef, character.ref, "人物");
    for (const membership of character.factionMemberships) {
      const factionId = requireId(ids.factionByRef, membership.factionRef, "势力");
      await tx.entityMembership.create({
        data: {
          characterId,
          factionId,
          role: membership.role,
          isPrimary: membership.isPrimary,
        },
      });
    }
  }
}
