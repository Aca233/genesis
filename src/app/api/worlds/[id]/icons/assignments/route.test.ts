import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORLD_ICON_THEME } from "@/lib/icons/theme";

const mocks = vi.hoisted(() => ({
  world: { findUnique: vi.fn(), findFirst: vi.fn() },
  timeline: { findFirst: vi.fn() },
  entity: { findFirst: vi.fn() },
  god: { findFirst: vi.fn() },
  ability: { findFirst: vi.fn() },
  worldEvent: { findFirst: vi.fn() },
  iconAssignment: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mocks }));
vi.mock("@/lib/auth/session", () => ({ requireUserId: vi.fn().mockResolvedValue("test-user") }));

import { DELETE, PUT } from "./route";

function request(method: "PUT" | "DELETE", body: unknown) {
  return new Request("http://localhost/api/worlds/world-1/icons/assignments", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const subject = {
  timelineId: "timeline-1",
  subjectType: "entity" as const,
  subjectId: "entity-1",
};

describe("world icon assignments route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.world.findUnique.mockResolvedValue({ iconTheme: DEFAULT_WORLD_ICON_THEME });
    mocks.world.findFirst.mockResolvedValue({ id: "world-1" });
    mocks.timeline.findFirst.mockResolvedValue({ id: "timeline-1" });
    mocks.entity.findFirst.mockResolvedValue({ id: "entity-1" });
    mocks.iconAssignment.findUnique.mockResolvedValue(null);
  });

  it("locks a valid token and returns a directly renderable SVG", async () => {
    mocks.iconAssignment.create.mockResolvedValue({
      id: "assignment-1",
      ...subject,
      token: "entity.character",
      source: "player",
      playerLocked: true,
    });

    const response = await PUT(request("PUT", { ...subject, token: "entity.character" }), {
      params: Promise.resolve({ id: "world-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      assignment: {
        token: "entity.character",
        source: "player",
        playerLocked: true,
        icon: { body: expect.stringContaining("<"), width: expect.any(Number), height: expect.any(Number) },
      },
    });
  });

  it("rejects an unknown token without writing", async () => {
    const response = await PUT(request("PUT", { ...subject, token: "illegal.token" }), {
      params: Promise.resolve({ id: "world-1" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.iconAssignment.create).not.toHaveBeenCalled();
    expect(mocks.iconAssignment.update).not.toHaveBeenCalled();
  });

  it("rejects a timeline from another world before writing", async () => {
    mocks.timeline.findFirst.mockResolvedValue(null);

    const response = await PUT(request("PUT", { ...subject, token: "entity.character" }), {
      params: Promise.resolve({ id: "world-other" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.iconAssignment.create).not.toHaveBeenCalled();
    expect(mocks.iconAssignment.update).not.toHaveBeenCalled();
  });

  it("restores automatic assignment and returns its resolved SVG", async () => {
    mocks.iconAssignment.findUnique.mockResolvedValue({
      id: "assignment-1",
      ...subject,
      token: "entity.character",
      source: "player",
      playerLocked: true,
    });
    mocks.iconAssignment.update.mockResolvedValue({
      id: "assignment-1",
      ...subject,
      token: "entity.unknown",
      source: "derived",
      playerLocked: false,
    });

    const response = await DELETE(request("DELETE", subject), {
      params: Promise.resolve({ id: "world-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      assignment: {
        token: "entity.unknown",
        source: "derived",
        playerLocked: false,
        icon: { body: expect.stringContaining("<"), width: expect.any(Number), height: expect.any(Number) },
      },
    });
  });
});
