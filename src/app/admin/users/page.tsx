import { AdminActionButton } from "@/components/admin/AdminActionButton";
import { AdminFilter, inputClass, PageNav } from "@/components/admin/AdminList";
import { AdminSection, EmptyState } from "@/components/admin/AdminShell";
import { listAdminUsers } from "@/lib/admin/data";
import { parseAdminPage } from "@/lib/admin/security";

const userActionImpact = {
  "revoke-sessions": "撤销该用户的全部现有会话；用户需要重新登录。",
  ban: "封禁账号并撤销全部现有会话。",
  unban: "解除账号封禁，允许用户重新登录。",
  promote: "授予管理员权限；该用户将可访问管理功能。",
  demote: "移除管理员权限；该用户将无法继续访问管理功能。",
  delete: "永久删除账号及其关联元数据，此操作不可撤销。",
} as const;

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") query.set(key, value);
  const page = parseAdminPage(query);
  const search = query.get("search") ?? "";
  const role = query.get("role") ?? "all";
  const banned = query.get("banned") ?? "all";
  const data = await listAdminUsers({ ...page, search, role, banned });

  return <AdminSection title="用户卷宗" note="仅显示账号元数据，不读取用户生成内容">
    <AdminFilter>
      <input name="search" defaultValue={search} placeholder="名称、邮箱或用户 ID" className={inputClass} />
      <select name="role" defaultValue={role} className={inputClass}><option value="all">全部角色</option><option value="admin">管理员</option><option value="user">普通用户</option></select>
      <select name="banned" defaultValue={banned} className={inputClass}><option value="all">全部状态</option><option value="no">正常</option><option value="yes">已封禁</option></select>
    </AdminFilter>
    {data.items.length ? <div className="space-y-3">{data.items.map((user) => {
      const targetLabel = `${user.name} · ${user.email}`;
      return <article key={user.id} className="rounded-xl border border-gilt/20 bg-paper/45 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-lg">{user.name}</strong>
              <span className="rounded-full border border-gilt/25 px-2 py-0.5 text-xs">{user.role === "admin" ? "管理员" : "用户"}</span>
              {user.banned && <span className="rounded-full border border-cinnabar/35 px-2 py-0.5 text-xs text-cinnabar">已封禁</span>}
            </div>
            <p className="mt-1 text-sm text-ink-soft">{user.email}</p>
            <p className="mt-1 break-all text-xs text-ink-faint">{user.id}</p>
            <p className="mt-2 text-xs text-ink-soft">Discord：{user.accounts.some((account) => account.providerId === "discord") ? "已绑定" : "未绑定"} · 会话 {user._count.sessions} · 世界 {user._count.worlds} · 任务 {user._count.genesisTasks}</p>
            {user.banReason && <p className="mt-2 text-xs text-cinnabar">原因：{user.banReason}</p>}
          </div>
          <div className="flex max-w-xl flex-wrap gap-2">
            <AdminActionButton label="撤销会话" targetLabel={targetLabel} impact={userActionImpact["revoke-sessions"]} payload={{ targetType: "user", targetUserId: user.id, action: "revoke-sessions" }} />
            {user.banned
              ? <AdminActionButton label="解封" targetLabel={targetLabel} impact={userActionImpact.unban} payload={{ targetType: "user", targetUserId: user.id, action: "unban" }} />
              : <AdminActionButton label="封禁" targetLabel={targetLabel} impact={userActionImpact.ban} danger payload={{ targetType: "user", targetUserId: user.id, action: "ban" }} />}
            {user.role === "admin"
              ? <AdminActionButton label="取消管理员" targetLabel={targetLabel} impact={userActionImpact.demote} danger payload={{ targetType: "user", targetUserId: user.id, action: "demote" }} />
              : <AdminActionButton label="设为管理员" targetLabel={targetLabel} impact={userActionImpact.promote} payload={{ targetType: "user", targetUserId: user.id, action: "promote" }} />}
            <AdminActionButton label="永久删除" targetLabel={targetLabel} impact={userActionImpact.delete} danger confirmationLabel={user.email} payload={{ targetType: "user", targetUserId: user.id, action: "delete" }} />
          </div>
        </div>
      </article>;
    })}</div> : <EmptyState>没有符合条件的用户</EmptyState>}
    <PageNav page={page.page} pageSize={page.pageSize} total={data.total} pathname="/admin/users" params={{ search, role, banned }} />
  </AdminSection>;
}
