import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORLD_ICON_THEME } from "@/lib/icons/theme";

const mocks = vi.hoisted(() => ({
  world: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: { world: mocks.world } }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/worlds/world-1/icons/recast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const world = {
  id: "world-1",
  status: "playing",
  draftDeck: { style: "赛博朋克", cosmology: "轨道都市" },
  themeCard: null,
  styleCard: null,
  cosmology: null,
  fusionAxiom: null,
  iconTheme: {
    ...DEFAULT_WORLD_ICON_THEME,
    lockedAssignments: { "navigation.activity": "event.discovery" },
  },
  iconThemeRevision: 3,
  iconThemeOperationKey: null,
};

describe("world icon theme recast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.world.findUnique.mockResolvedValue(world);
    mocks.world.updateMany.mockResolvedValue({ count: 1 });
  });

  it("atomically replaces the candidate while preserving world locks", async () => {
    const response = await POST(request({ expectedRevision: 3, idempotencyKey: "recast-1" }), {
      params: Promise.resolve({ id: "world-1" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.revision).toBe(4);
    expect(body.theme.primaryFamily).toBe("tabler");
    expect(body.theme.lockedAssignments).toEqual({
      "navigation.activity": "event.discovery",
    });
    expect(mocks.world.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "world-1", iconThemeRevision: 3 },
      data: expect.objectContaining({
        iconThemeOperationKey: "recast-1",
        iconThemeRevision: { increment: 1 },
      }),
    }));
  });

  it("returns the current result for a repeated idempotency key", async () => {
    mocks.world.findUnique.mockResolvedValue({
      ...world,
      iconThemeRevision: 4,
      iconThemeOperationKey: "recast-1",
    });

    const response = await POST(request({ expectedRevision: 3, idempotencyKey: "recast-1" }), {
      params: Promise.resolve({ id: "world-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 4, idempotent: true });
    expect(mocks.world.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a stale revision without replacing the current theme", async () => {
    const response = await POST(request({ expectedRevision: 2, idempotencyKey: "recast-stale" }), {
      params: Promise.resolve({ id: "world-1" }),
    });

    expect(response.status).toBe(409);
    expect(mocks.world.updateMany).not.toHaveBeenCalled();
  });
});
