import { describe, expect, it, vi } from "vitest";
import { listAdminWorlds, loadAdminOverview } from "./data";

describe("admin data privacy", () => {
  it("world listing selects metadata and counts but never content fields", async () => {
    const db = {
      world: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    await listAdminWorlds({ search: "", status: "all", archived: "all", page: 1, pageSize: 25, skip: 0 }, db as never);
    const query = db.world.findMany.mock.calls[0]![0];
    expect(query.select).toEqual(expect.objectContaining({ id: true, name: true, status: true, _count: expect.any(Object) }));
    for (const forbidden of ["genesisInput", "draftDeck", "themeCard", "styleCard", "cosmology", "lorebookEntries"]) {
      expect(query.select).not.toHaveProperty(forbidden);
    }
  });

  it("overview uses bounded 24-hour aggregates", async () => {
    const aggregate = vi.fn().mockResolvedValue({ _count: { _all: 0 }, _avg: { durationMs: null }, _sum: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } });
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const queryRaw = vi.fn().mockResolvedValue([{ ok: 1 }]);
    const db = {
      user: { count }, session: { count }, world: { count }, genesisTask: { count, findMany },
      generationRequest: { count }, realityRewrite: { count }, llmCall: { aggregate, count }, $queryRaw: queryRaw,
    };
    await loadAdminOverview(db as never);
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ createdAt: { gte: expect.any(Date) } }) }));
  });
});
