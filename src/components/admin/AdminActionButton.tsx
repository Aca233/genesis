"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Payload = Record<string, string | undefined>;
export function AdminActionButton({ label, payload, danger = false, confirmationLabel }: { label: string; payload: Payload; danger?: boolean; confirmationLabel?: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function run() {
    const reason = window.prompt("请输入操作原因（将写入审计日志）"); if (!reason?.trim()) return;
    const confirmation = confirmationLabel ? window.prompt(`请输入 ${confirmationLabel} 以确认永久操作`) : undefined; if (confirmationLabel && confirmation !== confirmationLabel) { setMessage("确认文字不匹配"); return; }
    setBusy(true); setMessage("");
    try { const response = await fetch("/api/admin/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, reason, ...(confirmationLabel ? { confirmation } : {}) }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error ?? "操作失败"); setMessage("已完成"); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); } finally { setBusy(false); }
  }
  return <span className="inline-flex flex-col items-start gap-1"><button type="button" onClick={run} disabled={busy} className={`rounded-lg border px-3 py-1.5 text-xs ${danger ? "border-cinnabar/40 text-cinnabar" : "border-gilt/35 text-ink-soft"}`}>{busy ? "处理中…" : label}</button>{message && <span role="status" className="max-w-48 text-[11px] text-ink-faint">{message}</span>}</span>;
}
