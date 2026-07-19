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

function apply(mode: ThemeMode) {
  if (isCandle(mode)) {
    document.documentElement.dataset.theme = "candle";
  } else {
    delete document.documentElement.dataset.theme;
  }
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
