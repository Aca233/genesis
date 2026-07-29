import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  listAdminTasks: vi.fn(),
  listAdminUsers: vi.fn(),
  listAdminWorlds: vi.fn(),
}));

vi.mock("@/lib/admin/data", () => data);
vi.mock("@/components/admin/AdminActionButton", () => ({
  AdminActionButton: (props: { label: string; targetLabel: string; impact: string; confirmationLabel?: string; payload: Record<string, string> }) => <button
    type="button"
    data-label={props.label}
    data-target={props.targetLabel}
    data-impact={props.impact}
    data-confirmation={props.confirmationLabel}
    data-action={props.payload.action}
    data-kind={props.payload.kind}
  >{props.label}</button>,
}));

import AdminTasksPage from "@/app/admin/tasks/page";
import AdminUsersPage from "@/app/admin/users/page";
import AdminWorldsPage from "@/app/admin/worlds/page";

const timestamp = new Date("2026-07-29T04:00:00.000Z");

function task(kind: "genesis" | "narrative" | "rewrite", id: string, status: string, leaseExpiresAt: Date | null = null) {
  return {
    kind,
    id,
    status,
    stage: "stage",
    attempt: kind === "rewrite" ? null : 1,
    leaseExpiresAt,
    createdAt: timestamp,
    updatedAt: timestamp,
    error: status === "failed" ? "脱敏错误" : null,
    user: { id: `user-${id}`, name: `用户 ${id}`, email: `${id}@example.com` },
    world: { id: `world-${id}`, name: `世界 ${id}` },
  };
}

describe("admin action call sites", () => {
  beforeEach(() => {
    data.listAdminTasks.mockReset();
    data.listAdminUsers.mockReset();
    data.listAdminWorlds.mockReset();
  });

  it("uses approved task copy, concrete target/impact copy, and hides narrative retry/recover", async () => {
    data.listAdminTasks.mockResolvedValue({
      total: 4,
      items: [
        task("genesis", "genesis-1", "failed"),
        task("narrative", "narrative-failed", "failed"),
        task("narrative", "narrative-pending", "pending", new Date("2026-07-28T00:00:00.000Z")),
        task("rewrite", "rewrite-stale", "running", new Date("2026-07-28T00:00:00.000Z")),
      ],
    });

    const markup = renderToStaticMarkup(await AdminTasksPage({ searchParams: Promise.resolve({}) }));

    expect(markup).toContain(">重新执行</button>");
    expect(markup).not.toContain(">重试</button>");
    expect(markup).not.toContain("恢复失租");
    expect(markup).toContain("data-target=\"创世任务 · 世界 genesis-1\"");
    expect(markup).toContain("data-impact=\"保留失败记录，从允许恢复的位置重新开始。\"");
    expect(markup).toContain("data-impact=\"清除过期租约并重新进入可执行状态。\"");
    expect(markup).toContain("data-impact=\"停止后续执行并保留当前故障证据。\"");
    const narrativeButtons = markup.match(/<button[^>]*data-kind="narrative"[^>]*>/g) ?? [];
    expect(narrativeButtons.some((button) => /data-action="(?:retry|recover)"/.test(button))).toBe(false);
  });

  it("provides target and impact copy for every user action while retaining delete confirmation", async () => {
    data.listAdminUsers.mockResolvedValue({
      total: 1,
      items: [{
        id: "user-1", name: "样本用户", email: "sample@example.com", image: null, role: "user", banned: false, banReason: null,
        createdAt: timestamp, updatedAt: timestamp, accounts: [], _count: { sessions: 2, worlds: 1, genesisTasks: 1 },
      }],
    });

    const markup = renderToStaticMarkup(await AdminUsersPage({ searchParams: Promise.resolve({}) }));
    const buttons = markup.match(/<button[^>]*data-label=/g) ?? [];

    expect(buttons).toHaveLength(4);
    expect(markup.match(/data-target="样本用户 · sample@example.com"/g)).toHaveLength(4);
    expect(markup.match(/data-impact="[^"]+"/g)).toHaveLength(4);
    expect(markup).toContain("data-confirmation=\"sample@example.com\"");
  });

  it("provides target and impact copy for every world action while retaining delete confirmation", async () => {
    data.listAdminWorlds.mockResolvedValue({
      total: 1,
      items: [{
        id: "world-1", name: "样本世界", mode: "solo", status: "playing", archivedAt: null,
        createdAt: timestamp, updatedAt: timestamp, user: { id: "user-1", name: "样本用户", email: "sample@example.com" },
        _count: { timelines: 1, rewrites: 2 },
      }],
    });

    const markup = renderToStaticMarkup(await AdminWorldsPage({ searchParams: Promise.resolve({}) }));
    const buttons = markup.match(/<button[^>]*data-label=/g) ?? [];

    expect(buttons).toHaveLength(2);
    expect(markup.match(/data-target="样本世界 · world-1"/g)).toHaveLength(2);
    expect(markup.match(/data-impact="[^"]+"/g)).toHaveLength(2);
    expect(markup).toContain("data-confirmation=\"样本世界\"");
  });
});
