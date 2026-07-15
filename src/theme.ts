import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "performa-theme";
const listeners = new Set<() => void>();

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveInitial(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : systemTheme();
}

let current: Theme = resolveInitial();

/** Reflect the current theme onto the document so CSS variables apply. */
export function applyTheme(theme: Theme = current): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme): void {
  current = theme;
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React binding kept in sync across every mounted toggle. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, getTheme, getTheme);
  return [theme, setTheme];
}

// Apply immediately on import so the first paint matches the saved theme.
applyTheme();
