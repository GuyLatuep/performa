import { readStored, writeStored } from "./persist";

// Which findings the user has already looked at, kept in localStorage so the
// tabs don't blink again for the same ones after a restart. Shared by the
// missing-worklog watcher and the mentions inbox — both track a set of item
// signatures and prune it to the current findings so it can't grow unbounded.

/** The stored signature set, empty when nothing (usable) is stored yet. */
export function readSigSet(key: string): Set<string> {
  const stored = readStored(key);
  if (!Array.isArray(stored)) return new Set();
  return new Set(stored.filter((s) => typeof s === "string"));
}

/** Has a usable set ever been stored under this key? Tells "we looked and
 *  found nothing" apart from "we have never looked", which `readSigSet` alone
 *  cannot do — both give back an empty set. Malformed storage counts as never,
 *  so a corrupted set is reseeded rather than treated as a blank slate. */
export function hasSigSet(key: string): boolean {
  return Array.isArray(readStored(key));
}

export function writeSigSet(key: string, sigs: string[]): void {
  writeStored(key, sigs);
}
