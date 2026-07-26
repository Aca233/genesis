import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError, unauthorizedJson } from "./errors";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

vi.mock("./index", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

import { requireUserId } from "./session";

// 注:requireUserId 被 React cache() 包裹,但客户端构建的 cache 在 RSC 请求
// 上下文之外是无记忆直通(已验证),两用例间不会串扰,无需 vi.resetModules()。
describe("requireUserId", () => {
  beforeEach(() => {
    mocks.headers.mockResolvedValue(new Headers());
  });

  it("有会话时返回 user.id", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    await expect(requireUserId()).resolves.toBe("user-1");
    expect(mocks.getSession).toHaveBeenCalledWith({ headers: expect.any(Headers) });
  });

  it("无会话时抛 UnauthorizedError", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(requireUserId()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("unauthorizedJson", () => {
  it("UnauthorizedError → 401 JSON { error: \"未登录或会话已过期\" }", async () => {
    const res = unauthorizedJson(new UnauthorizedError());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    await expect(res!.json()).resolves.toEqual({ error: "未登录或会话已过期" });
  });

  it("非鉴权错误返回 null", () => {
    expect(unauthorizedJson(new Error("boom"))).toBeNull();
    expect(unauthorizedJson("not-an-error")).toBeNull();
    expect(unauthorizedJson(undefined)).toBeNull();
  });
});
