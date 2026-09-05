/** @vitest-environment happy-dom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import type { MissingWorklog } from "../api";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

// The store is mocked wholesale rather than driven: it owns a 15-minute poller
// that has no business being awake in a component test, and what this file is
// about is the tab, not the scan.
const store = vi.hoisted(() => ({
  items: [] as MissingWorklog[],
  hidden: 0,
  error: null as string | null,
  lastChecked: null as string | null,
  refreshMissing: vi.fn(async () => {}),
  ignoreMissing: vi.fn(),
  restoreIgnoredMissing: vi.fn(),
  markMissingSeen: vi.fn(),
}));
vi.mock("../missing", () => ({
  useMissing: () => store.items,
  useMissingHiddenCount: () => store.hidden,
  useMissingError: () => store.error,
  useMissingLastChecked: () => store.lastChecked,
  refreshMissing: store.refreshMissing,
  ignoreMissing: store.ignoreMissing,
  restoreIgnoredMissing: store.restoreIgnoredMissing,
  markMissingSeen: store.markMissingSeen,
}));

const recordEvent = vi.hoisted(() => vi.fn(() => [] as string[]));
vi.mock("../achievements", () => ({ recordEvent }));

const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { apiMock, missingWorklog, resetApiMock } from "../test-support/api";
import MissingWorklogs from "./MissingWorklogs";

function renderTab() {
  const onLogged = vi.fn();
  render(
    <MissingWorklogs
      site="https://example.atlassian.net"
      onLogged={onLogged}
    />,
  );
  return onLogged;
}

beforeEach(() => {
  resetApiMock();
  store.items = [];
  store.hidden = 0;
  store.error = null;
  store.lastChecked = "09:30";
  store.refreshMissing.mockClear();
  store.ignoreMissing.mockClear();
  store.restoreIgnoredMissing.mockClear();
  store.markMissingSeen.mockClear();
  recordEvent.mockClear();
  recordEvent.mockReturnValue([]);
  openUrl.mockClear();
});

describe("what the tab shows", () => {
  it("explains what it flags", () => {
    renderTab();

    expect(screen.getByText(/without logging time around it/)).toBeDefined();
  });

  it("says it is still checking before the first scan lands", () => {
    store.lastChecked = null;

    renderTab();

    expect(screen.getByText("Checking…")).toBeDefined();
  });

  it("says all caught up once a scan found nothing", () => {
    renderTab();

    expect(screen.getByText("Nothing unlogged. All caught up.")).toBeDefined();
    expect(screen.getByText("at 09:30")).toBeDefined();
  });

  it("reports a failed scan instead of an empty list", () => {
    // "Nothing to log" and "we could not check" must not look the same.
    store.error = "Jira returned 503";

    renderTab();

    expect(screen.getByText(/Jira returned 503/)).toBeDefined();
    expect(screen.queryByText(/All caught up/)).toBeNull();
  });

  it("lists what was found", () => {
    store.items = [missingWorklog({ issueKey: "ABC-1" })];

    renderTab();

    expect(screen.getByRole("button", { name: "ABC-1" })).toBeDefined();
    expect(screen.queryByText(/All caught up/)).toBeNull();
  });

  it("acknowledges the findings on arrival, so the tab stops blinking", () => {
    renderTab();

    expect(store.markMissingSeen).toHaveBeenCalled();
  });
});

describe("checking now", () => {
  it("runs a scan and says it is busy", async () => {
    let finish = () => {};
    store.refreshMissing.mockImplementation(
      () => new Promise<void>((r) => (finish = r)),
    );
    renderTab();

    await userEvent.click(screen.getByRole("button", { name: "Check now" }));

    expect(store.refreshMissing).toHaveBeenCalledWith("manual");
    expect(screen.getByRole("button", { name: "Checking…" })).toHaveProperty(
      "disabled",
      true,
    );
    finish();
  });
});

describe("the achievement", () => {
  it("is recorded for an inbox a real scan found empty", () => {
    renderTab();

    expect(recordEvent).toHaveBeenCalledWith({ kind: "missingEmpty" });
  });

  it("is not recorded before anything has been checked", () => {
    // Nothing found before the first scan means "not looked yet".
    store.lastChecked = null;

    renderTab();

    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("is not recorded for a list emptied by ignoring everything", () => {
    store.hidden = 3;

    renderTab();

    expect(recordEvent).not.toHaveBeenCalled();
  });
});

describe("ignoring", () => {
  it("waves one finding away", async () => {
    const item = missingWorklog({ issueKey: "ABC-1" });
    store.items = [item];
    renderTab();

    await userEvent.click(screen.getByTitle(/Ignore until/));

    expect(store.ignoreMissing).toHaveBeenCalledWith(item);
  });

  it("counts what is hidden and offers it back", async () => {
    store.hidden = 2;
    renderTab();

    expect(screen.getByText(/2 ignored/)).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Show again" }));

    expect(store.restoreIgnoredMissing).toHaveBeenCalled();
  });
});

describe("logging from a finding", () => {
  const ITEM = missingWorklog({
    issueKey: "DEV-9",
    logKey: "ABC-1",
    logSummary: "Replace the pump",
    activityAt: "2026-03-16T14:30:00.000+01:00",
  });

  beforeEach(() => {
    store.items = [ITEM];
  });

  it("opens a form starting at the flagged activity", async () => {
    // So the new worklog covers it and the reminder clears.
    renderTab();

    await userEvent.click(screen.getByTitle("Log work on ABC-1"));

    expect(screen.getByLabelText("Date")).toHaveProperty("value", "2026-03-16");
    expect(screen.getByLabelText("Start time")).toHaveProperty(
      "value",
      "14:30",
    );
  });

  it("logs against the target issue, not the flagged one", async () => {
    // A DEV escalation books its time on the issue it was raised for.
    const onLogged = renderTab();
    await userEvent.click(screen.getByTitle("Log work on ABC-1"));

    await userEvent.type(screen.getByLabelText(/Time spent/), "1h");
    await userEvent.click(screen.getByRole("button", { name: /Log work/ }));

    await waitFor(() =>
      expect(apiMock.logWork).toHaveBeenCalledWith(
        "ABC-1",
        expect.objectContaining({ timeSpentSeconds: 3600 }),
      ),
    );
    expect(onLogged).toHaveBeenCalled();
    expect(store.refreshMissing).toHaveBeenCalledWith("post-log");
  });

  it("refuses a duration it cannot read", async () => {
    renderTab();
    await userEvent.click(screen.getByTitle("Log work on ABC-1"));

    await userEvent.type(screen.getByLabelText(/Time spent/), "soon");
    await userEvent.click(screen.getByRole("button", { name: /Log work/ }));

    expect(apiMock.logWork).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter a valid duration/)).toBeDefined();
  });

  it("keeps the form open when Jira refuses", async () => {
    apiMock.logWork.mockRejectedValue(new Error("Jira returned 400"));
    renderTab();
    await userEvent.click(screen.getByTitle("Log work on ABC-1"));
    await userEvent.type(screen.getByLabelText(/Time spent/), "1h");

    await userEvent.click(screen.getByRole("button", { name: /Log work/ }));

    expect(await screen.findByText(/Jira returned 400/)).toBeDefined();
  });

  it("goes back to the list on cancel", async () => {
    renderTab();
    await userEvent.click(screen.getByTitle("Log work on ABC-1"));

    await userEvent.click(
      screen.getByRole("button", { name: /Back to the list/ }),
    );

    expect(screen.getByText(/without logging time around it/)).toBeDefined();
    expect(apiMock.logWork).not.toHaveBeenCalled();
  });
});
