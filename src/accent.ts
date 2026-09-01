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

/** The only two inks the accent is ever paired with — they match --ink in the
 *  light and dark palettes, so accent fills sit in the same ink family as the
 *  rest of the app. */
export const INK_DARK = "#0a0a0a";
export const INK_LIGHT = "#f5f4ef";

/** WCAG relative luminance of an #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white ink, whichever contrasts better against the given fill.
 *
 *  Measured with the WCAG luminance formula rather than a perceived-brightness
 *  shortcut. The two disagree on saturated mid-tones: weighting the raw channels
 *  reads the pink and light-blue presets as light and puts white on them, at
 *  2.8:1 and 2.1:1. Since --accent-ink is the text colour on every primary
 *  button, tab and badge, that made those presets unreadable app-wide. */
export function contrastingInk(hex: string): string {
  return contrastRatio(INK_DARK, hex) >= contrastRatio(INK_LIGHT, hex)
    ? INK_DARK
    : INK_LIGHT;
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
