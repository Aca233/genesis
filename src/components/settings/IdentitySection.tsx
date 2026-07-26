"use client";

import { useEffect, useState } from "react";

// 式样常量复制自 src/app/settings/page.tsx（:32 BRASS_BUTTON / :36 FIELD_WELL），
// 按设计裁决不抽公共模块，保持两处独立演化。
/** 黄铜小器钮：玺印钮的紧凑变体 */
const BRASS_BUTTON = "seal-button min-h-8! px-3.5! py-1! text-xs";

/** 羊皮纸凹井：带内阴影的输入面，聚焦时鎏金微焕 */
const FIELD_WELL =
  "w-full rounded-lg border border-line bg-paper-sunken px-3 py-2 text-ink shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--ink)_10%,transparent)] outline-none transition-[border-color,box-shadow] focus:border-gilt/70 focus:shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--ink)_10%,transparent),0_0_0.6rem_var(--gilt-glow)]";

/** 纯函数（供单测）：改密前置校验，返回错误文案；null = 可提交 */
export function validatePasswordChange(current: string, next: string): string | null {
  if (!current) return "请先填旧密语。";
  if (next.length < 8) return "新密语至少八个字符。"; // better-auth 默认 minPasswordLength=8
  if (next === current) return "新旧密语不可相同。";
  return null;
}

/**
 * 「执笔者」身份小节：邮箱印信 + 自改密语（首登流程）+ 登出。
 *
 * 明确不做：强制首登改密门（Phase A 极简；若日后需要，better-auth admin
 * createUser 可配 requirePasswordChange，列 Phase B）。
 */
export function IdentitySection() {
  const [email, setEmail] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [changing, setChanging] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // 挂载取会话邮箱；json 为空视为未登录，不在此跳转（401 守卫与 proxy 兜底）
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/get-session")
      .then((r) => (r.ok ? (r.json() as Promise<{ user?: { email?: string } } | null>) : null))
      .then((json) => {
        if (!cancelled) setEmail(json?.user?.email ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function changePassword() {
    const problem = validatePasswordChange(current, next);
    if (problem !== null) {
      setNotice({ ok: false, text: problem });
      return;
    }
    setChanging(true);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: current,
          newPassword: next,
          revokeOtherSessions: true,
        }),
      });
      if (res.ok) {
        setCurrent("");
        setNext("");
        setNotice({ ok: true, text: "✓ 密语已改换，他处会话已一并注销。" });
      } else {
        // better-auth：旧密语不符 → 400 INVALID_PASSWORD
        setNotice({ ok: false, text: "✗ 旧密语不符，未予改换。" });
      }
    } catch {
      setNotice({ ok: false, text: "✗ 无法抵达彼岸（网络错误）。" });
    } finally {
      setChanging(false);
    }
  }

  async function signOut() {
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch {
      // 网络失败也照常离开：本地即将整页跳转，会话由服务端过期兜底
    }
    window.location.assign("/login"); // 不带 next：登出是有意离开
  }

  return (
    <section className="tome-plate p-5 sm:p-6" aria-labelledby="identity-title">
      <h2 id="identity-title" className="illuminated-header display-md">
        <span className="illuminated-header__glyph" aria-hidden="true">
          ✦
        </span>
        执笔者
      </h2>

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-sm text-ink-soft">名讳：{email ?? "验印中…"}</p>
        <button
          type="button"
          onClick={signOut}
          className="text-xs text-ink-faint transition hover:text-cinnabar"
        >
          登出此界
        </button>
      </div>

      <p className="mt-4 text-xs text-ink-faint">
        初次入界者，请在此改换房主代授的初始密语。
      </p>
      <div className="mt-2 grid gap-1.5">
        <input
          type="password"
          autoComplete="current-password"
          placeholder="旧密语"
          aria-label="旧密语"
          className={FIELD_WELL}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder="新密语（至少八字）"
          aria-label="新密语（至少八字）"
          className={FIELD_WELL}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void changePassword()}
          disabled={changing || !current || !next}
          className={BRASS_BUTTON}
        >
          {changing ? "改换中…" : "改换密语"}
        </button>
        {notice && (
          <span className={notice.ok ? "text-sm text-gilt" : "text-sm text-cinnabar"}>
            {notice.text}
          </span>
        )}
      </div>
    </section>
  );
}
