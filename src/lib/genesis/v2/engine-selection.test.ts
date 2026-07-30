import { describe, expect, it } from "vitest";
import {
  readGenesisV2PrimaryRollout,
  selectGenesisEngine,
} from "./engine-selection";

describe("Genesis V2 primary engine selection", () => {
  it("defaults every new task to V2", () => {
    expect(readGenesisV2PrimaryRollout({})).toEqual({
      percent: 100,
      userIds: new Set(),
    });
    expect(selectGenesisEngine({
      userId: "user-1",
      requestHash: "request-1",
      rollout: readGenesisV2PrimaryRollout({}),
    })).toBe("dag-v2");
  });

  it("routes explicit internal users to V2 even at zero percent", () => {
    const rollout = readGenesisV2PrimaryRollout({
      GENESIS_V2_PRIMARY_PERCENT: "0",
      GENESIS_V2_PRIMARY_USER_IDS: "user-2, user-1,user-2",
    });

    expect(rollout.userIds).toEqual(new Set(["user-1", "user-2"]));
    expect(selectGenesisEngine({ userId: "user-1", requestHash: "a", rollout })).toBe("dag-v2");
    expect(selectGenesisEngine({ userId: "user-3", requestHash: "a", rollout })).toBe("legacy-v1");
  });

  it("uses a stable request bucket for percentage rollout", () => {
    const rollout = readGenesisV2PrimaryRollout({ GENESIS_V2_PRIMARY_PERCENT: "37" });
    const first = selectGenesisEngine({ userId: "user-1", requestHash: "same-request", rollout });
    const second = selectGenesisEngine({ userId: "user-1", requestHash: "same-request", rollout });

    expect(second).toBe(first);
  });

  it("supports explicit legacy rollback and normalizes unsafe percent values to V2", () => {
    expect(selectGenesisEngine({
      userId: "user-1",
      requestHash: "request-1",
      rollout: readGenesisV2PrimaryRollout({ GENESIS_V2_PRIMARY_PERCENT: "0" }),
    })).toBe("legacy-v1");
    expect(selectGenesisEngine({
      userId: "user-1",
      requestHash: "request-1",
      rollout: readGenesisV2PrimaryRollout({ GENESIS_V2_PRIMARY_PERCENT: "100" }),
    })).toBe("dag-v2");
    expect(readGenesisV2PrimaryRollout({ GENESIS_V2_PRIMARY_PERCENT: "101" }).percent).toBe(100);
    expect(readGenesisV2PrimaryRollout({ GENESIS_V2_PRIMARY_PERCENT: "not-a-number" }).percent).toBe(100);
    expect(readGenesisV2PrimaryRollout({ GENESIS_V2_PRIMARY_PERCENT: "" }).percent).toBe(100);
  });
});
