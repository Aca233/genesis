export type WorldSettlementState =
  | { status: "idle" }
  | {
      status: "running";
      segmentId: string;
      stage: string;
      completedStages: string[];
    }
  | {
      status: "failed";
      segmentId: string;
      stage: string;
      completedStages: string[];
      error: string;
      retryable: boolean;
    };

type SettlementEvent =
  | {
      type: "progress";
      taskId: string;
      taskKind: "settlement";
      stage: string;
      status: "running" | "completed";
      detail?: string;
      occurredAt: string;
    }
  | { type: "done"; taskId: string; followUp: { kind: "none" } }
  | {
      type: "failed";
      taskId: string;
      stage: string;
      message: string;
      retryable: boolean;
    };

const SETTLEMENT_STAGES = [
  "checkpoint_read",
  "pantheon",
  "extract",
  "chronicle",
  "snapshot",
  "completed",
] as const;

function completedBefore(stage: string): string[] {
  const index = SETTLEMENT_STAGES.indexOf(stage as typeof SETTLEMENT_STAGES[number]);
  return index < 0 ? [] : SETTLEMENT_STAGES.slice(0, index);
}

function failed(
  segmentId: string,
  error: string,
  stage = "checkpoint_read",
  retryable = true,
): WorldSettlementState {
  return {
    status: "failed",
    segmentId,
    stage,
    completedStages: completedBefore(stage),
    error,
    retryable,
  };
}

export async function followWorldSettlement(
  segmentId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorldSettlementState> {
  let response: Response;
  try {
    response = await fetcher(`/api/chapters/${segmentId}/settle`, {
      method: "POST",
      headers: { Accept: "text/event-stream" },
    });
  } catch (error) {
    return failed(segmentId, error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      error?: string;
    } | null;
    return failed(segmentId, body?.error ?? `世界整理请求失败（${response.status}）`);
  }
  if (!response.body) {
    return failed(segmentId, "世界整理响应无正文流");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: WorldSettlementState = {
    status: "running",
    segmentId,
    stage: "checkpoint_read",
    completedStages: [],
  };
  const consume = (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5).trim()) as SettlementEvent;
      if (event.type === "done") terminal = { status: "idle" };
      if (event.type === "progress") {
        terminal = {
          status: "running",
          segmentId,
          stage: event.stage,
          completedStages: event.status === "completed"
            ? [...completedBefore(event.stage), event.stage]
            : completedBefore(event.stage),
        };
      }
      if (event.type === "failed") {
        terminal = failed(segmentId, event.message, event.stage, event.retryable);
      }
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      consume(buffer.slice(0, separator));
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) consume(buffer.trim());
  return terminal.status === "running"
    ? failed(
        segmentId,
        "世界整理进度流意外结束",
        terminal.stage,
        true,
      )
    : terminal;
}
