import type { Prisma } from "@prisma/client";
import type { Scale } from "@/lib/cards/schemas";
import type { NarratorMeta } from "@/lib/prompts/narrator";

const REQUEST_TAG = "chat-generation-request";
const LEASE_MS = 5 * 60 * 1000;
export type ChatGenerationMode = "say" | "continue" | "opening";
export class FrozenRealityError extends Error {
  constructor() { super("该现实已被冻结"); this.name = "FrozenRealityError"; }
}
export class OpeningGenerationConflictError extends Error {
  constructor() { super("本章已有开场，不可重复演出"); this.name = "OpeningGenerationConflictError"; }
}
export type GenerationRequestMeta = {
  type: typeof REQUEST_TAG; chapterId: string; mode: ChatGenerationMode; scale: Scale;
  content: string | null; directive: string | null; playerMessageId: string | null;
  narratorMessageId: string; playerIndex: number | null; narratorIndex: number;
};
export type GenerationCompletion = { messageId: string; meta: NarratorMeta };
type RequestRow = {
  id: string; chapterId: string; mode: string; scale: string; content: string | null;
  directive: string | null; status: string; error: string | null; attempt: number;
  leaseExpiresAt: Date | null; playerMessageId: string | null; narratorMessageId: string;
  playerIndex: number | null; narratorIndex: number; resultMeta: unknown;
};
type RequestMessage = {
  id: string; chapterId: string; index: number; role: string;
  content: string; scale: string; meta: unknown;
};
export type GenerationRequestTx = {
  world: {
    findUnique(args: { where: { id: string }; select: { activeTimelineId: true } }): Promise<{ activeTimelineId: string | null } | null>;
  };
  generationRequest: {
    findUnique(args: { where: { id: string } }): Promise<RequestRow | null>;
    create(args: { data: Record<string, unknown> }): Promise<RequestRow>;
    updateMany(args: {
      where: Record<string, unknown>; data: Record<string, unknown>;
    }): Promise<{ count: number }>;
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
  const raw = (value as { generationRequest?: unknown }).generationRequest ?? value;
  if (!raw || typeof raw !== "object") return null;
  const meta = raw as Partial<GenerationRequestMeta>;
  return meta.type === REQUEST_TAG && typeof meta.narratorMessageId === "string"
    ? meta as GenerationRequestMeta : null;
}
function rowMeta(row: RequestRow): GenerationRequestMeta {
  return { type: REQUEST_TAG, chapterId: row.chapterId, mode: row.mode as ChatGenerationMode,
    scale: row.scale as Scale, content: row.content, directive: row.directive,
    playerMessageId: row.playerMessageId, narratorMessageId: row.narratorMessageId,
    playerIndex: row.playerIndex, narratorIndex: row.narratorIndex };
}
function sameSemanticRequest(meta: GenerationRequestMeta, input: PrepareGenerationInput) {
  return meta.chapterId === input.chapterId && meta.mode === input.mode &&
    meta.scale === input.scale && meta.content === (input.content ?? null) &&
    meta.directive === (input.directive ?? null) && meta.narratorMessageId === input.generationId;
}
function asNarratorMeta(value: unknown): NarratorMeta | null {
  if (!value || typeof value !== "object") return null;
  const meta = value as Partial<NarratorMeta>;
  return Array.isArray(meta.suggestions) && typeof meta.chapterBreakHint === "boolean"
    ? meta as NarratorMeta : null;
}
export type PrepareGenerationInput = {
  generationId: string; chapterId: string; worldId: string; expectedActiveTimelineId: string; mode: ChatGenerationMode; scale: Scale;
  content?: string; directive?: string; playerIndex: number | null; narratorIndex: number;
  chapterHasMessages?: boolean;
};
export type PreparedGeneration = {
  meta: GenerationRequestMeta; state: "owner" | "pending" | "completed";
  attempt?: number; completion?: GenerationCompletion;
};

async function completedResult(tx: GenerationRequestTx, row: RequestRow, input: PrepareGenerationInput) {
  const meta = rowMeta(row);
  const narrator = await tx.message.findUnique({ where: { id: row.narratorMessageId } });
  const narratorRequest = parseGenerationRequestMeta(narrator?.meta);
  const resultMeta = asNarratorMeta(row.resultMeta);
  if (!narrator || narrator.role !== "narrator" || narrator.chapterId !== row.chapterId ||
      narrator.index !== row.narratorIndex || narrator.scale !== row.scale || !resultMeta ||
      !narratorRequest || !sameSemanticRequest(narratorRequest, input)) {
    throw new Error("generationId 已完成结果与请求绑定不一致");
  }
  return { meta, state: "completed" as const,
    completion: { messageId: narrator.id, meta: resultMeta } };
}
async function inspectOrTakeover(tx: GenerationRequestTx, row: RequestRow, input: PrepareGenerationInput) {
  const meta = rowMeta(row);
  if (!sameSemanticRequest(meta, input)) throw new Error("generationId 请求参数不一致");
  if (row.status === "completed") return completedResult(tx, row, input);
  const expired = !row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= Date.now();
  if (row.status !== "failed" && !expired) return { meta, state: "pending" as const };
  const attempt = row.attempt + 1;
  const claimed = await tx.generationRequest.updateMany({
    where: { id: row.id, status: row.status, attempt: row.attempt },
    data: { status: "pending", error: null, attempt, leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
  return claimed.count === 1
    ? { meta, state: "owner" as const, attempt }
    : { meta, state: "pending" as const };
}
async function reserveInTx(tx: GenerationRequestTx, input: PrepareGenerationInput) {
  if (input.mode === "opening" && input.chapterHasMessages) throw new OpeningGenerationConflictError();
  const playerMessageId = input.mode === "say" ? `genplayer:${input.generationId}` : null;
  const meta: GenerationRequestMeta = { type: REQUEST_TAG, chapterId: input.chapterId,
    mode: input.mode, scale: input.scale, content: input.content ?? null,
    directive: input.directive ?? null, playerMessageId, narratorMessageId: input.generationId,
    playerIndex: playerMessageId ? input.playerIndex : null, narratorIndex: input.narratorIndex };
  await tx.generationRequest.create({ data: { id: input.generationId, chapterId: input.chapterId,
    mode: input.mode, scale: input.scale, content: meta.content, directive: meta.directive,
    status: "pending", error: null, attempt: 1, leaseExpiresAt: new Date(Date.now() + LEASE_MS),
    playerMessageId, narratorMessageId: input.generationId, playerIndex: meta.playerIndex,
    narratorIndex: input.narratorIndex } });
  if (playerMessageId) await tx.message.create({ data: { id: playerMessageId,
    chapterId: input.chapterId, index: input.playerIndex, role: "player", content: meta.content,
    scale: input.scale, meta: { generationRequest: meta } as unknown as Prisma.InputJsonValue } });
  return { meta, state: "owner" as const, attempt: 1 };
}

export async function prepareGenerationRequest(client: GenerationRequestClient, input: PrepareGenerationInput) {
  try {
    return await client.$transaction(async (tx) => {
      const world = await tx.world.findUnique({
        where: { id: input.worldId },
        select: { activeTimelineId: true },
      });
      if (!world || world.activeTimelineId !== input.expectedActiveTimelineId) {
        throw new FrozenRealityError();
      }
      const existing = await tx.generationRequest.findUnique({ where: { id: input.generationId } });
      return existing ? inspectOrTakeover(tx, existing, input) : reserveInTx(tx, input);
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return client.$transaction(async (tx) => {
        const world = await tx.world.findUnique({
          where: { id: input.worldId },
          select: { activeTimelineId: true },
        });
        if (!world || world.activeTimelineId !== input.expectedActiveTimelineId) {
          throw new FrozenRealityError();
        }
        const row = await tx.generationRequest.findUnique({ where: { id: input.generationId } });
        if (!row) throw error;
        return inspectOrTakeover(tx, row, input);
      });
    }
    throw error;
  }
}
export async function readGenerationCompletion(client: GenerationRequestClient, input: PrepareGenerationInput) {
  return client.$transaction(async (tx) => {
    const world = await tx.world.findUnique({
      where: { id: input.worldId },
      select: { activeTimelineId: true },
    });
    if (!world || world.activeTimelineId !== input.expectedActiveTimelineId) {
      throw new FrozenRealityError();
    }
    const row = await tx.generationRequest.findUnique({ where: { id: input.generationId } });
    if (!row) throw new Error("generation reservation disappeared");
    const meta = rowMeta(row);
    if (!sameSemanticRequest(meta, input)) throw new Error("generationId 请求参数不一致");
    return row.status === "completed" ? (await completedResult(tx, row, input)).completion : null;
  });
}
export async function markGenerationFailed(
  client: GenerationRequestClient, generationId: string, attempt: number, error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  await client.$transaction((tx) => tx.generationRequest.updateMany({
    where: { id: generationId, status: "pending", attempt },
    data: { status: "failed", error: message.slice(0, 2000), leaseExpiresAt: null },
  }));
}
