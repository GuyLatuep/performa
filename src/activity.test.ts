import { describe, expect, it } from "vitest";
import { statusChangeLabel, timeline } from "./activity";
import {
  ActivityWorklog,
  IssueActivity,
  IssueComment,
  StatusChange,
} from "./api";

function comment(ts: number, over: Partial<IssueComment> = {}): IssueComment {
  return {
    id: `comment-${ts}`,
    author: "Malte Polzin",
    createdAt: new Date(ts * 1000).toISOString(),
    createdTs: ts,
    text: "",
    internal: false,
    ...over,
  };
}

function status(ts: number, over: Partial<StatusChange> = {}): StatusChange {
  return {
    id: `status-${ts}`,
    author: "Malte Polzin",
    createdAt: new Date(ts * 1000).toISOString(),
    createdTs: ts,
    from: "Backlog",
    to: "In Arbeit",
    ...over,
  };
}

function worklog(
  ts: number,
  over: Partial<ActivityWorklog> = {},
): ActivityWorklog {
  return {
    id: `worklog-${ts}`,
    author: "Malte Polzin",
    createdAt: new Date(ts * 1000).toISOString(),
    createdTs: ts,
    timeSpentSeconds: 900,
    comment: "",
    ...over,
  };
}

function activity(over: Partial<IssueActivity> = {}): IssueActivity {
  return {
    comments: [],
    statusChanges: [],
    worklogs: [],
    commentsTruncated: false,
    ...over,
  };
}

describe("timeline", () => {
  it("interleaves the three lists newest first", () => {
    const merged = timeline(
      activity({
        comments: [comment(300)],
        statusChanges: [status(100)],
        worklogs: [worklog(200)],
      }),
    );
    expect(merged.map((e) => [e.kind, e.createdTs])).toEqual([
      ["comment", 300],
      ["worklog", 200],
      ["status", 100],
    ]);
  });

  it("tags each entry with its kind without losing its own fields", () => {
    const [entry] = timeline(
      activity({ comments: [comment(1, { text: "Pump stalled" })] }),
    );
    expect(entry).toMatchObject({
      kind: "comment",
      text: "Pump stalled",
      internal: false,
    });
  });

  it("orders a transition and its comment deterministically", () => {
    // Commenting while transitioning stamps both at the same second; without a
    // tie-break the two swap places between renders.
    const merged = timeline(
      activity({ comments: [comment(500)], statusChanges: [status(500)] }),
    );
    expect(merged.map((e) => e.kind)).toEqual(["comment", "status"]);
    // Stable whichever way the input happened to be ordered.
    const again = timeline(
      activity({ statusChanges: [status(500)], comments: [comment(500)] }),
    );
    expect(again.map((e) => e.kind)).toEqual(["comment", "status"]);
  });

  it("sinks an unparseable timestamp instead of floating it to the top", () => {
    const merged = timeline(
      activity({
        comments: [comment(0), comment(50)],
        worklogs: [worklog(10)],
      }),
    );
    expect(merged.map((e) => e.createdTs)).toEqual([50, 10, 0]);
  });

  it("sorts on the epoch seconds, not the formatted stamp", () => {
    // Same instant, written in two timezones: as strings "2024-03-01T09:00"
    // sorts after "2024-03-01T08:00" even though it is the older event.
    const older = comment(1000, { createdAt: "2024-03-01T09:00:00+02:00" });
    const newer = comment(2000, { createdAt: "2024-03-01T08:00:00+00:00" });
    expect(timeline(activity({ comments: [older, newer] }))).toEqual([
      { kind: "comment", ...newer },
      { kind: "comment", ...older },
    ]);
  });

  it("is empty for an issue nobody has touched", () => {
    expect(timeline(activity())).toEqual([]);
  });
});

describe("statusChangeLabel", () => {
  it("renders both ends", () => {
    expect(statusChangeLabel(status(1))).toBe("Backlog → In Arbeit");
  });

  it("stands in for an end Jira did not report", () => {
    expect(statusChangeLabel(status(1, { from: undefined }))).toBe(
      "— → In Arbeit",
    );
    expect(statusChangeLabel(status(1, { to: undefined }))).toBe("Backlog → —");
  });
});
