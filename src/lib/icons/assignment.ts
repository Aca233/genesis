import { matchIconConcept } from "./resolver";
import { ICON_CATALOG_BY_TOKEN } from "./catalog";
import type { IconAssignmentValue } from "./types";

export type IconAssignmentSubjectType = "entity" | "god" | "ability" | "event";

export type IconAssignmentRecord = IconAssignmentValue & {
  id: string;
  timelineId: string;
  subjectType: string;
  subjectId: string;
};

export type IconAssignmentTx = {
  iconAssignment: {
    findUnique(args: {
      where: {
        timelineId_subjectType_subjectId: {
          timelineId: string;
          subjectType: string;
          subjectId: string;
        };
      };
    }): Promise<IconAssignmentRecord | null>;
    create(args: {
      data: Omit<IconAssignmentRecord, "id">;
    }): Promise<IconAssignmentRecord>;
    update(args: {
      where: { id: string };
      data: IconAssignmentValue;
    }): Promise<IconAssignmentRecord>;
  };
};

export type IconSubjectOwnershipClient = {
  timeline: {
    findFirst(args: {
      where: { id: string; worldId: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  entity: SubjectOwnershipDelegate;
  god: SubjectOwnershipDelegate;
  ability: SubjectOwnershipDelegate;
  worldEvent: SubjectOwnershipDelegate;
};

type SubjectOwnershipDelegate = {
  findFirst(args: {
    where: { id: string; timelineId: string };
    select: { id: true };
  }): Promise<{ id: string } | null>;
};

const SUBJECT_DELEGATE = {
  entity: "entity",
  god: "god",
  ability: "ability",
  event: "worldEvent",
} as const;

export async function assertIconSubjectOwnership(
  client: IconSubjectOwnershipClient,
  input: {
    worldId: string;
    timelineId: string;
    subjectType: IconAssignmentSubjectType;
    subjectId: string;
  },
): Promise<void> {
  const timeline = await client.timeline.findFirst({
    where: { id: input.timelineId, worldId: input.worldId },
    select: { id: true },
  });
  if (!timeline) throw new Error("现实不属于当前世界");
  const delegate = client[SUBJECT_DELEGATE[input.subjectType]];
  const subject = await delegate.findFirst({
    where: { id: input.subjectId, timelineId: input.timelineId },
    select: { id: true },
  });
  if (!subject) throw new Error("图标对象不属于当前现实");
}

export async function assignAutomaticIcon(
  tx: IconAssignmentTx,
  input: {
    worldId: string;
    timelineId: string;
    subjectType: IconAssignmentSubjectType;
    subjectId: string;
    iconConcept?: string;
  },
): Promise<IconAssignmentRecord> {
  const where = {
    timelineId_subjectType_subjectId: {
      timelineId: input.timelineId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    },
  };
  const existing = await tx.iconAssignment.findUnique({ where });
  if (existing?.playerLocked) return existing;

  const value: IconAssignmentValue = {
    token: matchIconConcept(
      input.iconConcept,
      input.subjectType,
      input.worldId,
      input.subjectId,
    ),
    source: input.iconConcept ? "generated" : "derived",
    playerLocked: false,
  };
  if (existing) {
    if (
      existing.token === value.token
      && existing.source === value.source
      && existing.playerLocked === value.playerLocked
    ) return existing;
    return tx.iconAssignment.update({ where: { id: existing.id }, data: value });
  }
  return tx.iconAssignment.create({
    data: {
      timelineId: input.timelineId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      ...value,
    },
  });
}

export async function setPlayerIconAssignment(
  tx: IconAssignmentTx,
  input: {
    timelineId: string;
    subjectType: IconAssignmentSubjectType;
    subjectId: string;
    token: string;
  },
): Promise<IconAssignmentRecord> {
  if (!ICON_CATALOG_BY_TOKEN.has(input.token)) {
    throw new Error("图标令牌不存在");
  }
  const where = {
    timelineId_subjectType_subjectId: {
      timelineId: input.timelineId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    },
  };
  const existing = await tx.iconAssignment.findUnique({ where });
  const value: IconAssignmentValue = {
    token: input.token,
    source: "player",
    playerLocked: true,
  };
  return existing
    ? tx.iconAssignment.update({ where: { id: existing.id }, data: value })
    : tx.iconAssignment.create({
        data: {
          timelineId: input.timelineId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          ...value,
        },
      });
}

export async function restoreAutomaticIcon(
  tx: IconAssignmentTx,
  input: {
    worldId: string;
    timelineId: string;
    subjectType: IconAssignmentSubjectType;
    subjectId: string;
    iconConcept?: string;
  },
): Promise<IconAssignmentRecord> {
  const where = {
    timelineId_subjectType_subjectId: {
      timelineId: input.timelineId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    },
  };
  const existing = await tx.iconAssignment.findUnique({ where });
  if (!existing) return assignAutomaticIcon(tx, input);
  return tx.iconAssignment.update({
    where: { id: existing.id },
    data: {
      token: matchIconConcept(
        input.iconConcept,
        input.subjectType,
        input.worldId,
        input.subjectId,
      ),
      source: input.iconConcept ? "generated" : "derived",
      playerLocked: false,
    },
  });
}

type CloneMaps = {
  entityIds: ReadonlyMap<string, string>;
  godIds: ReadonlyMap<string, string>;
  abilityIds: ReadonlyMap<string, string>;
  eventIds: ReadonlyMap<string, string>;
};

const SUBJECT_MAP = {
  entity: "entityIds",
  god: "godIds",
  ability: "abilityIds",
  event: "eventIds",
} as const;

export function remapIconAssignmentSubject(
  subjectType: string,
  subjectId: string,
  maps: CloneMaps,
): string | null {
  const mapName = SUBJECT_MAP[subjectType as keyof typeof SUBJECT_MAP];
  return mapName ? maps[mapName].get(subjectId) ?? null : null;
}
