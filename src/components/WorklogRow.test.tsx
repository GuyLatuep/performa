/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { WorklogEntry } from "../api";
import WorklogRow from "./WorklogRow";

const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const SITE = "https://example.atlassian.net";

function entry(overrides: Partial<WorklogEntry> = {}): WorklogEntry {
  return {
    id: "1",
    issueKey: "ABC-1",
    issueSummary: "Replace the pump",
    timeSpentSeconds: 5400,
    date: "2026-03-15",
    time: "09:00",
    comment: "",
    billable: true,
    ...overrides,
  };
}

/** Render a row and hand back every callback it was given. */
function renderRow(e: WorklogEntry = entry(), confirming = false) {
  const handlers = {
    onConfirmDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    onRepeat: vi.fn(),
  };
  render(
    <WorklogRow entry={e} site={SITE} confirming={confirming} {...handlers} />,
  );
  return handlers;
}

beforeEach(() => {
  openUrl.mockClear();
});

describe("what the row shows", () => {
  it("shows the issue, its summary and the duration", () => {
    renderRow();

    expect(screen.getByRole("button", { name: "ABC-1" })).toBeDefined();
    expect(screen.getByText("Replace the pump")).toBeDefined();
    expect(screen.getByText("1h 30m")).toBeDefined();
  });

  it("shows a comment when there is one, and nothing when there is not", () => {
    const { container } = render(
      <WorklogRow
        entry={entry({ comment: "cleaned the filter" })}
        site={SITE}
        confirming={false}
        onConfirmDelete={vi.fn()}
        onCancelDelete={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onRepeat={vi.fn()}
      />,
    );
    expect(screen.getByText("cleaned the filter")).toBeDefined();
    expect(container.querySelector(".comment")).not.toBeNull();
  });

  it("marks a non-billable worklog and leaves a billable one unmarked", () => {
    const { unmount } = render(
      <WorklogRow
        entry={entry({ billable: false })}
        site={SITE}
        confirming={false}
        onConfirmDelete={vi.fn()}
        onCancelDelete={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onRepeat={vi.fn()}
      />,
    );
    expect(screen.getByText("non-billable")).toBeDefined();
    unmount();

    renderRow(entry({ billable: true }));
    expect(screen.queryByText("non-billable")).toBeNull();
  });

  it("omits the time column for a worklog booked without one", () => {
    const { container } = render(
      <WorklogRow
        entry={entry({ time: "" })}
        site={SITE}
        confirming={false}
        onConfirmDelete={vi.fn()}
        onCancelDelete={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onRepeat={vi.fn()}
      />,
    );

    expect(container.querySelector(".wl-time")).toBeNull();
  });
});

describe("opening the issue", () => {
  it("opens the browse URL on the configured site", async () => {
    renderRow();

    await userEvent.click(screen.getByRole("button", { name: "ABC-1" }));

    expect(openUrl).toHaveBeenCalledWith(`${SITE}/browse/ABC-1`);
  });
});

describe("the action buttons", () => {
  it("offers repeat, edit and delete while not confirming", async () => {
    const handlers = renderRow();

    await userEvent.click(screen.getByTitle("Log again today"));
    await userEvent.click(screen.getByTitle("Edit"));
    await userEvent.click(screen.getByTitle("Delete"));

    expect(handlers.onRepeat).toHaveBeenCalledTimes(1);
    expect(handlers.onEdit).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirmDelete).toHaveBeenCalledTimes(1);
  });

  it("swaps to confirm and cancel once asking", async () => {
    // Jira has no undo for a deleted worklog, so the confirmation replaces the
    // ordinary actions rather than sitting beside them.
    const handlers = renderRow(entry(), true);

    expect(screen.queryByTitle("Edit")).toBeNull();
    expect(screen.queryByTitle("Log again today")).toBeNull();

    await userEvent.click(screen.getByTitle("Confirm delete"));
    await userEvent.click(screen.getByTitle("Cancel"));

    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    expect(handlers.onCancelDelete).toHaveBeenCalledTimes(1);
  });
});
