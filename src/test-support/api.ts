import { vi } from "vitest";
import type {
  Attachment,
  FieldMeta,
  IssueActivity,
  IssueDetail,
  IssueSummary,
  JiraUser,
  LinkedItem,
  LinkRelation,
  MentionScan,
  MissingWorklog,
  ProjectSummary,
  Transition,
  WorklogEntry,
} from "../api";

// Shared scaffolding for the component tests that talk to the backend.
//
// Every one of them mocks `../api` rather than driving the `invoke` stub from
// `setup.ts`. That is not a style preference: `api.ts` holds two module-level
// caches, and while `invalidateCachedReads` clears the read cache, the
// reference cache behind `memo` (jiraProjects, projectStatuses, jiraFieldNames,
// linkRelations, issueTypeIcon) has no reset at all. Driving the real module
// would mean the second test in a file could not change what those return.

// ----- Data builders -----
// One complete, valid default each, so a test only states the field it is
// about. Typed against the real interfaces, so a shape that drifts fails the
// typecheck rather than the assertion.

export const issueSummary = (o: Partial<IssueSummary> = {}): IssueSummary => ({
  key: "ABC-1",
  summary: "Replace the pump",
  ...o,
});

export const worklogEntry = (o: Partial<WorklogEntry> = {}): WorklogEntry => ({
  id: "w1",
  issueKey: "ABC-1",
  issueSummary: "Replace the pump",
  timeSpentSeconds: 3600,
  date: "2026-03-16",
  time: "09:00",
  comment: "",
  billable: true,
  ...o,
});

export const attachment = (o: Partial<Attachment> = {}): Attachment => ({
  id: "a1",
  filename: "plan.pdf",
  size: 2048,
  author: "Anna Leeson",
  createdAt: "2026-03-15T09:00:00.000+01:00",
  ...o,
});

export const linkedItem = (o: Partial<LinkedItem> = {}): LinkedItem => ({
  id: "l1",
  relation: "blocks",
  key: "ABC-2",
  summary: "Order the seal",
  ...o,
});

export const linkRelation = (o: Partial<LinkRelation> = {}): LinkRelation => ({
  typeName: "Blocks",
  direction: "outward",
  label: "blocks",
  ...o,
});

export const issueDetail = (o: Partial<IssueDetail> = {}): IssueDetail => ({
  key: "ABC-1",
  summary: "Replace the pump",
  createdAt: "2026-03-01T08:00:00.000+01:00",
  updatedAt: "2026-03-15T08:00:00.000+01:00",
  description: "",
  details: [],
  serviceDesk: false,
  attachments: [],
  links: [],
  ...o,
});

export const issueActivity = (
  o: Partial<IssueActivity> = {},
): IssueActivity => ({
  comments: [],
  commentsTruncated: false,
  statusChanges: [],
  worklogs: [],
  ...o,
});

export const fieldMeta = (o: Partial<FieldMeta> = {}): FieldMeta => ({
  id: "customfield_1",
  name: "A field",
  required: false,
  schemaType: "string",
  // Always an array by the time it reaches the webview — the Rust client
  // defaults it, so a field Jira described without one arrives as [].
  operations: ["set"],
  allowedValues: [],
  ...o,
});

export const transition = (o: Partial<Transition> = {}): Transition => ({
  id: "31",
  name: "Start work",
  to: "In Progress",
  fields: [],
  ...o,
});

export const jiraUser = (o: Partial<JiraUser> = {}): JiraUser => ({
  accountId: "acc-1",
  displayName: "Anna Leeson",
  ...o,
});

export const projectSummary = (
  o: Partial<ProjectSummary> = {},
): ProjectSummary => ({
  key: "ABC",
  name: "Pumps",
  ...o,
});

export const missingWorklog = (
  o: Partial<MissingWorklog> = {},
): MissingWorklog => ({
  issueKey: "ABC-1",
  issueSummary: "Replace the pump",
  kind: "comment",
  detail: "Pump stalled again",
  activityAt: "2026-03-16T09:00:00.000+01:00",
  logKey: "ABC-1",
  logSummary: "Replace the pump",
  ...o,
});

export const mentionScan = (o: Partial<MentionScan> = {}): MentionScan => ({
  mentions: [],
  truncated: false,
  nameSearchSkipped: false,
  ...o,
});

// ----- The mock -----

/** Every method on `api`. Listed rather than derived from the real module:
 *  importing it to read its keys would load the thing being replaced. Keep in
 *  step with the object at the bottom of `api.ts`. */
const METHOD_NAMES = [
  "saveCredentials",
  "credentialsStatus",
  "clearCredentials",
  "currentUser",
  "searchIssues",
  "dueIssues",
  "todoIssues",
  "jiraProjects",
  "projectStatuses",
  "startIssueWork",
  "logWork",
  "updateWorklog",
  "deleteWorklog",
  "listWorklogs",
  "issueWorklogs",
  "issueDetail",
  "issueActivity",
  "addComment",
  "searchUsers",
  "issueTransitions",
  "transitionIssue",
  "jiraFieldNames",
  "issueEditFields",
  "updateIssueFields",
  "openAttachment",
  "deleteAttachment",
  "openAttachmentFolder",
  "attachFiles",
  "issueTypeIcon",
  "linkRelations",
  "linkIssues",
  "deleteIssueLink",
  "missingWorklogs",
  "mentions",
  "setLogLevel",
  "openLogFolder",
] as const;

type MethodName = (typeof METHOD_NAMES)[number];

export type ApiMock = Record<
  MethodName | "invalidateCachedReads",
  ReturnType<typeof vi.fn>
>;

/** What each method answers unless a test says otherwise: valid, and empty.
 *  A component must not blow up on a call the test does not care about — a
 *  view that fetches four things to render one of them is the normal case
 *  here, not the exception. */
function defaultAnswers(): Partial<Record<MethodName, unknown>> {
  return {
    searchIssues: [],
    dueIssues: [],
    todoIssues: [],
    listWorklogs: [],
    issueWorklogs: [],
    searchUsers: [],
    issueTransitions: [],
    issueEditFields: [],
    jiraProjects: [],
    projectStatuses: [],
    jiraFieldNames: [],
    linkRelations: [],
    missingWorklogs: [],
    mentions: mentionScan(),
    issueDetail: issueDetail(),
    issueActivity: issueActivity(),
    credentialsStatus: null,
    issueTypeIcon: "data:image/png;base64,",
  };
}

/** The singleton the tests steer. Vitest gives every test file its own module
 *  registry, so one file's overrides cannot reach another's.
 *
 *  Armed with its defaults here rather than only in `resetApiMock`: the store
 *  modules call the backend *at import time* — `settings.ts` mirrors the log
 *  level over on its first line — which happens before any `beforeEach` has
 *  run. A bare `vi.fn()` returns `undefined` there, and the `.catch()` on it
 *  takes the whole file down before a single test starts.
 */
export const apiMock = Object.fromEntries(
  [...METHOD_NAMES, "invalidateCachedReads"].map((name) => [name, vi.fn()]),
) as ApiMock;
armDefaults();

/** Put every method back to its default answer.
 *
 *  Call from `beforeEach`. `vi.clearAllMocks()` is not enough on its own: it
 *  forgets the calls but keeps any `mockResolvedValueOnce` a previous test
 *  queued, which then fires in the middle of the next one.
 */
export function resetApiMock(): void {
  for (const name of [...METHOD_NAMES, "invalidateCachedReads"] as const) {
    apiMock[name].mockReset();
  }
  armDefaults();
}

/** Give every method its default answer. */
function armDefaults(): void {
  const answers = defaultAnswers();
  for (const name of [...METHOD_NAMES, "invalidateCachedReads"] as const) {
    const fn = apiMock[name];
    if (name === "invalidateCachedReads") {
      fn.mockImplementation(() => undefined);
    } else {
      const answer = answers[name as MethodName];
      fn.mockImplementation(async () => answer);
    }
  }
}

/** What a test file's `vi.mock("../api", …)` factory should return.
 *
 *  The factory is hoisted above the imports and may not close over module
 *  scope, so it cannot name `apiMock` directly — but a dynamic import inside
 *  it resolves to this same module instance:
 *
 *  ```ts
 *  vi.mock("../api", async () => {
 *    const { apiModule } = await import("../test-support/api");
 *    return apiModule();
 *  });
 *  ```
 *
 *  Every other export of `api.ts` is a type, and types are erased.
 */
export function apiModule() {
  return { api: apiMock, invalidateCachedReads: apiMock.invalidateCachedReads };
}
