import { describe, expect, it } from "vitest";
import { taskActionCopy, validateAdminActionForm } from "./action-form";

describe("validateAdminActionForm", () => {
  it("requires a two-character trimmed reason", () => {
    expect(validateAdminActionForm(" a ", undefined, "")).toEqual({ reason: "操作原因至少需要 2 个字" });
  });

  it("rejects reasons longer than 500 characters", () => {
    expect(validateAdminActionForm("处".repeat(501), undefined, "")).toEqual({ reason: "操作原因不能超过 500 个字" });
  });

  it("requires an exact permanent-action confirmation", () => {
    expect(validateAdminActionForm("用户请求", "u@example.com", "U@example.com")).toEqual({ confirmation: "确认文字不匹配" });
  });

  it("accepts a valid audited action", () => {
    expect(validateAdminActionForm(" 重新排队 ", undefined, "")).toEqual({});
    expect(validateAdminActionForm("用户请求永久删除", "u@example.com", "u@example.com")).toEqual({});
  });
});

describe("taskActionCopy", () => {
  it("uses the approved task action labels and impact copy", () => {
    expect(taskActionCopy).toEqual({
      retry: { label: "重新执行", impact: "保留失败记录，从允许恢复的位置重新开始。" },
      recover: { label: "恢复任务", impact: "清除过期租约并重新进入可执行状态。" },
      cancel: { label: "取消任务", impact: "停止后续执行并保留当前故障证据。" },
    });
  });
});
