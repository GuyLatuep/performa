/** @vitest-environment happy-dom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("../achievements", () => ({ recordEvent: vi.fn(() => []) }));

// Covered by its own file; here it only has to offer an issue to pick.
vi.mock("./IssuePicker", () => ({
  default: ({ onSelect }: { onSelect: (i: unknown) => void }) => (
    <button
      onClick={() => onSelect({ key: "ABC-9", summary: "A picked issue" })}
    >
      pick ABC-9
    </button>
  ),
}));

import { apiMock, resetApiMock, worklogEntry } from "../test-support/api";
import TimesheetMonth from "./TimesheetMonth";

// Mid-March 2026, so the month is fully in the past except its tail.
const MID_MARCH = new Date(2026, 2, 18, 12, 0, 0);

function renderMonth(refreshKey = 0) {
  render(
    <TimesheetMonth
      site="https://example.atlassian.net"
      refreshKey={refreshKey}
    />,
  );
}

/**
 * Answer each week chunk from one flat list.
 *
 * Keyed on the range rather than queued with `mockResolvedValueOnce`: the
 * month is fetched by two workers pulling from a shared queue, so the order
 * the chunks are asked for is not fixed.
 */
function serveWeeks(entries: ReturnType<typeof worklogEntry>[]) {
  apiMock.listWorklogs.mockImplementation(async (start: string, end: string) =>
    entries.filter((e) => e.date >= start && e.date <= end),
  );
}

/** Wait for the month to finish loading all of its chunks. */
async function loaded() {
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
}

beforeEach(() => {
  resetApiMock();
  serveWeeks([]);
  openUrl.mockClear();
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(MID_MARCH);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loading the month", () => {
  it("fetches it a week at a time", async () => {
    renderMonth();

    await loaded();
    // Five or six chunks for a March; what matters is that it is not one.
    expect(apiMock.listWorklogs.mock.calls.length).toBeGreaterThan(1);
  });

  it("says so while the chunks are on their way", () => {
    apiMock.listWorklogs.mockReturnValue(new Promise(() => {}));

    renderMonth();

    expect(screen.getByText("Loading…")).toBeDefined();
  });

  it("names the month", async () => {
    renderMonth();

    await loaded();
    expect(screen.getByText(/March 2026/)).toBeDefined();
  });

  it("totals what came back across every chunk", async () => {
    serveWeeks([
      worklogEntry({ id: "1", date: "2026-03-03", timeSpentSeconds: 3600 }),
      worklogEntry({ id: "2", date: "2026-03-17", timeSpentSeconds: 5400 }),
    ]);

    renderMonth();

    await loaded();
    // Once in the header corner, once in the total line.
    expect(screen.getAllByText("2h 30m").length).toBeGreaterThan(0);
  });

  it("counts a worklog that arrived in two overlapping chunks once", async () => {
    // The weeks overlap at their edges, so the same worklog can be fetched
    // twice — the totals must not double it.
    const shared = worklogEntry({
      id: "dup",
      date: "2026-03-17",
      timeSpentSeconds: 3600,
    });
    apiMock.listWorklogs.mockResolvedValue([shared]);

    renderMonth();

    await loaded();
    expect(screen.getAllByText("1h").length).toBeGreaterThan(0);
  });
});

describe("when a week could not be read", () => {
  it("says which one, and that the totals are short", async () => {
    // A month silently missing a week would look right and be wrong.
    let first = true;
    apiMock.listWorklogs.mockImplementation(async () => {
      if (first) {
        first = false;
        throw new Error("Jira returned 500");
      }
      return [];
    });

    renderMonth();

    expect(
      await screen.findByText(/could not be loaded — its time is missing/),
    ).toBeDefined();
  });

  it("uses the plural when several went missing", async () => {
    apiMock.listWorklogs.mockImplementation(async () => {
      throw new Error("Jira returned 500");
    });

    renderMonth();

    expect(
      await screen.findByText(/weeks could not be loaded — their time/),
    ).toBeDefined();
  });

  it("loads the month again on Retry", async () => {
    let failing = true;
    apiMock.listWorklogs.mockImplementation(async () => {
      if (failing) throw new Error("Jira returned 500");
      return [];
    });
    renderMonth();
    await screen.findByRole("button", { name: "Retry" });
    failing = false;

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull(),
    );
  });
});

describe("moving between months", () => {
  it("steps back and re-reads", async () => {
    renderMonth();
    await loaded();
    apiMock.listWorklogs.mockClear();

    await userEvent.click(screen.getByRole("button", { name: /Previous/ }));

    await waitFor(() => expect(apiMock.listWorklogs).toHaveBeenCalled());
    expect(screen.getByText(/February 2026/)).toBeDefined();
  });

  it("will not go into the future", async () => {
    renderMonth();
    await loaded();

    expect(screen.getByRole("button", { name: /Next/ })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("the grid", () => {
  beforeEach(() =>
    serveWeeks([
      worklogEntry({
        id: "1",
        date: "2026-03-17",
        timeSpentSeconds: 5400,
        issueKey: "ABC-1",
      }),
    ]),
  );

  it("gives each issue a row", async () => {
    renderMonth();

    await loaded();
    expect(screen.getByText("ABC-1")).toBeDefined();
  });

  it("shows a day's hours as a decimal the column can hold", async () => {
    renderMonth();

    await loaded();
    // "1h 30m" does not fit; "1.5" does.
    expect(screen.getAllByText("1.5").length).toBeGreaterThan(0);
  });

  it("says what a cell holds in its tooltip", async () => {
    renderMonth();

    await loaded();
    expect(screen.getByTitle(/1h 30m, click to open/)).toBeDefined();
  });

  it("offers an empty past day for logging", async () => {
    renderMonth();

    await loaded();
    expect(
      screen.getAllByTitle(/nothing booked, click to log/).length,
    ).toBeGreaterThan(0);
  });

  it("will not take a booking for a day that has not happened", async () => {
    renderMonth();

    await loaded();
    const future = screen.getAllByTitle(/not yet/);
    expect(future.length).toBeGreaterThan(0);
    expect(future[0]).toHaveProperty("disabled", true);
  });
});

describe("opening a cell", () => {
  beforeEach(() =>
    serveWeeks([
      worklogEntry({
        id: "w1",
        date: "2026-03-17",
        timeSpentSeconds: 3600,
        issueKey: "ABC-1",
      }),
    ]),
  );

  it("lists the worklogs booked in it", async () => {
    renderMonth();
    await loaded();

    await userEvent.click(screen.getByTitle(/1h, click to open/));

    expect(screen.getByTitle("Delete")).toBeDefined();
  });

  it("deletes one after confirming, then re-reads only that week", async () => {
    renderMonth();
    await loaded();
    await userEvent.click(screen.getByTitle(/1h, click to open/));
    apiMock.listWorklogs.mockClear();

    await userEvent.click(screen.getByTitle("Delete"));
    await userEvent.click(screen.getByTitle("Confirm delete"));

    await waitFor(() =>
      expect(apiMock.deleteWorklog).toHaveBeenCalledWith("ABC-1", "w1"),
    );
    // One week, not the whole month.
    await waitFor(() => expect(apiMock.listWorklogs).toHaveBeenCalledTimes(1));
  });

  it("opens a quick-log form for an empty day", async () => {
    renderMonth();
    await loaded();

    // The "＋" row, not an empty cell: a cell belongs to an issue that
    // already has a row, and this is for one that does not.
    await userEvent.click(screen.getAllByTitle(/^Log time on /)[0]);

    expect(screen.getByRole("button", { name: "pick ABC-9" })).toBeDefined();
  });

  it("logs against the issue picked in that form", async () => {
    renderMonth();
    await loaded();
    await userEvent.click(screen.getAllByTitle(/^Log time on /)[0]);

    await userEvent.click(screen.getByRole("button", { name: "pick ABC-9" }));
    await userEvent.type(screen.getByLabelText(/Time spent/), "1h");
    await userEvent.click(screen.getByRole("button", { name: "Log work" }));

    await waitFor(() =>
      expect(apiMock.logWork).toHaveBeenCalledWith(
        "ABC-9",
        expect.objectContaining({ timeSpentSeconds: 3600 }),
      ),
    );
  });
});
