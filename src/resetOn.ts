import { useState } from "react";

/**
 * Run `reset` in the render where `key` changes, not in an effect after it.
 *
 * The pattern React documents for "adjusting state when a prop changes": an
 * effect would first paint the stale state — last issue's error, the previous
 * month's rows — and then render a second time to clear it. Done here, the
 * render that sees the new key is already the one with the state reset.
 *
 * `reset` may only set this component's own state. It does not run on mount:
 * the initial state is what a fresh key starts from. Keys are compared with
 * `Object.is`, so several values belong in one string.
 */
export function useResetOn<K>(key: K, reset: () => void): void {
  const [seen, setSeen] = useState(key);
  if (!Object.is(seen, key)) {
    setSeen(key);
    reset();
  }
}
