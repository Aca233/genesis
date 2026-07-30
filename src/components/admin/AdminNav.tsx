"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type AdminNavProps = {
  attentionCount: number | null;
};

export function AdminNav({ attentionCount }: AdminNavProps) {
  const pathname = usePathname();
  const groups = [
    {
      label: "处置",
      links: [
        { href: "/admin", label: "任务工作台", description: "需要处理", count: attentionCount },
        { href: "/admin/tasks", label: "全部任务", description: "历史与筛选" },
      ],
    },
    {
      label: "对象",
      links: [
        { href: "/admin/users", label: "用户", description: "身份与会话" },
        { href: "/admin/worlds", label: "世界", description: "状态与归属" },
      ],
    },
    {
      label: "观测",
      links: [
        { href: "/admin/llm", label: "模型调用", description: "质量与消耗" },
        { href: "/admin/audit", label: "管理审计", description: "操作与追责" },
      ],
    },
  ] as const;

  return <nav aria-label="管理面板" className="admin-nav">
    {groups.map((group) => <section key={group.label} className="admin-nav__group">
      <h2 className="admin-nav__heading">{group.label}</h2>
      <div className="admin-nav__links">
        {group.links.map((item) => {
          const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
          return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={"admin-nav__item " + (active ? "is-active" : "")}>
            <span className="admin-nav__body"><strong>{item.label}</strong><small>{item.description}</small></span>
            {"count" in item && typeof item.count === "number" && <span className="admin-nav__count" aria-label={`${item.count} 项需要处理`}>{item.count}</span>}
          </Link>;
        })}
      </div>
    </section>)}
  </nav>;
}
