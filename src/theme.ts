import { persistedText } from "./persist";

export type Theme = "light" | "dark";

const STORAGE_KEY = "performa-theme";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

const store = persistedText<Theme>(STORAGE_KEY, (stored) =>
  stored === "light" || stored === "dark" ? stored : systemTheme(),
);

/** Reflect the current theme onto the document so CSS variables apply. */
export function applyTheme(theme: Theme = store.get()): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function getTheme(): Theme {
  return store.get();
}

export function setTheme(theme: Theme): void {
  store.save(theme);
  applyTheme(theme);
}

/** React binding kept in sync across every mounted toggle. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  return [store.use(), setTheme];
}

/** Run something whenever the theme changes; returns an unsubscribe.
 *
 *  Exists for the accent, whose --accent-text is measured against the theme's
 *  backdrop and goes stale when the theme moves. The two modules are wired
 *  together in main.tsx rather than importing each other: each one's tests
 *  stand in a different minimal shape for <html>, and importing either way
 *  round would drag the other's document access into those tests. */
export function onThemeChange(listener: () => void): () => void {
  return store.subscribe(listener);
}

// Apply immediately on import so the first paint matches the saved theme.
applyTheme();
