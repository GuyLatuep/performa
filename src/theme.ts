import { createStore } from "./store";

export type Theme = "light" | "dark";

const STORAGE_KEY = "performa-theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveInitial(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : systemTheme();
}

const store = createStore<Theme>(resolveInitial());

/** Reflect the current theme onto the document so CSS variables apply. */
export function applyTheme(theme: Theme = store.get()): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function getTheme(): Theme {
  return store.get();
}

export function setTheme(theme: Theme): void {
  store.set(theme);
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

/** React binding kept in sync across every mounted toggle. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  return [store.use(), setTheme];
}

// Apply immediately on import so the first paint matches the saved theme.
applyTheme();
