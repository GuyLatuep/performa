import { invoke } from "@tauri-apps/api/core";
import { logError, logInfo } from "./log";
import type { PickedMention } from "./mentionInput";

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
  /** Workflow status name; only present on searches that request it
   *  (todo_issues). */
  status?: string;
  /** Priority name; only present on searches that request it (todo_issues). */
  priority?: string;
}

/** One named field of an issue, already rendered to display text by the
 *  backend — Jira's custom fields arrive in half a dozen shapes and the
 *  webview should not have to know any of them. */
export interface IssueField {
  id: string;
  /** The field's name as configured on the site ("Plant-No."). */
  label: string;
  value: string;
}

/** Everything the issue view shows above the timeline. */
export interface IssueDetail {
  key: string;
  summary: string;
  status?: string;
  priority?: string;
  issueType?: string;
  reporter?: string;
  assignee?: string;
  dueDate?: string; // yyyy-MM-dd
  createdAt: string; // RFC3339, local
  updatedAt: string;
  /** Flattened to plain text, line breaks preserved. */
  description: string;
  /** The site's configured fields, in display order. Fields this site doesn't
   *  have — or that are empty on this issue — are simply absent. */
  details: IssueField[];
  /** Whether a comment here can be public, i.e. whether this is a service-desk
   *  request. Drives whether a customer reply is offered at all. */
  serviceDesk: boolean;
  /** Files on the issue, newest first. */
  attachments: Attachment[];
}

/** One file attached to an issue. Carries no URL: the content is fetched by id
 *  through the Rust side, which is where the credentials are. */
export interface Attachment {
  id: string;
  filename: string;
  size: number;
  mimeType?: string;
  author: string;
  createdAt: string;
}

/** A comment somebody wrote on the issue. */
export interface IssueComment {
  id: string;
  author: string;
  createdAt: string;
  createdTs: number;
  text: string;
  /** Agent-only service-desk comment. Always false elsewhere. */
  internal: boolean;
}

/** The workflow moving the issue between statuses. */
export interface StatusChange {
  id: string;
  author: string;
  createdAt: string;
  createdTs: number;
  from?: string;
  to?: string;
}

/** Time somebody recorded against the issue. Distinct from `WorklogEntry`,
 *  which is the current user's own time as the timesheet needs it. */
export interface ActivityWorklog {
  id: string;
  author: string;
  createdAt: string;
  createdTs: number;
  timeSpentSeconds: number;
  comment: string;
}

/** An issue's history, one list per kind. They are shown on a single timeline
 *  (see `timeline` in ./activity) but they are not three kinds of one thing —
 *  see CONTEXT.md. */
export interface IssueActivity {
  comments: IssueComment[];
  statusChanges: StatusChange[];
  worklogs: ActivityWorklog[];
}

/** Somebody who can be @-mentioned. */
export interface JiraUser {
  /** Jira's opaque account id — what a mention points at. Display names are
   *  neither unique nor stable; this is. */
  accountId: string;
  displayName: string;
  /** Absent when the site hides email addresses, which is the Cloud default. */
  email?: string;
}

/** One permitted value of a constrained field. */
export interface AllowedValue {
  id: string;
  label: string;
}

/** One field of a transition screen or an issue's edit form, close to the
 *  shape Jira describes it in. Turning this into something renderable is
 *  `toFormFields` in ./issueFields — Jira spreads the answer across the base
 *  type, the array item type and the custom-field URI. */
export interface FieldMeta {
  id: string;
  name: string;
  required: boolean;
  schemaType: string;
  schemaItems?: string;
  schemaCustom?: string;
  /** The built-in field this is ("description", "environment", …). Some are
   *  rich text even though their base type is only "string". */
  schemaSystem?: string;
  /** What Jira says can be done to the field. Without "set", this app cannot
   *  fill it in. */
  operations: string[];
  allowedValues: AllowedValue[];
}

/** A move the workflow currently permits from the issue's status. Not the same
 *  as setting a status field: which ones exist depends on where the issue is
 *  right now. See CONTEXT.md. */
export interface Transition {
  id: string;
  /** The transition's own name ("Start Progress"), which is not always the
   *  name of the status it leads to. */
  name: string;
  to?: string;
  /** The move's screen. Empty means it runs bare. */
  fields: FieldMeta[];
}

/** A project the user can see. Only the settings screen asks for these — the
 *  key scopes which statuses the ignore-list picker offers. */
export interface ProjectSummary {
  key: string;
  name: string;
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

/** The outcome of one mentions scan, with the blind spots it knows about:
 *  `truncated` means a candidate search had a page it never fetched, and
 *  `nameSearchSkipped` that the display-name net could not run at all. The
 *  inbox says so rather than presenting a short list as the whole truth. */
export interface MentionScan {
  mentions: Mention[];
  truncated: boolean;
  nameSearchSkipped: boolean;
}

/** A comment in which somebody tagged the current user. */
export interface Mention {
  issueKey: string;
  issueSummary: string;
  /** Jira's comment id — the row links straight to the comment with it. */
  commentId: string;
  /** Display name of whoever wrote the comment. */
  author: string;
  /** The comment text, collapsed to one bounded line. */
  text: string;
  createdAt: string; // RFC3339
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

/**
 * Jira's project and status catalogues, held for the life of the process.
 *
 * Deliberately not `cached`: that map is dropped on every worklog write, which
 * has nothing to do with reference data, and its 60s window would have the
 * settings screen re-ask Jira each time it is opened. A failed call is dropped
 * so one offline moment isn't replayed forever.
 */
const refCache = new Map<string, Promise<unknown>>();

function memo<T>(key: string, call: () => Promise<T>): Promise<T> {
  const hit = refCache.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const promise = call();
  refCache.set(key, promise);
  promise.catch(() => {
    if (refCache.get(key) === promise) refCache.delete(key);
  });
  return promise;
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
  /** Issues waiting on me: escalations I raised, plus everything assigned to
   *  me, minus anything done or in a status I chose to ignore in its project.
   *  Urgent first.
   *
   *  `ignoredStatuses` is part of the query, so it has to be part of the cache
   *  key too. Settings hands over a normalized value (sorted projects, sorted
   *  names), so serializing it is enough to key on the selection rather than
   *  on the order the boxes were ticked in. */
  todoIssues(
    ignoredStatuses: Record<string, string[]>,
  ): Promise<IssueSummary[]> {
    const projects = Object.keys(ignoredStatuses);
    return cached(`todo_issues:${JSON.stringify(ignoredStatuses)}`, () =>
      logged(
        `todo_issues(ignored in ${projects.length} project(s))`,
        () => invoke("todo_issues", { ignoredStatuses }),
        issues,
      ),
    );
  },
  /** Projects I can see — scopes the status picker in settings. */
  jiraProjects(): Promise<ProjectSummary[]> {
    return memo("jira_projects", () =>
      logged(
        "jira_projects",
        () => invoke("jira_projects"),
        (r) => `${r.length} project(s)`,
      ),
    );
  },
  /** Status names one project's workflows use that are not already done. */
  projectStatuses(projectKey: string): Promise<string[]> {
    return memo(`project_statuses:${projectKey}`, () =>
      logged(
        `project_statuses(projectKey=${projectKey})`,
        () => invoke("project_statuses", { projectKey }),
        (r) => `${r.length} status(es)`,
      ),
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
  /** One issue as the issue view shows it. A pure function of the key, so it
   *  is cached like the other reads and dropped on any write. */
  issueDetail(issueKey: string, fieldNames: string[]): Promise<IssueDetail> {
    // The configured names are part of the request, so they have to be part of
    // the cache key too — same reasoning as `todoIssues`.
    return cached(`issue_detail:${issueKey}:${fieldNames.join("|")}`, () =>
      logged(
        `issue_detail(issueKey=${issueKey}, fields=${fieldNames.length})`,
        () => invoke("issue_detail", { issueKey, fieldNames }),
        (d) => `${d.details.length} configured field(s)`,
      ),
    );
  },
  /** That issue's history. Deliberately uncached: it is read straight after
   *  the user comments or logs time, and a stale timeline there would look
   *  like the write was lost. */
  issueActivity(issueKey: string): Promise<IssueActivity> {
    return logged(
      `issue_activity(issueKey=${issueKey})`,
      () => invoke("issue_activity", { issueKey }),
      (a) =>
        `${a.comments.length} comment(s), ${a.statusChanges.length} status change(s), ` +
        `${a.worklogs.length} worklog(s)`,
    );
  },
  /** Post a comment on an issue.
   *
   *  `publicReply` decides who can read it on a service-desk issue and is
   *  ignored by Jira elsewhere — see `commentActions` in ./comments. The text
   *  is not logged: it can carry whatever the customer wrote in.
   *
   *  Drops the read cache like the worklog writes: a comment moves the issue's
   *  `updated` stamp, which is what the todo list and both background scans
   *  read. */
  addComment(
    issueKey: string,
    text: string,
    publicReply: boolean,
    mentions: PickedMention[] = [],
  ): Promise<void> {
    return logged(
      `add_issue_comment(issueKey=${issueKey}, public=${publicReply}, ` +
        `chars=${text.length}, mentions=${mentions.length})`,
      () =>
        invoke("add_issue_comment", {
          issueKey,
          text,
          public: publicReply,
          mentions,
        }),
    ).then(invalidateCachedReads);
  },
  /** People matching `query`, for the comment box's mention picker.
   *
   *  Not cached: it is keystroke-driven and the answers are cheap. An empty
   *  result may mean the account lacks Jira's "Browse users" permission rather
   *  than that nobody matched. */
  searchUsers(query: string): Promise<JiraUser[]> {
    return logged(
      `search_users(query=${JSON.stringify(query)})`,
      () => invoke("search_users", { query }),
      (r) => `${r.length} user(s)`,
    );
  },
  /** The workflow moves available from this issue's current status. Cached
   *  like the detail — a transition, or anything else the app writes, drops
   *  it. */
  issueTransitions(issueKey: string): Promise<Transition[]> {
    return cached(`issue_transitions:${issueKey}`, () =>
      logged(
        `issue_transitions(issueKey=${issueKey})`,
        () => invoke("issue_transitions", { issueKey }),
        (t) => `${t.length} transition(s)`,
      ),
    );
  },
  /** Run one of them, with the transition screen's answers when it has one
   *  (already in Jira's shape — see `toJiraFields`). The issue's status is what
   *  the todo list filters on, so this drops the read cache like every other
   *  write. */
  transitionIssue(
    issueKey: string,
    transitionId: string,
    fields?: Record<string, unknown>,
  ): Promise<void> {
    return logged(
      `transition_issue(issueKey=${issueKey}, transitionId=${transitionId}, ` +
        `fields=${fields ? Object.keys(fields).length : 0})`,
      () => invoke("transition_issue", { issueKey, transitionId, fields }),
    ).then(invalidateCachedReads);
  },
  /** Every field name this site defines — the settings screen picks from
   *  these rather than having names typed. Reference data, so it is held for
   *  the life of the process like the project list. */
  jiraFieldNames(): Promise<string[]> {
    return memo("jira_field_names", () =>
      logged(
        "jira_field_names",
        () => invoke("jira_field_names"),
        (r) => `${r.length} field(s)`,
      ),
    );
  },
  /** The fields this issue's edit form offers, in the same shape a transition
   *  screen uses. */
  issueEditFields(issueKey: string): Promise<FieldMeta[]> {
    return cached(`issue_edit_fields:${issueKey}`, () =>
      logged(
        `issue_edit_fields(issueKey=${issueKey})`,
        () => invoke("issue_edit_fields", { issueKey }),
        (f) => `${f.length} editable field(s)`,
      ),
    );
  },
  /** Write field values back to the issue (shaped by `toJiraFields`). */
  updateIssueFields(
    issueKey: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    return logged(
      `update_issue_fields(issueKey=${issueKey}, fields=${Object.keys(fields).length})`,
      () => invoke("update_issue_fields", { issueKey, fields }),
    ).then(invalidateCachedReads);
  },
  /** Download an attachment and hand it to whatever the OS opens it with. */
  openAttachment(attachmentId: string, filename: string): Promise<void> {
    return logged(
      `open_attachment(attachmentId=${attachmentId}, filename=${filename})`,
      () => invoke("open_attachment", { attachmentId, filename }),
    );
  },
  /** Remove an attachment from its issue. Irreversible in Jira and visible to
   *  everyone on the issue, so the view asks before calling this. */
  deleteAttachment(attachmentId: string): Promise<void> {
    return logged(`delete_attachment(attachmentId=${attachmentId})`, () =>
      invoke("delete_attachment", { attachmentId }),
    ).then(invalidateCachedReads);
  },
  /** Reveal the folder downloads land in. */
  openAttachmentFolder(): Promise<void> {
    return invoke("open_attachment_folder");
  },
  /** Attach files to an issue. Adds to the issue, so the read cache goes. */
  attachFiles(issueKey: string, paths: string[]): Promise<void> {
    return logged(
      `attach_files(issueKey=${issueKey}, files=${paths.length})`,
      () => invoke("attach_files", { issueKey, paths }),
    ).then(invalidateCachedReads);
  },
  missingWorklogs(): Promise<MissingWorklog[]> {
    return logged(
      "missing_worklogs",
      () => invoke("missing_worklogs"),
      (r) => `${r.length} item(s)`,
    );
  },
  mentions(): Promise<MentionScan> {
    return logged(
      "mentions",
      () => invoke("mentions"),
      (r) =>
        `${r.mentions.length} mention(s)${r.truncated ? ", search truncated" : ""}` +
        `${r.nameSearchSkipped ? ", name search skipped" : ""}`,
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
