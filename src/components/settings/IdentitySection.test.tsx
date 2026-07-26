import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IdentitySection, validatePasswordChange } from "./IdentitySection";

describe("validatePasswordChange", () => {
  it("旧密语为空时要求先填旧密语", () => {
    expect(validatePasswordChange("", "x")).toBe("请先填旧密语。");
  });

  it("新密语不足八字时被拒", () => {
    expect(validatePasswordChange("old", "short")).toBe("新密语至少八个字符。");
  });

  it("新旧相同被拒", () => {
    expect(validatePasswordChange("samepass", "samepass")).toBe("新旧密语不可相同。");
  });

  it("合规改密放行（返回 null）", () => {
    expect(validatePasswordChange("oldpass1", "newpass1")).toBeNull();
  });
});

describe("IdentitySection", () => {
  it("渲染执笔者小节：印信占位、登出与改密控件齐备", () => {
    // renderToStaticMarkup 不跑 effect，无需 mock fetch；邮箱显示挂载占位「验印中…」
    const html = renderToStaticMarkup(createElement(IdentitySection));

    expect(html).toContain("执笔者");
    expect(html).toContain("登出此界");
    expect(html).toContain("改换密语");
    expect(html).toContain("验印中…");
    expect(html.match(/type="password"/g)).toHaveLength(2);
    // React 19 的 renderToStaticMarkup 按原样输出 autoComplete 属性名，这里对大小写不敏感断言
    expect(html).toMatch(/autocomplete="new-password"/i);
    expect(html).toMatch(/autocomplete="current-password"/i);
  });
});
