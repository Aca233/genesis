export type WorldSettlementState =
  | { status: "idle" }
  | { status: "running"; segmentId: string }
  | { status: "failed"; segmentId: string; error: string };

type SettlementEvent =
  | { type: "progress"; step: string; detail?: string }
  | { type: "done"; nextChapterId?: string | null; nextSegmentId?: string | null }
  | { type: "error"; message: string };

export async function followWorldSettlement(
  segmentId: string,
  fetcher: typeof fetch = fetch,
): Promise<WorldSettlementState> {
  const response = await fetcher(`/api/chapters/${segmentId}/settle`, {
    method: "POST",
    headers: { Accept: "text/event-stream" },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      error?: string;
    } | null;
    return {
      status: "failed",
      segmentId,
      error: body?.error ?? `世界整理请求失败（${response.status}）`,
    };
  }
  if (!response.body) {
    return { status: "failed", segmentId, error: "世界整理响应无正文流" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: WorldSettlementState = {
    status: "running",
    segmentId,
  };
  const consume = (chunk: string) => {
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5).trim()) as SettlementEvent;
      if (event.type === "done") terminal = { status: "idle" };
      if (event.type === "error") {
        terminal = { status: "failed", segmentId, error: event.message };
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
    ? { status: "failed", segmentId, error: "世界整理进度流意外结束" }
    : terminal;
}

