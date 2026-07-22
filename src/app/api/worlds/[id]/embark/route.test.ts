import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeCreatorDeck, completeDeck } from "@/lib/abilities/embark.test-fixtures";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  runClaimedEmbarkTransaction: vi.fn(),
  archiveWorldMaterials: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { world: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/materials/archive-world", () => ({ archiveWorldMaterials: mocks.archiveWorldMaterials }));
vi.mock("@/lib/embark/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/embark/mutations")>();
  return { ...actual, runClaimedEmbarkTransaction: mocks.runClaimedEmbarkTransaction };
});

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "world-1" }) };

describe("POST /api/worlds/[id]/embark mode boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runClaimedEmbarkTransaction.mockImplementation(async (_db, _id, loadDeck) => loadDeck({
      world: { findUnique: mocks.findUnique },
    }));
  });

  it("世界模式与草稿模式不一致时返回 409", async () => {
    mocks.findUnique.mockResolvedValue({ mode: "creator", draftDeck: completeDeck() });
    const response = await POST(new Request("http://localhost"), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "世界模式不可更改" });
    expect(mocks.archiveWorldMaterials).not.toHaveBeenCalled();
  });

  it("Creator 草稿返回独立的临时 409 而非 404", async () => {
    mocks.findUnique.mockResolvedValue({ mode: "creator", draftDeck: completeCreatorDeck() });
    const response = await POST(new Request("http://localhost"), context);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "创世主开局将在现实状态初始化后启用" });
    expect(mocks.archiveWorldMaterials).not.toHaveBeenCalled();
  });
});
