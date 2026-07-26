import { AsyncLocalStorage } from "node:async_hooks";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

// next/experimental/testing/server 在模块加载期即要求 globalThis.AsyncLocalStorage
// (真实 Next 服务器运行时会注入;vitest node 环境需在动态 import 之前手动补上)。
Reflect.set(globalThis, "AsyncLocalStorage", AsyncLocalStorage);
// 注:proxy.md 文档写的是 unstable_doesProxyMatch,但 next@16.2.10 实际导出名
// 仍为 unstable_doesMiddlewareMatch(实验 API 更名未跟上文件约定改名),语义相同。
const { unstable_doesMiddlewareMatch } = await import(
  "next/experimental/testing/server"
);

const SESSION_COOKIE = "better-auth.session_token=stub-token";

function requestOf(path: string, withCookie = false): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: withCookie ? { cookie: SESSION_COOKIE } : {},
  });
}

describe("proxy config.matcher", () => {
  it.each(["/api/worlds", "/_next/static/x.js", "/favicon.ico", "/fonts/x.woff2"])(
    "不匹配 %s(API 与静态资源不过导航门)",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );

  it.each(["/", "/play/w1", "/login"])("匹配页面导航 %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });
});

describe("proxy 乐观 cookie 重定向", () => {
  it("无 cookie 访问受保护页 → 重定向 /login 并带 next=path+search", () => {
    const response = proxy(requestOf("/play/w1?tab=codex"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?next=%2Fplay%2Fw1%3Ftab%3Dcodex",
    );
  });

  it("无 cookie 访问根路径 → 重定向 /login 不带 next 参数", () => {
    const response = proxy(requestOf("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("带 cookie 访问受保护页 → 放行", () => {
    const response = proxy(requestOf("/play/w1", true));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("带 cookie 访问 /login → 重定向回首页", () => {
    const response = proxy(requestOf("/login", true));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
  });

  it("无 cookie 访问 /login → 放行", () => {
    const response = proxy(requestOf("/login"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
