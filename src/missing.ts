import { api, MissingWorklog } from "./api";
import { notify } from "./notify";
import { createStore } from "./store";

// Background watcher behind the "Missing worklog" tab: polls Jira for recent
// own activity (comments / status changes) without a nearby worklog, and
// remembers which findings the user has already looked at so the tab only
// blinks for new ones. New findings also raise a desktop notification once.

const SEEN_KEY = "performa-missing-seen";
const NOTIFIED_KEY = "performa-missing-notified";
const POLL_MS = 2 * 60 * 1000;

interface MissingState {
  items: MissingWorklog[];
  unseenCount: number;
  lastError: string | null;
  /** HH:mm of the last completed check. */
  lastChecked: string | null;
}

const store = createStore<MissingState>({
  items: [],
  unseenCount: 0,
  lastError: null,
  lastChecked: null,
});

let pollId: number | undefined;

const sig = (item: MissingWorklog) => `${item.issueKey}@${item.activityAt}`;

function readSigSet(key: string): Set<string> {
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

const readSeen = () => readSigSet(SEEN_KEY);

// Distinct from the seen-set: "seen" is the user's acknowledgment (stops the
// tab blinking), "notified" only prevents duplicate desktop notifications.
async function notifyNew(items: MissingWorklog[]): Promise<void> {
  const notified = readSigSet(NOTIFIED_KEY);
  const fresh = items.filter((i) => !notified.has(sig(i)));
  // Pruned to the current findings so the set can't grow without bound.
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(items.map(sig)));
  if (fresh.length === 0) return;
  if (fresh.length === 1) {
    const item = fresh[0];
    const detail = item.detail ? ` — ${item.detail}` : "";
    await notify(
      `Missing worklog · ${item.issueKey}`,
      `${item.issueSummary}${detail}`,
    );
  } else {
    await notify("Missing worklogs", `${fresh.length} unlogged activities`);
  }
}

function countUnseen(items: MissingWorklog[]): number {
  const seen = readSeen();
  return items.filter((i) => !seen.has(sig(i))).length;
}

export function getMissing(): MissingWorklog[] {
  return store.get().items;
}

export async function refreshMissing(): Promise<void> {
  let items = store.get().items;
  let lastError: string | null = null;
  try {
    items = await api.missingWorklogs();
    await notifyNew(items);
  } catch (err) {
    lastError = String(err);
  }
  store.set({
    items,
    unseenCount: countUnseen(items),
    lastError,
    lastChecked: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  });
}

export function startMissingPolling(): void {
  if (pollId !== undefined) return;
  refreshMissing();
  pollId = window.setInterval(refreshMissing, POLL_MS);
}

export function stopMissingPolling(): void {
  if (pollId === undefined) return;
  window.clearInterval(pollId);
  pollId = undefined;
  store.set({ items: [], unseenCount: 0, lastError: null, lastChecked: null });
}

/** Acknowledge the current findings so the tab stops blinking for them. */
export function markMissingSeen(): void {
  const state = store.get();
  localStorage.setItem(SEEN_KEY, JSON.stringify(state.items.map(sig)));
  store.set({ ...state, unseenCount: countUnseen(state.items) });
}

export function useMissing(): MissingWorklog[] {
  return store.use().items;
}

export function useMissingUnseenCount(): number {
  return store.use().unseenCount;
}

export function useMissingError(): string | null {
  return store.use().lastError;
}

export function useMissingLastChecked(): string | null {
  return store.use().lastChecked;
}
