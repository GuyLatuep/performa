/** @vitest-environment happy-dom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import type { MissingWorklog } from "../api";
import type { WorklogTemplate } from "../templates";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

// Mocked wholesale: the store owns the 15-minute poller, and the start tab
// only reads its findings.
const missingStore = vi.hoisted(() => ({ items: [] as MissingWorklog[] }));
vi.mock("../missing", () => ({ useMissing: () => missingStore.items }));

const templateStore = vi.hoisted(() => ({
  items: [] as WorklogTemplate[],
  removeTemplate: vi.fn(),
}));
vi.mock("../templates", () => ({
  useTemplates: () => templateStore.items,
  removeTemplate: templateStore.removeTemplate,
}));

const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("../achievements", () => ({ recordEvent: vi.fn(() => []) }));

vi.mock("./IssueRow", () => ({
  default: ({
    issue,
    onSelect,
  }: {
    issue: { key: string };
    onSelect: (i: unknown) => void;
  }) => (
    <li>
      <button onClick={() => onSelect(issue)}>{issue.key}</button>
    </li>
  ),
}));

import {
  apiMock,
  issueSummary,
  missingWorklog,
  resetApiMock,
  worklogEntry,
} from "../test-support/api";
import Start from "./Start";

const WEDNESDAY = new Date(2026, 2, 18, 12, 0, 0);

function template(o: Partial<WorklogTemplate> = {}): WorklogTemplate {
  return {
    id: "t1",
    issueKey: "ABC-1",
    issueSummary: "Replace the pump",
    duration: "1h",
    comment: "weekly check",
    nonBillable: false,
    ...o,
  };
}

function renderStart() {
  const handlers = {
    onSelectIssue: vi.fn(),
    onOpenMissing: vi.fn(),
    onLogged: vi.fn(),
  };
  render(
    <Start site="https://example.atlassian.net" refreshKey={0} {...handlers} />,
  );
  return handlers;
}

beforeEach(() => {
  resetApiMock();
  missingStore.items = [];
  templateStore.items = [];
  templateStore.removeTemplate.mockClear();
  openUrl.mockClear();
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(WEDNESDAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the due-dates section", () => {
  it("lists what is due soon", async () => {
    apiMock.dueIssues.mockResolvedValue([issueSummary({ key: "ABC-1" })]);

    renderStart();

    expect(await screen.findByRole("button", { name: "ABC-1" })).toBeDefined();
    expect(screen.getByText(/last 7 · next 14 days/)).toBeDefined();
  });

  it("says so while they are on their way", () => {
    apiMock.dueIssues.mockReturnValue(new Promise(() => {}));

    renderStart();

    expect(screen.getByText("Loading…")).toBeDefined();
  });

  it("says when nothing is due", async () => {
    renderStart();

    expect(await screen.findByText("Nothing due soon.")).toBeDefined();
  });

  it("reports a failed read", async () => {
    apiMock.dueIssues.mockRejectedValue(new Error("Jira returned 500"));

    renderStart();

    expect(await screen.findByText(/Jira returned 500/)).toBeDefined();
    expect(screen.queryByText("Nothing due soon.")).toBeNull();
  });

  it("hands a picked issue to the caller", async () => {
    const issue = issueSummary({ key: "ABC-1" });
    apiMock.dueIssues.mockResolvedValue([issue]);
    const { onSelectIssue } = renderStart();

    await userEvent.click(await screen.findByRole("button", { name: "ABC-1" }));

    expect(onSelectIssue).toHaveBeenCalledWith(issue);
  });
});

describe("the week section", () => {
  it("reads the current week and totals it", async () => {
    apiMock.listWorklogs.mockResolvedValue([
      worklogEntry({ id: "1", date: "2026-03-16", timeSpentSeconds: 3600 }),
      worklogEntry({ id: "2", date: "2026-03-17", timeSpentSeconds: 1800 }),
    ]);

    renderStart();

    await waitFor(() =>
      expect(apiMock.listWorklogs).toHaveBeenCalledWith(
        "2026-03-16",
        "2026-03-22",
      ),
    );
    expect(await screen.findByText("1h 30m logged")).toBeDefined();
  });

  it("reports a failed read without losing the chart", async () => {
    apiMock.listWorklogs.mockRejectedValue(new Error("Jira returned 503"));

    renderStart();

    expect(await screen.findByText(/Jira returned 503/)).toBeDefined();
    expect(screen.getByText("This week")).toBeDefined();
  });
});

describe("the templates section", () => {
  it("is left out entirely while none are saved", () => {
    renderStart();

    expect(screen.queryByText("Templates")).toBeNull();
  });

  it("offers each saved template as a chip", () => {
    templateStore.items = [template()];

    renderStart();

    expect(screen.getByTitle("Log 1h on ABC-1")).toBeDefined();
    expect(screen.getByText("weekly check")).toBeDefined();
  });

  it("logs a template's time through the usual form", async () => {
    templateStore.items = [template()];
    const { onLogged } = renderStart();

    await userEvent.click(screen.getByTitle("Log 1h on ABC-1"));
    // Prefilled from the template.
    expect(screen.getByLabelText(/Time spent/)).toHaveProperty("value", "1h");

    await userEvent.click(screen.getByRole("button", { name: "Log work" }));

    await waitFor(() =>
      expect(apiMock.logWork).toHaveBeenCalledWith(
        "ABC-1",
        expect.objectContaining({ timeSpentSeconds: 3600 }),
      ),
    );
    expect(onLogged).toHaveBeenCalled();
  });

  it("removes a template", async () => {
    templateStore.items = [template({ id: "t9" })];
    renderStart();

    await userEvent.click(screen.getByTitle("Remove template"));

    expect(templateStore.removeTemplate).toHaveBeenCalledWith("t9");
  });
});

describe("the missing-worklog section", () => {
  it("is left out entirely when nothing is unlogged", () => {
    renderStart();

    expect(screen.queryByText("Missing worklogs")).toBeNull();
  });

  it("summarises what was found", () => {
    missingStore.items = [missingWorklog({ issueKey: "ABC-1" })];

    renderStart();

    expect(screen.getByText("Missing worklogs")).toBeDefined();
    expect(screen.getByRole("button", { name: "ABC-1" })).toBeDefined();
  });

  it("sends the user to the tab that works the list", async () => {
    // The overview is a summary; logging belongs on the tab itself.
    missingStore.items = [missingWorklog()];
    const { onOpenMissing } = renderStart();

    await userEvent.click(screen.getByRole("button", { name: "Open tab" }));

    expect(onOpenMissing).toHaveBeenCalledTimes(1);
  });

  it("sends the user there from a row as well", async () => {
    missingStore.items = [missingWorklog()];
    const { onOpenMissing } = renderStart();

    await userEvent.click(screen.getByTitle("Show in the missing-worklog tab"));

    expect(onOpenMissing).toHaveBeenCalledTimes(1);
  });

  it("offers no ignore here, since the list is worked elsewhere", () => {
    missingStore.items = [missingWorklog()];

    renderStart();

    expect(screen.queryByTitle(/Ignore until/)).toBeNull();
  });
});
