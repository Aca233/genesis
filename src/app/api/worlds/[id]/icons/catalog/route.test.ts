import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORLD_ICON_THEME } from "@/lib/icons/theme";

const mocks = vi.hoisted(() => ({
  world: { findFirst: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: mocks }));
vi.mock("@/lib/auth/session", () => ({ requireUserId: vi.fn().mockResolvedValue("test-user") }));

import { GET } from "./route";

describe("world icon catalog route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.world.findFirst.mockResolvedValue({
      iconTheme: {
        ...DEFAULT_WORLD_ICON_THEME,
        primaryFamily: "tabler",
        emblemFamily: "gameIcons",
      },
    });
  });

  it("clamps a response to 24 current-family items with SVG data", async () => {
    const response = await GET(
      new Request("http://localhost/api/worlds/world-1/icons/catalog?library=primary&page=1&pageSize=500"),
      { params: Promise.resolve({ id: "world-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pageSize).toBe(24);
    expect(body.items.length).toBeLessThanOrEqual(24);
    expect(body.total).toBeGreaterThan(body.items.length);
    expect(body.items.every((item: { family: string }) => item.family === "tabler")).toBe(true);
    expect(body.items.every((item: { icon: { body?: string } | null }) => item.icon?.body)).toBe(true);
  });

  it("searches only the configured emblem family", async () => {
    const response = await GET(
      new Request("http://localhost/api/worlds/world-1/icons/catalog?library=emblem&q=%E6%88%98%E4%BA%89"),
      { params: Promise.resolve({ id: "world-1" }) },
    );
    const body = await response.json();

    expect(body.items).toContainEqual(expect.objectContaining({
      token: "event.conflict",
      family: "gameIcons",
      icon: expect.objectContaining({ body: expect.any(String) }),
    }));
    expect(body.items.every((item: { role: string }) => item.role === "emblem")).toBe(true);
  });

  it("returns 404 for a missing world", async () => {
    mocks.world.findFirst.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/worlds/missing/icons/catalog"),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
  });
});
