import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), headers: vi.fn(), findUnique: vi.fn() }));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("./index", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("../db", () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));

import { AdminForbiddenError, AdminUnauthorizedError, requireAdmin, withAdmin } from "./admin";

describe("requireAdmin", () => {
  beforeEach(() => mocks.headers.mockResolvedValue(new Headers()));

  it("returns a minimal admin principal", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "admin-1" } });
    mocks.findUnique.mockResolvedValue({ id: "admin-1", name: "站主", email: "admin@example.com", role: "admin", banned: false });
    await expect(requireAdmin()).resolves.toEqual({ id: "admin-1", name: "站主", email: "admin@example.com" });
  });

  it("rejects missing sessions", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminUnauthorizedError);
  });

  it("rejects ordinary and banned users", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.findUnique.mockResolvedValue({ id: "user-1", name: "凡人", email: "u@example.com", role: "user", banned: false });
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminForbiddenError);
    mocks.findUnique.mockResolvedValue({ id: "user-1", name: "凡人", email: "u@example.com", role: "admin", banned: true });
    await expect(requireAdmin()).rejects.toBeInstanceOf(AdminForbiddenError);
  });
});

describe("withAdmin", () => {
  it("maps missing sessions to 401 and forbidden users to 403", async () => {
    const handler = withAdmin(async () => Response.json({ ok: true }));
    mocks.getSession.mockResolvedValue(null);
    expect((await handler()).status).toBe(401);
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.findUnique.mockResolvedValue({ id: "user-1", name: "凡人", email: "u@example.com", role: "user", banned: false });
    expect((await handler()).status).toBe(403);
  });
});
