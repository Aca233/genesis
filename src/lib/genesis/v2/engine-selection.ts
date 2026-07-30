import { createHash } from "node:crypto";

export type GenesisEngineVersion = "legacy-v1" | "dag-v2";

export type GenesisV2PrimaryRollout = {
  percent: number;
  userIds: Set<string>;
};

type RolloutEnvironment = Record<string, string | undefined>;

export function readGenesisV2PrimaryRollout(
  environment: RolloutEnvironment = process.env,
): GenesisV2PrimaryRollout {
  const configuredPercent = environment.GENESIS_V2_PRIMARY_PERCENT?.trim();
  const parsedPercent = Number(configuredPercent || "0");
  const percent = Number.isInteger(parsedPercent) && parsedPercent >= 0 && parsedPercent <= 100
    ? parsedPercent
    : 0;
  const userIds = new Set(
    (environment.GENESIS_V2_PRIMARY_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .sort(),
  );
  return { percent, userIds };
}

export function selectGenesisEngine(input: {
  userId: string;
  requestHash: string;
  rollout: GenesisV2PrimaryRollout;
}): GenesisEngineVersion {
  if (input.rollout.userIds.has(input.userId)) return "dag-v2";
  if (input.rollout.percent <= 0) return "legacy-v1";
  if (input.rollout.percent >= 100) return "dag-v2";
  const bucket = Number.parseInt(
    createHash("sha256")
      .update(`${input.userId}:${input.requestHash}`, "utf8")
      .digest("hex")
      .slice(0, 8),
    16,
  ) % 100;
  return bucket < input.rollout.percent ? "dag-v2" : "legacy-v1";
}
