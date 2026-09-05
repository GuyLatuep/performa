/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { MissingWorklog } from "../api";
import MissingRow, { missingRowKey } from "./MissingRow";

const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const SITE = "https://example.atlassian.net";

function item(overrides: Partial<MissingWorklog> = {}): MissingWorklog {
  return {
    issueKey: "ABC-1",
    issueSummary: "Replace the pump",
    kind: "comment",
    detail: "cleaned the filter",
    activityAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    logKey: "ABC-1",
    logSummary: "Replace the pump",
    ...overrides,
  };
}

function renderRow(props: Partial<Parameters<typeof MissingRow>[0]> = {}) {
  const onAction = vi.fn();
  render(
    <MissingRow
      item={item()}
      site={SITE}
      actionTitle="Log time on this"
      onAction={onAction}
      {...props}
    />,
  );
  return onAction;
}

beforeEach(() => {
  openUrl.mockClear();
});

describe("what the row shows", () => {
  it("shows the issue and its summary", () => {
    renderRow();

    expect(screen.getByRole("button", { name: "ABC-1" })).toBeDefined();
    expect(screen.getByText("Replace the pump")).toBeDefined();
  });

  it("quotes a comment but not a status change", () => {
    // A comment is something the user wrote; a status change is a movement,
    // and quoting "Open → In Progress" would read as speech.
    const { unmount } = render(
      <MissingRow
        item={item({ kind: "comment", detail: "cleaned the filter" })}
        site={SITE}
        actionTitle="x"
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("“cleaned the filter”")).toBeDefined();
    expect(screen.getByText(/commented/)).toBeDefined();
    unmount();

    renderRow({ item: item({ kind: "status", detail: "Open → In Progress" }) });
    expect(screen.getByText("Open → In Progress")).toBeDefined();
    expect(screen.getByText(/status changed/)).toBeDefined();
  });

  it("says how long ago the activity was", () => {
    renderRow();

    expect(screen.getByText(/3h ago/)).toBeDefined();
  });

  it("omits the detail line when there is none", () => {
    const { container } = render(
      <MissingRow
        item={item({ detail: "" })}
        site={SITE}
        actionTitle="x"
        onAction={vi.fn()}
      />,
    );

    expect(container.querySelector(".comment")).toBeNull();
  });
});

describe("the log target", () => {
  it("names the other issue when the time goes somewhere else", () => {
    // An escalation books its time on the issue it was raised for, and the
    // user is about to log — so the tab that logs says where it will land.
    renderRow({
      showLogTarget: true,
      item: item({ logKey: "DEV-9", logSummary: "The source issue" }),
    });

    expect(
      screen.getByText(/→ logs on DEV-9 · The source issue/),
    ).toBeDefined();
  });

  it("stays quiet when the time goes on the flagged issue itself", () => {
    renderRow({ showLogTarget: true });

    expect(screen.queryByText(/→ logs on/)).toBeNull();
  });

  it("stays quiet on the overview, which is a summary", () => {
    renderRow({
      showLogTarget: false,
      item: item({ logKey: "DEV-9", logSummary: "The source issue" }),
    });

    expect(screen.queryByText(/→ logs on/)).toBeNull();
  });
});

describe("the actions", () => {
  it("opens the issue in the browser", async () => {
    renderRow();

    await userEvent.click(screen.getByTitle("Open ABC-1 in browser"));

    expect(openUrl).toHaveBeenCalledWith(`${SITE}/browse/ABC-1`);
  });

  it("runs the surrounding view's action, under its own tooltip", async () => {
    const onAction = renderRow({ actionTitle: "Log time on this" });

    await userEvent.click(screen.getByTitle("Log time on this"));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("offers ignore only where the list is worked", async () => {
    // The start tab's overview is a summary; dismissing belongs on the tab
    // that owns the list.
    renderRow();
    expect(screen.queryByTitle(/Ignore until/)).toBeNull();

    const onIgnore = vi.fn();
    render(
      <MissingRow
        item={item()}
        site={SITE}
        actionTitle="x"
        onAction={vi.fn()}
        onIgnore={onIgnore}
      />,
    );
    await userEvent.click(screen.getByTitle(/Ignore until/));

    expect(onIgnore).toHaveBeenCalledTimes(1);
  });
});

describe("missingRowKey", () => {
  it("covers the activity as well as the issue", () => {
    // The same issue can be flagged again for a later activity, and a key of
    // the issue alone would have React reuse the old row.
    const first = item({ activityAt: "2026-03-15T09:00:00.000Z" });
    const later = item({ activityAt: "2026-03-15T14:00:00.000Z" });

    expect(missingRowKey(first)).not.toBe(missingRowKey(later));
  });
});
