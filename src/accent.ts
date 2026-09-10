import { createStore } from "./store";

export type AccentColor = string;

const STORAGE_KEY = "performa-accent";

/** systemBlue — the shipped default accent, matching Apple's own. */
export const DEFAULT_ACCENT = "#007AFF";

/** Apple's system colours, in their light-mode values. One accent is ever
 *  live at a time; the picker exists because macOS offers one too. */
export const ACCENT_PRESETS: { value: AccentColor; label: string }[] = [
  { value: "#007AFF", label: "Blue" },
  { value: "#5856D6", label: "Indigo" },
  { value: "#AF52DE", label: "Purple" },
  { value: "#FF2D55", label: "Pink" },
  { value: "#FF9500", label: "Orange" },
  { value: "#34C759", label: "Green" },
];

function isValidHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function resolveInitial(): AccentColor {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && isValidHex(stored) ? stored : DEFAULT_ACCENT;
}

const store = createStore<AccentColor>(resolveInitial());

/** The only two inks the accent is ever paired with — pure black and white,
 *  the way Apple's own tinted fills are inked. */
export const INK_DARK = "#000000";
export const INK_LIGHT = "#ffffff";

/** The surface --accent-text is measured against, per theme. Each is the
 *  *harder* of the two backgrounds the app puts accent text on — the grouped
 *  one, which sits closer to the ink than the plain one does — so clearing it
 *  clears both. */
const TEXT_BACKDROP = { light: "#f2f2f7", dark: "#1c1c1e" } as const;

/** WCAG AA for normal-size text. */
const AA = 4.5;

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
 *  reads saturated pinks and light blues as light and puts white on them, at
 *  around 2-3:1. Since --accent-ink is the text colour on every primary
 *  button, tab and badge, that made those accents unreadable app-wide. */
export function contrastingInk(hex: string): string {
  return contrastRatio(INK_DARK, hex) >= contrastRatio(INK_LIGHT, hex)
    ? INK_DARK
    : INK_LIGHT;
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function toHex(rgb: number[]): string {
  return (
    "#" +
    rgb
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/**
 * The accent, darkened or lightened just enough to be readable *as text*.
 *
 * The accent is a fill colour: --accent-ink goes on top of it and the pair is
 * always legible. Apple's language also uses the accent the other way round —
 * as a tint, colouring text and glyphs on a plain background — and there the
 * raw colour often is not enough. systemBlue on white is 4.02:1, under AA,
 * and Apple ships that; this app states a WCAG AA commitment at the top of
 * App.css, so it does not.
 *
 * Since the accent is user-configurable the readable variant cannot be a
 * constant, so it is derived the same way --accent-ink is: step the colour
 * toward black (light theme) or white (dark theme) until it clears AA against
 * the backdrop. Returns the accent untouched when it already clears — most
 * of the presets do in dark mode.
 */
export function readableAccent(
  hex: string,
  theme: "light" | "dark" = "light",
): string {
  const backdrop = TEXT_BACKDROP[theme];
  const toward = theme === "dark" ? 255 : 0;
  const rgb = channels(hex);
  for (let step = 0; step <= 100; step++) {
    const t = step / 100;
    const candidate = toHex(rgb.map((v) => v + (toward - v) * t));
    if (contrastRatio(candidate, backdrop) >= AA) return candidate;
  }
  // Unreachable in practice: pure black on the light backdrop and pure white
  // on the dark one both clear AA by a wide margin.
  return theme === "dark" ? INK_LIGHT : INK_DARK;
}

/** The theme currently on the document, for the accent-text derivation.
 *  Read off the attribute rather than imported from theme.ts, which would
 *  couple the two modules in a direction neither wants. */
function currentTheme(): "light" | "dark" {
  return document.documentElement.getAttribute?.("data-theme") === "dark"
    ? "dark"
    : "light";
}

/** Reflect the current accent onto the document so CSS variables apply.
 *  Set as an inline style so it wins over the light/dark --accent rules.
 *
 *  Re-run when the theme changes — --accent-text is measured against the
 *  theme's backdrop, so it goes stale otherwise. main.tsx wires that up. */
export function applyAccent(accent: AccentColor = store.get()): void {
  const style = document.documentElement.style;
  style.setProperty("--accent", accent);
  style.setProperty("--accent-ink", contrastingInk(accent));
  style.setProperty("--accent-text", readableAccent(accent, currentTheme()));
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
