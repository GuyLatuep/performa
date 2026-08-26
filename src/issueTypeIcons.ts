import { useEffect } from "react";
import { api } from "./api";
import { createStore } from "./store";

// Jira's issue-type icons, resolved to data URLs and kept by their Jira URL.
//
// A cache rather than a fetch per row because the URLs repeat: a list of fifty
// issues uses the same three or four types, and every row of every list shares
// them. `api.issueTypeIcon` already memoizes the in-flight call for the life of
// the process; what this adds is the part that survives a restart, so the rows
// are not blank for a moment on every launch.

const KEY = "performa-issue-type-icons";

/** How many icons are worth keeping. A site has a handful of types; the cap is
 *  there so a long-lived install cannot grow the entry without bound — an
 *  icon's data URL is a few kB, and localStorage is not large. */
const LIMIT = 30;

/** Keyed by Jira's icon URL. A plain object, not a Map: it is written to
 *  localStorage as it stands, and insertion order is what decides which entry
 *  is dropped when the cap is reached. */
type IconCache = Record<string, string>;

function read(): IconCache {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

const store = createStore<IconCache>(read());

function remember(url: string, dataUrl: string): void {
  const current = store.get();
  if (current[url] === dataUrl) return;
  const next: IconCache = { ...current, [url]: dataUrl };
  const urls = Object.keys(next);
  // Oldest first, which is the order they were inserted in.
  for (const stale of urls.slice(0, Math.max(0, urls.length - LIMIT)))
    delete next[stale];
  // A full localStorage is not worth a broken row: the cache still works for
  // this session, it just won't survive the restart.
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* keep it in memory only */
  }
  store.set(next);
}

/** URLs that came back with an error. Fetching an icon is best-effort — the row
 *  reads fine without it — and a failure must not turn into a request per
 *  mount for the rest of the session. */
const failed = new Set<string>();

/**
 * The data URL for one issue type's icon, fetching it the first time it is
 * asked for.
 *
 * `undefined` while it is on its way, and for good if it cannot be fetched at
 * all; the caller keeps the cell's space either way, so an icon arriving late
 * doesn't move the row.
 */
export function useIssueTypeIcon(url?: string): string | undefined {
  const icon = store.useSelector((icons) => (url ? icons[url] : undefined));

  useEffect(() => {
    if (!url || icon || failed.has(url)) return;
    let cancelled = false;
    api.issueTypeIcon(url).then(
      (dataUrl) => !cancelled && remember(url, dataUrl),
      () => {
        failed.add(url);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url, icon]);

  return icon;
}
