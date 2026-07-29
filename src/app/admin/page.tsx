import { redirect } from "next/navigation";
import { AdminAttentionQueue, workbenchHref } from "@/components/admin/AdminAttentionQueue";
import { AdminRefreshButton } from "@/components/admin/AdminRefreshButton";
import { AdminTaskDetail } from "@/components/admin/AdminTaskDetail";
import { loadAdminTaskWorkbench, type AdminWorkbenchFilters } from "@/lib/admin/workbench";

type AdminPageSearchParams = Promise<Record<string, string | string[] | undefined>>;

function generatedAtLabel(value: Date) {
  return value.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default async function AdminPage({ searchParams }: { searchParams: AdminPageSearchParams }) {
  const raw = await searchParams;
  const view: AdminWorkbenchFilters["view"] = raw.view === "failed" || raw.view === "stale" || raw.view === "repeated"
    ? raw.view
    : "attention";
  const search = typeof raw.q === "string" ? raw.q.trim() : "";
  const selected = typeof raw.task === "string" ? raw.task : null;
  const result = await loadAdminTaskWorkbench({ view, search, selected });

  if (result.state === "unavailable") {
    return <section className="admin-workbench-unavailable" aria-labelledby="admin-workbench-unavailable-title">
      <div>
        <h1 id="admin-workbench-unavailable-title">{result.message}</h1>
        <p>无法读取任务元数据，请稍后刷新当前视图。</p>
      </div>
      <AdminRefreshButton />
    </section>;
  }

  if (selected && result.selected === null) {
    redirect(workbenchHref({ view, q: search, task: selected }, { task: null }));
  }

  return <div className="admin-workbench">
    <header className="admin-workbench-header">
      <div>
        <p className="admin-workbench-eyebrow">ADMIN TASK TRIAGE</p>
        <h1>任务工作台</h1>
        <p>按故障类型筛选任务，查看安全的处置上下文与建议操作。</p>
      </div>
      <time dateTime={result.generatedAt.toISOString()}>数据生成于 {generatedAtLabel(result.generatedAt)}</time>
    </header>
    <div className="admin-workbench-layout">
      <AdminAttentionQueue
        counts={result.counts}
        items={result.items}
        total={result.total}
        hasMore={result.hasMore}
        selected={result.selected}
        filters={{ view, q: search, task: selected }}
        now={result.generatedAt}
      />
      <AdminTaskDetail task={result.selected} now={result.generatedAt} />
    </div>
  </div>;
}
