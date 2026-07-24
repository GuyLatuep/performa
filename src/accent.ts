import { createStore } from "./store";

export type AccentColor = string;

const STORAGE_KEY = "performa-accent";

/** Neon yellow — the shipped default accent. */
export const DEFAULT_ACCENT = "#e6ff3d";

export const ACCENT_PRESETS: { value: AccentColor; label: string }[] = [
  { value: "#e6ff3d", label: "Yellow" },
  { value: "#ff3dc4", label: "Pink" },
  { value: "#3dfff0", label: "Cyan" },
  { value: "#3db4ff", label: "Light blue" },
];

function isValidHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function resolveInitial(): AccentColor {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && isValidHex(stored) ? stored : DEFAULT_ACCENT;
}

const store = createStore<AccentColor>(resolveInitial());

/** Black or white ink, whichever contrasts better against the given fill. */
function contrastingInk(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0a0a0a" : "#f5f4ef";
}

/** Reflect the current accent onto the document so CSS variables apply.
 *  Set as an inline style so it wins over the light/dark --accent rules. */
export function applyAccent(accent: AccentColor = store.get()): void {
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty(
    "--accent-ink",
    contrastingInk(accent),
  );
}

export function getAccent(): AccentColor {
  return store.get();
}

export function setAccent(accent: AccentColor): void {
  if (!isValidHex(accent)) return;
  store.set(accent);
  localStorage.setItem(STORAGE_KEY, accent);
  applyAccent(accent);
}

export function useAccent(): AccentColor {
  return store.use();
}

// Apply immediately on import so the first paint matches the saved accent.
applyAccent();
