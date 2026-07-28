import { describe, expect, it } from "vitest";
import { assertAdminConfirmation, assertAdminMutationAllowed, parseAdminPage, redactAdminError } from "./security";

function params(entries: Record<string, string>) {
  const value = new URLSearchParams();
  for (const [key, item] of Object.entries(entries)) value.set(key, item);
  return value;
}

describe("parseAdminPage", () => {
  it("defaults to 25 rows and caps page sizes at 100", () => {
    expect(parseAdminPage(new URLSearchParams())).toEqual({ page: 1, pageSize: 25, skip: 0 });
    expect(parseAdminPage(params({ page: "3", pageSize: "999" }))).toEqual({ page: 3, pageSize: 100, skip: 200 });
  });

  it("normalizes invalid values", () => {
    expect(parseAdminPage(params({ page: "-2", pageSize: "nope" }))).toEqual({ page: 1, pageSize: 25, skip: 0 });
  });
});

describe("redactAdminError", () => {
  it("redacts tokens, API keys and URL credentials", () => {
    const value = redactAdminError("Bearer secret-token-123456789 sk-live-abcdefghijklmnopqrstuvwxyz https://alice:password@example.com/path");
    expect(value).not.toContain("secret-token");
    expect(value).not.toContain("sk-live");
    expect(value).not.toContain("password");
    expect(value).toContain("[已隐藏]");
  });

  it("truncates summaries", () => {
    expect(redactAdminError("x".repeat(2_000))).toHaveLength(500);
  });
});

describe("assertAdminMutationAllowed", () => {
  it("rejects self-directed dangerous actions", () => {
    for (const action of ["ban-user", "delete-user", "demote-user"] as const) {
      expect(() => assertAdminMutationAllowed({ action, actorUserId: "u1", targetUserId: "u1", activeAdminCount: 2 }))
        .toThrow("不能对自己的管理员账号执行此操作");
    }
  });

  it("rejects removal of the last active admin", () => {
    expect(() => assertAdminMutationAllowed({ action: "demote-user", actorUserId: "owner", targetUserId: "admin-2", activeAdminCount: 1, targetIsActiveAdmin: true }))
      .toThrow("不能移除最后一个有效管理员");
  });
});

describe("assertAdminConfirmation", () => {
  it("requires a reason and an exact label match", () => {
    expect(() => assertAdminConfirmation({ expected: "world-name", confirmation: "World-name", reason: "清理" })).toThrow("确认文字不匹配");
    expect(() => assertAdminConfirmation({ expected: "world-name", confirmation: "world-name", reason: " " })).toThrow("必须填写操作原因");
    expect(() => assertAdminConfirmation({ expected: "world-name", confirmation: "world-name", reason: "用户请求删除" })).not.toThrow();
  });
});
