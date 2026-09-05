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
vi.mock("../achievements", () => ({ recordEvent: vi.fn() }));

import { setDailyHours, setFunMode, setShowWeekends } from "../settings";
import { apiMock, resetApiMock, worklogEntry } from "../test-support/api";
import TimesheetWeek from "./TimesheetWeek";

// Wednesday of the week starting Monday 2026-03-16.
const WEDNESDAY = new Date(2026, 2, 18, 12, 0, 0);
const MONDAY = "2026-03-16";
const SUNDAY = "2026-03-22";

function renderWeek(refreshKey = 0) {
  render(
    <TimesheetWeek
      site="https://example.atlassian.net"
      refreshKey={refreshKey}
    />,
  );
}

beforeEach(() => {
  resetApiMock();
  openUrl.mockClear();
  localStorage.clear();
  setDailyHours(8);
  setShowWeekends(false);
  setFunMode(false);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(WEDNESDAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the week that loads", () => {
  it("asks for the current week and names it", async () => {
    renderWeek();

    await waitFor(() =>
      expect(apiMock.listWorklogs).toHaveBeenCalledWith(MONDAY, SUNDAY),
    );
    expect(screen.getByText("This week")).toBeDefined();
    expect(screen.getByText(`${MONDAY} – ${SUNDAY}`)).toBeDefined();
  });

  it("totals the week", async () => {
    apiMock.listWorklogs.mockResolvedValue([
      worklogEntry({ id: "1", date: MONDAY, timeSpentSeconds: 3600 }),
      worklogEntry({ id: "2", date: "2026-03-17", timeSpentSeconds: 1800 }),
    ]);

    renderWeek();

    expect(await screen.findByText("1h 30m")).toBeDefined();
  });

  it("groups the entries by day, newest day first", async () => {
    apiMock.listWorklogs.mockResolvedValue([
      worklogEntry({ id: "1", date: MONDAY }),
      worklogEntry({ id: "2", date: "2026-03-18" }),
    ]);

    renderWeek();

    await screen.findByText(/2026-03-18|Wed/);
    const heads = [...document.querySelectorAll(".day-head")].map(
      (h) => h.textContent ?? "",
    );
    // The 18th's group leads the 16th's.
    expect(heads.length).toBeGreaterThanOrEqual(2);
  });

  it("reports a failed read", async () => {
    apiMock.listWorklogs.mockRejectedValue(new Error("Jira returned 500"));

    renderWeek();

    expect(await screen.findByText(/Jira returned 500/)).toBeDefined();
  });

  it("re-reads when the caller bumps the refresh key", async () => {
    const { rerender } = render(
      <TimesheetWeek site="https://example.atlassian.net" refreshKey={0} />,
    );
    await waitFor(() => expect(apiMock.listWorklogs).toHaveBeenCalledTimes(1));

    rerender(
      <TimesheetWeek site="https://example.atlassian.net" refreshKey={1} />,
    );

    await waitFor(() => expect(apiMock.listWorklogs).toHaveBeenCalledTimes(2));
  });
});

describe("moving between weeks", () => {
  it("steps back a week and names it", async () => {
    renderWeek();
    await waitFor(() => expect(apiMock.listWorklogs).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: "←" }));

    expect(await screen.findByText("Last week")).toBeDefined();
    await waitFor(() =>
      expect(apiMock.listWorklogs).toHaveBeenLastCalledWith(
        "2026-03-09",
        "2026-03-15",
      ),
    );
  });

  it("shows the plain range for anything further back", async () => {
    renderWeek();
    const back = screen.getByRole("button", { name: "←" });

    await userEvent.click(back);
    await userEvent.click(back);

    // The heading falls back to the range itself, which the muted line below
    // it already shows — hence two matches for the same text.
    await waitFor(() =>
      expect(document.querySelector(".week-label strong")?.textContent).toBe(
        "2026-03-02 – 2026-03-08",
      ),
    );
  });

  it("will not go into the future", async () => {
    // Time cannot be logged before it is worked.
    renderWeek();

    expect(screen.getByRole("button", { name: "→" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("comes forward again once it is behind", async () => {
    renderWeek();
    await userEvent.click(screen.getByRole("button", { name: "←" }));
    await screen.findByText("Last week");

    await userEvent.click(screen.getByRole("button", { name: "→" }));

    expect(await screen.findByText("This week")).toBeDefined();
  });
});

describe("deleting a worklog", () => {
  beforeEach(() =>
    apiMock.listWorklogs.mockResolvedValue([
      worklogEntry({ id: "w1", date: MONDAY }),
    ]),
  );

  it("asks first, then deletes and re-reads", async () => {
    // Jira has no undo for this.
    renderWeek();
    await userEvent.click(await screen.findByTitle("Delete"));

    await userEvent.click(screen.getByTitle("Confirm delete"));

    await waitFor(() =>
      expect(apiMock.deleteWorklog).toHaveBeenCalledWith("ABC-1", "w1"),
    );
    await waitFor(() => expect(apiMock.listWorklogs).toHaveBeenCalledTimes(2));
  });

  it("backs out on cancel, deleting nothing", async () => {
    renderWeek();
    await userEvent.click(await screen.findByTitle("Delete"));

    await userEvent.click(screen.getByTitle("Cancel"));

    expect(apiMock.deleteWorklog).not.toHaveBeenCalled();
    expect(screen.getByTitle("Delete")).toBeDefined();
  });

  it("reports a delete Jira refused", async () => {
    apiMock.deleteWorklog.mockRejectedValue(new Error("Jira returned 403"));
    renderWeek();
    await userEvent.click(await screen.findByTitle("Delete"));

    await userEvent.click(screen.getByTitle("Confirm delete"));

    expect(await screen.findByText(/Jira returned 403/)).toBeDefined();
  });
});

describe("the row actions", () => {
  beforeEach(() =>
    apiMock.listWorklogs.mockResolvedValue([
      worklogEntry({ id: "w1", date: MONDAY, timeSpentSeconds: 3600 }),
    ]),
  );

  it("opens a repeat form and re-reads once it saves", async () => {
    renderWeek();

    await userEvent.click(await screen.findByTitle("Log again today"));
    expect(screen.getByText(/Log again — ABC-1/)).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "Log work" }));

    await waitFor(() => expect(apiMock.logWork).toHaveBeenCalled());
    await waitFor(() => expect(apiMock.listWorklogs).toHaveBeenCalledTimes(2));
  });

  it("opens an edit form and re-reads once it saves", async () => {
    renderWeek();

    await userEvent.click(await screen.findByTitle("Edit"));
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(apiMock.updateWorklog).toHaveBeenCalled());
    await waitFor(() => expect(apiMock.listWorklogs).toHaveBeenCalledTimes(2));
  });

  it("opens the issue in the browser", async () => {
    renderWeek();

    await userEvent.click(await screen.findByTitle("Open ABC-1 in browser"));

    expect(openUrl).toHaveBeenCalledWith(
      "https://example.atlassian.net/browse/ABC-1",
    );
  });
});
