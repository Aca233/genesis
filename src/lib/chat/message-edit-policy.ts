export class MessageCheckpointError extends Error {
  constructor(message = "此段已成史，不可直接修改") {
    super(message);
    this.name = "MessageCheckpointError";
  }
}

export function assertMessageEditable(input: {
  settleState: string;
  timelineId: string;
  activeTimelineId: string | null;
}): void {
  if (input.timelineId !== input.activeTimelineId) {
    throw new MessageCheckpointError("该现实已被冻结");
  }
  if (input.settleState !== "open") {
    throw new MessageCheckpointError();
  }
}

