import { GENESIS_STAGES, type GenesisStageId } from "./stages";

type Snapshot = { stage: string; updatedAt: string };

/** Prevents a slower poll response from rolling back a newer SSE snapshot. */
export function acceptTaskSnapshot(current: Snapshot | null, incoming: Snapshot): boolean {
  if (!current) return true;
  const currentTime = new Date(current.updatedAt).getTime();
  const incomingTime = new Date(incoming.updatedAt).getTime();
  if (incomingTime !== currentTime) return incomingTime > currentTime;
  const index = (stage: string) =>
    GENESIS_STAGES.findIndex(({ id }) => id === (stage as GenesisStageId));
  return index(incoming.stage) >= index(current.stage);
}
