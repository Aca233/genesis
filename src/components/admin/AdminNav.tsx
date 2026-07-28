"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin", label: "运行总览", code: "01", description: "态势与待办" },
  { href: "/admin/users", label: "用户卷宗", code: "02", description: "身份与会话" },
  { href: "/admin/worlds", label: "世界目录", code: "03", description: "状态与归属" },
  { href: "/admin/tasks", label: "任务仪轨", code: "04", description: "队列与恢复" },
  { href: "/admin/llm", label: "模型观测", code: "05", description: "质量与消耗" },
  { href: "/admin/audit", label: "管理审计", code: "06", description: "操作与追责" },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return <nav aria-label="管理面板" className="admin-nav">
    {links.map((item) => {
      const active = item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
      return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={"admin-nav__item " + (active ? "is-active" : "")}>
        <span className="admin-nav__code">{item.code}</span>
        <span><strong>{item.label}</strong><small>{item.description}</small></span>
      </Link>;
    })}
  </nav>;
}
