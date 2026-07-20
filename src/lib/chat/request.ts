import type { Prisma } from "@prisma/client";
import type { Scale } from "@/lib/cards/schemas";
import type { NarratorMeta } from "@/lib/prompts/narrator";

const REQUEST_TAG = "chat-generation-request";
export type ChatGenerationMode = "say" | "continue" | "opening";
export type GenerationRequestMeta = {
  type: typeof REQUEST_TAG;
  chapterId: string;
  mode: ChatGenerationMode;
  scale: Scale;
  content: string | null;
  directive: string | null;
  playerMessageId: string | null;
  narratorMessageId: string;
  playerIndex: number | null;
  narratorIndex: number;
};

export type GenerationCompletion = { messageId: string; meta: NarratorMeta };
type RequestRow = {
  id: string;
  chapterId: string;
  mode: string;
  scale: string;
  content: string | null;
  directive: string | null;
  status: string;
  playerMessageId: string | null;
  narratorMessageId: string;
  playerIndex: number | null;
  narratorIndex: number;
  resultMeta: unknown;
};
type RequestMessage = {
  id: string; chapterId: string; index: number; role: string;
  content: string; scale: string; meta: unknown;
};
export type GenerationRequestTx = {
  generationRequest: {
    findUnique(args: { where: { id: string } }): Promise<RequestRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<RequestRow>;
  };
  message: {
    findUnique(args: { where: { id: string } }): Promise<RequestMessage | null>;
    create(args: { data: Record<string, unknown> }): Promise<RequestMessage>;
  };
};
export type GenerationRequestClient = {
  $transaction<T>(operation: (tx: GenerationRequestTx) => Promise<T>): Promise<T>;
};

export function parseGenerationRequestMeta(value: unknown): GenerationRequestMeta | null {
  if (!value || typeof value !== "object") return null;
  const container = value as { generationRequest?: unknown };
  const raw = container.generationRequest ?? value;
  if (!raw || typeof raw !== "object") return null;
  const meta = raw as Partial<GenerationRequestMeta>;
  return meta.type === REQUEST_TAG && typeof meta.narratorMessageId === "string"
    ? meta as GenerationRequestMeta : null;
}

function rowMeta(row: RequestRow): GenerationRequestMeta {
  return {
    type: REQUEST_TAG,
    chapterId: row.chapterId,
    mode: row.mode as ChatGenerationMode,
    scale: row.scale as Scale,
    content: row.content,
    directive: row.directive,
    playerMessageId: row.playerMessageId,
    narratorMessageId: row.narratorMessageId,
    playerIndex: row.playerIndex,
    narratorIndex: row.narratorIndex,
  };
}

function sameSemanticRequest(meta: GenerationRequestMeta, input: PrepareGenerationInput) {
  return meta.chapterId === input.chapterId && meta.mode === input.mode &&
    meta.scale === input.scale && meta.content === (input.content ?? null) &&
    meta.directive === (input.directive ?? null) &&
    meta.narratorMessageId === input.generationId;
}

function asNarratorMeta(value: unknown): NarratorMeta | null {
  if (!value || typeof value !== "object") return null;
  const meta = value as Partial<NarratorMeta>;
  return Array.isArray(meta.suggestions) && typeof meta.chapterBreakHint === "boolean"
    ? meta as NarratorMeta
    : null;
}

export type PrepareGenerationInput = {
  generationId: string; chapterId: string; mode: ChatGenerationMode; scale: Scale;
  content?: string; directive?: string; playerIndex: number | null; narratorIndex: number;
  chapterHasMessages?: boolean;
};
export type PreparedGeneration = {
  meta: GenerationRequestMeta;
  state: "owner" | "pending" | "completed";
  completion?: GenerationCompletion;
};

async function inspectExisting(
  tx: GenerationRequestTx,
  input: PrepareGenerationInput,
): Promise<PreparedGeneration> {
  const row = await tx.generationRequest.findUnique({ where: { id: input.generationId } });
  if (!row) throw new Error("generation reservation disappeared");
  const meta = rowMeta(row);
  if (!sameSemanticRequest(meta, input)) throw new Error("generationId 请求参数不一致");
  if (row.status !== "completed") return { meta, state: "pending" };

  const narrator = await tx.message.findUnique({ where: { id: row.narratorMessageId } });
  const narratorRequest = parseGenerationRequestMeta(narrator?.meta);
  const resultMeta = asNarratorMeta(row.resultMeta);
  if (!narrator || narrator.role !== "narrator" || narrator.chapterId !== row.chapterId ||
      narrator.index !== row.narratorIndex || narrator.scale !== row.scale || !resultMeta ||
      !narratorRequest || narratorRequest.narratorMessageId !== row.narratorMessageId ||
      !sameSemanticRequest(narratorRequest, input)) {
    throw new Error("generationId 已完成结果与请求绑定不一致");
  }
  return {
    meta,
    state: "completed",
    completion: { messageId: narrator.id, meta: resultMeta },
  };
}

async function reserveInTx(
  tx: GenerationRequestTx,
  input: PrepareGenerationInput,
): Promise<PreparedGeneration> {
  if (input.mode === "opening" && input.chapterHasMessages) {
    throw new Error("本章已有开场，不可重复演出");
  }
  const playerMessageId = input.mode === "say" ? `genplayer:${input.generationId}` : null;
  const meta: GenerationRequestMeta = {
    type: REQUEST_TAG,
    chapterId: input.chapterId,
    mode: input.mode,
    scale: input.scale,
    content: input.content ?? null,
    directive: input.directive ?? null,
    playerMessageId,
    narratorMessageId: input.generationId,
    playerIndex: playerMessageId ? input.playerIndex : null,
    narratorIndex: input.narratorIndex,
  };
  await tx.generationRequest.create({ data: {
    id: input.generationId,
    chapterId: input.chapterId,
    mode: input.mode,
    scale: input.scale,
    content: meta.content,
    directive: meta.directive,
    status: "pending",
    playerMessageId,
    narratorMessageId: input.generationId,
    playerIndex: meta.playerIndex,
    narratorIndex: input.narratorIndex,
  } });
  if (playerMessageId) {
    await tx.message.create({ data: {
      id: playerMessageId,
      chapterId: input.chapterId,
      index: input.playerIndex,
      role: "player",
      content: meta.content,
      scale: input.scale,
      meta: { generationRequest: meta } as unknown as Prisma.InputJsonValue,
    } });
  }
  return { meta, state: "owner" };
}

/** Atomically reserves a generation before any player message or LLM call. */
export async function prepareGenerationRequest(
  client: GenerationRequestClient,
  input: PrepareGenerationInput,
): Promise<PreparedGeneration> {
  try {
    return await client.$transaction(async (tx) => {
      const existing = await tx.generationRequest.findUnique({
        where: { id: input.generationId },
      });
      return existing ? inspectExisting(tx, input) : reserveInTx(tx, input);
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return client.$transaction((tx) => inspectExisting(tx, input));
    }
    throw error;
  }
}

export async function readGenerationCompletion(
  client: GenerationRequestClient,
  input: PrepareGenerationInput,
): Promise<GenerationCompletion | null> {
  const result = await client.$transaction((tx) => inspectExisting(tx, input));
  return result.completion ?? null;
}
