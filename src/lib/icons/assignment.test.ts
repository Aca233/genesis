import { describe, expect, it, vi } from "vitest";
import {
  assignAutomaticIcon,
  assertIconSubjectOwnership,
  restoreAutomaticIcon,
  setPlayerIconAssignment,
  remapIconAssignmentSubject,
  type IconAssignmentRecord,
  type IconAssignmentTx,
} from "./assignment";

const maps = {
  entityIds: new Map([["entity-old", "entity-new"]]),
  godIds: new Map([["god-old", "god-new"]]),
  abilityIds: new Map([["ability-old", "ability-new"]]),
  eventIds: new Map([["event-old", "event-new"]]),
};

describe("icon assignment reality remapping", () => {
  it.each([
    ["entity", "entity-old", "entity-new"],
    ["god", "god-old", "god-new"],
    ["ability", "ability-old", "ability-new"],
    ["event", "event-old", "event-new"],
  ] as const)("remaps %s subjects", (subjectType, source, expected) => {
    expect(remapIconAssignmentSubject(subjectType, source, maps)).toBe(expected);
  });

  it("skips unmapped and illegal subjects instead of leaking source reality ids", () => {
    expect(remapIconAssignmentSubject("entity", "missing", maps)).toBeNull();
    expect(remapIconAssignmentSubject("timeline", "entity-old", maps)).toBeNull();
  });
});

function assignmentFixture(existing?: IconAssignmentRecord) {
  let record = existing ?? null;
  const tx: IconAssignmentTx = {
    iconAssignment: {
      findUnique: vi.fn(async () => record),
      create: vi.fn(async ({ data }) => {
        const created: IconAssignmentRecord = { id: "assignment-1", ...data };
        record = created;
        return created;
      }),
      update: vi.fn(async ({ data }) => {
        record = record ? { ...record, ...data } : null;
        if (!record) throw new Error("missing assignment");
        return record;
      }),
    },
  };
  return { tx, current: () => record };
}

describe("automatic icon assignment", () => {
  it("matches a concept and persists one deterministic generated assignment", async () => {
    const fixture = assignmentFixture();

    const first = await assignAutomaticIcon(fixture.tx, {
      worldId: "world-1",
      timelineId: "timeline-1",
      subjectType: "ability",
      subjectId: "ability-1",
      iconConcept: "time.reverse",
    });
    const second = await assignAutomaticIcon(fixture.tx, {
      worldId: "world-1",
      timelineId: "timeline-1",
      subjectType: "ability",
      subjectId: "ability-1",
      iconConcept: "time.reverse",
    });

    expect(first.token).toBe("time.reverse");
    expect(second).toEqual(first);
    expect(fixture.current()).toMatchObject({
      timelineId: "timeline-1",
      subjectType: "ability",
      subjectId: "ability-1",
      token: "time.reverse",
      source: "generated",
      playerLocked: false,
    });
    expect(fixture.tx.iconAssignment.create).toHaveBeenCalledTimes(1);
  });

  it("uses a deterministic derived fallback when no concept was supplied", async () => {
    const fixture = assignmentFixture();

    const assignment = await assignAutomaticIcon(fixture.tx, {
      worldId: "world-1",
      timelineId: "timeline-1",
      subjectType: "entity",
      subjectId: "entity-1",
    });

    expect(assignment.source).toBe("derived");
    expect(assignment.token).toMatch(/^(?:entity|motif)\./u);
  });

  it("never overwrites a player-locked assignment", async () => {
    const locked: IconAssignmentRecord = {
      id: "assignment-player",
      timelineId: "timeline-1",
      subjectType: "god",
      subjectId: "god-1",
      token: "divinity.sun",
      source: "player",
      playerLocked: true,
    };
    const fixture = assignmentFixture(locked);

    const assignment = await assignAutomaticIcon(fixture.tx, {
      worldId: "world-1",
      timelineId: "timeline-1",
      subjectType: "god",
      subjectId: "god-1",
      iconConcept: "time.reverse",
    });

    expect(assignment).toEqual(locked);
    expect(fixture.tx.iconAssignment.update).not.toHaveBeenCalled();
  });
});

describe("player icon assignment", () => {
  it("locks a valid semantic token and restores a deterministic automatic token", async () => {
    const fixture = assignmentFixture();

    const locked = await setPlayerIconAssignment(fixture.tx, {
      timelineId: "timeline-1",
      subjectType: "entity",
      subjectId: "entity-1",
      token: "entity.character",
    });
    const restored = await restoreAutomaticIcon(fixture.tx, {
      worldId: "world-1",
      timelineId: "timeline-1",
      subjectType: "entity",
      subjectId: "entity-1",
    });

    expect(locked).toMatchObject({
      token: "entity.character",
      source: "player",
      playerLocked: true,
    });
    expect(restored).toMatchObject({ source: "derived", playerLocked: false });
    expect(restored.token).toMatch(/^(?:entity|motif)\./u);
  });

  it("rejects unknown catalog tokens before writing", async () => {
    const fixture = assignmentFixture();

    await expect(setPlayerIconAssignment(fixture.tx, {
      timelineId: "timeline-1",
      subjectType: "entity",
      subjectId: "entity-1",
      token: "illegal.token",
    })).rejects.toThrow(/图标令牌/u);
    expect(fixture.tx.iconAssignment.create).not.toHaveBeenCalled();
  });
});

describe("icon subject ownership", () => {
  it("accepts only a subject owned by the requested world and timeline", async () => {
    const client = {
      timeline: { findFirst: vi.fn(async () => ({ id: "timeline-1" })) },
      entity: { findFirst: vi.fn(async () => ({ id: "entity-1" })) },
      god: { findFirst: vi.fn(async () => null) },
      ability: { findFirst: vi.fn(async () => null) },
      worldEvent: { findFirst: vi.fn(async () => null) },
    };

    await expect(assertIconSubjectOwnership(client, {
      worldId: "world-1",
      timelineId: "timeline-1",
      subjectType: "entity",
      subjectId: "entity-1",
    })).resolves.toBeUndefined();
    expect(client.timeline.findFirst).toHaveBeenCalledWith({
      where: { id: "timeline-1", worldId: "world-1" },
      select: { id: true },
    });
  });

  it("rejects an unknown timeline or a subject from another timeline", async () => {
    const client = {
      timeline: { findFirst: vi.fn(async () => ({ id: "timeline-1" })) },
      entity: { findFirst: vi.fn(async () => null) },
      god: { findFirst: vi.fn(async () => null) },
      ability: { findFirst: vi.fn(async () => null) },
      worldEvent: { findFirst: vi.fn(async () => null) },
    };

    await expect(assertIconSubjectOwnership(client, {
      worldId: "world-1",
      timelineId: "timeline-1",
      subjectType: "entity",
      subjectId: "entity-other",
    })).rejects.toThrow(/不属于当前现实/u);
    client.timeline.findFirst.mockResolvedValueOnce(null as never);
    await expect(assertIconSubjectOwnership(client, {
      worldId: "world-1",
      timelineId: "timeline-other",
      subjectType: "event",
      subjectId: "event-1",
    })).rejects.toThrow(/现实不属于当前世界/u);
  });
});
