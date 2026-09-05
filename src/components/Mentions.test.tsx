/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import type { Mention } from "../api";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

// Mocked wholesale: the store owns a 3-minute poller, and this file is about
// the tab rather than the scan behind it.
const store = vi.hoisted(() => ({
  items: [] as Mention[],
  error: null as string | null,
  lastChecked: null as string | null,
  truncated: false,
  nameSearchSkipped: false,
  unread: new Set<string>(),
  refreshMentions: vi.fn(async () => {}),
  markMentionsRead: vi.fn(),
}));
vi.mock("../mentions", () => ({
  useMentions: () => store.items,
  useMentionsError: () => store.error,
  useMentionsLastChecked: () => store.lastChecked,
  useMentionsTruncated: () => store.truncated,
  useMentionsNameSearchSkipped: () => store.nameSearchSkipped,
  unreadMentionIds: () => store.unread,
  markMentionsRead: store.markMentionsRead,
  refreshMentions: store.refreshMentions,
  mentionId: (m: Mention) => `${m.issueKey}-${m.commentId}`,
}));

const recordEvent = vi.hoisted(() => vi.fn(() => [] as string[]));
vi.mock("../achievements", () => ({ recordEvent }));

const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

vi.mock("./IssueView", () => ({
  default: ({
    issue,
    onBack,
  }: {
    issue: { key: string };
    onBack: () => void;
  }) => (
    <div>
      <p>viewing {issue.key}</p>
      <button onClick={onBack}>back</button>
    </div>
  ),
}));

import { resetApiMock } from "../test-support/api";
import Mentions from "./Mentions";

function mention(o: Partial<Mention> = {}): Mention {
  return {
    issueKey: "ABC-1",
    issueSummary: "Replace the pump",
    commentId: "c1",
    author: "Anna Leeson",
    text: "can you look at this?",
    createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    ...o,
  };
}

function renderTab() {
  const onLogged = vi.fn();
  render(<Mentions site="https://example.atlassian.net" onLogged={onLogged} />);
  return onLogged;
}

beforeEach(() => {
  resetApiMock();
  store.items = [];
  store.error = null;
  store.lastChecked = "09:30";
  store.truncated = false;
  store.nameSearchSkipped = false;
  store.unread = new Set();
  store.refreshMentions.mockClear();
  store.markMentionsRead.mockClear();
  recordEvent.mockClear();
  recordEvent.mockReturnValue([]);
  openUrl.mockClear();
});

describe("what the tab shows", () => {
  it("says it is still checking before the first scan", () => {
    store.lastChecked = null;

    renderTab();

    expect(screen.getByText("Checking…")).toBeDefined();
  });

  it("says the inbox is empty once a scan found nothing", () => {
    renderTab();

    expect(
      screen.getByText("No mentions found in the last 14 days."),
    ).toBeDefined();
  });

  it("reports a failed scan instead of an empty inbox", () => {
    store.error = "Jira returned 503";

    renderTab();

    expect(screen.getByText(/Jira returned 503/)).toBeDefined();
    expect(screen.queryByText(/No mentions found/)).toBeNull();
  });

  it("shows who wrote what", () => {
    store.items = [mention()];

    renderTab();

    expect(
      screen.getByText(/Anna Leeson: “can you look at this\?”/),
    ).toBeDefined();
    expect(screen.getByText("Replace the pump")).toBeDefined();
    expect(screen.getByText(/3h ago/)).toBeDefined();
  });

  it("stands in for a mention whose text could not be read", () => {
    store.items = [mention({ text: "" })];

    renderTab();

    expect(screen.getByText(/Anna Leeson: mentioned you/)).toBeDefined();
  });
});

describe("the blind spots it admits to", () => {
  // "Nothing found" must not read as "nothing exists" when the scan knows it
  // did not look everywhere.
  it("says when the display-name search could not run", () => {
    store.nameSearchSkipped = true;

    renderTab();

    expect(screen.getByText(/has no display name/)).toBeDefined();
  });

  it("says when there were more issues than it could open", () => {
    store.truncated = true;

    renderTab();

    expect(screen.getByText(/more than it could open/)).toBeDefined();
  });

  it("says neither when the scan was complete", () => {
    renderTab();

    expect(screen.queryByText(/has no display name/)).toBeNull();
    expect(screen.queryByText(/more than it could open/)).toBeNull();
  });

  it("keeps quiet about them while the scan itself failed", () => {
    store.error = "Jira returned 503";
    store.truncated = true;

    renderTab();

    expect(screen.queryByText(/more than it could open/)).toBeNull();
  });
});

describe("unread highlighting", () => {
  it("marks the ones that were new on arrival, then acknowledges them", () => {
    // Captured before the acknowledgement, or the highlighting would clear in
    // the same render that drew it.
    store.items = [mention()];
    store.unread = new Set(["ABC-1-c1"]);

    renderTab();

    expect(document.querySelector(".mention-row.unread")).not.toBeNull();
    expect(document.querySelector(".unread-dot")).not.toBeNull();
    expect(store.markMentionsRead).toHaveBeenCalled();
  });

  it("leaves an already-read mention unmarked", () => {
    store.items = [mention()];

    renderTab();

    expect(document.querySelector(".mention-row.unread")).toBeNull();
  });
});

describe("the achievement", () => {
  it("is recorded for an inbox a real scan found empty", () => {
    renderTab();

    expect(recordEvent).toHaveBeenCalledWith({ kind: "mentionsEmpty" });
  });

  it("is not recorded before the first scan", () => {
    store.lastChecked = null;

    renderTab();

    expect(recordEvent).not.toHaveBeenCalled();
  });
});

describe("acting on a mention", () => {
  beforeEach(() => {
    store.items = [mention()];
  });

  it("opens the issue in the app, since the point is to go and look", async () => {
    renderTab();

    await userEvent.click(screen.getByText("Replace the pump"));

    expect(screen.getByText("viewing ABC-1")).toBeDefined();
  });

  it("keeps the key as the way out to Jira", async () => {
    renderTab();

    await userEvent.click(screen.getByTitle("Open ABC-1 in browser"));

    expect(openUrl).toHaveBeenCalledWith(
      "https://example.atlassian.net/browse/ABC-1",
    );
    expect(screen.queryByText("viewing ABC-1")).toBeNull();
  });

  it("re-scans on the way back, since the mention may be answered", async () => {
    renderTab();
    await userEvent.click(screen.getByText("Replace the pump"));

    await userEvent.click(screen.getByRole("button", { name: "back" }));

    expect(store.refreshMentions).toHaveBeenCalledWith("manual");
  });
});

describe("checking now", () => {
  it("runs a scan and says it is busy", async () => {
    let finish = () => {};
    store.refreshMentions.mockImplementation(
      () => new Promise<void>((r) => (finish = r)),
    );
    renderTab();

    await userEvent.click(screen.getByRole("button", { name: "Check now" }));

    expect(store.refreshMentions).toHaveBeenCalledWith("manual");
    expect(screen.getByRole("button", { name: "Checking…" })).toHaveProperty(
      "disabled",
      true,
    );
    finish();
  });
});
