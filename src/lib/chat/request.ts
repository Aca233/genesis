import type { Prisma } from "@prisma/client";
import type { Scale } from "@/lib/cards/schemas";

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

type RequestMessage = {
  id: string; chapterId: string; index: number; role: string;
  content: string; scale: string; meta: unknown;
};
export type GenerationRequestTx = { message: {
  findUnique(args: { where: { id: string } }): Promise<RequestMessage | null>;
  create(args: { data: Record<string, unknown> }): Promise<RequestMessage>;
} };
export type GenerationRequestClient = {
  $transaction<T>(operation: (tx: GenerationRequestTx) => Promise<T>): Promise<T>;
};

export function parseGenerationRequestMeta(value: unknown): GenerationRequestMeta | null {
  if (!value || typeof value !== "object") return null;
  const container = value as { generationRequest?: unknown; type?: unknown };
  const raw = container.generationRequest ?? value;
  if (!raw || typeof raw !== "object") return null;
  const meta = raw as Partial<GenerationRequestMeta>;
  return meta.type === REQUEST_TAG && typeof meta.narratorMessageId === "string"
    ? meta as GenerationRequestMeta : null;
}

function sameSemanticRequest(meta: GenerationRequestMeta, input: PrepareGenerationInput) {
  return meta.chapterId === input.chapterId && meta.mode === input.mode &&
    meta.scale === input.scale && meta.content === (input.content ?? null) &&
    meta.directive === (input.directive ?? null) &&
    meta.narratorMessageId === input.generationId;
}

export type PrepareGenerationInput = {
  generationId: string; chapterId: string; mode: ChatGenerationMode; scale: Scale;
  content?: string; directive?: string; playerIndex: number | null; narratorIndex: number;
};

async function prepareInTx(tx: GenerationRequestTx, input: PrepareGenerationInput) {
  const narrator = await tx.message.findUnique({ where: { id: input.generationId } });
  if (narrator) {
    const meta = parseGenerationRequestMeta(narrator.meta);
    if (!meta || !sameSemanticRequest(meta, input) || narrator.role !== "narrator" ||
        narrator.chapterId !== input.chapterId || narrator.index !== meta.narratorIndex) {
      throw new Error("generationId 已被其他叙事请求占用");
    }
    return { meta, reused: true, completedMessageId: narrator.id };
  }

  const playerMessageId = input.mode === "say" ? `genplayer:${input.generationId}` : null;
  if (playerMessageId) {
    const player = await tx.message.findUnique({ where: { id: playerMessageId } });
    if (player) {
      const meta = parseGenerationRequestMeta(player.meta);
      if (!meta || !sameSemanticRequest(meta, input) || player.role !== "player" ||
          player.chapterId !== input.chapterId || player.index !== meta.playerIndex) {
        throw new Error("generationId 请求参数不一致");
      }
      return { meta, reused: true };
    }
  }

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
  if (playerMessageId) {
    await tx.message.create({ data: {
      id: playerMessageId, chapterId: input.chapterId, index: input.playerIndex,
      role: "player", content: meta.content, scale: input.scale,
      meta: { generationRequest: meta } as unknown as Prisma.InputJsonValue,
    } });
  }
  return { meta, reused: false };
}

/** Checks/reserves generation identity before any player write. Stable IDs make same-ID retries safe. */
export async function prepareGenerationRequest(
  client: GenerationRequestClient,
  input: PrepareGenerationInput,
): Promise<{ meta: GenerationRequestMeta; reused: boolean; completedMessageId?: string }> {
  try {
    return await client.$transaction((tx) => prepareInTx(tx, input));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return client.$transaction((tx) => prepareInTx(tx, input));
    }
    throw error;
  }
}
