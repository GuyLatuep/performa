import { createStore } from "./store";

/** How large the app draws its text. Scales the root font size, which every
 *  --fs-* token is relative to, so one value resizes the whole UI. */
export type TextScale = "normal" | "large" | "larger";

const STORAGE_KEY = "performa-text-scale";

/** The multiplier each step applies to the 16px root. Kept modest: the tight
 *  layouts (the month matrix, the todo column header) are sized in px and stop
 *  fitting well before a doubling. */
export const SCALES: Record<TextScale, number> = {
  normal: 1,
  large: 1.12,
  larger: 1.25,
};

function isTextScale(value: string | null): value is TextScale {
  return value !== null && value in SCALES;
}

function resolveInitial(): TextScale {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isTextScale(stored) ? stored : "normal";
}

const store = createStore<TextScale>(resolveInitial());

/** Reflect the current scale onto the document so the root font size follows.
 *  Set as an inline style, the way the accent is, so it wins over the :root
 *  rules. */
export function applyTextScale(scale: TextScale = store.get()): void {
  document.documentElement.style.setProperty(
    "--text-scale",
    String(SCALES[scale]),
  );
}

export function getTextScale(): TextScale {
  return store.get();
}

export function setTextScale(scale: TextScale): void {
  store.set(scale);
  localStorage.setItem(STORAGE_KEY, scale);
  applyTextScale(scale);
}

/** React binding kept in sync across every mounted control. */
export function useTextScale(): [TextScale, (scale: TextScale) => void] {
  return [store.use(), setTextScale];
}

// Apply immediately on import so the first paint matches the saved scale.
applyTextScale();
