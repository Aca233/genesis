import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminAttentionTask } from "@/lib/admin/task-attention";

vi.mock("./AdminActionButton", () => ({
  AdminActionButton: (props: { label: string; targetLabel: string; currentState: string; impact: string; payload: Record<string, string> }) => <button
    type="button"
    data-action={props.payload.action}
    data-impact={props.impact}
    data-target={props.targetLabel}
    data-state={props.currentState}
  >{props.label}</button>,
}));
import { AdminAttentionQueue, workbenchHref } from "./AdminAttentionQueue";
import { AdminTaskDetail } from "./AdminTaskDetail";

const now = new Date("2026-07-29T04:00:00.000Z");

function attentionTask(overrides: Partial<AdminAttentionTask> = {}): AdminAttentionTask {
  return {
    kind: "genesis",
    id: "genesis-001",
    status: "failed",
    stage: "deck_generation",
    attempt: 3,
    leaseExpiresAt: null,
    createdAt: new Date("2026-07-29T03:00:00.000Z"),
    updatedAt: new Date("2026-07-29T03:42:00.000Z"),
    error: "模型调用失败",
    user: { id: "user/001", name: "值守样本", email: "sample@example.com" },
    world: { id: "world 001", name: "薄暮之海" },
    reason: "repeated_failure",
    severity: "high",
    recommendation: "rerun",
    explanation: "创世任务在生成阶段连续失败。",
    impactSummary: "世界尚未完成创建。",
    ...overrides,
  };
}

describe("AdminAttentionQueue", () => {
  it("builds encoded URLs from the current view, query, and task", () => {
    expect(workbenchHref(
      { view: "failed", q: "星 海", task: "genesis:g-1" },
      { task: "rewrite:r/1" },
    )).toBe("/admin?view=failed&q=%E6%98%9F+%E6%B5%B7&task=rewrite%3Ar%2F1");
  });

  it("renders readable linked rows and retains selection only in compatible filters", () => {
    const selected = attentionTask();
    const narrative = attentionTask({
      kind: "narrative",
      id: "narrative-002",
      attempt: 1,
      reason: "failed",
      severity: "medium",
      recommendation: "inspect",
      world: null,
      stage: null,
    });
    const markup = renderToStaticMarkup(<AdminAttentionQueue
      counts={{ attention: 2, failed: 2, stale: 0, repeated: 1, recoveredToday: { state: "ready", value: 4 } }}
      total={2}
      hasMore={false}
      items={[selected, narrative]}
      selected={selected}
      filters={{ view: "attention", q: "薄暮", task: "genesis:genesis-001" }}
      now={now}
    />);

    expect(markup).toContain("高优先级");
    expect(markup).toContain("需处理");
    expect(markup).toContain("创世任务");
    expect(markup).toContain("叙事生成");
    expect(markup).toContain("连续失败");
    expect(markup).toContain("失败");
    expect(markup).toContain("阶段未知");
    expect(markup).toContain("18 分钟前");
    expect(markup).toContain("查看详情");
    expect(markup).toContain("dateTime=\"2026-07-29T03:42:00.000Z\"");
    expect(markup).toContain("aria-current=\"true\"");
    expect(markup).toContain("任务 genesis-001");
    expect(markup).toContain("href=\"/admin?view=failed&amp;q=%E8%96%84%E6%9A%AE\"");
    expect(markup).not.toContain("href=\"/admin?view=failed&amp;q=%E8%96%84%E6%9A%AE&amp;task=");
    expect(markup).toContain("href=\"/admin?view=stale&amp;q=%E8%96%84%E6%9A%AE\"");
    expect(markup).toContain("href=\"/admin?view=attention&amp;q=%E8%96%84%E6%9A%AE&amp;task=narrative%3Anarrative-002\"");
    expect(markup).toContain("type=\"hidden\" name=\"task\" value=\"genesis:genesis-001\"");
  });


  it("shows partial recovery availability, overflow disclosure, and a real full-collection link", () => {
    const markup = renderToStaticMarkup(<AdminAttentionQueue
      counts={{ attention: 63, failed: 60, stale: 3, repeated: 8, recoveredToday: { state: "unavailable" } }}
      items={[attentionTask()]}
      total={63}
      hasMore
      selected={null}
      filters={{ view: "attention", q: "", task: null }}
      now={now}
    />);

    expect(markup).toContain("今日已恢复");
    expect(markup).toContain("数据暂不可用");
    expect(markup).not.toContain("今日已恢复 <strong>0</strong>");
    expect(markup).toContain("当前展示前 1 条 / 共 63 条");
    expect(markup).toContain('href="/admin/tasks?attention=yes"');
    expect(markup).toContain("查看完整集合");
  });

  it("distinguishes the default attention empty state from filtered no-results", () => {
    const defaultEmpty = renderToStaticMarkup(<AdminAttentionQueue
      counts={{ attention: 0, failed: 0, stale: 0, repeated: 0, recoveredToday: { state: "ready", value: 0 } }}
      items={[]}
      total={0}
      hasMore={false}
      selected={null}
      filters={{ view: "attention", q: "", task: null }}
      now={now}
    />);
    expect(defaultEmpty).toContain("当前没有需要处理的任务");
    expect(defaultEmpty).not.toContain("清除筛选");

    const filteredEmpty = renderToStaticMarkup(<AdminAttentionQueue
      counts={{ attention: 4, failed: 2, stale: 2, repeated: 0, recoveredToday: { state: "ready", value: 0 } }}
      items={[]}
      total={0}
      hasMore={false}
      selected={null}
      filters={{ view: "stale", q: "雾港", task: null }}
      now={now}
    />);
    expect(filteredEmpty).toContain("没有符合当前条件的任务");
    expect(filteredEmpty).toContain('href="/admin"');
    expect(filteredEmpty).toContain("清除筛选");
  });

});

describe("AdminTaskDetail", () => {
  it("renders metadata links and the explicit non-reexecution guidance for narrative failures", () => {
    const task = attentionTask({
      kind: "narrative",
      id: "request/007",
      attempt: 2,
      reason: "failed",
      severity: "medium",
      recommendation: "inspect",
    });
    const markup = renderToStaticMarkup(<AdminTaskDetail task={task} now={now} />);

    for (const label of ["发生了什么", "影响对象", "当前阶段", "尝试次数", "数据风险", "建议操作"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("管理员不能直接重新执行叙事任务；请检查模型调用或由原世界重新发起。");
    expect(markup).toContain("href=\"/admin/llm?userId=user%2F001&amp;worldId=world%20001&amp;ok=no\"");
    expect(markup).toContain("href=\"/admin/audit?targetId=request%2F007\"");
    expect(markup).toContain("href=\"/admin/worlds?search=world%20001\"");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("重新执行</");
    expect(markup).not.toContain("恢复任务</");
  });

  it("renders approved reexecution copy for failed non-narrative tasks", () => {
    const markup = renderToStaticMarkup(<AdminTaskDetail task={attentionTask({ attempt: 1, reason: "failed", recommendation: "rerun" })} now={now} />);

    expect(markup).toContain(">重新执行</button>");
    expect(markup).toContain("data-impact=\"保留失败记录，从允许恢复的位置重新开始。\"");
    expect(markup).toContain("data-state=\"failed · deck_generation\"");
    expect(markup).not.toContain(">重试</button>");
  });

  it("uses allowed action rules to render recovery controls with target and impact copy", () => {
    const task = attentionTask({
      status: "running",
      attempt: 1,
      leaseExpiresAt: new Date("2026-07-29T03:30:00.000Z"),
      reason: "stale",
      recommendation: "recover",
    });
    const markup = renderToStaticMarkup(<AdminTaskDetail task={task} now={now} />);

    expect(markup).toContain("建议恢复任务");
    expect(markup).toContain("当前规则允许：恢复任务、取消任务");
    expect(markup).toContain(">恢复任务</button>");
    expect(markup).toContain(">取消任务</button>");
    expect(markup).toContain("data-target=\"创世任务 · 薄暮之海\"");
    expect(markup).toContain("data-impact=\"清除过期租约并重新进入可执行状态。\"");
  });
});

describe("task workbench styles", () => {
  it("keeps the workbench responsive, keyboard-visible, and reduced-motion safe", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.admin-workbench-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1\.45fr\)\s+minmax\(20rem,\s*\.8fr\)/);
    expect(css).toMatch(/\.admin-workbench-row:focus-visible[\s\S]*?outline:\s*2px solid var\(--gilt-strong\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*1024px\)[\s\S]*?\.admin-workbench-layout\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.admin-workbench-row[^{]*\{[\s\S]*?transition:\s*none[\s\S]*?transform:\s*none/);
    expect(css).toMatch(/\.admin-workbench-filters a\s*\{[\s\S]*?min-height:\s*40px/);
    expect(css).toMatch(/\.admin-workbench-search input,[^{]*\.admin-workbench-search button,[^{]*\.admin-workbench-search a\s*\{[\s\S]*?min-height:\s*40px/);
    expect(css).toMatch(/\.admin-workbench-header p\s*\{[\s\S]*?font-size:\s*\.75rem/);
    expect(css).toMatch(/\.admin-workbench-eyebrow\s*\{[\s\S]*?font:[^;}]*\.6875rem/);
    expect(css).toMatch(/\.admin-workbench\s*\{[\s\S]*?overflow-x:\s*clip/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.admin-workbench-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.admin-workbench-row__identity\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1[\s\S]*?grid-row:\s*2/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.admin-workbench-row__reason\s*\{[\s\S]*?grid-column:\s*1[\s\S]*?grid-row:\s*3[\s\S]*?\.admin-workbench-row>time\s*\{[\s\S]*?grid-column:\s*2[\s\S]*?grid-row:\s*3/);
  });
});
