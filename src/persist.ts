import { createStore, Store } from "./store";

/**
 * The app's one door to localStorage.
 *
 * Everything the user has ever set lives behind that one key-value API, and it
 * is *outside data*: a key can be absent, hold what an older version of this
 * app wrote, hold something a user pasted in by hand, or be unreadable because
 * the browser refuses storage altogether. None of those is an error — all of
 * them mean "this user has not usefully set it" — but every one of them has to
 * be answered for before a value can be trusted.
 *
 * The guards are given once, here, rather than per stored thing. A module that
 * keeps something is then left with the only part that is actually its own:
 * what shape it expects, and what it wants when there isn't one.
 */

/** What is stored under `key`, or `undefined` when nothing usable is —
 *  absent, malformed, or a storage that won't answer. */
export function readStored(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Store `value` under `key`. Storing `null` removes the key instead: an
 *  absent key and a stored `null` are the same statement — nothing is set —
 *  and `readStored` cannot tell them apart anyway, so the tidier of the two
 *  is what gets written. */
export function writeStored(key: string, value: unknown): void {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
}

/** A store whose value is kept in localStorage. */
export interface PersistedStore<T> extends Store<T> {
  /** Write the value through to storage, then publish it. Always pass a fresh
   *  object or array: the store compares with `Object.is`, so an in-place edit
   *  is not a change and wakes nobody. */
  save: (next: T) => void;
}

/**
 * A store seeded from stored JSON and written back on every `save`.
 *
 * `parse` is handed whatever was stored — `undefined` when there was nothing
 * usable — and returns the value to start from. It runs once, at import.
 *
 * `encode` is for the stores whose stored shape is not their value: a config
 * that carries a schema version alongside it, say, which `parse` reads and
 * nothing in the app wants to hold. Most stores are written as they stand.
 */
export function persisted<T>(
  key: string,
  parse: (stored: unknown) => T,
  encode: (value: T) => unknown = (value) => value,
): PersistedStore<T> {
  const store = createStore<T>(parse(readStored(key)));
  return {
    ...store,
    save(next: T) {
      writeStored(key, encode(next));
      store.set(next);
    },
  };
}

/**
 * The same, for a value stored as a bare string rather than as JSON.
 *
 * The theme, the accent, the text scale and the settings toggles are all kept
 * unquoted — `dark`, not `"dark"` — and there are installs out there holding
 * exactly that, so the encoding is part of the format and not a detail to
 * unify away. `parse` gets the raw string, or null when the key is unset.
 */
export function persistedText<T>(
  key: string,
  parse: (stored: string | null) => T,
  encode: (value: T) => string = String,
): PersistedStore<T> {
  const store = createStore<T>(parse(localStorage.getItem(key)));
  return {
    ...store,
    save(next: T) {
      localStorage.setItem(key, encode(next));
      store.set(next);
    },
  };
}

/**
 * Bind stored keys to one account, dropping them when they were written for
 * somebody else. True when that happened, so the caller can reset whatever it
 * holds in memory too.
 *
 * Anything derived from one person's Jira means nothing on another's — read
 * marks are about that inbox, a saved search names a field that site spells
 * that way — and localStorage outlives a sign-out. Signing back in as the same
 * account keeps everything.
 */
export function claimStoredFor(
  ownerKey: string,
  account: string,
  keys: string[],
): boolean {
  if (localStorage.getItem(ownerKey) === account) return false;
  for (const key of keys) localStorage.removeItem(key);
  localStorage.setItem(ownerKey, account);
  return true;
}
