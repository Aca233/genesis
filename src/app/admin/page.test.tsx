import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAttentionTask } from "@/lib/admin/task-attention";

const dependencies = vi.hoisted(() => ({
  loadAdminTaskWorkbench: vi.fn(),
  loadAdminDashboard: vi.fn(),
  loadAdminAnalysis: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: dependencies.redirect,
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

const selectedTask: AdminAttentionTask = {
  kind: "genesis",
  id: "genesis-001",
  status: "failed",
  stage: "deck_generation",
  attempt: 3,
  leaseExpiresAt: null,
  createdAt: new Date("2026-07-29T03:00:00.000Z"),
  updatedAt: new Date("2026-07-29T03:42:00.000Z"),
  error: "模型调用失败",
  user: { id: "user-001", name: "值守样本", email: "sample@example.com" },
  world: { id: "world-001", name: "薄暮之海" },
  reason: "repeated_failure",
  severity: "high",
  recommendation: "rerun",
  explanation: "创世任务在生成阶段连续失败。",
  impactSummary: "世界尚未完成创建。",
};

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
    dependencies.redirect.mockReset();
    dependencies.redirect.mockImplementation((href: string) => {
      throw new Error(`NEXT_REDIRECT:${href}`);
    });
    dependencies.loadAdminDashboard.mockRejectedValue(new Error("legacy dashboard loader called"));
    dependencies.loadAdminAnalysis.mockResolvedValue({});
  });

  it("awaits and normalizes URL parameters before loading the workbench", async () => {
    dependencies.loadAdminTaskWorkbench.mockResolvedValue({
      ...readyResult,
      counts: { ...readyResult.counts, attention: 1, failed: 1, repeated: 1 },
      items: [selectedTask],
      selected: selectedTask,
    });

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
    expect(dependencies.redirect).not.toHaveBeenCalled();
    expect(markup).toContain("任务工作台");
    expect(markup).toContain("value=\"genesis:genesis-001\"");
  });

  it("canonicalizes task out of the URL when a new q no longer matches the selected task", async () => {
    dependencies.loadAdminTaskWorkbench.mockResolvedValue(readyResult);

    await expect(AdminPage({
      searchParams: Promise.resolve({
        view: "failed",
        q: "不匹配的世界",
        task: "genesis:genesis-001",
      }),
    })).rejects.toThrow("NEXT_REDIRECT:/admin?view=failed&q=%E4%B8%8D%E5%8C%B9%E9%85%8D%E7%9A%84%E4%B8%96%E7%95%8C");

    expect(dependencies.redirect).toHaveBeenCalledWith("/admin?view=failed&q=%E4%B8%8D%E5%8C%B9%E9%85%8D%E7%9A%84%E4%B8%96%E7%95%8C");
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
