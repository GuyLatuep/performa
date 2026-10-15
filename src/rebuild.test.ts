import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", async () => {
  const { apiModule } = await import("./test-support/api");
  return apiModule();
});

import type { DayEvidence } from "./api";
import { apiMock, resetApiMock, worklogEntry } from "./test-support/api";
import {
  canRebuild,
  dayTimeline,
  forgetDayActivity,
  loadDayActivity,
} from "./rebuild";

const DAY = "2026-03-10";

/** What Jira answers for a day: the evidence, all of it unless said. */
const day = (evidence: DayEvidence[], complete = true) => ({
  evidence,
  complete,
});

const evidence = (o: Partial<DayEvidence> = {}): DayEvidence => ({
  kind: "comment",
  issueKey: "ABC-1",
  issueSummary: "Replace the pump",
  at: new Date(2026, 2, 10, 14, 0).toISOString(),
  detail: "swapped the seal",
  ...o,
});

beforeEach(() => {
  resetApiMock();
  forgetDayActivity();
});

describe("canRebuild", () => {
  it("reaches back to the first of the previous month", () => {
    expect(canRebuild("2026-03-01", "2026-04-15")).toBe(true);
    expect(canRebuild("2026-02-28", "2026-04-15")).toBe(false);
  });

  it("crosses a year boundary", () => {
    expect(canRebuild("2025-12-01", "2026-01-05")).toBe(true);
    expect(canRebuild("2025-11-30", "2026-01-05")).toBe(false);
  });

  it("refuses a day that has not happened", () => {
    expect(canRebuild("2026-04-16", "2026-04-15")).toBe(false);
    expect(canRebuild("2026-04-15", "2026-04-15")).toBe(true);
  });
});

describe("dayTimeline", () => {
  it("puts everything in time order", () => {
    const items = dayTimeline(DAY, {
      evidence: [evidence()],
      worklogs: [worklogEntry({ date: DAY, time: "09:00", issueKey: "XYZ-9" })],
      timer: null,
      drafts: [],
    });

    expect(items.map((i) => [i.kind, i.at])).toEqual([
      ["worklog", "09:00"],
      ["evidence", "14:00"],
    ]);
  });

  it("calls evidence logged when the issue has time that day", () => {
    const items = dayTimeline(DAY, {
      evidence: [evidence(), evidence({ issueKey: "XYZ-9" })],
      worklogs: [worklogEntry({ date: DAY, issueKey: "ABC-1" })],
      timer: null,
      drafts: [],
    });

    const logged = items
      .filter((i) => i.kind === "evidence")
      .map((i) => i.kind === "evidence" && [i.evidence.issueKey, i.logged]);
    expect(logged).toEqual([
      ["ABC-1", true],
      ["XYZ-9", false],
    ]);
  });

  it("ignores another day's worklogs", () => {
    const items = dayTimeline(DAY, {
      evidence: [evidence()],
      worklogs: [worklogEntry({ date: "2026-03-11", issueKey: "ABC-1" })],
      timer: null,
      drafts: [],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "evidence", logged: false });
  });

  it("shows the running timer's stretches and the day's drafts", () => {
    const nine = new Date(2026, 2, 10, 9, 0).getTime();
    const items = dayTimeline(DAY, {
      evidence: [],
      worklogs: [],
      timer: {
        issueKey: null,
        issueSummary: "Walk-in",
        segments: [{ from: nine, to: null }],
      },
      drafts: [
        {
          id: "d",
          seconds: 1800,
          date: DAY,
          time: "11:00",
          note: "printer",
          issueKey: null,
          issueSummary: "",
          billable: true,
        },
      ],
      now: nine + 3600_000,
    });

    expect(items).toEqual([
      expect.objectContaining({ kind: "timer", at: "09:00", seconds: 3600 }),
      expect.objectContaining({ kind: "draft", at: "11:00" }),
    ]);
  });
});

describe("loadDayActivity", () => {
  it("asks Jira once per day for the session", async () => {
    apiMock.dayActivity.mockResolvedValue(day([evidence()]));

    await loadDayActivity(DAY);
    await loadDayActivity(DAY);

    expect(apiMock.dayActivity).toHaveBeenCalledTimes(1);
    expect(apiMock.dayActivity).toHaveBeenCalledWith(DAY);
  });

  it("tries again after a failure", async () => {
    apiMock.dayActivity.mockRejectedValueOnce(new Error("Jira returned 503"));
    await expect(loadDayActivity(DAY)).rejects.toThrow(/503/);

    apiMock.dayActivity.mockResolvedValue(day([]));
    await expect(loadDayActivity(DAY)).resolves.toEqual(day([]));
    expect(apiMock.dayActivity).toHaveBeenCalledTimes(2);
  });
});
