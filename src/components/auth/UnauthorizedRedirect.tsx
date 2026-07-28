"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    __csAuthFetchPatched?: boolean;
  }
}

export function shouldRedirectOn401(rawUrl: string, currentPath: string, origin: string): boolean {
  if (currentPath === "/login") return false;
  let url: URL;
  try {
    url = new URL(rawUrl, origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (!url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/api/auth/")) return false;
  return true;
}

export function UnauthorizedRedirect() {
  useEffect(() => {
    if (window.__csAuthFetchPatched) return;
    window.__csAuthFetchPatched = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      try {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (response.status === 401 && shouldRedirectOn401(raw, window.location.pathname, window.location.origin)) {
          const next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.assign(next === "%2F" ? "/login" : `/login?next=${next}`);
        }
      } catch {
        // 解析失败时不干预原响应。
      }
      return response;
    };
  }, []);
  return null;
}
