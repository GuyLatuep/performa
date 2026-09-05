/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { IssueSummary } from "../api";
import IssueRow from "./IssueRow";

// The row reads three stores and reaches the OS browser. Each is somebody
// else's concern and tested there; here they only need to be steerable.
const mocks = vi.hoisted(() => ({
  openUrl: vi.fn(),
  togglePin: vi.fn(),
  startTimer: vi.fn(),
  useTimer: vi.fn<() => { issueKey: string } | null>(() => null),
  useIssueTypeIcon: vi.fn<(url?: string) => string | undefined>(
    () => undefined,
  ),
  useShowIssueTypeIcons: vi.fn(() => true),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("../pins", () => ({ togglePin: mocks.togglePin }));
vi.mock("../timer", () => ({
  startTimer: mocks.startTimer,
  useTimer: mocks.useTimer,
}));
vi.mock("../issueTypeIcons", () => ({
  useIssueTypeIcon: mocks.useIssueTypeIcon,
}));
vi.mock("../settings", () => ({
  useShowIssueTypeIcons: mocks.useShowIssueTypeIcons,
}));

const SITE = "https://example.atlassian.net";

function issue(overrides: Partial<IssueSummary> = {}): IssueSummary {
  return {
    key: "ABC-1",
    summary: "Replace the pump",
    ...overrides,
  } as IssueSummary;
}

function renderRow(i: IssueSummary = issue(), pinned = false) {
  const onSelect = vi.fn();
  render(
    <IssueRow issue={i} site={SITE} pinned={pinned} onSelect={onSelect} />,
  );
  return onSelect;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useTimer.mockReturnValue(null);
  mocks.useIssueTypeIcon.mockReturnValue(undefined);
  mocks.useShowIssueTypeIcons.mockReturnValue(true);
});

describe("the pin toggle", () => {
  it("shows a hollow star when unpinned and a filled one when pinned", () => {
    const { unmount } = render(
      <IssueRow
        issue={issue()}
        site={SITE}
        pinned={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTitle("Pin ABC-1 to top")).toHaveProperty(
      "textContent",
      "☆",
    );
    unmount();

    renderRow(issue(), true);
    expect(screen.getByTitle("Unpin ABC-1")).toHaveProperty("textContent", "★");
  });

  it("toggles the pin for its own issue", async () => {
    const i = issue();
    renderRow(i);

    await userEvent.click(screen.getByTitle("Pin ABC-1 to top"));

    expect(mocks.togglePin).toHaveBeenCalledWith(i);
  });
});

describe("the issue itself", () => {
  it("opens the issue in the browser", async () => {
    renderRow();

    await userEvent.click(screen.getByTitle("Open ABC-1 in browser"));

    expect(mocks.openUrl).toHaveBeenCalledWith(`${SITE}/browse/ABC-1`);
  });

  it("hands the whole issue to the selection handler", async () => {
    const i = issue();
    const onSelect = renderRow(i);

    await userEvent.click(screen.getByText("Replace the pump"));

    expect(onSelect).toHaveBeenCalledWith(i);
  });

  it("carries the full summary in a tooltip, since the column is ellipsised", () => {
    renderRow(issue({ summary: "A very long summary that will be cut off" }));

    expect(
      screen.getByTitle("A very long summary that will be cut off"),
    ).toBeDefined();
  });
});

describe("the badges", () => {
  it("shows priority and status when the issue carries them", () => {
    renderRow(issue({ priority: "High", status: "In Progress" }));

    expect(screen.getByTitle("Priority: High")).toBeDefined();
    expect(screen.getByTitle("Status: In Progress")).toBeDefined();
  });

  it("shows neither when the search did not ask for them", () => {
    // The start tab's search omits both columns; a row must not render empty
    // badges for fields it never received.
    const { container } = render(
      <IssueRow
        issue={issue()}
        site={SITE}
        pinned={false}
        onSelect={vi.fn()}
      />,
    );

    expect(container.querySelector(".priority-badge")).toBeNull();
    expect(container.querySelector(".status-badge")).toBeNull();
  });
});

describe("the due badge", () => {
  const NOON = new Date(2026, 2, 15, 12, 0, 0);

  function withClock(body: () => void) {
    vi.useFakeTimers();
    vi.setSystemTime(NOON);
    try {
      body();
    } finally {
      vi.useRealTimers();
    }
  }

  it("says today for the current day", () => {
    withClock(() => {
      renderRow(issue({ dueDate: "2026-03-15" }));
      expect(screen.getByText(/today/)).toBeDefined();
    });
  });

  it("marks a past due date as overdue", () => {
    withClock(() => {
      const { container } = render(
        <IssueRow
          issue={issue({ dueDate: "2026-03-14" })}
          site={SITE}
          pinned={false}
          onSelect={vi.fn()}
        />,
      );
      expect(container.querySelector(".due-badge.overdue")).not.toBeNull();
      expect(screen.getByText(/overdue/)).toBeDefined();
    });
  });

  it("leaves a future due date unmarked", () => {
    withClock(() => {
      const { container } = render(
        <IssueRow
          issue={issue({ dueDate: "2026-03-20" })}
          site={SITE}
          pinned={false}
          onSelect={vi.fn()}
        />,
      );
      const badge = container.querySelector(".due-badge");
      expect(badge).not.toBeNull();
      expect(badge?.className).not.toMatch(/overdue|due-today/);
    });
  });

  it("is absent when the issue has no due date", () => {
    const { container } = render(
      <IssueRow
        issue={issue()}
        site={SITE}
        pinned={false}
        onSelect={vi.fn()}
      />,
    );

    expect(container.querySelector(".due-badge")).toBeNull();
  });
});

describe("the type icon", () => {
  it("draws the cell even with no icon, so a late one does not shift the row", () => {
    const { container } = render(
      <IssueRow
        issue={issue({ issueType: "Bug" })}
        site={SITE}
        pinned={false}
        onSelect={vi.fn()}
      />,
    );

    expect(container.querySelector(".type-icon")).not.toBeNull();
    expect(container.querySelector(".type-icon img")).toBeNull();
  });

  it("shows the icon once it has arrived", () => {
    mocks.useIssueTypeIcon.mockReturnValue("data:image/png;base64,AAA");

    const { container } = render(
      <IssueRow
        issue={issue({ issueType: "Bug" })}
        site={SITE}
        pinned={false}
        onSelect={vi.fn()}
      />,
    );

    expect(container.querySelector(".type-icon img")).not.toBeNull();
    expect(screen.getByTitle("Type: Bug")).toBeDefined();
  });

  it("drops the cell entirely when the setting is off, and fetches nothing", () => {
    // An icon fetched for a cell nobody can see is a request for nothing.
    mocks.useShowIssueTypeIcons.mockReturnValue(false);

    const { container } = render(
      <IssueRow
        issue={issue({ issueType: "Bug", issueTypeIcon: "https://x/i.png" })}
        site={SITE}
        pinned={false}
        onSelect={vi.fn()}
      />,
    );

    expect(container.querySelector(".type-icon")).toBeNull();
    expect(mocks.useIssueTypeIcon).toHaveBeenCalledWith(undefined);
  });
});

describe("the timer button", () => {
  it("starts a timer for this issue", async () => {
    renderRow();

    await userEvent.click(screen.getByTitle("Start timer for ABC-1"));

    expect(mocks.startTimer).toHaveBeenCalledWith("ABC-1", "Replace the pump");
  });

  it("shows itself as running when the timer is on this issue", () => {
    mocks.useTimer.mockReturnValue({ issueKey: "ABC-1" });

    renderRow();

    expect(screen.getByTitle("Timer running")).toBeDefined();
    expect(screen.getByText("● timing")).toBeDefined();
  });

  it("is disabled for other issues while a timer runs elsewhere", () => {
    // Only one timer at a time, and the tooltip has to say why the button is
    // dead rather than leaving the user guessing.
    mocks.useTimer.mockReturnValue({ issueKey: "OTHER-9" });

    renderRow();

    const button = screen.getByTitle("Stop the running timer first");
    expect(button).toHaveProperty("disabled", true);
  });
});
