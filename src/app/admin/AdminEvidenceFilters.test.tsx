import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  listAdminTasks: vi.fn(),
  listAdminLlmCalls: vi.fn(),
  listAdminAudit: vi.fn(),
}));

vi.mock("@/lib/admin/data", () => dependencies);

import AdminAuditPage from "./audit/page";
import AdminLlmPage from "./llm/page";
import AdminTasksPage from "./tasks/page";
import { normalizePageParams, PageNav } from "@/components/admin/AdminList";

function emptyResult() {
  return { items: [], total: 0 };
}

describe("admin drill-down page parameters", () => {
  beforeEach(() => {
    dependencies.listAdminTasks.mockReset().mockResolvedValue(emptyResult());
    dependencies.listAdminLlmCalls.mockReset().mockResolvedValue(emptyResult());
    dependencies.listAdminAudit.mockReset().mockResolvedValue(emptyResult());
  });

  it("parses and passes every task filter and renders programmatic labels", async () => {
    const page = await AdminTasksPage({ searchParams: Promise.resolve({
      kind: "genesis", status: "failed", search: "  雾港  ", attention: "yes", stale: "yes", repeated: "yes", page: "2", pageSize: "10",
    }) });
    const markup = renderToStaticMarkup(page);

    expect(dependencies.listAdminTasks).toHaveBeenCalledWith({
      kind: "genesis", status: "failed", search: "雾港", attention: "yes", stale: "yes", repeated: "yes", page: 2, pageSize: 10, skip: 10,
    });
    for (const label of ["搜索任务", "任务类型", "任务状态", "需要处理", "疑似失租", "连续失败"]) expect(markup).toContain(label);
    expect(markup).toContain("没有符合当前条件的记录");
    expect(markup).toContain('href="/admin/tasks"');
  });

  it("passes exact LLM context filters and distinguishes filtered and domain empty states", async () => {
    const filtered = await AdminLlmPage({ searchParams: Promise.resolve({ ok: "no", task: "narrative", userId: "user/1", worldId: "world 1" }) });
    const filteredMarkup = renderToStaticMarkup(filtered);

    expect(dependencies.listAdminLlmCalls).toHaveBeenCalledWith(expect.objectContaining({ ok: "no", task: "narrative", userId: "user/1", worldId: "world 1" }));
    for (const label of ["调用结果", "任务类型", "用户 ID", "世界 ID"]) expect(filteredMarkup).toContain(label);
    expect(filteredMarkup).toContain("没有符合当前条件的记录");
    expect(filteredMarkup).toContain('href="/admin/llm"');

    const unfiltered = await AdminLlmPage({ searchParams: Promise.resolve({}) });
    expect(renderToStaticMarkup(unfiltered)).toContain("当前没有模型调用记录");
  });

  it("passes exact audit filters and distinguishes filtered and domain empty states", async () => {
    const filtered = await AdminAuditPage({ searchParams: Promise.resolve({ targetId: "task/1", action: "task.retry", success: "yes" }) });
    const filteredMarkup = renderToStaticMarkup(filtered);

    expect(dependencies.listAdminAudit).toHaveBeenCalledWith(expect.objectContaining({ targetId: "task/1", action: "task.retry", success: "yes" }));
    for (const label of ["目标 ID", "操作", "执行结果"]) expect(filteredMarkup).toContain(label);
    expect(filteredMarkup).toContain("没有符合当前条件的记录");
    expect(filteredMarkup).toContain('href="/admin/audit"');

    const unfiltered = await AdminAuditPage({ searchParams: Promise.resolve({}) });
    expect(renderToStaticMarkup(unfiltered)).toContain("尚无管理操作记录");
  });
});

describe("PageNav filter preservation", () => {
  it("omits defaults only for keys where the value is actually the server default", () => {
    expect(normalizePageParams({
      kind: "all", status: "all", ok: "no", success: "no", attention: "no",
      targetId: "all", userId: "all", worldId: "all", search: "all",
    })).toEqual({
      ok: "no", success: "no", targetId: "all", userId: "all", worldId: "all", search: "all",
    });
  });
  it("preserves active values, omits semantic defaults, and URL-encodes values", () => {
    const markup = renderToStaticMarkup(<PageNav
      page={2}
      pageSize={25}
      total={100}
      pathname="/admin/tasks"
      params={{
        kind: "all",
        status: "all",
        attention: "no",
        stale: "yes",
        repeated: "yes",
        search: "雾 港/一",
        targetId: "task / 1",
        userId: "user/1",
        worldId: "world 1",
      }}
    />);

    expect(markup).not.toContain("kind=all");
    expect(markup).not.toContain("status=all");
    expect(markup).not.toContain("attention=no");
    expect(markup).toContain("stale=yes");
    expect(markup).toContain("repeated=yes");
    expect(markup).toContain("search=%E9%9B%BE+%E6%B8%AF%2F%E4%B8%80");
    expect(markup).toContain("targetId=task+%2F+1");
    expect(markup).toContain("userId=user%2F1");
    expect(markup).toContain("worldId=world+1");
  });
});
