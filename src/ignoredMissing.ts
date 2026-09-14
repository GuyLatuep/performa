import { MissingWorklog } from "./api";
import { persisted } from "./persist";

// Missing-worklog findings the user has waved away, per issue.
//
// A Jira automation that moves the parent epic along with the issue the
// developer actually touched runs *as* that developer, so both issues count as
// own activity and both get flagged — but only one of them deserves a worklog.
// The heuristic cannot tell the two apart, so the user does it by hand.
//
// An ignore is a timestamp, not a flag: the issue stays hidden only as long as
// its newest flagged activity is older than the moment it was ignored. Work on
// it again and it is flagged again, on the ordinary criteria. Storing the
// activity signature instead would hide that issue's *current* activity just
// the same, but would say nothing about what came after it.

const IGNORED_KEY = "performa-missing-ignored";

// The scan itself only looks back a day (`MISSING_LOOKBACK_DAYS`), so an ignore
// older than that can no longer be hiding anything. Dropping it keeps the
// stored map to the handful of issues that are actually still in play.
const TTL_MS = 24 * 60 * 60 * 1000;

/** Issue key → when the user ignored it, epoch ms. */
export type IgnoredMissing = Record<string, number>;

/** Without the entries that have outlived `TTL_MS`, and without anything that
 *  isn't a usable timestamp. */
function prune(ignored: IgnoredMissing, now: number): IgnoredMissing {
  const out: IgnoredMissing = {};
  for (const [key, at] of Object.entries(ignored)) {
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    if (now - at >= TTL_MS) continue;
    out[key] = at;
  }
  return out;
}

// Parsed once at import — which is also the 24-hour cleanup the app does on
// every start, since nothing imports this module twice.
const store = persisted<IgnoredMissing>(IGNORED_KEY, (stored) =>
  !stored || typeof stored !== "object" || Array.isArray(stored)
    ? {}
    : prune(stored as IgnoredMissing, Date.now()),
);

// Whatever that prune dropped is gone from storage too, not just from this
// session's copy.
store.save(store.get());

export function getIgnoredMissing(): IgnoredMissing {
  return store.get();
}

/** Hide this issue's current findings until it sees newer activity. */
export function ignoreIssue(issueKey: string): void {
  store.save(prune({ ...store.get(), [issueKey]: Date.now() }, Date.now()));
}

export function clearIgnoredMissing(): void {
  store.save({});
}

/** Is this finding covered by an ignore? Only activity from before the ignore
 *  is hidden; anything the user did afterwards brings the issue back.
 *
 *  A timestamp that won't parse counts as covered: the finding is one the user
 *  has already dismissed for this issue, and re-showing a row nobody can date
 *  is the worse of the two failures. */
export function isIgnored(
  ignored: IgnoredMissing,
  item: MissingWorklog,
): boolean {
  const at = ignored[item.issueKey];
  if (at === undefined) return false;
  const activity = Date.parse(item.activityAt);
  return Number.isNaN(activity) || activity <= at;
}
