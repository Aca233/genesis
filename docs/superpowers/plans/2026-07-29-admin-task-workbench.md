# Admin Task Triage Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the data-first admin landing page with a task-first triage workbench where an administrator can find, understand, act on, and verify failed or stale tasks without losing context.

**Architecture:** Keep admin data loading in Server Components and server-only query modules. Introduce a pure task-attention domain module that normalizes the three task families, then use URL search parameters to drive workbench filters and selection. Keep mutations on the existing `/api/admin/actions` boundary; replace browser prompts with one focused Client Component and refresh the current route after successful actions.

**Tech Stack:** Next.js 16.2.10 App Router, React 19.2.4 Server/Client Components, TypeScript 5, Prisma 7.8, Zod 4.4, Vitest 4.1, existing CSS tokens in `src/app/globals.css`.

## Global Constraints

- Read `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`, `03-file-conventions/page.md`, `04-functions/use-router.md`, and `04-functions/use-search-params.md` before implementation.
- Page `searchParams` is a `Promise`; await it in Server Component pages. Prefer the page prop over `useSearchParams` for server-rendered admin data.
- Use Client Components only for browser APIs, local form state, dialog focus, and `router.refresh()`.
- Do not add dependencies.
- Do not add polling, SSE, or WebSocket behavior.
- Do not expose user-authored content, prompts, responses, credentials, raw errors, or secrets; every Prisma query uses an explicit `select`.
- UI copy is “重新执行”, with help text “保留失败记录，从允许恢复的位置重新开始。” Do not display “安全重试”.
- Preserve the existing server mutation contract: narrative jobs cannot be retried from admin; their failed state recommends inspection, while active narrative jobs may be cancelled.
- Preserve admin authorization, idempotency, lease checks, error redaction, and audit logging.
- Keep existing unrelated working-tree edits intact and stage only files owned by each task.

## File Structure

### New files

- `src/lib/admin/task-attention.ts` — pure normalized task types, attention classification, severity, recommended action, allowed-action helpers, and human-readable summaries.
- `src/lib/admin/task-attention.test.ts` — deterministic domain tests with a fixed clock.
- `src/lib/admin/workbench.ts` — server-only bounded workbench queries, normalized DTO mapping, summary counts, selected-task lookup, and explicit unavailable state.
- `src/lib/admin/workbench.test.ts` — query shape, privacy boundary, sorting, selection, and unavailable-state tests.
- `src/components/admin/AdminRefreshButton.tsx` — minimal Client Component that calls `router.refresh()` without navigation.
- `src/components/admin/AdminAttentionQueue.tsx` — server-rendered summary, filter chips, fault queue, and selected-row links.
- `src/components/admin/AdminTaskDetail.tsx` — server-rendered explanation, facts, timeline, contextual links, and allowed operations.
- `src/components/admin/AdminActionPanel.tsx` — accessible native-dialog Client Component for reason/confirmation collection and mutation feedback.
- `src/lib/admin/action-form.ts` — pure client-safe validation and action-copy mapping.
- `src/lib/admin/action-form.test.ts` — reason and confirmation validation tests.

### Modified files

- `src/app/admin/page.tsx` — replace the old metric-heavy landing page with the URL-driven task workbench.
- `src/app/admin/tasks/page.tsx` — add attention/stale/repeated/search filters, deep selection links, and new action copy.
- `src/app/admin/llm/page.tsx` — add `userId` and `worldId` filters for contextual drill-down.
- `src/app/admin/audit/page.tsx` — add `targetId`, `action`, and result filters for contextual drill-down.
- `src/app/admin/layout.tsx` — load a nullable attention count for navigation.
- `src/components/admin/AdminNav.tsx` — reorganize labels into task-oriented groups and display the nullable attention count.
- `src/components/admin/AdminShell.tsx` — pass the count to desktop/mobile navigation and use `AdminRefreshButton`.
- `src/components/admin/AdminActionButton.tsx` — reduce to a compatibility wrapper around `AdminActionPanel`, or delete after all call sites migrate.
- `src/components/admin/AdminList.tsx` — preserve optional/empty filter parameters in pagination without emitting misleading defaults.
- `src/lib/admin/data.ts` — extend task, LLM, and audit list filters with explicit Prisma conditions.
- `src/lib/admin/data.test.ts` — query-filter and privacy regression tests.
- `src/lib/admin/dashboard.ts` — represent audit-query failure explicitly instead of converting it to an empty array.
- `src/lib/admin/dashboard.test.ts` — ready/unavailable audit-state tests.
- `src/app/api/admin/actions/route.ts` — return field-level Zod errors while preserving redacted conflict responses.
- `src/app/globals.css` — workbench, detail panel, dialog, responsive, focus, and reduced-motion styles.

---

### Task 1: Lock the task-attention domain rules

**Files:**
- Create: `src/lib/admin/task-attention.ts`
- Create: `src/lib/admin/task-attention.test.ts`

**Interfaces:**
- Consumes: no server-only imports; fixed `Date` values and normalized task snapshots.
- Produces:
  - `AdminTaskKind`
  - `AdminTaskSnapshot`
  - `AdminAttentionTask`
  - `deriveTaskAttention(task, now)`
  - `allowedAdminTaskActions(task, now)`
  - `taskSelectionKey(task)`
  - `buildTaskExplanation(task)`

- [ ] **Step 1: Write failing classification and action-capability tests**

```ts
import { describe, expect, it } from "vitest";
import { allowedAdminTaskActions, deriveTaskAttention } from "./task-attention";

const now = new Date("2026-07-29T07:00:00.000Z");
const base = {
  kind: "genesis" as const,
  id: "genesis-1",
  status: "failed",
  stage: "pantheon",
  attempt: 1,
  leaseExpiresAt: null,
  createdAt: new Date("2026-07-29T06:40:00.000Z"),
  updatedAt: new Date("2026-07-29T06:55:00.000Z"),
  error: "上游超时",
  user: { id: "user-1", name: "林舟", email: "lin@example.com" },
  world: { id: "world-1", name: "雾港纪元" },
};

describe("deriveTaskAttention", () => {
  it("marks a single failure medium and rerunnable", () => {
    expect(deriveTaskAttention(base, now)).toEqual(expect.objectContaining({ reason: "failed", severity: "medium", recommendation: "rerun" }));
  });

  it("marks attempt >= 3 as a high repeated failure", () => {
    expect(deriveTaskAttention({ ...base, attempt: 3 }, now)).toEqual(expect.objectContaining({ reason: "repeated_failure", severity: "high" }));
  });

  it("marks a lease expired for ten minutes as high", () => {
    expect(deriveTaskAttention({ ...base, status: "running", attempt: 1, leaseExpiresAt: new Date("2026-07-29T06:49:59.000Z") }, now)).toEqual(expect.objectContaining({ reason: "stale", severity: "high", recommendation: "recover" }));
  });

  it("does not offer retry or recover for narrative failures", () => {
    const narrative = { ...base, kind: "narrative" as const, status: "failed" };
    expect(deriveTaskAttention(narrative, now)?.recommendation).toBe("inspect");
    expect(allowedAdminTaskActions(narrative, now)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `npx vitest run src/lib/admin/task-attention.test.ts`
Expected: FAIL because `task-attention.ts` does not exist.

- [ ] **Step 3: Implement normalized types and deterministic rules**

```ts
export type AdminTaskKind = "genesis" | "narrative" | "rewrite";
export type AdminTaskAction = "retry" | "recover" | "cancel";
export type AdminTaskSnapshot = {
  kind: AdminTaskKind;
  id: string;
  status: string;
  stage: string | null;
  attempt: number | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  error: string | null;
  user: { id: string; name: string; email: string };
  world: { id: string; name: string } | null;
};
export type AdminAttentionTask = AdminTaskSnapshot & {
  reason: "failed" | "stale" | "repeated_failure";
  severity: "high" | "medium";
  recommendation: "rerun" | "recover" | "cancel" | "inspect";
  explanation: string;
  impactSummary: string;
};

const ACTIVE = {
  genesis: ["queued", "running", "repairing"],
  narrative: ["pending"],
  rewrite: ["planning", "applying", "narrating"],
} as const;

export function allowedAdminTaskActions(task: AdminTaskSnapshot, now: Date): AdminTaskAction[] {
  const stale = task.leaseExpiresAt !== null && task.leaseExpiresAt < now && (ACTIVE[task.kind] as readonly string[]).includes(task.status);
  if (task.kind === "narrative") return task.status === "pending" ? ["cancel"] : [];
  if (task.status === "failed") return ["retry"];
  if (stale) return ["recover", "cancel"];
  return (ACTIVE[task.kind] as readonly string[]).includes(task.status) ? ["cancel"] : [];
}
export function taskSelectionKey(task: Pick<AdminTaskSnapshot, "kind" | "id">) {
  return `${task.kind}:${task.id}`;
}

export function buildTaskExplanation(task: AdminTaskSnapshot) {
  const label = task.kind === "genesis" ? "创世任务" : task.kind === "narrative" ? "叙事生成" : "现实改写";
  const stage = task.stage ? `在“${task.stage}”阶段` : "在当前阶段";
  return task.error ? `${label}${stage}中断：${task.error}` : `${label}${stage}停止，未记录可展示的错误摘要。`;
}

export function deriveTaskAttention(task: AdminTaskSnapshot, now: Date): AdminAttentionTask | null {
  const active = (ACTIVE[task.kind] as readonly string[]).includes(task.status);
  const stale = active && task.leaseExpiresAt !== null && task.leaseExpiresAt < now;
  if (task.status !== "failed" && !stale) return null;
  const repeated = task.kind !== "rewrite" && task.status === "failed" && (task.attempt ?? 0) >= 3;
  const staleForMs = stale && task.leaseExpiresAt ? now.getTime() - task.leaseExpiresAt.getTime() : 0;
  const reason = repeated ? "repeated_failure" : stale ? "stale" : "failed";
  const recommendation = task.kind === "narrative" ? (stale ? "cancel" : "inspect") : stale ? "recover" : "rerun";
  return { ...task, reason, recommendation, severity: repeated || staleForMs >= 600_000 ? "high" : "medium", explanation: buildTaskExplanation(task), impactSummary: task.world ? `${task.user.name} 的世界「${task.world.name}」受到影响` : `${task.user.name} 的任务尚未落地世界` };
}
```

Implement `deriveTaskAttention` with the exact rules from the approved spec: failed tasks; active tasks whose lease is before `now`; repeated only for genesis/narrative with `attempt >= 3`; high for repeated or stale by at least 10 minutes; otherwise medium. Return `null` for completed/cancelled/non-attention tasks. Build summaries only from metadata and redacted errors.

- [ ] **Step 4: Run the domain test**

Run: `npx vitest run src/lib/admin/task-attention.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the domain contract**

```powershell
git add src/lib/admin/task-attention.ts src/lib/admin/task-attention.test.ts
git commit -m "feat(admin): define task attention rules"
```

### Task 2: Add bounded workbench queries and explicit availability

**Files:**
- Create: `src/lib/admin/workbench.ts`
- Create: `src/lib/admin/workbench.test.ts`
- Modify: `src/lib/admin/dashboard.ts:17-120`
- Modify: `src/lib/admin/dashboard.test.ts`
- Modify: `src/app/admin/page.tsx` (temporary audit-state compatibility before Task 4 rewrites the page)

**Interfaces:**
- Consumes: `AdminTaskSnapshot`, `AdminAttentionTask`, `deriveTaskAttention`, `taskSelectionKey` from Task 1.
- Produces:
  - `AdminWorkbenchFilters`
  - `AdminWorkbenchResult`
  - `loadAdminTaskWorkbench(filters, db?, now?)`
  - `loadAdminAttentionCount(db?, now?)`
  - `recentAudits: { state: "ready"; items: AuditRow[] } | { state: "unavailable"; items: [] }` on `loadAdminDashboard()`.

- [ ] **Step 1: Write failing workbench query tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { loadAdminTaskWorkbench } from "./workbench";

const now = new Date("2026-07-29T07:00:00.000Z");
function taskDb() {
  const emptyModel = { findMany: vi.fn().mockResolvedValue([]) };
  return {
    genesisTask: { findMany: vi.fn().mockResolvedValue([]) },
    generationRequest: { ...emptyModel },
    realityRewrite: { ...emptyModel },
    adminAuditLog: { count: vi.fn().mockResolvedValue(0) },
  };
}

it("queries only failed or lease-expired metadata", async () => {
  const db = taskDb();
  await loadAdminTaskWorkbench({ view: "attention", search: "", selected: null }, db as never, now);
  expect(db.genesisTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { OR: [
      { status: "failed" },
      { status: { in: ["queued", "running", "repairing"] }, leaseExpiresAt: { lt: now } },
    ] },
    select: expect.objectContaining({ id: true, status: true, stage: true, attempt: true, leaseExpiresAt: true }),
    take: 50,
  }));
  expect(JSON.stringify(db.genesisTask.findMany.mock.calls[0])).not.toMatch(/genesisInput|content|rawOutput|decree/);
  expect(db.adminAuditLog.count).toHaveBeenCalledWith({ where:{ success:true, action:{ in:["retry-task","recover-task"] }, createdAt:{ gte:expect.any(Date) } } });
});

it("returns unavailable instead of a false empty queue", async () => {
  const db = taskDb();
  db.genesisTask.findMany.mockRejectedValueOnce(new Error("offline"));
  await expect(loadAdminTaskWorkbench({ view: "attention", search: "", selected: null }, db as never, now)).resolves.toEqual({
    state: "unavailable",
    message: "任务数据暂不可用",
  });
});
```

Add a dashboard test where `adminAuditLog.findMany` rejects and assert `recentAudits.state === "unavailable"`, then a ready-state test with one audit row.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx vitest run src/lib/admin/workbench.test.ts src/lib/admin/dashboard.test.ts`
Expected: FAIL because the loader and explicit audit state do not exist.

- [ ] **Step 3: Implement the server-only workbench loader**

Use three bounded `findMany` queries and one `adminAuditLog.count` query in `Promise.all`. Each task query uses `take: 50`, an explicit metadata-only `select`, and the task-family-specific failed/stale conditions. The audit count uses `{ success: true, action: { in: ["retry-task", "recover-task"] }, createdAt: { gte: startOfLocalDay(now) } }` and populates `counts.recoveredToday`. Normalize rows to `AdminTaskSnapshot`, redact errors with `redactAdminError`, call `deriveTaskAttention`, filter by `view` and the minimum-two-character search rule, sort high before medium then `updatedAt` descending, and select by the stable key `${kind}:${id}`.

```ts
export type AdminWorkbenchFilters = {
  view: "attention" | "failed" | "stale" | "repeated";
  search: string;
  selected: string | null;
};

export type AdminWorkbenchResult =
  | { state: "ready"; generatedAt: Date; counts: { attention: number; failed: number; stale: number; repeated: number; recoveredToday: number }; items: AdminAttentionTask[]; selected: AdminAttentionTask | null }
  | { state: "unavailable"; message: "任务数据暂不可用" };
```
Define the query contracts and mappers in the same file so later components never depend on Prisma row shapes:

```ts
const userSelect = { id:true, name:true, email:true } as const;
const genesisAttentionSelect = { id:true, status:true, stage:true, attempt:true, leaseExpiresAt:true, createdAt:true, updatedAt:true, error:true, user:{ select:userSelect }, world:{ select:{ id:true, name:true } } } as const;
const narrativeAttentionSelect = { id:true, status:true, stage:true, attempt:true, leaseExpiresAt:true, createdAt:true, updatedAt:true, safeError:true, error:true, chapter:{ select:{ timeline:{ select:{ world:{ select:{ id:true, name:true, user:{ select:userSelect } } } } } } } } as const;
const rewriteAttentionSelect = { id:true, status:true, scope:true, leaseExpiresAt:true, createdAt:true, updatedAt:true, error:true, world:{ select:{ id:true, name:true, user:{ select:userSelect } } } } as const;

function mapGenesis(row: Prisma.GenesisTaskGetPayload<{ select:typeof genesisAttentionSelect }>): AdminTaskSnapshot {
  return { kind:"genesis", id:row.id, status:row.status, stage:row.stage, attempt:row.attempt, leaseExpiresAt:row.leaseExpiresAt, createdAt:row.createdAt, updatedAt:row.updatedAt, error:row.error ? redactAdminError(row.error) : null, user:row.user, world:row.world };
}
function mapNarrative(row: Prisma.GenerationRequestGetPayload<{ select:typeof narrativeAttentionSelect }>): AdminTaskSnapshot {
  const world = row.chapter.timeline.world;
  return { kind:"narrative", id:row.id, status:row.status, stage:row.stage, attempt:row.attempt, leaseExpiresAt:row.leaseExpiresAt, createdAt:row.createdAt, updatedAt:row.updatedAt, error:redactAdminError(row.safeError ?? row.error ?? "") || null, user:world.user, world:{ id:world.id, name:world.name } };
}
function mapRewrite(row: Prisma.RealityRewriteGetPayload<{ select:typeof rewriteAttentionSelect }>): AdminTaskSnapshot {
  return { kind:"rewrite", id:row.id, status:row.status, stage:row.scope, attempt:null, leaseExpiresAt:row.leaseExpiresAt, createdAt:row.createdAt, updatedAt:row.updatedAt, error:row.error ? redactAdminError(row.error) : null, user:row.world.user, world:{ id:row.world.id, name:row.world.name } };
}
function startOfLocalDay(now: Date) { const value = new Date(now); value.setHours(0,0,0,0); return value; }
```

Map the three query results with dedicated metadata-only mappers and build the return value:

```ts
const [genesis, narratives, rewrites, recoveredToday] = await Promise.all([
  db.genesisTask.findMany({ where:{ OR:[{ status:"failed" }, { status:{ in:["queued","running","repairing"] }, leaseExpiresAt:{ lt:now } }] }, select:genesisAttentionSelect, orderBy:{ updatedAt:"desc" }, take:50 }),
  db.generationRequest.findMany({ where:{ OR:[{ status:"failed" }, { status:"pending", leaseExpiresAt:{ lt:now } }] }, select:narrativeAttentionSelect, orderBy:{ updatedAt:"desc" }, take:50 }),
  db.realityRewrite.findMany({ where:{ OR:[{ status:"failed" }, { status:{ in:["planning","applying","narrating"] }, leaseExpiresAt:{ lt:now } }] }, select:rewriteAttentionSelect, orderBy:{ updatedAt:"desc" }, take:50 }),
  db.adminAuditLog.count({ where:{ success:true, action:{ in:["retry-task","recover-task"] }, createdAt:{ gte:startOfLocalDay(now) } } }),
]);
const attention = [...genesis.map(mapGenesis), ...narratives.map(mapNarrative), ...rewrites.map(mapRewrite)]
  .map((task) => deriveTaskAttention(task, now)).filter((task): task is AdminAttentionTask => task !== null);
```

Catch only at the loader boundary, log `console.error("[admin.workbench] task query failed", error)`, and return the explicit unavailable state. Do not turn the error into an empty ready result.

- [ ] **Step 4: Replace the dashboard audit fallback**

Wrap the audit query in a discriminated result before `Promise.all`:

```ts
const recentAuditQuery = db.adminAuditLog.findMany({
  orderBy: { createdAt: "desc" },
  take: 6,
  select: {
    id: true, action: true, targetType: true, targetId: true, targetLabel: true,
    reason: true, success: true, requestIp: true, createdAt: true,
    actor: { select: { id: true, name: true, email: true } },
  },
})
  .then((items) => ({ state: "ready" as const, items }))
  .catch((error) => {
    console.error("[admin.dashboard] audit query failed", error);
    return { state: "unavailable" as const, items: [] as const };
  });
```

Return `recentAudits` as that object and update any remaining dashboard rendering to branch on `state` rather than array length.

In the current `src/app/admin/page.tsx`, replace the audit list branch so Task 2 stays type-correct until Task 4 replaces the landing page:

```tsx
{dashboard.recentAudits.state === "unavailable" ? <p className="admin-data-unavailable">审计数据暂不可用</p>
  : dashboard.recentAudits.items.length ? <div className="admin-event-list">{dashboard.recentAudits.items.map((log) => <article key={log.id}>
      <span className={`admin-event-kind ${log.success ? "" : "is-error"}`}>{log.success ? "成功" : "失败"}</span>
      <div><strong>{log.action}</strong><p>{log.targetLabel} · {log.reason}</p></div>
      <time>{dateTime(log.createdAt)}</time>
    </article>)}</div>
  : <EmptyState>暂无管理操作</EmptyState>}
```

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run src/lib/admin/workbench.test.ts src/lib/admin/dashboard.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit the query boundary**

```powershell
git add src/lib/admin/workbench.ts src/lib/admin/workbench.test.ts src/lib/admin/dashboard.ts src/lib/admin/dashboard.test.ts src/app/admin/page.tsx
git commit -m "feat(admin): load actionable task queue"
```

### Task 3: Reorganize navigation and preserve refresh context

**Files:**
- Create: `src/components/admin/AdminRefreshButton.tsx`
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/components/admin/AdminNav.tsx`
- Modify: `src/components/admin/AdminShell.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `loadAdminAttentionCount()` from Task 2.
- Produces: `AdminShell({ adminName, attentionCount, children })` and `AdminNav({ attentionCount })`.

- [ ] **Step 1: Add the refresh Client Component**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function AdminRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())} className="seal-button seal-button--lit px-4 py-2 text-sm">
    {pending ? "刷新中…" : "刷新当前视图"}
  </button>;
}
```

- [ ] **Step 2: Load the nullable navigation count in the admin layout**

Call `requireAdmin()` and `loadAdminAttentionCount()` in parallel after entering the layout. Convert count-query failure to `null`, log the failure server-side, and pass `attentionCount` into `AdminShell`; authorization failures must retain the existing 404 behavior.

```tsx
const attentionCountPromise = loadAdminAttentionCount().catch((error) => {
  console.error("[admin.layout] attention count failed", error);
  return null;
});
const [admin, attentionCount] = await Promise.all([loadAdmin(), attentionCountPromise]);
return <AdminShell adminName={admin.name} attentionCount={attentionCount}>{children}</AdminShell>;
```

- [ ] **Step 3: Rebuild the navigation labels and groups**

Render headings “处置 / 对象 / 观测”. Use these links in this order:

```ts
[
  { href: "/admin", label: "任务工作台", description: "需要处理", count: attentionCount },
  { href: "/admin/tasks", label: "全部任务", description: "历史与筛选" },
  { href: "/admin/users", label: "用户", description: "身份与会话" },
  { href: "/admin/worlds", label: "世界", description: "状态与归属" },
  { href: "/admin/llm", label: "模型调用", description: "质量与消耗" },
  { href: "/admin/audit", label: "管理审计", description: "操作与追责" },
]
```

Keep `aria-current="page"`, render the count only when it is a number, and use the same component for desktop and mobile.

- [ ] **Step 4: Replace the hard-coded refresh link**

Remove `<Link href="/admin?refresh=1">` from `AdminShell` and render `AdminRefreshButton`. Update the topbar copy to “管理中枢 / 任务处置” and retain the privacy badge.

```tsx
<div><p>管理中枢 / 任务处置</p><span>仅管理员可见 · 数据动态读取</span></div>
<div className="admin-topbar__actions">
  <span className="admin-privacy-badge">正文边界已启用</span>
  <AdminRefreshButton />
</div>
```

- [ ] **Step 5: Run static verification**

Run: `npx eslint src/app/admin/layout.tsx src/components/admin/AdminNav.tsx src/components/admin/AdminShell.tsx src/components/admin/AdminRefreshButton.tsx`
Expected: PASS.

Run: `npx tsc --noEmit --incremental false`
Expected: PASS.

- [ ] **Step 6: Commit navigation and refresh**

```powershell
git add src/app/admin/layout.tsx src/components/admin/AdminNav.tsx src/components/admin/AdminShell.tsx src/components/admin/AdminRefreshButton.tsx src/app/globals.css
git commit -m "feat(admin): prioritize task triage navigation"
```

### Task 4: Build the URL-driven task workbench

**Files:**
- Create: `src/components/admin/AdminAttentionQueue.tsx`
- Create: `src/components/admin/AdminTaskDetail.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `loadAdminTaskWorkbench()`, `AdminAttentionTask`, and `allowedAdminTaskActions()` from Tasks 1–2. Render the recommended action as explanatory text only in this task; Task 5 adds executable controls after the prompt-free action panel exists.
- Produces: `/admin?view=<attention|failed|stale|repeated>&q=<text>&task=<kind:id>`.

- [ ] **Step 1: Replace the page loader with awaited URL parameters**

```tsx
export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const view = raw.view === "failed" || raw.view === "stale" || raw.view === "repeated" ? raw.view : "attention";
  const search = typeof raw.q === "string" ? raw.q.trim() : "";
  const selected = typeof raw.task === "string" ? raw.task : null;
  const result = await loadAdminTaskWorkbench({ view, search, selected });
  // render explicit unavailable or ready workbench
}
```

Do not call `useSearchParams` in the page. If `result.state === "unavailable"`, render a page-level message “任务数据暂不可用” and `AdminRefreshButton`; do not render the empty-state copy.

- [ ] **Step 2: Implement queue links that preserve all filters**

Build every chip and row URL from one helper that starts with the current `view`, `q`, and `task` parameters. Selecting a row changes only `task`; changing a filter clears `task` unless the selected item remains in the filtered result. Use real `<Link>` elements so deep links, back/forward, and keyboard navigation work.

```ts
function workbenchHref(current: { view: string; q: string }, changes: { view?: string; q?: string; task?: string | null }) {
  const params = new URLSearchParams({ view: changes.view ?? current.view });
  const q = changes.q ?? current.q;
  if (q) params.set("q", q);
  if (changes.task) params.set("task", changes.task);
  return `/admin?${params.toString()}`;
}
```

- [ ] **Step 3: Implement readable task rows**

Each row must show, in order:

1. severity text (“高优先级” or “需处理”), not color alone;
2. localized task type and world/user;
3. failure class (“连续失败”, “租约过期”, “失败”);
4. stage and elapsed time;
5. “查看详情” affordance.

Use `<time dateTime={task.updatedAt.toISOString()}>` and keep IDs copyable but visually secondary.

```tsx
const taskLabels = { genesis:"创世任务", narrative:"叙事生成", rewrite:"现实改写" } as const;
const reasonLabels = { failed:"失败", stale:"租约过期", repeated_failure:"连续失败" } as const;
function taskLabel(kind: AdminTaskKind) { return taskLabels[kind]; }
function reasonLabel(reason: AdminAttentionTask["reason"]) { return reasonLabels[reason]; }
function formatElapsed(value: Date, now: Date) { const minutes = Math.max(0, Math.floor((now.getTime() - value.getTime()) / 60_000)); return minutes < 1 ? "刚刚" : `${minutes} 分钟前`; }

<Link href={workbenchHref(filters, { task: taskSelectionKey(task) })} aria-current={selected ? "true" : undefined} className={`admin-workbench-row ${selected ? "is-selected" : ""}`}>
  <span className={`admin-severity is-${task.severity}`}>{task.severity === "high" ? "高优先级" : "需处理"}</span>
  <span><strong>{task.world?.name ?? "未落地世界"}</strong><small>{task.user.name} · {taskLabel(task.kind)}</small></span>
  <span><strong>{reasonLabel(task.reason)}</strong><small>{task.stage ?? "阶段未知"}</small></span>
  <time dateTime={task.updatedAt.toISOString()}>{formatElapsed(task.updatedAt, now)}</time>
</Link>
```

- [ ] **Step 4: Implement the detail panel**

Render “发生了什么 / 影响对象 / 当前阶段 / 尝试次数 / 数据风险 / 建议操作” followed by a short metadata timeline. Context links must be:

```ts
const llmHref = `/admin/llm?userId=${encodeURIComponent(task.user.id)}${task.world ? `&worldId=${encodeURIComponent(task.world.id)}` : ""}&ok=no`;
const auditHref = `/admin/audit?targetId=${encodeURIComponent(task.id)}`;
const worldHref = task.world ? `/admin/worlds?search=${encodeURIComponent(task.world.id)}` : null;
```

For narrative failures, state “管理员不能直接重新执行叙事任务；请检查模型调用或由原世界重新发起。” Do not render a retry action.

- [ ] **Step 5: Add responsive and focus styles**

Add `.admin-workbench-*` styles with a two-column queue/detail grid above 1024px and one-column flow below it. Keep primary body text at least `0.75rem`, metadata at least `0.6875rem`, controls at least 40px high, visible `:focus-visible` outlines, severity text labels, and no horizontal page overflow. Under `prefers-reduced-motion: reduce`, remove nonessential transforms/transitions.

```css
.admin-workbench-layout { display:grid; grid-template-columns:minmax(0,1.45fr) minmax(20rem,.8fr); gap:1rem; }
.admin-workbench-row { min-height:4.75rem; display:grid; grid-template-columns:auto minmax(0,1fr) auto auto; align-items:center; gap:.8rem; }
.admin-workbench-row:focus-visible,.admin-action-trigger:focus-visible { outline:2px solid var(--gilt-strong); outline-offset:3px; }
@media (max-width:1024px) { .admin-workbench-layout { grid-template-columns:1fr; } }
@media (prefers-reduced-motion:reduce) { .admin-workbench-row,.admin-action-dialog { transition:none; transform:none; } }
```

- [ ] **Step 6: Run page verification**

Run: `npx eslint src/app/admin/page.tsx src/components/admin/AdminAttentionQueue.tsx src/components/admin/AdminTaskDetail.tsx`
Expected: PASS.

Run: `npx tsc --noEmit --incremental false`
Expected: PASS.

- [ ] **Step 7: Commit the workbench UI**

```powershell
git add src/app/admin/page.tsx src/components/admin/AdminAttentionQueue.tsx src/components/admin/AdminTaskDetail.tsx src/app/globals.css
git commit -m "feat(admin): add task triage workbench"
```

### Task 5: Replace browser prompts with an accessible action panel

**Files:**
- Create: `src/lib/admin/action-form.ts`
- Create: `src/lib/admin/action-form.test.ts`
- Create: `src/components/admin/AdminActionPanel.tsx`
- Modify: `src/components/admin/AdminActionButton.tsx`
- Modify: `src/components/admin/AdminTaskDetail.tsx`
- Modify: `src/app/admin/tasks/page.tsx`
- Modify: `src/app/admin/users/page.tsx`
- Modify: `src/app/admin/worlds/page.tsx`
- Modify: `src/app/api/admin/actions/route.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: existing action payloads and `/api/admin/actions`.
- Produces: `AdminActionPanel({ label, targetLabel, impact, payload, danger?, confirmationLabel? })` and `validateAdminActionForm(reason, confirmationLabel, confirmation)`.

- [ ] **Step 1: Write failing form-validation tests**

```ts
import { describe, expect, it } from "vitest";
import { validateAdminActionForm } from "./action-form";

describe("validateAdminActionForm", () => {
  it("requires a two-character reason", () => {
    expect(validateAdminActionForm("a", undefined, "")).toEqual({ reason: "操作原因至少需要 2 个字" });
  });
  it("requires an exact permanent-action confirmation", () => {
    expect(validateAdminActionForm("用户请求", "u@example.com", "wrong")).toEqual({ confirmation: "确认文字不匹配" });
  });
  it("accepts a valid audited action", () => {
    expect(validateAdminActionForm("重新排队", undefined, "")).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run src/lib/admin/action-form.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement validation and action copy**

Keep the module free of React/Next imports. Trim reason, enforce 2–500 characters, and match confirmation exactly. Provide copy for task actions:

```ts
export type AdminActionFormErrors = { reason?:string; confirmation?:string; form?:string };
export function validateAdminActionForm(reason: string, confirmationLabel: string | undefined, confirmation: string): AdminActionFormErrors {
  const value = reason.trim();
  if (value.length < 2) return { reason:"操作原因至少需要 2 个字" };
  if (value.length > 500) return { reason:"操作原因不能超过 500 个字" };
  if (confirmationLabel && confirmation !== confirmationLabel) return { confirmation:"确认文字不匹配" };
  return {};
}

export const taskActionCopy = {
  retry: { label: "重新执行", impact: "保留失败记录，从允许恢复的位置重新开始。" },
  recover: { label: "恢复任务", impact: "清除过期租约并重新进入可执行状态。" },
  cancel: { label: "取消任务", impact: "停止后续执行并保留当前故障证据。" },
} as const;
```

- [ ] **Step 4: Implement the native-dialog action panel**

Use a `<dialog ref={dialogRef}>`, `showModal()`, a real `<form method="dialog">` for cancel, and a separate async submit handler. Show operation, target, impact, reason length, permanent confirmation, field errors, busy state, and a `role="status"` result. On failure, keep the dialog open and preserve values. On success, close, announce “操作已完成”, and call `router.refresh()` without changing the URL.

Do not use `window.prompt`, `window.alert`, or a second nested dialog. Restore focus to the trigger after close.

```tsx
const dialogRef = useRef<HTMLDialogElement>(null);
const triggerRef = useRef<HTMLButtonElement>(null);
function closeDialog() {
  dialogRef.current?.close();
  triggerRef.current?.focus();
}
async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const nextErrors = validateAdminActionForm(reason, confirmationLabel, confirmation);
  if (Object.keys(nextErrors).length) return setErrors(nextErrors);
  const response = await fetch("/api/admin/actions", { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ ...payload, reason, ...(confirmationLabel ? { confirmation } : {}) }) });
  const body = await response.json() as { error?:string; fields?:Record<string,string[]> };
  if (!response.ok) return setErrors({ form: body.error ?? "操作失败", reason: body.fields?.reason?.[0], confirmation: body.fields?.confirmation?.[0] });
  closeDialog();
  setStatus("操作已完成");
  router.refresh();
}
```

- [ ] **Step 5: Return field-level schema errors from the API**

For `ActionSchema.safeParse` failure, return:

```ts
return NextResponse.json({
  error: "管理操作参数无效",
  fields: parsed.error.flatten().fieldErrors,
}, { status: 400 });
```

Keep mutation conflicts at status 409 with `redactAdminError(error)`. The client maps `fields.reason?.[0]` and `fields.confirmation?.[0]` into the matching controls.

- [ ] **Step 6: Migrate all action call sites**

Pass a concrete `targetLabel` and `impact` from task, user, and world pages. Rename task `retry` UI copy to “重新执行”. Do not render retry/recover for narrative tasks. Keep confirmation labels for permanent deletion.

```tsx
<AdminActionPanel
  label={taskActionCopy.retry.label}
  targetLabel={`${title} · ${task.world?.name ?? task.id}`}
  impact={taskActionCopy.retry.impact}
  payload={{ targetType:"task", kind:task.kind, taskId:task.id, action:"retry" }}
/>
```

- [ ] **Step 7: Run focused and static verification**

Run: `npx vitest run src/lib/admin/action-form.test.ts src/lib/admin/actions.test.ts src/lib/admin/security.test.ts`
Expected: PASS.

Run: `npx eslint src/components/admin/AdminActionPanel.tsx src/components/admin/AdminActionButton.tsx src/app/api/admin/actions/route.ts src/app/admin/tasks/page.tsx src/app/admin/users/page.tsx src/app/admin/worlds/page.tsx`
Expected: PASS.

Run: `npx tsc --noEmit --incremental false`
Expected: PASS.

- [ ] **Step 8: Commit the action interaction**

```powershell
git add src/lib/admin/action-form.ts src/lib/admin/action-form.test.ts src/components/admin/AdminActionPanel.tsx src/components/admin/AdminActionButton.tsx src/components/admin/AdminTaskDetail.tsx src/app/api/admin/actions/route.ts src/app/admin/tasks/page.tsx src/app/admin/users/page.tsx src/app/admin/worlds/page.tsx src/app/globals.css
git commit -m "feat(admin): replace prompt-based actions"
```

### Task 6: Add task and evidence drill-down filters

**Files:**
- Modify: `src/lib/admin/data.ts`
- Modify: `src/lib/admin/data.test.ts`
- Modify: `src/app/admin/tasks/page.tsx`
- Modify: `src/app/admin/llm/page.tsx`
- Modify: `src/app/admin/audit/page.tsx`
- Modify: `src/components/admin/AdminList.tsx`

**Interfaces:**
- Consumes: workbench query parameter names and task rules from Tasks 1–4.
- Produces:
  - `listAdminTasks(input & { kind; status; attention; stale; repeated }, db?, now?)`
  - `listAdminLlmCalls(input & { ok; task; userId; worldId })`
  - `listAdminAudit(input & { targetId; action; success })`.

- [ ] **Step 1: Write failing query-filter tests**

```ts
import { expect, it, vi } from "vitest";
import { listAdminAudit, listAdminLlmCalls, listAdminTasks } from "./data";

const now = new Date("2026-07-29T07:00:00.000Z");
function listDb() {
  const model = () => ({ findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) });
  return { genesisTask: model(), generationRequest: model(), realityRewrite: model() };
}
function evidenceDb() {
  return {
    llmCall: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    adminAuditLog: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  };
}

it("filters active task families by expired lease", async () => {
  const db = listDb();
  await listAdminTasks({ search: "", kind: "all", status: "all", attention: "no", stale: "yes", repeated: "no", page: 1, pageSize: 25, skip: 0 }, db as never, now);
  expect(db.genesisTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: { in: ["queued", "running", "repairing"] }, leaseExpiresAt: { lt: now } } }));
  expect(db.generationRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: "pending", leaseExpiresAt: { lt: now } } }));
});

it("filters evidence by task context without selecting bodies", async () => {
  const db = evidenceDb();
  await listAdminLlmCalls({ search: "", ok: "no", task: "all", userId: "user-1", worldId: "world-1", page: 1, pageSize: 25, skip: 0 }, db as never);
  expect(db.llmCall.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ok: false, userId: "user-1", worldId: "world-1" }) }));
  await listAdminAudit({ search: "", targetId: "task-1", action: "all", success: "all", page: 1, pageSize: 25, skip: 0 }, db as never);
  expect(db.adminAuditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { targetId: "task-1" } }));
});
```

- [ ] **Step 2: Run the data tests and verify failure**

Run: `npx vitest run src/lib/admin/data.test.ts`
Expected: FAIL because the new inputs and filters are not implemented.

- [ ] **Step 3: Extend task filters at the Prisma query boundary**

Add an optional `now = new Date()` parameter for deterministic stale queries. Build task-family-specific `where` objects before `Promise.all`; do not fetch all tasks and filter after pagination. For `repeated=yes`, query `status: "failed", attempt: { gte: 3 }` for genesis/narrative and return no rewrite rows. For `attention=yes`, use the same failed-or-stale OR conditions as the workbench.

```ts
const genesisWhere = input.repeated === "yes" ? { status:"failed", attempt:{ gte:3 } }
  : input.stale === "yes" ? { status:{ in:["queued","running","repairing"] }, leaseExpiresAt:{ lt:now } }
  : input.attention === "yes" ? { OR:[{ status:"failed" }, { status:{ in:["queued","running","repairing"] }, leaseExpiresAt:{ lt:now } }] }
  : status ? { status } : {};
const narrativeWhere = input.repeated === "yes" ? { status:"failed", attempt:{ gte:3 } }
  : input.stale === "yes" ? { status:"pending", leaseExpiresAt:{ lt:now } }
  : input.attention === "yes" ? { OR:[{ status:"failed" }, { status:"pending", leaseExpiresAt:{ lt:now } }] }
  : status ? { status } : {};
const rewriteWhere = input.repeated === "yes" ? { id:{ in:[] as string[] } }
  : input.stale === "yes" ? { status:{ in:["planning","applying","narrating"] }, leaseExpiresAt:{ lt:now } }
  : input.attention === "yes" ? { OR:[{ status:"failed" }, { status:{ in:["planning","applying","narrating"] }, leaseExpiresAt:{ lt:now } }] }
  : status ? { status } : {};
```

- [ ] **Step 4: Extend LLM and audit filters**

Add exact `userId` and `worldId` equality filters to LLM calls. Add exact `targetId`, exact `action` unless `all`, and boolean `success` mapping (`yes/no/all`) to audit logs. Keep explicit metadata-only selects.

```ts
const llmWhere = { ...(input.ok === "yes" ? { ok:true } : input.ok === "no" ? { ok:false } : {}), ...(input.task !== "all" ? { task:input.task } : {}), ...(input.userId ? { userId:input.userId } : {}), ...(input.worldId ? { worldId:input.worldId } : {}) };
const auditWhere = { ...(input.targetId ? { targetId:input.targetId } : {}), ...(input.action !== "all" ? { action:input.action } : {}), ...(input.success === "yes" ? { success:true } : input.success === "no" ? { success:false } : {}) };
```

- [ ] **Step 5: Update page forms and pagination preservation**

Add visible labeled filters and preserve every active parameter in `PageNav`. `PageNav` must omit empty strings and `all/no` defaults only when omission means the same server default; it must never drop an active `targetId`, `userId`, `worldId`, `stale=yes`, or `repeated=yes` value.

Use this parameter normalizer before constructing pagination links:

```ts
const cleanParams = Object.fromEntries(Object.entries(params).filter(([, value]) => value && value !== "all" && value !== "no"));
const search = new URLSearchParams({ ...cleanParams, page:String(value), pageSize:String(pageSize) });
```

Use these empty-state distinctions:

- no filters + zero rows: domain empty state;
- active filters + zero rows: “没有符合当前条件的记录” plus a link to the unfiltered page.

- [ ] **Step 6: Run focused verification**

Run: `npx vitest run src/lib/admin/data.test.ts`
Expected: PASS.

Run: `npx eslint src/lib/admin/data.ts src/app/admin/tasks/page.tsx src/app/admin/llm/page.tsx src/app/admin/audit/page.tsx src/components/admin/AdminList.tsx`
Expected: PASS.

Run: `npx tsc --noEmit --incremental false`
Expected: PASS.

- [ ] **Step 7: Commit contextual drill-down**

```powershell
git add src/lib/admin/data.ts src/lib/admin/data.test.ts src/app/admin/tasks/page.tsx src/app/admin/llm/page.tsx src/app/admin/audit/page.tsx src/components/admin/AdminList.tsx
git commit -m "feat(admin): add task evidence filters"
```

### Task 7: Integrate, verify, and polish the complete admin flow

**Files:**
- Modify only files from Tasks 1–6 if verification exposes defects.

**Interfaces:**
- Consumes: the completed workbench, filter, navigation, action, and evidence-link contracts.
- Produces: fresh completion evidence for desktop/mobile, privacy, accessibility, tests, lint, typecheck, and production build.

- [ ] **Step 1: Run the complete admin test set**

Run:

```powershell
npx vitest run src/lib/admin src/lib/auth/admin.test.ts
```

Expected: all admin/auth tests PASS, including the new attention, workbench, form, filter, privacy, and unavailable-state cases.

- [ ] **Step 2: Run the full project test suite**

Run: `npm test`
Expected: PASS. If an unrelated pre-existing failure appears, capture the exact failing test and prove the admin-focused suite still passes before deciding whether it is in scope.

- [ ] **Step 3: Run lint and TypeScript**

Run: `npm run lint`
Expected: PASS.

Run: `npx tsc --noEmit --incremental false`
Expected: PASS.

- [ ] **Step 4: Run a production build**

Run: `npm run build`
Expected: PASS. This specifically proves Next.js 16 Server/Client boundaries, async `searchParams`, and any `useSearchParams`/Suspense requirements are valid in production.

- [ ] **Step 5: Browser-smoke the authenticated admin path**

At 1440×1000 and 390×844, verify:

1. `/admin` shows failure/stale/repeated counts and queue before secondary information.
2. `/admin?view=stale&task=genesis:<id>` opens the correct detail and survives reload/back/forward.
3. A failed narrative task has no “重新执行” action.
4. A retryable genesis/rewrite failure shows “重新执行” and the approved help text.
5. Opening the action dialog, submitting invalid reason, and receiving a conflict keeps input and focus context.
6. A successful action stays on the same URL and refreshes status.
7. Model/audit links open already-filtered evidence pages.
8. “刷新当前视图” preserves route and filters.
9. Keyboard focus is visible; Escape closes the dialog; focus returns to the trigger.
10. Mobile has no page-level horizontal overflow and retains all critical fields/actions.

Save screenshots under `output/admin-workbench/` only as verification artifacts; do not stage them unless the user explicitly requests them.

- [ ] **Step 6: Review the final diff for scope and privacy**

Run:

```powershell
git diff --check
git diff --stat
git status --short
rg -n "window\.(prompt|alert)|安全重试|genesisInput|rawOutput|accessToken|refreshToken" src/app/admin src/components/admin src/lib/admin
```

Expected: no `window.prompt`/`window.alert`, no “安全重试”, no new content/credential selections, no whitespace errors, and no unrelated files staged.

- [ ] **Step 7: Commit final integration fixes, if any**

If Step 1–6 required code changes, stage only those files and commit:

```powershell
git commit -m "fix(admin): polish task triage workflow"
```

If no fixes were needed, do not create an empty commit.
