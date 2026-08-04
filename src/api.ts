import { invoke } from "@tauri-apps/api/core";
import { logError, logInfo } from "./log";

export interface Myself {
  accountId: string;
  displayName: string;
  emailAddress: string | null;
}

export interface CredentialsMeta {
  site: string;
  email: string;
}

export interface IssueSummary {
  key: string;
  summary: string;
  /** yyyy-MM-dd; only present on searches that request it (due_issues). */
  dueDate?: string;
}

export interface WorklogEntry {
  id: string;
  issueKey: string;
  issueSummary: string;
  timeSpentSeconds: number;
  date: string; // yyyy-MM-dd
  time: string; // HH:mm
  comment: string;
  billable: boolean;
}

/** The editable fields of a worklog, as the backend expects them. Build one
 *  from a form draft with `toWorklogInput` (components/WorklogFields). */
export interface WorklogInput {
  timeSpentSeconds: number;
  date: string; // yyyy-MM-dd
  time: string; // HH:mm
  comment: string;
  billable: boolean;
}

export interface MissingWorklog {
  issueKey: string;
  issueSummary: string;
  kind: "comment" | "status";
  /** The activity itself: a comment excerpt, or "Old status → New status". */
  detail: string;
  activityAt: string; // RFC3339
  /** Issue to log the work on (escalation source for DEV issues). */
  logKey: string;
  logSummary: string;
}

/**
 * Every backend call goes through here so each one lands a single debug-log
 * line: what was requested (`label`, caller-supplied — must omit secrets
 * like the API token), how it turned out (`describe` summarizes the result,
 * e.g. a result-set size), and how long it took. This is the app's one
 * performance/usage trace point, so prefer adding a `describe` over adding
 * ad hoc logging at call sites.
 */
function logged<T>(
  label: string,
  call: () => Promise<T>,
  describe?: (result: T) => string,
): Promise<T> {
  const start = performance.now();
  return call().then(
    (result) => {
      const ms = Math.round(performance.now() - start);
      const outcome = describe ? describe(result) : "ok";
      logInfo(`${label} → ${outcome} (${ms}ms)`);
      return result;
    },
    (err) => {
      const ms = Math.round(performance.now() - start);
      logError(`${label} failed after ${ms}ms: ${err}`);
      throw err;
    },
  );
}

/**
 * How long a completed read stays servable from `cached`.
 *
 * Short on purpose: this exists to collapse the refetch storm from tabs
 * unmounting and remounting (App renders one tab at a time, and the start and
 * timesheet tabs ask for the same week), not to hold data for long. Anything
 * the user changes in this app invalidates the cache outright — see
 * `invalidateCachedReads` — so the window only ever defers picking up a
 * worklog written somewhere else.
 */
const CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  promise: Promise<T>;
  /** Null while the call is still in flight: an unsettled entry never expires,
   *  which is what makes concurrent callers share one request instead of
   *  racing to start their own. */
  storedAt: number | null;
}

const readCache = new Map<string, CacheEntry<unknown>>();

/**
 * Serve a read from cache when one is fresh, join the in-flight call when one
 * is already running, and otherwise start it — keyed by `key`, which must
 * encode the arguments.
 *
 * Only reads that are pure functions of their arguments belong here. Note that
 * a cache hit bypasses `logged`, so a served-from-cache call is visible in the
 * debug log by the *absence* of its line.
 */
function cached<T>(key: string, call: () => Promise<T>): Promise<T> {
  const hit = readCache.get(key) as CacheEntry<T> | undefined;
  const fresh =
    hit && (hit.storedAt === null || Date.now() - hit.storedAt < CACHE_TTL_MS);
  if (hit && fresh) return hit.promise;

  const entry: CacheEntry<T> = { promise: call(), storedAt: null };
  readCache.set(key, entry);
  entry.promise.then(
    () => {
      entry.storedAt = Date.now();
    },
    () => {
      // Never cache a failure: the next caller should get a real retry, not a
      // rejected promise replayed for a minute. Guarded so a retry that has
      // already replaced this entry survives.
      if (readCache.get(key) === entry) readCache.delete(key);
    },
  );
  return entry.promise;
}

/** Drop every cached read, so the next call goes to Jira for real. Called
 *  after anything that writes a worklog. */
export function invalidateCachedReads(): void {
  readCache.clear();
}

const issues = (r: IssueSummary[]) => `${r.length} issue(s)`;
const entries = (r: WorklogEntry[]) => `${r.length} entr(y/ies)`;

export const api = {
  saveCredentials(site: string, email: string, token: string): Promise<Myself> {
    // Never log the token itself.
    return logged(
      `save_credentials(site=${site}, email=${email})`,
      () => invoke("save_credentials", { site, email, token }),
      (me) => `verified as ${me.displayName}`,
    );
  },
  credentialsStatus(): Promise<CredentialsMeta | null> {
    return logged(
      "credentials_status",
      () => invoke("credentials_status"),
      (r) => (r ? `configured (${r.site})` : "not configured"),
    );
  },
  clearCredentials(): Promise<void> {
    return logged("clear_credentials", () => invoke("clear_credentials"));
  },
  currentUser(): Promise<Myself> {
    return logged(
      "current_user",
      () => invoke("current_user"),
      (me) => me.displayName,
    );
  },
  /** Free-form search; the query is turned into JQL on the Rust side. */
  searchIssues(query: string): Promise<IssueSummary[]> {
    return logged(
      `search_issues(query=${JSON.stringify(query)})`,
      () => invoke("search_issues", { query }),
      issues,
    );
  },
  /** My issues due between 7 days ago and 14 days ahead, soonest first. */
  dueIssues(): Promise<IssueSummary[]> {
    return cached("due_issues", () =>
      logged("due_issues", () => invoke("due_issues"), issues),
    );
  },
  /** Best-effort: move the issue to the "in progress" workflow status. A
   *  no-op (not an error) when the workflow has no direct transition there. */
  startIssueWork(issueKey: string): Promise<void> {
    return logged(`start_issue_work(issueKey=${issueKey})`, () =>
      invoke("start_issue_work", { issueKey }),
    );
  },
  // The three worklog mutations each drop the read cache on success, so the
  // invalidation lives with the write rather than at every call site that
  // happens to trigger one.
  logWork(issueKey: string, worklog: WorklogInput): Promise<void> {
    return logged(
      `log_work(issueKey=${issueKey}, seconds=${worklog.timeSpentSeconds}, date=${worklog.date}, billable=${worklog.billable})`,
      () => invoke("log_work", { issueKey, worklog }),
    ).then(invalidateCachedReads);
  },
  updateWorklog(
    issueKey: string,
    worklogId: string,
    worklog: WorklogInput,
  ): Promise<void> {
    return logged(
      `update_worklog(issueKey=${issueKey}, worklogId=${worklogId}, seconds=${worklog.timeSpentSeconds})`,
      () => invoke("update_worklog", { issueKey, worklogId, worklog }),
    ).then(invalidateCachedReads);
  },
  deleteWorklog(issueKey: string, worklogId: string): Promise<void> {
    return logged(
      `delete_worklog(issueKey=${issueKey}, worklogId=${worklogId})`,
      () => invoke("delete_worklog", { issueKey, worklogId }),
    ).then(invalidateCachedReads);
  },
  listWorklogs(start: string, end: string): Promise<WorklogEntry[]> {
    return cached(`list_worklogs:${start}:${end}`, () =>
      logged(
        `list_worklogs(start=${start}, end=${end})`,
        () => invoke("list_worklogs", { start, end }),
        entries,
      ),
    );
  },
  issueWorklogs(issueKey: string): Promise<WorklogEntry[]> {
    return logged(
      `issue_worklogs(issueKey=${issueKey})`,
      () => invoke("issue_worklogs", { issueKey }),
      entries,
    );
  },
  missingWorklogs(): Promise<MissingWorklog[]> {
    return logged(
      "missing_worklogs",
      () => invoke("missing_worklogs"),
      (r) => `${r.length} item(s)`,
    );
  },
  /** Change the debug-log verbosity ("error" | "warn" | "info" | "debug"). */
  setLogLevel(level: string): Promise<void> {
    return invoke("set_log_level", { level });
  },
  /** Reveal the folder holding the rotated debug log files. */
  openLogFolder(): Promise<void> {
    return invoke("open_log_folder");
  },
};
