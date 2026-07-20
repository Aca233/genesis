import { describe, expect, it, vi } from "vitest";
import { prepareGenerationRequest } from "./request";
function fixture() {
  const rows = new Map<string, Record<string, unknown>>();
  const tx = { message: {
    findUnique: vi.fn(async ({ where }) => rows.get(where.id) ?? null),
    create: vi.fn(async ({ data }) => { if (rows.has(data.id)) throw Object.assign(new Error("unique"), { code: "P2002" }); const row = { ...data }; rows.set(data.id, row); return row; }),
  } };
  return { rows, tx, client: { $transaction: vi.fn(async (fn) => fn(tx)) } };
}
const input = { generationId: "generation-1", chapterId: "chapter-1", mode: "say" as const, scale: "scene" as const, content: "神谕", playerIndex: 3, narratorIndex: 4 };
describe("prepareGenerationRequest", () => {
  it("首次请求仅以稳定 ID 原子写玩家消息，并在 meta 绑定预期 narrator", async () => {
    const { client, tx } = fixture();
    const result = await prepareGenerationRequest(client as never, input);
    expect(tx.message.create).toHaveBeenCalledTimes(1);
    expect(tx.message.create.mock.calls[0][0].data).toMatchObject({ id: "genplayer:generation-1", role: "player", index: 3 });
    expect(result.meta.narratorMessageId).toBe("generation-1");
  });
  it("相同 ID 重试复用玩家协议，不重复写且沿用原 index", async () => {
    const { client, tx } = fixture();
    await prepareGenerationRequest(client as never, input);
    const second = await prepareGenerationRequest(client as never, { ...input, playerIndex: 9, narratorIndex: 10 });
    expect(second.meta).toMatchObject({ playerIndex: 3, narratorIndex: 4 });
    expect(tx.message.create).toHaveBeenCalledTimes(1);
  });
  it("相同 ID 不同语义请求被拒绝", async () => {
    const { client } = fixture(); await prepareGenerationRequest(client as never, input);
    await expect(prepareGenerationRequest(client as never, { ...input, content: "另一神谕" })).rejects.toThrow(/参数不一致/);
  });
});
