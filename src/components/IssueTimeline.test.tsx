/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../test-support/dom";
import { IssueActivity } from "../api";
import IssueTimeline, { timelineCount } from "./IssueTimeline";

/** Newest first is the timeline's own order, so fixtures carry real stamps. */
const AT = (iso: string) => ({ createdAt: iso, createdTs: Date.parse(iso) });

function activity(overrides: Partial<IssueActivity> = {}): IssueActivity {
  return {
    comments: [],
    commentsTruncated: false,
    statusChanges: [],
    worklogs: [],
    ...overrides,
  };
}

const COMMENT = {
  id: "c1",
  author: "Anna Leeson",
  text: "Pump stalled again",
  internal: false,
  ...AT("2026-03-15T09:00:00.000Z"),
};

const STATUS = {
  id: "s1",
  author: "Malte",
  from: "Open",
  to: "In Progress",
  ...AT("2026-03-15T10:00:00.000Z"),
};

const WORKLOG = {
  id: "w1",
  author: "Malte",
  timeSpentSeconds: 5400,
  comment: "swapped the seal",
  ...AT("2026-03-15T11:00:00.000Z"),
};

describe("an empty issue", () => {
  it("says nothing has happened rather than showing an empty list", () => {
    const { container } = render(<IssueTimeline activity={activity()} />);

    expect(
      screen.getByText("Nothing has happened on this issue."),
    ).toBeDefined();
    expect(container.querySelector(".issue-timeline")).toBeNull();
  });
});

describe("the three kinds", () => {
  it("renders a comment as what the person said", () => {
    render(<IssueTimeline activity={activity({ comments: [COMMENT] })} />);

    expect(screen.getByText("Pump stalled again")).toBeDefined();
    expect(screen.getByText("Anna Leeson")).toBeDefined();
  });

  it("renders a status change as a movement", () => {
    render(<IssueTimeline activity={activity({ statusChanges: [STATUS] })} />);

    expect(screen.getByText("Open → In Progress")).toBeDefined();
  });

  it("fills a missing end of a status change rather than leaving a hole", () => {
    // Jira reports no previous status on the move out of creation.
    render(
      <IssueTimeline
        activity={activity({
          statusChanges: [{ ...STATUS, from: undefined }],
        })}
      />,
    );

    expect(screen.getByText("— → In Progress")).toBeDefined();
  });

  it("renders a worklog as a duration, with its comment when there is one", () => {
    render(<IssueTimeline activity={activity({ worklogs: [WORKLOG] })} />);

    expect(screen.getByText("1h 30m")).toBeDefined();
    expect(screen.getByText(/swapped the seal/)).toBeDefined();
  });

  it("renders a worklog with no comment as just the duration", () => {
    const { container } = render(
      <IssueTimeline
        activity={activity({ worklogs: [{ ...WORKLOG, comment: "" }] })}
      />,
    );

    expect(container.querySelector(".timeline-duration")).not.toBeNull();
    expect(screen.queryByText(/·/)).toBeNull();
  });
});

describe("all three together", () => {
  it("interleaves them newest first", () => {
    const { container } = render(
      <IssueTimeline
        activity={activity({
          comments: [COMMENT],
          statusChanges: [STATUS],
          worklogs: [WORKLOG],
        })}
      />,
    );

    const kinds = [...container.querySelectorAll(".timeline-entry")].map((li) =>
      li.className.replace("timeline-entry ", ""),
    );
    // 11:00 worklog, 10:00 status, 09:00 comment.
    expect(kinds).toEqual(["worklog", "status", "comment"]);
  });
});

describe("a service-desk internal note", () => {
  it("is marked, and an ordinary comment is not", () => {
    // Who can read it is the thing a reader has to know before replying.
    const { unmount } = render(
      <IssueTimeline
        activity={activity({ comments: [{ ...COMMENT, internal: true }] })}
      />,
    );
    expect(screen.getByText("internal")).toBeDefined();
    unmount();

    render(<IssueTimeline activity={activity({ comments: [COMMENT] })} />);
    expect(screen.queryByText("internal")).toBeNull();
  });
});

describe("a truncated history", () => {
  it("admits the gap rather than looking complete", () => {
    render(
      <IssueTimeline
        activity={activity({ comments: [COMMENT], commentsTruncated: true })}
      />,
    );

    expect(
      screen.getByText(/Only the newest comments are shown/),
    ).toBeDefined();
  });

  it("says nothing when the history is whole", () => {
    render(<IssueTimeline activity={activity({ comments: [COMMENT] })} />);

    expect(screen.queryByText(/Only the newest comments/)).toBeNull();
  });
});

describe("an entry with no timestamp", () => {
  it("says so instead of rendering an empty slot", () => {
    render(
      <IssueTimeline
        activity={activity({
          comments: [{ ...COMMENT, createdAt: "", createdTs: 0 }],
        })}
      />,
    );

    expect(screen.getByText("at an unknown time")).toBeDefined();
  });
});

describe("timelineCount", () => {
  it("counts all three lists, since the list scrolls out of sight", () => {
    expect(
      timelineCount(
        activity({
          comments: [COMMENT],
          statusChanges: [STATUS],
          worklogs: [WORKLOG],
        }),
      ),
    ).toBe(3);
    expect(timelineCount(activity())).toBe(0);
  });
});
