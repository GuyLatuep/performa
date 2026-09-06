/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import Timesheet from "./Timesheet";

// The two views have their own tests; what this file is about is the switch
// between them and what each is handed.
vi.mock("./TimesheetWeek", () => ({
  default: (p: { site: string; refreshKey: number }) => (
    <div>
      week view site={p.site} key={p.refreshKey}
    </div>
  ),
}));
vi.mock("./TimesheetMonth", () => ({
  default: (p: { site: string; refreshKey: number }) => (
    <div>
      month view site={p.site} key={p.refreshKey}
    </div>
  ),
}));

const settings = vi.hoisted(() => ({
  view: "week" as "week" | "month",
  setTimesheetView: vi.fn(),
}));
vi.mock("../settings", () => ({
  useTimesheetView: () => settings.view,
  setTimesheetView: settings.setTimesheetView,
}));

const renderSheet = (refreshKey = 1) =>
  render(
    <Timesheet site="https://example.atlassian.net" refreshKey={refreshKey} />,
  );

const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  settings.view = "week";
});

describe("which view is showing", () => {
  it("shows the week as a ledger", () => {
    renderSheet();

    expect(screen.getByText(/week view/)).toBeDefined();
    expect(screen.queryByText(/month view/)).toBeNull();
  });

  it("shows the month as a matrix", () => {
    settings.view = "month";
    renderSheet();

    expect(screen.getByText(/month view/)).toBeDefined();
    expect(screen.queryByText(/week view/)).toBeNull();
  });

  it("marks the one being shown", () => {
    renderSheet();

    expect(button("Week").className).toContain("active");
    expect(button("Month").className).not.toContain("active");
  });

  it("marks the month when that is the one", () => {
    settings.view = "month";
    renderSheet();

    expect(button("Month").className).toContain("active");
    expect(button("Week").className).not.toContain("active");
  });
});

describe("switching", () => {
  it("stores the choice rather than keeping it locally", async () => {
    // The view outlives the tab, so it belongs in the settings store.
    renderSheet();

    await userEvent.click(button("Month"));

    expect(settings.setTimesheetView).toHaveBeenCalledWith("month");
  });

  it("switches back to the week", async () => {
    settings.view = "month";
    renderSheet();

    await userEvent.click(button("Week"));

    expect(settings.setTimesheetView).toHaveBeenCalledWith("week");
  });
});

describe("what the view is given", () => {
  it("passes the site and the refresh key through", () => {
    renderSheet(7);

    expect(
      screen.getByText(/site=https:\/\/example.atlassian.net key=7/),
    ).toBeDefined();
  });
});
