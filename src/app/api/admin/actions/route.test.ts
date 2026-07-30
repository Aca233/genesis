import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/admin", () => ({
  withAdmin: (handler: (admin: { id: string; name: string; email: string }, request: Request) => Promise<Response>) =>
    (request: Request) => handler({ id: "admin-1", name: "Admin", email: "admin@example.com" }, request),
}));
vi.mock("@/lib/admin/actions", () => ({
  mutateAdminTask: vi.fn(),
  mutateAdminUser: vi.fn(),
  mutateAdminWorld: vi.fn(),
}));

import { POST } from "./route";

describe("POST /api/admin/actions", () => {
  it("returns field-level Zod errors for invalid admin action fields", async () => {
    const response = await POST(new Request("http://localhost/api/admin/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetType: "task", kind: "genesis", taskId: "task-1", action: "retry", reason: "a" }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "管理操作参数无效",
      fields: { reason: [expect.any(String)] },
    });
  });

  it("returns confirmation field errors for invalid permanent-action input", async () => {
    const response = await POST(new Request("http://localhost/api/admin/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetType: "user",
        targetUserId: "user-1",
        action: "delete",
        reason: "用户请求删除",
        confirmation: "x".repeat(321),
      }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "管理操作参数无效",
      fields: { confirmation: [expect.any(String)] },
    });
  });
});
