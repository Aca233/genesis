import type { MessageRow } from "./types";

export type CreatorChannel = "observe" | "rewrite";
export type RewriteScope = "prospective" | "memory_only" | "retroactive";
export type RewriteProgressStage =
  | "planning"
  | "branching"
  | "applying"
  | "narrating"
  | "completed"
  | "failed";

export type RealityRewriteView = {
  id: string;
  worldId?: string;
  sourceTimelineId?: string;
  decree: string;
  scope: RewriteScope;
  status: "planning" | "applying" | "narrating" | "completed" | "failed";
  interpretation: string | null;
  branchName: string | null;
  summary: string | null;
  resultTimelineId: string | null;
  error: string | null;
};

export type CreatorInputState = {
  channel: CreatorChannel;
  scope: RewriteScope;
  text: string;
  busy: boolean;
  stage: RewriteProgressStage | null;
  error: string | null;
  completedRewrite: RealityRewriteView | null;
  idempotencyKey: string | null;
  idempotencyDraft: string | null;
};

export type CreatorInputDependencies = {
  createIdempotencyKey: () => string;
  observe: (text: string) => Promise<void>;
  createRewrite: (input: {
    decree: string;
    scope: RewriteScope;
    idempotencyKey: string;
  }) => Promise<{ taskId: string }>;
  followRewrite: (
    taskId: string,
    onProgress: (stage: RewriteProgressStage, task: RealityRewriteView | null) => void,
  ) => Promise<RealityRewriteView>;
  refreshState: (completed?: RealityRewriteView) => Promise<void>;
  refreshEntityIndex: () => Promise<void>;
};

export function createCreatorInputState(): CreatorInputState {
  return {
    channel: "observe",
    scope: "prospective",
    text: "",
    busy: false,
    stage: null,
    error: null,
    completedRewrite: null,
    idempotencyKey: null,
    idempotencyDraft: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Pure orchestration for the two creator input channels. UI may mirror progress
 * through onState without coupling the behavior to React.
 */
export async function submitCreatorInput(
  state: CreatorInputState,
  dependencies: CreatorInputDependencies,
  onState?: (state: CreatorInputState) => void,
): Promise<CreatorInputState> {
  const text = state.text.trim();
  if (!text || state.busy) return state;

  let current: CreatorInputState = {
    ...state,
    busy: true,
    stage: state.channel === "rewrite" ? "planning" : null,
    error: null,
    completedRewrite: null,
  };
  onState?.(current);

  if (state.channel === "observe") {
    try {
      await dependencies.observe(text);
      current = { ...current, text: "", busy: false };
    } catch (error) {
      current = { ...current, busy: false, error: errorMessage(error) };
    }
    onState?.(current);
    return current;
  }

  let taskId: string;
  const draftKey = state.idempotencyDraft === text && state.idempotencyKey
    ? state.idempotencyKey
    : dependencies.createIdempotencyKey();
  current = { ...current, idempotencyKey: draftKey, idempotencyDraft: text };
  onState?.(current);
  try {
    const accepted = await dependencies.createRewrite({
      decree: text,
      scope: state.scope,
      idempotencyKey: draftKey,
    });
    taskId = accepted.taskId;
    // Once the server acknowledges a durable task, the draft and its retry key are safe to clear.
    current = { ...current, text: "", idempotencyKey: null, idempotencyDraft: null };
    onState?.(current);
  } catch (error) {
    current = { ...current, busy: false, stage: "failed", error: errorMessage(error) };
    onState?.(current);
    return current;
  }

  try {
    const completed = await dependencies.followRewrite(taskId, (stage, task) => {
      current = {
        ...current,
        stage,
        completedRewrite: task?.status === "completed" ? task : current.completedRewrite,
      };
      onState?.(current);
    });
    if (completed.status !== "completed") {
      current = {
        ...current,
        busy: false,
        stage: "failed",
        error: completed.error ?? "现实改写未能完成",
      };
      onState?.(current);
      return current;
    }
    await Promise.all([dependencies.refreshState(completed), dependencies.refreshEntityIndex()]);
    current = {
      ...current,
      busy: false,
      stage: "completed",
      error: null,
      completedRewrite: completed,
    };
  } catch (error) {
    current = { ...current, busy: false, stage: "failed", error: errorMessage(error) };
  }
  onState?.(current);
  return current;
}

export type RewriteEventFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Parse the named-event SSE exposed by /api/rewrites/[id]/events. */
export async function followRealityRewriteEvents(
  taskId: string,
  onProgress: (stage: RewriteProgressStage, task: RealityRewriteView | null) => void,
  fetcher: RewriteEventFetcher = fetch,
  signal?: AbortSignal,
): Promise<RealityRewriteView> {
  const response = await fetcher(`/api/rewrites/${taskId}/events`, {
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `现实改写进度请求失败（${response.status}）`);
  }
  if (response.body === null) throw new Error("现实改写进度响应无正文流");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: RealityRewriteView | null = null;

  const consume = (chunk: string) => {
    let eventName = "";
    let data = "";
    for (const rawLine of chunk.split("\n")) {
      const line = rawLine.trimEnd();
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    const payload = JSON.parse(data) as {
      stage?: RewriteProgressStage;
      task?: RealityRewriteView | null;
      error?: string;
    };
    const stage = payload.stage ?? (eventName as RewriteProgressStage);
    if (!stage) return;
    const task = payload.task ?? null;
    onProgress(stage, task);
    if (stage === "failed") throw new Error(task?.error ?? payload.error ?? "现实改写失败");
    if (stage === "completed" && task !== null) terminal = task;
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
  if (terminal === null) throw new Error("现实改写进度流意外结束");
  return terminal;
}

export function enrichRewriteResultMessages(
  messages: readonly MessageRow[],
  rewrite: RealityRewriteView | null | undefined,
): MessageRow[] {
  if (!rewrite) return [...messages];
  return messages.map((message) => {
    if (
      message.meta?.kind !== "reality_rewrite_result"
      || message.meta.realityRewriteId !== rewrite.id
    ) return message;
    return {
      ...message,
      meta: {
        ...message.meta,
        decree: rewrite.decree,
        scope: rewrite.scope,
        interpretation: rewrite.interpretation,
        branchName: rewrite.branchName,
        summary: rewrite.summary,
        sourceTimelineId: rewrite.sourceTimelineId,
      },
    };
  });
}
