import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissingWorklog } from "./api";
import {
  getMissing,
  refreshMissing,
  startMissingPolling,
  stopMissingPolling,
} from "./missing";

// Desktop notifications reach for a Tauri plugin that does not exist under
// vitest; `notifyNew` runs on every refresh, so it has to be stubbed out.
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => false,
  requestPermission: async () => "denied",
  sendNotification: () => {},
}));

const mockInvoke = vi.mocked(invoke);

const finding = (issueKey: string, activityAt: string): MissingWorklog => ({
  issueKey,
  issueSummary: "An issue",
  kind: "comment",
  detail: "said something",
  activityAt,
  logKey: issueKey,
  logSummary: "An issue",
});

/** What the backend answers the next time the scan runs. */
function backendReturns(items: MissingWorklog[]) {
  mockInvoke.mockImplementation(async (command) =>
    command === "missing_worklogs" ? items : undefined,
  );
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("refreshMissing", () => {
  it("keeps the previous array when the findings are unchanged", async () => {
    // The scan builds a fresh array every time it runs. Handing that new array
    // to the store would re-render every component watching the findings, on
    // every check, forever — even though nothing was found that wasn't there
    // before.
    backendReturns([finding("ABC-1", "2026-08-03T09:00:00+02:00")]);
    await refreshMissing();
    const first = getMissing();

    backendReturns([finding("ABC-1", "2026-08-03T09:00:00+02:00")]);
    await refreshMissing();

    expect(getMissing()).toBe(first);
  });

  it("takes the new array once a finding actually differs", async () => {
    backendReturns([finding("ABC-1", "2026-08-03T09:00:00+02:00")]);
    await refreshMissing();
    const first = getMissing();

    backendReturns([
      finding("ABC-1", "2026-08-03T09:00:00+02:00"),
      finding("ABC-2", "2026-08-03T11:00:00+02:00"),
    ]);
    await refreshMissing();

    expect(getMissing()).not.toBe(first);
    expect(getMissing()).toHaveLength(2);
  });

  it("notices a repeat activity on the same issue", async () => {
    // Same issue key, later timestamp — the signature covers both, so this
    // must not be mistaken for the finding already on screen.
    backendReturns([finding("ABC-1", "2026-08-03T09:00:00+02:00")]);
    await refreshMissing();
    const first = getMissing();

    backendReturns([finding("ABC-1", "2026-08-03T14:30:00+02:00")]);
    await refreshMissing();

    expect(getMissing()).not.toBe(first);
  });

  it("holds on to the findings when the check fails", async () => {
    backendReturns([finding("ABC-1", "2026-08-03T09:00:00+02:00")]);
    await refreshMissing();
    const first = getMissing();

    mockInvoke.mockImplementation(async (command) => {
      if (command === "missing_worklogs") throw new Error("Jira returned 503");
      return undefined;
    });
    await refreshMissing();

    expect(getMissing()).toBe(first);
  });
});

describe("opening scan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopMissingPolling();
    vi.useRealTimers();
  });

  /** Which backend commands the scan has asked for so far. Debug logging goes
   *  over the same bridge, so the command name is what to look at. */
  const scansRun = () =>
    mockInvoke.mock.calls.filter((call) => call[0] === "missing_worklogs");

  it("lets the mentions scan go first", async () => {
    // Both watchers start at sign-in with a cold cache. This one holds back so
    // the app's heaviest burst is not also its first.
    backendReturns([]);
    startMissingPolling();

    expect(scansRun()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(20 * 1000);

    expect(scansRun()).toHaveLength(1);
  });

  it("does not scan after a sign-out during the delay", async () => {
    backendReturns([]);
    startMissingPolling();
    stopMissingPolling();

    await vi.advanceTimersByTimeAsync(20 * 1000);

    expect(scansRun()).toHaveLength(0);
  });
});

describe("overlapping scans", () => {
  it("does not start a second scan while one is running", async () => {
    // Logging work and closing the app both ask for a check of their own, so
    // an overlap does not need the interval to be near the scan duration.
    backendReturns([]);

    await Promise.all([refreshMissing("manual"), refreshMissing("post-log")]);

    const scans = mockInvoke.mock.calls.filter(
      (call) => call[0] === "missing_worklogs",
    );
    expect(scans).toHaveLength(1);
  });
});

describe("ignored findings", () => {
  // The findings store and the ignore map are both seeded at import, so these
  // cases re-import the pair over a storage they control — the same idiom the
  // other persisted-state tests use.
  async function freshMissing() {
    localStorage.clear();
    vi.resetModules();
    return import("./missing");
  }

  const HOUR = 60 * 60 * 1000;
  /** Relative to the real clock: an ignore is stamped with `Date.now()`, and
   *  freezing that around a dynamic import is more trouble than it is worth. */
  const at = (offsetMs: number) =>
    new Date(Date.now() + offsetMs).toISOString();

  it("hides the ignored issue and counts it as hidden", async () => {
    // The case this whole feature is for: an automation dragged the epic along
    // with the issue the developer actually worked on.
    const missing = await freshMissing();
    const epic = finding("DEV-9", at(-2 * HOUR));
    backendReturns([finding("DEV-1", at(-HOUR)), epic]);
    await missing.refreshMissing();

    missing.ignoreMissing(epic);

    expect(missing.getMissing().map((i) => i.issueKey)).toEqual(["DEV-1"]);
    expect(missing.getMissingHiddenCount()).toBe(1);
  });

  it("keeps it hidden across the next check", async () => {
    const missing = await freshMissing();
    const epic = finding("DEV-9", at(-2 * HOUR));
    backendReturns([epic]);
    await missing.refreshMissing();
    missing.ignoreMissing(epic);

    backendReturns([epic]);
    await missing.refreshMissing("manual");

    expect(missing.getMissing()).toHaveLength(0);
    expect(missing.getMissingHiddenCount()).toBe(1);
  });

  it("does not announce what the user has ignored", async () => {
    // `notifyNew` prunes its set to the findings it was handed, so that set is
    // also the record of which ones it considered worth announcing.
    const missing = await freshMissing();
    const epic = finding("DEV-9", at(-2 * HOUR));
    const mine = finding("DEV-1", at(-HOUR));
    backendReturns([epic]);
    await missing.refreshMissing();
    missing.ignoreMissing(epic);

    backendReturns([epic, mine]);
    await missing.refreshMissing("manual");

    expect(
      JSON.parse(localStorage.getItem("performa-missing-notified") ?? "[]"),
    ).toEqual([`DEV-1@${mine.activityAt}`]);
  });

  it("brings it back once the issue sees newer activity", async () => {
    const missing = await freshMissing();
    const epic = finding("DEV-9", at(-2 * HOUR));
    backendReturns([epic]);
    await missing.refreshMissing();
    missing.ignoreMissing(epic);

    // Real work on the epic this time, after the ignore.
    backendReturns([finding("DEV-9", at(HOUR))]);
    await missing.refreshMissing("manual");

    expect(missing.getMissing()).toHaveLength(1);
    expect(missing.getMissingHiddenCount()).toBe(0);
  });

  it("restores every ignore without asking Jira again", async () => {
    const missing = await freshMissing();
    const epic = finding("DEV-9", at(-2 * HOUR));
    backendReturns([epic]);
    await missing.refreshMissing();
    missing.ignoreMissing(epic);
    const scansBefore = mockInvoke.mock.calls.filter(
      (call) => call[0] === "missing_worklogs",
    ).length;

    missing.restoreIgnoredMissing();

    expect(missing.getMissing()).toHaveLength(1);
    expect(missing.getMissingHiddenCount()).toBe(0);
    expect(
      mockInvoke.mock.calls.filter((call) => call[0] === "missing_worklogs"),
    ).toHaveLength(scansBefore);
  });
});
