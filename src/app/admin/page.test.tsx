import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  loadAdminTaskWorkbench: vi.fn(),
  loadAdminDashboard: vi.fn(),
  loadAdminAnalysis: vi.fn(),
}));

vi.mock("@/lib/admin/workbench", () => ({
  loadAdminTaskWorkbench: dependencies.loadAdminTaskWorkbench,
}));
vi.mock("@/lib/admin/dashboard", () => ({
  loadAdminDashboard: dependencies.loadAdminDashboard,
}));
vi.mock("@/lib/admin/analysis", () => ({
  loadAdminAnalysis: dependencies.loadAdminAnalysis,
}));
vi.mock("@/components/admin/AdminRefreshButton", () => ({
  AdminRefreshButton: () => <button type="button">刷新当前视图</button>,
}));

import AdminPage from "./page";

const readyResult = {
  state: "ready" as const,
  generatedAt: new Date("2026-07-29T04:00:00.000Z"),
  counts: { attention: 0, failed: 0, stale: 0, repeated: 0, recoveredToday: 2 },
  items: [],
  selected: null,
};

describe("AdminPage task workbench", () => {
  beforeEach(() => {
    dependencies.loadAdminTaskWorkbench.mockReset();
    dependencies.loadAdminDashboard.mockReset();
    dependencies.loadAdminAnalysis.mockReset();
    dependencies.loadAdminDashboard.mockRejectedValue(new Error("legacy dashboard loader called"));
    dependencies.loadAdminAnalysis.mockResolvedValue({});
  });

  it("awaits and normalizes URL parameters before loading the workbench", async () => {
    dependencies.loadAdminTaskWorkbench.mockResolvedValue(readyResult);

    const page = await AdminPage({
      searchParams: Promise.resolve({
        view: "repeated",
        q: "  薄暮  ",
        task: "genesis:genesis-001",
      }),
    });
    const markup = renderToStaticMarkup(page);

    expect(dependencies.loadAdminTaskWorkbench).toHaveBeenCalledWith({
      view: "repeated",
      search: "薄暮",
      selected: "genesis:genesis-001",
    });
    expect(dependencies.loadAdminDashboard).not.toHaveBeenCalled();
    expect(markup).toContain("任务工作台");
    expect(markup).toContain("当前筛选条件下没有需要处理的任务。");
  });

  it("defaults invalid and repeated parameters without using array values", async () => {
    dependencies.loadAdminTaskWorkbench.mockResolvedValue(readyResult);

    await AdminPage({
      searchParams: Promise.resolve({
        view: "unknown",
        q: ["ignored", "values"],
        task: ["genesis:first", "genesis:second"],
      }),
    });

    expect(dependencies.loadAdminTaskWorkbench).toHaveBeenCalledWith({
      view: "attention",
      search: "",
      selected: null,
    });
  });

  it("renders the page-level unavailable message and refresh control without empty-state copy", async () => {
    dependencies.loadAdminTaskWorkbench.mockResolvedValue({ state: "unavailable", message: "任务数据暂不可用" });

    const page = await AdminPage({ searchParams: Promise.resolve({}) });
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("任务数据暂不可用");
    expect(markup).toContain("刷新当前视图");
    expect(markup).not.toContain("当前筛选条件下没有需要处理的任务。");
  });
});
