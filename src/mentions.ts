import { api, Mention } from "./api";
import { logInfo } from "./log";
import { notify } from "./notify";
import { hasSigSet, readSigSet, writeSigSet } from "./seen";
import { createStore } from "./store";

// Background watcher behind the "Mentions" tab: polls Jira for comments that
// tag the current user and tracks which of them have been read. Opening the tab
// marks everything currently listed as read; the badge counts what is left.
// New mentions also raise a desktop notification once.

const READ_KEY = "performa-mentions-read";
const NOTIFIED_KEY = "performa-mentions-notified";
// Which account the two sets above were collected for. Both are statements
// about one person's inbox, and localStorage outlives a sign-out.
const OWNER_KEY = "performa-mentions-owner";
// Ceiling on the notified set. It is pruned towards the current findings, but
// not down to them (see `notifyNew`), so it needs a bound of its own.
const MAX_NOTIFIED = 500;
// This inbox is meant to stand in for Jira's mention mails, so it has to be
// the first alarm rather than a standing overview — hence a much tighter
// interval than the missing-worklog scan, which reports on work already done
// and does not care about minutes. The extra cost is bounded: the per-issue
// cache is keyed on the issue's `updated` timestamp, so a re-scan re-reads
// comments only for issues that actually changed. Nothing notifies while the
// app is closed; that is a limit of a desktop app, not something to poll away.
const POLL_MS = 3 * 60 * 1000;

interface MentionsState {
  items: Mention[];
  unreadCount: number;
  lastError: string | null;
  /** HH:mm of the last completed check. */
  lastChecked: string | null;
  /** The last scan hit the ceiling on issues it was willing to look at, so
   *  the list below may be missing mentions nobody ever saw. */
  truncated: boolean;
  /** The account has no display name, so the scan could only look at issues
   *  the user is otherwise involved with. */
  nameSearchSkipped: boolean;
}

const store = createStore<MentionsState>({
  items: [],
  unreadCount: 0,
  lastError: null,
  lastChecked: null,
  truncated: false,
  nameSearchSkipped: false,
});

let pollId: number | undefined;
// The scan currently running, if any — see `refreshMentions`.
let inFlight: Promise<void> | null = null;

/** Identity of one mention. A comment can only be edited, never re-created
 *  under the same id, so this stays stable across scans. */
export const mentionId = (item: Mention) =>
  `${item.issueKey}:${item.commentId}`;

// Distinct from the read set: "read" is the user's acknowledgment (clears the
// badge), "notified" only prevents duplicate desktop notifications.
async function notifyNew(items: Mention[]): Promise<void> {
  // The very first scan turns up the whole lookback window at once — a
  // fortnight the user has long since read in Jira. Record it as already
  // announced instead of raising a toast about a backlog; only what appears
  // after this first scan is news.
  const firstScan = !hasSigSet(NOTIFIED_KEY);
  const notified = readSigSet(NOTIFIED_KEY);
  const fresh = firstScan
    ? []
    : items.filter((i) => !notified.has(mentionId(i)));
  // Kept for a while beyond the current findings, newest first, and only then
  // bounded. Pruning straight down to this scan's items would re-announce an
  // old mention as soon as its issue dropped out of the candidate search and
  // came back — which the bounded candidate list makes routine.
  const remembered = [...items.map(mentionId), ...notified];
  writeSigSet(NOTIFIED_KEY, [...new Set(remembered)].slice(0, MAX_NOTIFIED));
  if (fresh.length === 0) return;
  if (fresh.length === 1) {
    const item = fresh[0];
    await notify(
      `${item.author} mentioned you · ${item.issueKey}`,
      item.text || item.issueSummary,
    );
  } else {
    await notify("New mentions", `${fresh.length} comments mention you`);
  }
}

function countUnread(items: Mention[]): number {
  const read = readSigSet(READ_KEY);
  return items.filter((i) => !read.has(mentionId(i))).length;
}

/** Do two scans report the same mentions? Lets `refreshMentions` hand back the
 *  array it already had, so a check that turned up nothing new does not
 *  re-render the list (see the `useSelector` hooks at the bottom). */
function sameItems(a: Mention[], b: Mention[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, i) => mentionId(item) === mentionId(b[i]))
  );
}

export function getMentions(): Mention[] {
  return store.get().items;
}

/** The ids not yet acknowledged. Read once when the tab opens, so the rows can
 *  stay highlighted while that same visit marks them read. */
export function unreadMentionIds(): Set<string> {
  const read = readSigSet(READ_KEY);
  return new Set(
    store
      .get()
      .items.map(mentionId)
      .filter((id) => !read.has(id)),
  );
}

/** `source` only labels the debug log — "why did this check run", separate
 *  from the generic request/result line `api.mentions()` already logs. */
export function refreshMentions(
  source: "poll" | "manual" = "poll",
): Promise<void> {
  // One scan at a time. A scan can outlast the poll interval (a cold cache
  // opens every candidate issue), and two in flight would read the notified
  // set before either wrote it — announcing the same mention twice — and then
  // land their results in completion order.
  inFlight ??= runRefresh(source).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runRefresh(source: "poll" | "manual"): Promise<void> {
  logInfo(`mention check triggered (${source})`);
  const previous = store.get().items;
  let items = previous;
  let truncated = store.get().truncated;
  let nameSearchSkipped = store.get().nameSearchSkipped;
  let lastError: string | null = null;
  try {
    const scan = await api.mentions();
    items = scan.mentions;
    truncated = scan.truncated;
    nameSearchSkipped = scan.nameSearchSkipped;
    await notifyNew(items);
  } catch (err) {
    lastError = String(err);
  }
  store.set({
    items: sameItems(previous, items) ? previous : items,
    unreadCount: countUnread(items),
    lastError,
    truncated,
    nameSearchSkipped,
    lastChecked: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  });
}

/** Bind the stored read and notified sets to `account`, dropping them if they
 *  were collected for somebody else. Without this a second account inherits
 *  the first one's read marks, and its whole fortnight of mentions counts as
 *  unseen news — a notification about a backlog nobody here has seen.
 *  Signing back in as the same account keeps everything. */
export function claimMentionsFor(account: string): void {
  if (localStorage.getItem(OWNER_KEY) === account) return;
  localStorage.removeItem(NOTIFIED_KEY);
  localStorage.removeItem(READ_KEY);
  localStorage.setItem(OWNER_KEY, account);
}

/** `account` identifies whose inbox this is — see `claimMentionsFor`. */
export function startMentionsPolling(account: string): void {
  if (pollId !== undefined) return;
  claimMentionsFor(account);
  refreshMentions();
  pollId = window.setInterval(refreshMentions, POLL_MS);
}

export function stopMentionsPolling(): void {
  if (pollId === undefined) return;
  window.clearInterval(pollId);
  pollId = undefined;
  store.set({
    items: [],
    unreadCount: 0,
    lastError: null,
    lastChecked: null,
    truncated: false,
    nameSearchSkipped: false,
  });
}

/** Mark everything currently listed as read. Pruning to the current findings
 *  keeps the stored set bounded; a mention that scrolls out of the lookback
 *  window and later returns would count as unread again, which is the safer
 *  way round. */
export function markMentionsRead(): void {
  const state = store.get();
  writeSigSet(READ_KEY, state.items.map(mentionId));
  store.set({ ...state, unreadCount: countUnread(state.items) });
}

export function useMentions(): Mention[] {
  return store.useSelector((s) => s.items);
}

export function useMentionsUnreadCount(): number {
  return store.useSelector((s) => s.unreadCount);
}

export function useMentionsError(): string | null {
  return store.useSelector((s) => s.lastError);
}

export function useMentionsLastChecked(): string | null {
  return store.useSelector((s) => s.lastChecked);
}

export function getMentionsTruncated(): boolean {
  return store.get().truncated;
}

export function useMentionsTruncated(): boolean {
  return store.useSelector((s) => s.truncated);
}

export function getMentionsNameSearchSkipped(): boolean {
  return store.get().nameSearchSkipped;
}

export function useMentionsNameSearchSkipped(): boolean {
  return store.useSelector((s) => s.nameSearchSkipped);
}
