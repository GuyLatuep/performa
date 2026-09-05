import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, invalidateCachedReads, WorklogEntry } from "./api";

// The read cache in api.ts: `listWorklogs` and `dueIssues` are asked for the
// same arguments from several places (the start and timesheet tabs both want
// the current week) and every tab switch remounts the asking component, so the
// point is that those repeats collapse into one backend call.

const mockInvoke = vi.mocked(invoke);

/** Calls to one Tauri command, ignoring the `frontend_log` chatter that every
 *  logged() call emits over the same bridge. */
function callsTo(command: string): unknown[][] {
  return mockInvoke.mock.calls.filter(([name]) => name === command);
}

const entry = (id: string): WorklogEntry => ({
  id,
  issueKey: "ABC-1",
  issueSummary: "An issue",
  timeSpentSeconds: 3600,
  date: "2026-08-03",
  time: "09:00",
  comment: "",
  billable: true,
});

beforeEach(() => {
  mockInvoke.mockClear();
  mockInvoke.mockResolvedValue([]);
  invalidateCachedReads();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reference data", () => {
  // Projects and statuses are asked for by the settings screen only, and never
  // change as a result of anything this app does — so unlike the read cache,
  // theirs must not be dropped when a worklog is written.
  it("asks for the project list once per process", async () => {
    await api.jiraProjects();
    await api.jiraProjects();
    invalidateCachedReads();
    await api.jiraProjects();

    expect(callsTo("jira_projects")).toHaveLength(1);
  });

  it("keeps each project's statuses apart", async () => {
    await api.projectStatuses("DEV");
    await api.projectStatuses("DEV");
    await api.projectStatuses("OPS");

    expect(callsTo("project_statuses")).toHaveLength(2);
  });
});

describe("cached reads", () => {
  it("keys the todo query on the ignored statuses", async () => {
    await api.todoIssues({ DEV: ["Backlog", "Review"] });
    await api.todoIssues({ DEV: ["Backlog", "Review"] });
    expect(callsTo("todo_issues")).toHaveLength(1);

    // A different selection is a different query, and must not be served the
    // previous answer out of the cache — including when only another project's
    // list changed.
    await api.todoIssues({ DEV: ["Backlog", "Review"], OPS: ["Backlog"] });
    expect(callsTo("todo_issues")).toHaveLength(2);
  });

  it("collapses repeat calls with the same arguments into one", async () => {
    await api.listWorklogs("2026-08-03", "2026-08-09");
    await api.listWorklogs("2026-08-03", "2026-08-09");

    expect(callsTo("list_worklogs")).toHaveLength(1);
  });

  it("shares one in-flight call between concurrent callers", async () => {
    // Both callers arrive before the first call settles — the case a
    // settle-time-only cache would miss, letting each start its own request.
    const [a, b] = await Promise.all([
      api.listWorklogs("2026-08-03", "2026-08-09"),
      api.listWorklogs("2026-08-03", "2026-08-09"),
    ]);

    expect(callsTo("list_worklogs")).toHaveLength(1);
    expect(a).toBe(b);
  });

  it("keeps different arguments apart", async () => {
    await api.listWorklogs("2026-08-03", "2026-08-09");
    await api.listWorklogs("2026-07-27", "2026-08-02");

    expect(callsTo("list_worklogs")).toHaveLength(2);
  });

  it("caches dueIssues too", async () => {
    await api.dueIssues();
    await api.dueIssues();

    expect(callsTo("due_issues")).toHaveLength(1);
  });

  it("refetches once the entry is older than the TTL", async () => {
    vi.useFakeTimers();
    await api.listWorklogs("2026-08-03", "2026-08-09");
    await vi.advanceTimersByTimeAsync(61_000);
    await api.listWorklogs("2026-08-03", "2026-08-09");

    expect(callsTo("list_worklogs")).toHaveLength(2);
  });

  it("does not cache a failure", async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === "list_worklogs") throw new Error("Jira returned 503");
      return undefined;
    });

    await expect(api.listWorklogs("2026-08-03", "2026-08-09")).rejects.toThrow(
      "Jira returned 503",
    );
    await expect(api.listWorklogs("2026-08-03", "2026-08-09")).rejects.toThrow(
      "Jira returned 503",
    );

    // A replayed rejection would leave this at 1 — the retry has to be real.
    expect(callsTo("list_worklogs")).toHaveLength(2);
  });
});

describe("write-through invalidation", () => {
  const worklog = {
    timeSpentSeconds: 900,
    date: "2026-08-03",
    time: "09:00",
    comment: "",
    billable: true,
  };

  it.each([
    ["logWork", () => api.logWork("ABC-1", worklog)],
    ["updateWorklog", () => api.updateWorklog("ABC-1", "42", worklog)],
    ["deleteWorklog", () => api.deleteWorklog("ABC-1", "42")],
  ])("%s makes the next read go to the backend", async (_name, write) => {
    await api.listWorklogs("2026-08-03", "2026-08-09");
    await write();
    await api.listWorklogs("2026-08-03", "2026-08-09");

    expect(callsTo("list_worklogs")).toHaveLength(2);
  });

  it("shows the freshly written worklog rather than the stale week", async () => {
    mockInvoke.mockResolvedValue([]);
    expect(await api.listWorklogs("2026-08-03", "2026-08-09")).toEqual([]);

    await api.logWork("ABC-1", worklog);
    mockInvoke.mockResolvedValue([entry("42")]);

    expect(await api.listWorklogs("2026-08-03", "2026-08-09")).toEqual([
      entry("42"),
    ]);
  });

  it("leaves the cache intact when the write fails", async () => {
    await api.listWorklogs("2026-08-03", "2026-08-09");
    mockInvoke.mockImplementation(async (command) => {
      if (command === "log_work") throw new Error("Jira returned 400");
      return [];
    });

    await expect(api.logWork("ABC-1", worklog)).rejects.toThrow();
    await api.listWorklogs("2026-08-03", "2026-08-09");

    // Nothing changed on the Jira side, so the cached week is still valid.
    expect(callsTo("list_worklogs")).toHaveLength(1);
  });
});

describe("cache keys that carry more than an id", () => {
  // Two reads take a *selection* alongside their arguments. If the selection
  // isn't in the key, changing it in settings serves the previous answer.

  it("keys todoIssues on the ignored statuses, not just the command", async () => {
    await api.todoIssues({ DEV: ["In Progress"] });
    await api.todoIssues({ DEV: ["In Progress"] });
    expect(callsTo("todo_issues")).toHaveLength(1);

    await api.todoIssues({ DEV: ["Escalated"] });

    expect(callsTo("todo_issues")).toHaveLength(2);
  });

  it("keys issueDetail on the configured field names as well as the key", async () => {
    mockInvoke.mockResolvedValue({ details: [] });

    await api.issueDetail("ABC-1", ["Due"]);
    await api.issueDetail("ABC-1", ["Due"]);
    expect(callsTo("issue_detail")).toHaveLength(1);

    // Same issue, a field added in settings — the cached answer is missing it.
    await api.issueDetail("ABC-1", ["Due", "Plant"]);

    expect(callsTo("issue_detail")).toHaveLength(2);
  });

  it("passes the field names through to the backend unchanged", async () => {
    mockInvoke.mockResolvedValue({ details: [] });

    await api.issueDetail("ABC-1", ["Due", "Plant"]);

    expect(callsTo("issue_detail")[0][1]).toEqual({
      issueKey: "ABC-1",
      fieldNames: ["Due", "Plant"],
    });
  });
});

describe("writes that invalidate the read cache", () => {
  it("drops cached reads after a comment, a transition and a link", async () => {
    // Each of these changes what a later read would return, so the cache has
    // to go — the issue view reloads straight after every one of them.
    for (const write of [
      () => api.addComment("ABC-1", "hello", false),
      () => api.transitionIssue("ABC-1", "31", {}),
      () => api.linkIssues("ABC-1", "ABC-2", "blocks", "outward"),
    ]) {
      mockInvoke.mockResolvedValue([]);
      invalidateCachedReads();
      mockInvoke.mockClear();

      await api.listWorklogs("2026-08-03", "2026-08-09");
      await write();
      await api.listWorklogs("2026-08-03", "2026-08-09");

      expect(callsTo("list_worklogs")).toHaveLength(2);
    }
  });
});

describe("the call log", () => {
  it("reports a failure and lets the error through", async () => {
    // `logged` wraps every backend call; its failure arm must re-throw rather
    // than resolve, or a failed write would look like a successful one.
    mockInvoke.mockImplementation(async (command) => {
      if (command === "todo_issues") throw new Error("Jira returned 500");
      return [];
    });

    await expect(api.todoIssues({})).rejects.toThrow("Jira returned 500");

    const logged = callsTo("frontend_log").map(([, args]) =>
      JSON.stringify(args),
    );
    expect(logged.some((line) => line.includes("todo_issues"))).toBe(true);
  });
});
