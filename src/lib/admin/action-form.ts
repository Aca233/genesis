export type AdminActionFormErrors = {
  reason?: string;
  confirmation?: string;
  form?: string;
};

export function validateAdminActionForm(
  reason: string,
  confirmationLabel: string | undefined,
  confirmation: string,
): AdminActionFormErrors {
  const value = reason.trim();
  if (value.length < 2) return { reason: "操作原因至少需要 2 个字" };
  if (value.length > 500) return { reason: "操作原因不能超过 500 个字" };
  if (confirmationLabel && confirmation !== confirmationLabel) return { confirmation: "确认文字不匹配" };
  return {};
}

export const taskActionCopy = {
  retry: { label: "重新执行", impact: "保留失败记录，从允许恢复的位置重新开始。" },
  recover: { label: "恢复任务", impact: "清除过期租约并重新进入可执行状态。" },
  cancel: { label: "取消任务", impact: "停止后续执行并保留当前故障证据。" },
} as const;
