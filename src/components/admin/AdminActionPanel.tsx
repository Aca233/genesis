"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { validateAdminActionForm, type AdminActionFormErrors } from "@/lib/admin/action-form";

export type AdminActionPayload = Record<string, string | undefined>;

export type AdminActionPanelProps = {
  label: string;
  targetLabel: string;
  currentState: string;
  currentStateLabel?: string;
  impact: string;
  payload: AdminActionPayload;
  danger?: boolean;
  confirmationLabel?: string;
};

type AdminActionResponse = {
  error?: string;
  fields?: Record<string, string[] | undefined>;
};

const SUCCESS_STATUS = "操作已完成";
const REFRESH_DELAY_MS = 250;

export function AdminActionPanel({
  label,
  targetLabel,
  currentState,
  currentStateLabel = "当前状态",
  impact,
  payload,
  danger = false,
  confirmationLabel,
}: AdminActionPanelProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const sessionCounterRef = useRef(0);
  const openSessionRef = useRef<number | null>(null);
  const failureFocusRef = useRef<{ session: number; target: "reason" | "confirmation" } | null>(null);
  const refreshPendingSessionRef = useRef<number | null>(null);
  const refreshScheduledRef = useRef(false);
  const refreshFrameRef = useRef<number | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<AdminActionFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [refreshPending, setRefreshPending] = useState(false);
  const titleId = `${id}-title`;
  const impactId = `${id}-impact`;
  const reasonHelpId = `${id}-reason-help`;
  const reasonErrorId = `${id}-reason-error`;
  const confirmationHelpId = `${id}-confirmation-help`;
  const confirmationErrorId = `${id}-confirmation-error`;

  useEffect(() => {
    if (busy || !failureFocusRef.current) return;
    const pendingFocus = failureFocusRef.current;
    if (!isCurrentDialogSession(pendingFocus.session)) {
      failureFocusRef.current = null;
      return;
    }
    const target = pendingFocus.target === "confirmation" ? confirmationRef.current : reasonRef.current;
    failureFocusRef.current = null;
    target?.focus();
  }, [busy, errors]);

  useEffect(() => {
    const session = refreshPendingSessionRef.current;
    if (!refreshPending || status !== SUCCESS_STATUS || session === null || refreshScheduledRef.current) return;
    refreshScheduledRef.current = true;
    refreshFrameRef.current = requestAnimationFrame(() => {
      refreshFrameRef.current = null;
      refreshTimeoutRef.current = setTimeout(() => {
        refreshTimeoutRef.current = null;
        if (refreshPendingSessionRef.current !== session || openSessionRef.current !== null || dialogRef.current?.open) return;
        refreshPendingSessionRef.current = null;
        refreshScheduledRef.current = false;
        setRefreshPending(false);
        router.refresh();
      }, REFRESH_DELAY_MS);
    });
  }, [refreshPending, router, status]);

  useEffect(() => () => {
    if (refreshFrameRef.current !== null) cancelAnimationFrame(refreshFrameRef.current);
    if (refreshTimeoutRef.current !== null) clearTimeout(refreshTimeoutRef.current);
    refreshFrameRef.current = null;
    refreshTimeoutRef.current = null;
    refreshPendingSessionRef.current = null;
    refreshScheduledRef.current = false;
    failureFocusRef.current = null;
    openSessionRef.current = null;
  }, []);

  function isCurrentDialogSession(session: number) {
    return openSessionRef.current === session && dialogRef.current?.open === true;
  }

  function restoreTriggerFocus() {
    triggerRef.current?.focus();
  }

  function openDialog() {
    if (submittingRef.current || refreshPendingSessionRef.current !== null) return;
    openSessionRef.current = ++sessionCounterRef.current;
    failureFocusRef.current = null;
    setReason("");
    setConfirmation("");
    setErrors({});
    setStatus("");
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    failureFocusRef.current = null;
    openSessionRef.current = null;
    if (dialogRef.current?.open) dialogRef.current.close();
    restoreTriggerFocus();
  }

  function handleDialogClose() {
    failureFocusRef.current = null;
    openSessionRef.current = null;
    if (typeof document === "undefined" || document.activeElement !== triggerRef.current) restoreTriggerFocus();
  }

  function updateReason(event: ChangeEvent<HTMLTextAreaElement>) {
    setReason(event.currentTarget.value);
    if (errors.reason || errors.form) setErrors((current) => ({ ...current, reason: undefined, form: undefined }));
  }

  function updateConfirmation(event: ChangeEvent<HTMLInputElement>) {
    setConfirmation(event.currentTarget.value);
    if (errors.confirmation || errors.form) setErrors((current) => ({ ...current, confirmation: undefined, form: undefined }));
  }

  function showErrors(nextErrors: AdminActionFormErrors, session: number) {
    if (!isCurrentDialogSession(session)) return;
    failureFocusRef.current = {
      session,
      target: nextErrors.reason || !nextErrors.confirmation ? "reason" : "confirmation",
    };
    setErrors(nextErrors);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = openSessionRef.current;
    if (submittingRef.current || refreshPendingSessionRef.current !== null || session === null || !isCurrentDialogSession(session)) return;
    const nextErrors = validateAdminActionForm(reason, confirmationLabel, confirmation);
    if (Object.keys(nextErrors).length > 0) {
      showErrors(nextErrors, session);
      return;
    }

    submittingRef.current = true;
    setBusy(true);
    setErrors({});
    setStatus("");
    try {
      const response = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...payload,
          reason: reason.trim(),
          ...(confirmationLabel ? { confirmation } : {}),
        }),
      });
      const body = await response.json() as AdminActionResponse;
      if (!response.ok) {
        showErrors({
          form: body.error ?? "操作失败，请稍后重试",
          reason: body.fields?.reason?.[0],
          confirmation: body.fields?.confirmation?.[0],
        }, session);
        return;
      }

      refreshPendingSessionRef.current = session;
      setReason("");
      setConfirmation("");
      setStatus(SUCCESS_STATUS);
      setRefreshPending(true);
      if (isCurrentDialogSession(session)) closeDialog();
    } catch {
      showErrors({ form: "操作失败，请稍后重试" }, session);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  const reasonDescribedBy = errors.reason ? `${reasonHelpId} ${reasonErrorId}` : reasonHelpId;
  const confirmationDescribedBy = errors.confirmation
    ? `${confirmationHelpId} ${confirmationErrorId}`
    : confirmationHelpId;

  return <div className="admin-action-panel">
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="dialog"
      aria-disabled={busy || refreshPending}
      onClick={openDialog}
      className={`admin-action-panel__trigger${danger ? " is-danger" : ""}`}
    >
      {label}
    </button>
    <span role="status" aria-live="polite" className="admin-action-panel__status">{status}</span>

    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={impactId}
      onClose={handleDialogClose}
      className="admin-action-dialog"
    >
      <div className="admin-action-dialog__head">
        <div>
          <p className="admin-action-dialog__eyebrow">ADMIN ACTION</p>
          <h2 id={titleId}>{label}</h2>
        </div>
        <form method="dialog">
          <button type="submit" className="admin-action-dialog__close" aria-label="关闭操作面板" disabled={busy}>关闭</button>
        </form>
      </div>

      <dl className="admin-action-dialog__summary">
        <div><dt>操作目标</dt><dd>{targetLabel}</dd></div>
        <div><dt>{currentStateLabel}</dt><dd>{currentState}</dd></div>
        <div><dt>操作影响</dt><dd id={impactId}>{impact}</dd></div>
      </dl>

      <form onSubmit={submit} className="admin-action-dialog__form" aria-busy={busy} noValidate>
        <div className="admin-action-dialog__field">
          <label htmlFor={`${id}-reason`}>操作原因</label>
          <textarea
            ref={reasonRef}
            id={`${id}-reason`}
            name="reason"
            value={reason}
            onChange={updateReason}
            minLength={2}
            maxLength={500}
            rows={5}
            required
            disabled={busy}
            aria-invalid={Boolean(errors.reason)}
            aria-describedby={reasonDescribedBy}
          />
          <div id={reasonHelpId} className="admin-action-dialog__help">
            <span>填写 2–500 个字；内容将写入管理审计。</span>
            <span>{reason.length} / 500</span>
          </div>
          {errors.reason && <p id={reasonErrorId} className="admin-action-dialog__error">{errors.reason}</p>}
        </div>

        {confirmationLabel && <div className="admin-action-dialog__field">
          <label htmlFor={`${id}-confirmation`}>永久操作确认</label>
          <p id={confirmationHelpId} className="admin-action-dialog__help">
            请输入 <strong>{confirmationLabel}</strong> 以确认此操作。
          </p>
          <input
            ref={confirmationRef}
            id={`${id}-confirmation`}
            name="confirmation"
            value={confirmation}
            onChange={updateConfirmation}
            autoComplete="off"
            required
            disabled={busy}
            aria-invalid={Boolean(errors.confirmation)}
            aria-describedby={confirmationDescribedBy}
          />
          {errors.confirmation && <p id={confirmationErrorId} className="admin-action-dialog__error">{errors.confirmation}</p>}
        </div>}

        {errors.form && <p role="alert" className="admin-action-dialog__form-error">{errors.form}</p>}
        <div className="admin-action-dialog__actions">
          <button type="submit" disabled={busy} className={`admin-action-dialog__submit${danger ? " is-danger" : ""}`}>
            {busy ? "处理中…" : `确认${label}`}
          </button>
        </div>
      </form>
    </dialog>
  </div>;
}
