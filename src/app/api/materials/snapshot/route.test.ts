import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), findFirst: vi.fn(), createCard: vi.fn(), createVersion: vi.fn() }));
vi.mock("@/lib/materials/runtime-snapshot", () => ({ snapshotRuntimeMaterial: mocks.snapshot }));
vi.mock("@/lib/materials/repository", () => ({ createMaterialVersion: mocks.createVersion }));
vi.mock("@/lib/db", () => ({ prisma: { materialCard: { findFirst: mocks.findFirst, create: mocks.createCard } } }));
import { POST } from "./route";

describe("POST /api/materials/snapshot", () => {
  beforeEach(() => vi.clearAllMocks());
  it("creates a card when needed and appends a runtime version", async () => {
    mocks.snapshot.mockResolvedValue({
      cardIdentity: { kind: "character", sourceKind: "entity", sourceRef: "world:runtime:entity:e1", name: "旅人", summary: "摘要", sourceWorldId: "w1", sourceWorldName: "旧世界" },
      content: { schemaVersion: 1, origin: "runtime", kind: "character", card: { id: "e1" } }, dependencies: [],
    });
    mocks.findFirst.mockResolvedValue(null);
    mocks.createCard.mockResolvedValue({ id: "card-1" });
    mocks.createVersion.mockResolvedValue({ id: "version-1", version: 1 });
    const response = await POST(new Request("http://localhost/api/materials/snapshot", { method: "POST", body: JSON.stringify({ sourceType: "entity", sourceId: "e1", versionName: "第七章后", setDefault: true }) }));
    expect(response.status).toBe(201);
    expect(mocks.createVersion).toHaveBeenCalledWith(expect.objectContaining({ cardId: "card-1", name: "第七章后", setDefault: true }));
  });
  it("rejects invalid source and empty version names", async () => {
    const response = await POST(new Request("http://localhost/api/materials/snapshot", { method: "POST", body: JSON.stringify({ sourceType: "world", sourceId: "e1", versionName: "" }) }));
    expect(response.status).toBe(400);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
});
