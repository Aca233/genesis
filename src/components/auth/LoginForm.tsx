"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";

const FIELD_WELL =
  "w-full rounded-lg border border-line bg-paper-sunken px-4 py-3 text-base text-ink shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--ink)_10%,transparent)] outline-none transition-[border-color,box-shadow] focus:border-gilt/70 focus:shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--ink)_10%,transparent),0_0_0.6rem_var(--gilt-glow)]";

export function safeNext(raw: string | null): string {
  if (!raw) return "/";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export function discordCallbackURL(rawNext: string | null): string {
  return safeNext(rawNext);
}

export function discordErrorCallbackURL(rawNext: string | null): string {
  const next = safeNext(rawNext);
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}

export function discordErrorMessage(code: string | null): string | null {
  if (!code) return null;
  if (code === "access_denied") return "已取消 Discord 授权。";
  if (code === "account_not_linked") {
    return "该邮箱已有账号，请先使用原登录方式进入。";
  }
  if (code === "email_not_found") return "Discord 账号未提供邮箱，无法注册。";
  if (code === "invalid_code") return "未能连接 Discord 完成授权，请重新尝试。";
  return "Discord 登录失败，请重新尝试。";
}

export function LoginForm({ discordEnabled = false }: { discordEnabled?: boolean }) {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    discordErrorMessage(params?.get("error") ?? null),
  );

  async function signInWithDiscord() {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await authClient.signIn.social({
      provider: "discord",
      callbackURL: discordCallbackURL(params?.get("next") ?? null),
      errorCallbackURL: discordErrorCallbackURL(params?.get("next") ?? null),
    });
    if (result?.error) {
      setPending(false);
      setError("Discord 登录失败，请重新尝试。");
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await authClient.signIn.email({ email, password });
    if (result.error) {
      setPending(false);
      setError(result.error.status === 0 ? "无法连接服务器，请稍后再试" : "邮箱或密码不正确");
      return;
    }
    window.location.assign(safeNext(params?.get("next") ?? null));
  }

  return (
    <form onSubmit={onSubmit} className="login-tome tome-plate tome-plate--corners w-full max-w-[31rem] p-7 sm:p-12">
      <div className="mb-3 flex items-center justify-center gap-4 text-gilt" aria-hidden="true">
        <span className="h-px w-14 bg-gradient-to-r from-transparent to-gilt/70" />
        <span className="text-lg">✦</span>
        <span className="h-px w-14 bg-gradient-to-l from-transparent to-gilt/70" />
      </div>
      <h1 className="text-center font-display text-3xl tracking-[0.34em] text-ink sm:text-4xl">创世</h1>
      <p className="mt-3 text-center text-base leading-7 text-ink-soft">
        {discordEnabled ? "Discord 可直接入界 · 邮箱账号由房主分发" : "执笔者登入 · 账号由房主分发"}
      </p>
      {discordEnabled && (
        <>
          <button
            type="button"
            onClick={() => void signInWithDiscord()}
            disabled={pending}
            className="mt-9 flex min-h-12 w-full items-center justify-center gap-3 rounded-lg border border-[#5865f2]/60 bg-[#5865f2] px-5 py-3 text-base font-semibold text-white shadow-[0_0.75rem_2rem_color-mix(in_srgb,#5865f2_18%,transparent)] transition hover:bg-[#4752c4] disabled:opacity-50"
          >
            <span aria-hidden="true" className="font-bold">DC</span>
            使用 Discord 注册 / 登录
          </button>
          <div className="my-7 flex items-center gap-4 text-sm text-ink-faint" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            或使用邮箱登入
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      <label className={discordEnabled ? "block text-base text-ink-soft" : "mt-9 block text-base text-ink-soft"} htmlFor="login-email">邮箱</label>
      <input id="login-email" type="email" required autoComplete="email" className={`mt-1 ${FIELD_WELL}`} value={email} onChange={(event) => setEmail(event.target.value)} />
      <label className="mt-5 block text-base text-ink-soft" htmlFor="login-password">密码</label>
      <input id="login-password" type="password" required autoComplete="current-password" className={`mt-1 ${FIELD_WELL}`} value={password} onChange={(event) => setPassword(event.target.value)} />
      {error && <p className="mt-4 text-sm text-cinnabar" role="alert">{error}</p>}
      <button type="submit" disabled={pending} className="seal-button mt-9 min-h-12 w-full text-base">
        {pending ? "登入中……" : "登入"}
      </button>
    </form>
  );
}
