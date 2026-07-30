import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  pathname: "/admin",
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));

const transition = vi.hoisted(() => ({
  pending: false,
  start: vi.fn<(callback: () => void) => void>(),
}));

const auth = vi.hoisted(() => {
  class AdminUnauthorizedError extends Error {}
  class AdminForbiddenError extends Error {}
  return {
    AdminForbiddenError,
    AdminUnauthorizedError,
    requireAdmin: vi.fn(),
  };
});

const workbench = vi.hoisted(() => ({
  loadAdminAttentionCount: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useTransition: () => [transition.pending, transition.start] as const,
  };
});

vi.mock("next/link", async () => {
  const ReactModule = await import("react");
  return {
    default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
      ReactModule.createElement("a", props, children),
  };
});

vi.mock("next/navigation", () => ({
  notFound: navigation.notFound,
  usePathname: () => navigation.pathname,
  useRouter: () => ({
    push: navigation.push,
    refresh: navigation.refresh,
    replace: navigation.replace,
  }),
}));

vi.mock("@/components/play/PlayBackground", () => ({ PlayBackground: () => null }));
vi.mock("@/lib/auth/admin", () => auth);
vi.mock("@/lib/admin/workbench", () => workbench);

import AdminLayout from "@/app/admin/layout";
import { AdminNav } from "./AdminNav";
import { AdminRefreshButton } from "./AdminRefreshButton";
import { AdminShell } from "./AdminShell";

function renderNav(attentionCount: number | null) {
  return renderToStaticMarkup(<AdminNav attentionCount={attentionCount} />);
}

describe("admin task navigation", () => {
  beforeEach(() => {
    auth.requireAdmin.mockReset();
    workbench.loadAdminAttentionCount.mockReset();
    navigation.notFound.mockClear();
    navigation.pathname = "/admin";
    navigation.push.mockClear();
    navigation.refresh.mockClear();
    navigation.replace.mockClear();
    transition.pending = false;
    transition.start.mockReset();
    transition.start.mockImplementation((callback) => callback());
  });

  it("starts authorization and attention-count loading in parallel", async () => {
    let resolveAdmin!: (admin: { name: string }) => void;
    auth.requireAdmin.mockReturnValue(new Promise((resolve) => { resolveAdmin = resolve; }));
    workbench.loadAdminAttentionCount.mockResolvedValue(7);

    const rendered = AdminLayout({ children: <p>content</p> });
    await Promise.resolve();
    const countStartedBeforeAdminResolved = workbench.loadAdminAttentionCount.mock.calls.length;
    resolveAdmin({ name: "Admin" });
    const layout = await rendered;

    expect(countStartedBeforeAdminResolved).toBe(1);
    expect(layout.props).toMatchObject({ adminName: "Admin", attentionCount: 7 });
  });

  it("logs attention-count failures and passes null", async () => {
    const failure = new Error("database unavailable");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    auth.requireAdmin.mockResolvedValue({ name: "Admin" });
    workbench.loadAdminAttentionCount.mockRejectedValue(failure);

    const layout = await AdminLayout({ children: <p>content</p> });

    expect(layout.props.attentionCount).toBeNull();
    expect(error).toHaveBeenCalledWith("[admin.layout] attention count failed", failure);
    error.mockRestore();
  });

  it.each([
    ["unauthorized", () => new auth.AdminUnauthorizedError()],
    ["forbidden", () => new auth.AdminForbiddenError()],
  ])("retains the %s authorization-to-404 behavior", async (_name, createError) => {
    auth.requireAdmin.mockRejectedValue(createError());
    workbench.loadAdminAttentionCount.mockResolvedValue(0);

    await expect(AdminLayout({ children: <p>content</p> })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(navigation.notFound).toHaveBeenCalledOnce();
  });

  it("renders the required groups and links in order with a numeric count", () => {
    const markup = renderNav(5);
    const expectedText = [
      "处置",
      "任务工作台",
      "需要处理",
      "全部任务",
      "历史与筛选",
      "对象",
      "用户",
      "身份与会话",
      "世界",
      "状态与归属",
      "观测",
      "模型调用",
      "质量与消耗",
      "管理审计",
      "操作与追责",
    ];

    expect(expectedText.every((text, index) => index === 0 || markup.indexOf(expectedText[index - 1]) < markup.indexOf(text))).toBe(true);
    expect(markup).toContain("aria-current=\"page\"");
    expect(markup).toContain("class=\"admin-nav__count\"");
    expect(markup).toContain("aria-label=\"5 项需要处理\">5</span>");
  });

  it("renders zero but omits an unavailable count", () => {
    expect(renderNav(0)).toContain("aria-label=\"0 项需要处理\">0</span>");
    expect(renderNav(null)).not.toContain("admin-nav__count");
  });

  it("activates the nested task route instead of the workbench root", () => {
    navigation.pathname = "/admin/tasks/history";

    const markup = renderNav(null);

    expect(markup).toContain("href=\"/admin/tasks\" aria-current=\"page\"");
    expect(markup).not.toContain("href=\"/admin\" aria-current=\"page\"");
  });

  it("uses the same counted navigation for desktop and mobile", () => {
    const markup = renderToStaticMarkup(<AdminShell adminName="Admin" attentionCount={3}><p>content</p></AdminShell>);

    expect(markup.match(/aria-label=\"3 项需要处理\">3<\/span>/g)).toHaveLength(2);
    expect(markup.match(/class=\"admin-nav__heading\">处置<\/h2>/g)).toHaveLength(2);
    expect(markup).toContain("管理中枢 / 任务处置");
    expect(markup).toContain("正文边界已启用");
    expect(markup).not.toContain("/admin?refresh=1");
  });

  it("refreshes the current route through a transition without navigating", () => {
    const button = AdminRefreshButton();

    expect(button.props).toMatchObject({ type: "button", disabled: false });
    expect(button.props.children).toBe("刷新当前视图");
    expect(button.props.href).toBeUndefined();
    button.props.onClick();

    expect(transition.start).toHaveBeenCalledOnce();
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("disables the refresh button and reports its pending state", () => {
    transition.pending = true;

    const button = AdminRefreshButton();

    expect(button.props.disabled).toBe(true);
    expect(button.props.children).toBe("刷新中…");
  });
});
