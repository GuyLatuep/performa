import { api, Mention } from "./api";
import { logInfo } from "./log";
import { notify } from "./notify";
import { readSigSet, writeSigSet } from "./seen";
import { createStore } from "./store";

// Background watcher behind the "Mentions" tab: polls Jira for comments that
// tag the current user and tracks which of them have been read. Opening the tab
// marks everything currently listed as read; the badge counts what is left.
// New mentions also raise a desktop notification once.

const READ_KEY = "performa-mentions-read";
const NOTIFIED_KEY = "performa-mentions-notified";
// One search pair plus a comment fetch per candidate issue, so the same wide
// interval as the missing-worklog scan. Jira mails about mentions anyway —
// this tab is the standing overview, not the first alarm.
const POLL_MS = 15 * 60 * 1000;

interface MentionsState {
  items: Mention[];
  unreadCount: number;
  lastError: string | null;
  /** HH:mm of the last completed check. */
  lastChecked: string | null;
}

const store = createStore<MentionsState>({
  items: [],
  unreadCount: 0,
  lastError: null,
  lastChecked: null,
});

let pollId: number | undefined;

/** Identity of one mention. A comment can only be edited, never re-created
 *  under the same id, so this stays stable across scans. */
export const mentionId = (item: Mention) =>
  `${item.issueKey}:${item.commentId}`;

// Distinct from the read set: "read" is the user's acknowledgment (clears the
// badge), "notified" only prevents duplicate desktop notifications.
async function notifyNew(items: Mention[]): Promise<void> {
  const notified = readSigSet(NOTIFIED_KEY);
  const fresh = items.filter((i) => !notified.has(mentionId(i)));
  // Pruned to the current findings so the set can't grow without bound.
  writeSigSet(NOTIFIED_KEY, items.map(mentionId));
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
export async function refreshMentions(
  source: "poll" | "manual" = "poll",
): Promise<void> {
  logInfo(`mention check triggered (${source})`);
  const previous = store.get().items;
  let items = previous;
  let lastError: string | null = null;
  try {
    items = await api.mentions();
    await notifyNew(items);
  } catch (err) {
    lastError = String(err);
  }
  store.set({
    items: sameItems(previous, items) ? previous : items,
    unreadCount: countUnread(items),
    lastError,
    lastChecked: new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  });
}

export function startMentionsPolling(): void {
  if (pollId !== undefined) return;
  refreshMentions();
  pollId = window.setInterval(refreshMentions, POLL_MS);
}

export function stopMentionsPolling(): void {
  if (pollId === undefined) return;
  window.clearInterval(pollId);
  pollId = undefined;
  store.set({ items: [], unreadCount: 0, lastError: null, lastChecked: null });
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
