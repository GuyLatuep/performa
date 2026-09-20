import { useEffect } from "react";
import { api } from "./api";
import { createStore } from "./store";

// The issue type behind a key, for the views whose rows don't carry one.
//
// A worklog names its issue and nothing else: the month matrix knows the key
// and the summary, never the type, so the icon every other list shows has to
// be looked up. One search answers a whole month — `key in (…)` over the keys
// on screen — rather than a request per row, and the answers are kept for the
// session so paging back and forth over the same months asks once.
//
// Best effort throughout. The grid reads fine with no icon in it, so a failed
// lookup is remembered as a failure and never retried rather than surfaced.

/** What a list needs to draw the type: the name for the tooltip, the URL for
 *  `useIssueTypeIcon` to resolve into an image. */
export interface IssueTypeInfo {
  name?: string;
  iconUrl?: string;
}

const store = createStore<Record<string, IssueTypeInfo>>({});

/** Keys whose lookup failed, and keys whose lookup is on its way. Neither is
 *  asked for again: the first would repeat a request that already didn't work,
 *  the second would duplicate one still in flight. */
const failed = new Set<string>();
const inFlight = new Set<string>();

/** Keys per search. Well under the 2,000-character cap the backend puts on a
 *  query, with room for the longest keys a site produces. */
const CHUNK = 80;

/** The type behind one key, once it is known.
 *
 *  A stable object per key — the selector hands back what the store holds, not
 *  a fresh shape each render, which `useSelector` requires. */
export function useIssueType(key: string): IssueTypeInfo | undefined {
  return store.useSelector((types) => types[key]);
}

/** The type behind one key as the cache stands right now, outside React —
 *  what a callback that has just finished loading a month reads, where a hook
 *  cannot go. */
export function issueTypeName(issueKey: string): string | undefined {
  return store.get()[issueKey]?.name;
}

/** Every type known so far, keyed by issue key.
 *
 *  What the month matrix orders its rows by — a sort is about all the rows at
 *  once, so it wants the whole table rather than a hook per row. The object
 *  identity changes exactly when a lookup lands, which is the cue to re-sort. */
export function useIssueTypeNames(): Record<string, IssueTypeInfo> {
  return store.use();
}

/** Look up whatever is missing among these keys. Pass an empty list to ask for
 *  nothing — what a caller does when the icons are turned off. */
export function useIssueTypes(keys: string[]): void {
  // The effect runs on the *set* of keys, not on the array identity: the
  // caller rebuilds its list every render, and depending on the array itself
  // would search the same month again on each one.
  const wanted = keys.join(",");

  useEffect(() => {
    const known = store.get();
    const missing = [
      ...new Set(
        keys.filter(
          (key) => !(key in known) && !failed.has(key) && !inFlight.has(key),
        ),
      ),
    ];
    if (missing.length === 0) return;
    for (const key of missing) inFlight.add(key);

    for (let at = 0; at < missing.length; at += CHUNK) {
      const chunk = missing.slice(at, at + CHUNK);
      const jql = `key in (${chunk.map((key) => `"${key}"`).join(",")})`;
      api.viewIssues(jql).then(
        ({ issues }) => {
          const next = { ...store.get() };
          for (const issue of issues)
            next[issue.key] = {
              name: issue.issueType,
              iconUrl: issue.issueTypeIcon,
            };
          // A key the search didn't answer for — a deleted issue, or one this
          // account can no longer see — must not stay pending forever.
          for (const key of chunk) if (!(key in next)) failed.add(key);
          for (const key of chunk) inFlight.delete(key);
          store.set(next);
        },
        () => {
          for (const key of chunk) {
            inFlight.delete(key);
            failed.add(key);
          }
        },
      );
    }
    // `keys` is read through `wanted`, which is the same list written out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
}
