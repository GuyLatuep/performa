import { useEffect, useRef } from "react";

/** ↑ ↑ ↓ ↓ ← → ← → B A. */
export const KONAMI_CODE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

/**
 * The last few keys, with `key` added and anything older than the code
 * dropped.
 *
 * A rolling window rather than a progress counter: counting forward has to
 * decide what a wrong key means, and every simple rule for that gets some
 * sequence wrong — "↑ ↑ ↑ ↓ ↓ …" being the easy one to trip over, since the
 * third press is both a mismatch and a legitimate start. Comparing the tail
 * has no such rule to get wrong.
 */
export function pushKey(recent: string[], key: string): string[] {
  const pressed = key.length === 1 ? key.toLowerCase() : key;
  return [...recent, pressed].slice(-KONAMI_CODE.length);
}

/** True when those keys end with the code. */
export function isKonami(recent: string[]): boolean {
  return (
    recent.length === KONAMI_CODE.length &&
    recent.every((k, i) => k === KONAMI_CODE[i])
  );
}

/** Watch for the code while `active`, and call `onEntered` when it lands. */
export function useKonamiCode(onEntered: () => void, active: boolean): void {
  const recent = useRef<string[]>([]);

  useEffect(() => {
    if (!active) {
      recent.current = [];
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      // Not while somebody is typing: the letters at the end of the code are
      // ordinary letters in a comment box.
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      )
        return;
      recent.current = pushKey(recent.current, e.key);
      if (isKonami(recent.current)) {
        recent.current = [];
        onEntered();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onEntered, active]);
}
