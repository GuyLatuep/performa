/** @vitest-environment happy-dom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

const pins = vi.hoisted(() => ({
  usePinnedIssues: vi.fn(() => [] as { key: string; summary: string }[]),
  togglePin: vi.fn(),
}));
vi.mock("../pins", () => pins);

// The rows are already covered by IssueRow.test.tsx; here they only need to be
// something identifiable in the list.
vi.mock("./IssueRow", () => ({
  default: ({
    issue,
    pinned,
    onSelect,
  }: {
    issue: { key: string; summary: string };
    pinned: boolean;
    onSelect: (i: unknown) => void;
  }) => (
    <li>
      <button data-pinned={pinned} onClick={() => onSelect(issue)}>
        {issue.key}
      </button>
    </li>
  ),
}));

import { apiMock, issueSummary, resetApiMock } from "../test-support/api";
import IssuePicker from "./IssuePicker";

/** user-event drives its own clock, so it has to be told about the fake one
 *  or every `type()` hangs waiting for a timer that never advances. */
function setup() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

function renderPicker() {
  const onSelect = vi.fn();
  render(
    <IssuePicker site="https://example.atlassian.net" onSelect={onSelect} />,
  );
  return onSelect;
}

beforeEach(() => {
  resetApiMock();
  pins.usePinnedIssues.mockReturnValue([]);
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the list on open", () => {
  it("asks for my open issues before anything is typed", async () => {
    apiMock.searchIssues.mockResolvedValue([issueSummary({ key: "ABC-1" })]);

    renderPicker();

    // A blank query means "assigned to me" on the Rust side.
    await waitFor(() => expect(apiMock.searchIssues).toHaveBeenCalledWith(""));
    expect(await screen.findByRole("button", { name: "ABC-1" })).toBeDefined();
  });

  it("says so when there is nothing to show", async () => {
    renderPicker();

    expect(await screen.findByText("No matching issues.")).toBeDefined();
  });

  it("reports a failed search and shows no stale rows", async () => {
    apiMock.searchIssues.mockRejectedValue(new Error("Jira returned 503"));

    renderPicker();

    expect(await screen.findByText(/Jira returned 503/)).toBeDefined();
    expect(screen.getByText("No matching issues.")).toBeDefined();
  });
});

describe("typing", () => {
  it("waits for the typing to stop before asking Jira", async () => {
    const user = setup();
    renderPicker();
    await waitFor(() => expect(apiMock.searchIssues).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText("Find an issue"), "pump");

    // Still just the mount search: four keystrokes must not be four searches.
    expect(apiMock.searchIssues).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300);

    expect(apiMock.searchIssues).toHaveBeenCalledTimes(2);
    expect(apiMock.searchIssues).toHaveBeenLastCalledWith("pump");
  });

  it("searches once for a whole word rather than once per letter", async () => {
    const user = setup();
    renderPicker();
    await waitFor(() => expect(apiMock.searchIssues).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText("Find an issue"), "abc");
    await vi.advanceTimersByTimeAsync(300);

    expect(apiMock.searchIssues).toHaveBeenCalledTimes(2);
  });
});

describe("pinned issues", () => {
  it("leads the blank list with them", async () => {
    pins.usePinnedIssues.mockReturnValue([{ key: "PIN-1", summary: "Pinned" }]);
    apiMock.searchIssues.mockResolvedValue([issueSummary({ key: "ABC-1" })]);

    renderPicker();

    // Both, in order — waiting on the pinned row alone would pass before the
    // search had landed.
    await waitFor(() => {
      const keys = screen.getAllByRole("button").map((b) => b.textContent);
      expect(keys).toEqual(["PIN-1", "ABC-1"]);
    });
  });

  it("does not list a pinned issue twice when the search finds it too", async () => {
    pins.usePinnedIssues.mockReturnValue([{ key: "ABC-1", summary: "Both" }]);
    apiMock.searchIssues.mockResolvedValue([issueSummary({ key: "ABC-1" })]);

    renderPicker();

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "ABC-1" })).toHaveLength(1),
    );
  });

  it("drops them once a search is on, so the results stand alone", async () => {
    const user = setup();
    pins.usePinnedIssues.mockReturnValue([{ key: "PIN-1", summary: "Pinned" }]);
    apiMock.searchIssues.mockResolvedValue([issueSummary({ key: "ABC-1" })]);
    renderPicker();
    await screen.findByRole("button", { name: "PIN-1" });

    await user.type(screen.getByLabelText("Find an issue"), "pump");
    await vi.advanceTimersByTimeAsync(300);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "PIN-1" })).toBeNull(),
    );
  });
});

describe("choosing", () => {
  it("hands the whole issue to the caller", async () => {
    const user = setup();
    const chosen = issueSummary({ key: "ABC-1" });
    apiMock.searchIssues.mockResolvedValue([chosen]);
    const onSelect = renderPicker();

    await user.click(await screen.findByRole("button", { name: "ABC-1" }));

    expect(onSelect).toHaveBeenCalledWith(chosen);
  });
});
