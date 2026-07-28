import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LoginForm,
  discordCallbackURL,
  discordErrorCallbackURL,
  discordErrorMessage,
  safeNext,
} from "./LoginForm";

describe("safeNext", () => {
  it.each([
    [null, "/"],
    ["/play/w1", "/play/w1"],
    ["//evil.example", "/"],
    ["https://evil.example", "/"],
  ])("把 %s 收敛为 %s", (raw, expected) => {
    expect(safeNext(raw)).toBe(expected);
  });
});

describe("Discord OAuth 回跳", () => {
  it.each([
    [null, "/"],
    ["/play/w1?tab=codex", "/play/w1?tab=codex"],
    ["//evil.example", "/"],
    ["https://evil.example", "/"],
  ])("成功回跳把 %s 收敛为 %s", (raw, expected) => {
    expect(discordCallbackURL(raw)).toBe(expected);
  });

  it("错误回跳保留安全的 next 参数", () => {
    expect(discordErrorCallbackURL("/play/w1?tab=codex")).toBe(
      "/login?next=%2Fplay%2Fw1%3Ftab%3Dcodex",
    );
    expect(discordErrorCallbackURL("//evil.example")).toBe("/login");
  });
});

describe("Discord OAuth 错误文案", () => {
  it.each([
    ["access_denied", "已取消 Discord 授权。"],
    ["account_not_linked", "该邮箱已有账号，请先使用原登录方式进入。"],
    ["email_not_found", "Discord 账号未提供邮箱，无法注册。"],
    ["invalid_code", "未能连接 Discord 完成授权，请重新尝试。"],
    ["unexpected", "Discord 登录失败，请重新尝试。"],
  ])("把 %s 映射为中文提示", (code, expected) => {
    expect(discordErrorMessage(code)).toBe(expected);
  });
});

describe("Discord 登录入口", () => {
  it("配置 Discord 时显示开放注册入口", () => {
    const html = renderToStaticMarkup(createElement(LoginForm, { discordEnabled: true }));
    expect(html).toContain("使用 Discord 注册 / 登录");
    expect(html).toContain("或使用邮箱登入");
    expect(html).toContain("login-tome");
    expect(html).toContain("max-w-[31rem]");
  });

  it("未配置 Discord 时隐藏入口并保留邮箱表单", () => {
    const html = renderToStaticMarkup(createElement(LoginForm, { discordEnabled: false }));
    expect(html).not.toContain("使用 Discord 注册 / 登录");
    expect(html).toContain("login-email");
    expect(html).toContain("login-password");
  });
});
