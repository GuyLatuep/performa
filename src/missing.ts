import { api, MissingWorklog } from "./api";
import { logInfo } from "./log";
import { notify } from "./notify";
import { readSigSet, writeSigSet } from "./seen";
import { createStore } from "./store";

// Background watcher behind the "Missing worklog" tab: polls Jira for recent
// own activity (comments / status changes) without a nearby worklog, and
// remembers which findings the user has already looked at so the tab only
// blinks for new ones. New findings also raise a desktop notification once.

const SEEN_KEY = "performa-missing-seen";
const NOTIFIED_KEY = "performa-missing-notified";
// Each check costs a burst of Jira requests (one search per candidate issue,
// plus worklogs and changelog per hit), so the interval is kept wide. Anything
// missed in between still surfaces at the next run, on "Check now", or when
// closing the app — the reminder is not time-critical.
const POLL_MS = 15 * 60 * 1000;
// Both watchers start the moment the user signs in, and both begin with a cold
// per-issue cache — the one run in which every candidate issue costs a request.
// Colliding makes the app's heaviest burst its very first one, while the window
// is still being drawn. The mentions inbox is the alarm and goes first; this
// scan reports on work already done, so it loses nothing by waiting.
const INITIAL_DELAY_MS = 20 * 1000;

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
// The delayed opening scan — see `INITIAL_DELAY_MS`.
let firstRunId: number | undefined;
// The scan currently running, if any — see `refreshMissing`.
let inFlight: Promise<void> | null = null;

const sig = (item: MissingWorklog) => `${item.issueKey}@${item.activityAt}`;

const readSeen = () => readSigSet(SEEN_KEY);

// Distinct from the seen-set: "seen" is the user's acknowledgment (stops the
// tab blinking), "notified" only prevents duplicate desktop notifications.
async function notifyNew(items: MissingWorklog[]): Promise<void> {
  const notified = readSigSet(NOTIFIED_KEY);
  const fresh = items.filter((i) => !notified.has(sig(i)));
  // Pruned to the current findings so the set can't grow without bound.
  writeSigSet(NOTIFIED_KEY, items.map(sig));
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

/** Do two scans report the same findings? Compared by signature, the same key
 *  the seen/notified sets use. Lets `refreshMissing` hand back the array it
 *  already had, so the components watching `items` are not re-rendered by a
 *  check that turned up nothing new. */
function sameItems(a: MissingWorklog[], b: MissingWorklog[]): boolean {
  return a.length === b.length && a.every((item, i) => sig(item) === sig(b[i]));
}

export function getMissing(): MissingWorklog[] {
  return store.get().items;
}

/** `source` only labels the debug log — "why did this check run", separate
 *  from the generic request/result line `api.missingWorklogs()` already logs. */
export function refreshMissing(
  source: "poll" | "manual" | "post-log" | "close" = "poll",
): Promise<void> {
  // One scan at a time, as in the mentions inbox. This one has more ways to be
  // triggered than the poll — logging work and closing the app both ask for a
  // fresh check — so two can overlap without the interval being anywhere near
  // the scan duration, and they would announce the same finding twice and land
  // their results in completion order.
  inFlight ??= runRefresh(source).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runRefresh(
  source: "poll" | "manual" | "post-log" | "close",
): Promise<void> {
  logInfo(`missing-worklog check triggered (${source})`);
  const previous = store.get().items;
  let items = previous;
  let lastError: string | null = null;
  try {
    items = await api.missingWorklogs();
    await notifyNew(items);
  } catch (err) {
    lastError = String(err);
  }
  store.set({
    // `lastChecked` below moves on every single check, so the state object is
    // always new — keeping the array identity is what spares the components
    // that only watch `items` (see the `useSelector` hooks at the bottom).
    items: sameItems(previous, items) ? previous : items,
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
  firstRunId = window.setTimeout(refreshMissing, INITIAL_DELAY_MS);
  pollId = window.setInterval(refreshMissing, POLL_MS);
}

export function stopMissingPolling(): void {
  if (pollId === undefined) return;
  window.clearInterval(pollId);
  // Signing out during the opening delay must not fire a scan afterwards.
  window.clearTimeout(firstRunId);
  pollId = undefined;
  firstRunId = undefined;
  store.set({ items: [], unseenCount: 0, lastError: null, lastChecked: null });
}

/** Acknowledge the current findings so the tab stops blinking for them. */
export function markMissingSeen(): void {
  const state = store.get();
  writeSigSet(SEEN_KEY, state.items.map(sig));
  store.set({ ...state, unseenCount: countUnseen(state.items) });
}

// Each hook selects its own field rather than the whole state: a check that
// only moves `lastChecked` then re-renders the one component showing that
// timestamp, instead of every component watching for findings.

export function useMissing(): MissingWorklog[] {
  return store.useSelector((s) => s.items);
}

export function useMissingUnseenCount(): number {
  return store.useSelector((s) => s.unseenCount);
}

export function useMissingError(): string | null {
  return store.useSelector((s) => s.lastError);
}

export function useMissingLastChecked(): string | null {
  return store.useSelector((s) => s.lastChecked);
}
