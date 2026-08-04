import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MissingWorklog } from "./api";
import { getMissing, refreshMissing } from "./missing";

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
