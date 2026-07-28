import Link from "next/link";

export function AdminFilter({ children }: { children: React.ReactNode }) { return <form className="mb-5 grid gap-3 rounded-xl border border-gilt/20 bg-paper/40 p-4 sm:grid-cols-[minmax(12rem,1fr)_repeat(3,auto)]">{children}<button className="seal-button seal-button--lit min-h-10 px-4 text-sm">筛选 / 刷新</button></form>; }
export const inputClass = "min-h-10 rounded-lg border border-gilt/25 bg-paper/75 px-3 text-sm text-ink outline-none focus:border-gilt";
export function PageNav({ page, pageSize, total, pathname, params }: { page: number; pageSize: number; total: number; pathname: string; params: Record<string, string> }) {
  const last = Math.max(1, Math.ceil(total / pageSize)); const href = (value: number) => { const search = new URLSearchParams({ ...params, page: String(value), pageSize: String(pageSize) }); return `${pathname}?${search}`; };
  return <div className="mt-5 flex items-center justify-between gap-3 text-sm text-ink-soft"><span>第 {page} / {last} 页 · 共 {total} 条</span><div className="flex gap-2">{page > 1 && <Link href={href(page - 1)} className="rounded-lg border border-gilt/25 px-3 py-2">上一页</Link>}{page < last && <Link href={href(page + 1)} className="rounded-lg border border-gilt/25 px-3 py-2">下一页</Link>}</div></div>;
}
