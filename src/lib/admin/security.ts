export type AdminPage = { page: number; pageSize: number; skip: number };

export function parseAdminPage(params: URLSearchParams): AdminPage {
  const rawPage = Number.parseInt(params.get("page") ?? "1", 10);
  const rawSize = Number.parseInt(params.get("pageSize") ?? "25", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize > 0 ? Math.min(rawSize, 100) : 25;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function redactAdminError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [已隐藏]")
    .replace(/(?:sk-|AIza|key-)[A-Za-z0-9_.-]{8,}/g, "[已隐藏]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[已隐藏]@")
    .replace(/(?=[A-Za-z0-9_-]{48,})(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+/g, "[已隐藏]")
    .slice(0, 500);
}

type DangerousUserAction = "ban-user" | "delete-user" | "demote-user";

export function assertAdminMutationAllowed(input: {
  action: DangerousUserAction;
  actorUserId: string;
  targetUserId: string;
  activeAdminCount: number;
  targetIsActiveAdmin?: boolean;
}): void {
  if (input.actorUserId === input.targetUserId) {
    throw new Error("不能对自己的管理员账号执行此操作");
  }
  if (input.targetIsActiveAdmin && input.activeAdminCount <= 1) {
    throw new Error("不能移除最后一个有效管理员");
  }
}

export function assertAdminConfirmation(input: { expected: string; confirmation: string; reason: string }): void {
  if (!input.reason.trim()) throw new Error("必须填写操作原因");
  if (input.confirmation !== input.expected) throw new Error("确认文字不匹配");
}
