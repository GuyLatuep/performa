import { createStore } from "./store";

// One-off announcements: shown the first time a user reaches the app after an
// update introduced something they have to know about, then never again.
//
// Kept as a set of ids rather than a "last version seen", so a notice is tied
// to the change it explains instead of to a release number — a user who skips
// three versions still gets each notice exactly once, and a release with
// nothing to announce shows nothing.

const SEEN_KEY = "performa-notices-seen";

/** Ids of the notices there are. One per announcement, never reused: changing
 *  an id re-shows the notice to everyone. */
export const TODO_FILTER_NOTICE = "todo-filter-2026-08";

function readSeen(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

const store = createStore<string[]>(readSeen());

/** Whether the notice is still owed to this user. */
export function useNoticePending(id: string): boolean {
  return store.useSelector((seen) => !seen.includes(id));
}

export function dismissNotice(id: string): void {
  const seen = store.get();
  if (seen.includes(id)) return;
  // A fresh array — the store compares with Object.is.
  const next = [...seen, id];
  localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  store.set(next);
}
