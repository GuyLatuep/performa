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

describe("cached reads", () => {
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
