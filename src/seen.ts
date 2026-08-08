// Which findings the user has already looked at, kept in localStorage so the
// tabs don't blink again for the same ones after a restart. Shared by the
// missing-worklog watcher and the mentions inbox — both track a set of item
// signatures and prune it to the current findings so it can't grow unbounded.

/** The stored signature set, empty when nothing (usable) is stored yet. */
export function readSigSet(key: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (Array.isArray(raw)) {
      return new Set(raw.filter((s) => typeof s === "string"));
    }
  } catch {
    /* ignore malformed storage */
  }
  return new Set();
}

export function writeSigSet(key: string, sigs: string[]): void {
  localStorage.setItem(key, JSON.stringify(sigs));
}
