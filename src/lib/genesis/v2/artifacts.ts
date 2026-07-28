import { createHash } from "node:crypto";
import type { GenesisV2StageId } from "./stage-registry";
import { serializeGenesisV2PromptValue } from "./prompt-bundle";

export const GENESIS_V2_ARTIFACT_STATUSES = [
  "candidate",
  "accepted",
  "rejected",
  "superseded",
  "sealed",
  "stale",
] as const;

export type GenesisV2ArtifactStatus = (typeof GENESIS_V2_ARTIFACT_STATUSES)[number];

export type GenesisV2ArtifactEnvelope = {
  stageId: GenesisV2StageId;
  version: number;
  status: GenesisV2ArtifactStatus;
  visibility: "shadow";
  inputHash: string;
  outputHash: string;
  reuseKey: string;
  dependencyHashes: string[];
  content: unknown;
  validation: { valid: boolean; issues: string[] };
};

const allowedTransitions: Record<GenesisV2ArtifactStatus, readonly GenesisV2ArtifactStatus[]> = {
  candidate: ["accepted", "rejected"],
  accepted: ["superseded", "sealed", "stale"],
  rejected: [],
  superseded: [],
  sealed: ["stale"],
  stale: ["candidate"],
};

export function canTransitionArtifact(
  from: GenesisV2ArtifactStatus,
  to: GenesisV2ArtifactStatus,
): boolean {
  return allowedTransitions[from].includes(to);
}

export function hashGenesisV2ArtifactContent(content: unknown): string {
  return createHash("sha256")
    .update(serializeGenesisV2PromptValue(content), "utf8")
    .digest("hex");
}

export function buildGenesisV2ReuseKey(input: {
  stageId: GenesisV2StageId;
  contractVersion: string;
  inputHash: string;
  dependencyHashes: readonly string[];
}): string {
  return createHash("sha256")
    .update(serializeGenesisV2PromptValue({
      stageId: input.stageId,
      contractVersion: input.contractVersion,
      inputHash: input.inputHash,
      dependencyHashes: [...input.dependencyHashes].sort(),
    }), "utf8")
    .digest("hex");
}

export function assertSingleAcceptedArtifact(
  artifacts: readonly Pick<GenesisV2ArtifactEnvelope, "stageId" | "status">[],
): void {
  const accepted = new Set<GenesisV2StageId>();
  for (const artifact of artifacts) {
    if (artifact.status !== "accepted" && artifact.status !== "sealed") continue;
    if (accepted.has(artifact.stageId)) {
      throw new Error(`Genesis V2 stage has multiple accepted artifacts: ${artifact.stageId}`);
    }
    accepted.add(artifact.stageId);
  }
}
