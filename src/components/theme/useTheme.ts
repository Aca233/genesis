"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ThemeMode = "day" | "candle" | "auto";

const KEY = "genesis:theme";
const listeners = new Set<() => void>();

function readMode(): ThemeMode {
  if (typeof window === "undefined") return "day";
  return (localStorage.getItem(KEY) as ThemeMode) || "day";
}

function isCandle(mode: ThemeMode): boolean {
  if (mode === "candle") return true;
  if (mode === "auto") {
    const h = new Date().getHours();
    return h >= 19 || h < 7;
  }
  return false;
}

/**
 * 同步移动端浏览器铬条颜色（<meta name="theme-color">）。
 * 字面量取双主题 --paper 值（#f3ead8 日卷 / #2b241c 烛光）；
 * 与 ThemeScript.tsx 首帧内联脚本中的取值各自独立维护、互为镜像。
 */
function syncThemeColor(candle: boolean) {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", candle ? "#2b241c" : "#f3ead8");
}

function apply(mode: ThemeMode) {
  const candle = isCandle(mode);
  if (candle) {
    document.documentElement.dataset.theme = "candle";
  } else {
    delete document.documentElement.dataset.theme;
  }
  syncThemeColor(candle);
}

/** 日卷/烛光主题控制 */
export function useTheme() {
  const mode = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readMode,
    () => "day" as ThemeMode,
  );

  const setMode = useCallback((next: ThemeMode) => {
    localStorage.setItem(KEY, next);
    apply(next);
    listeners.forEach((cb) => cb());
  }, []);

  return { mode, candle: isCandle(mode), setMode };
}
