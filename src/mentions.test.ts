import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Mention } from "./api";
import {
  getMentions,
  getMentionsTruncated,
  markMentionsRead,
  refreshMentions,
  claimMentionsFor,
  unreadMentionIds,
} from "./mentions";

// Desktop notifications reach for a Tauri plugin that does not exist under
// vitest; `notifyNew` runs on every refresh, so it has to be stubbed out.
// Permission is granted here so the tests below can see what would be sent.
const sendNotification = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => true,
  requestPermission: async () => "granted",
  sendNotification,
}));

const mockInvoke = vi.mocked(invoke);

const mention = (issueKey: string, commentId: string): Mention => ({
  issueKey,
  issueSummary: "An issue",
  commentId,
  author: "A Colleague",
  text: "@Malte can you look at this?",
  createdAt: "2026-08-03T09:00:00+02:00",
});

/** What the backend answers the next time the scan runs. */
function backendReturns(items: Mention[], truncated = false) {
  mockInvoke.mockImplementation(async (command) =>
    command === "mentions"
      ? { mentions: items, truncated, nameSearchSkipped: false }
      : undefined,
  );
}

beforeEach(() => {
  mockInvoke.mockReset();
  sendNotification.mockClear();
  localStorage.clear();
});

describe("refreshMentions", () => {
  it("keeps the previous array when nothing changed", async () => {
    // A fresh array on every poll would re-render the list forever, even
    // though nobody mentioned anything new.
    backendReturns([mention("ABC-1", "10001")]);
    await refreshMentions();
    const first = getMentions();

    backendReturns([mention("ABC-1", "10001")]);
    await refreshMentions();

    expect(getMentions()).toBe(first);
  });

  it("notices a second mention on the same issue", async () => {
    // Same issue, different comment — the id covers both.
    backendReturns([mention("ABC-1", "10001")]);
    await refreshMentions();
    const first = getMentions();

    backendReturns([mention("ABC-1", "10002")]);
    await refreshMentions();

    expect(getMentions()).not.toBe(first);
  });

  it("holds on to the mentions when the check fails", async () => {
    backendReturns([mention("ABC-1", "10001")]);
    await refreshMentions();
    const first = getMentions();

    mockInvoke.mockImplementation(async (command) => {
      if (command === "mentions") throw new Error("Jira returned 503");
      return undefined;
    });
    await refreshMentions();

    expect(getMentions()).toBe(first);
  });
});

describe("read state", () => {
  it("counts everything as unread until the tab is opened", async () => {
    backendReturns([mention("ABC-1", "10001"), mention("ABC-2", "10002")]);
    await refreshMentions();

    expect(unreadMentionIds()).toEqual(new Set(["ABC-1:10001", "ABC-2:10002"]));

    markMentionsRead();
    expect(unreadMentionIds().size).toBe(0);
  });

  it("keeps a mention read across the next check", async () => {
    // The read set survives in localStorage, so a poll that returns the same
    // comment must not make the badge light up again.
    backendReturns([mention("ABC-1", "10001")]);
    await refreshMentions();
    markMentionsRead();

    backendReturns([mention("ABC-1", "10001"), mention("ABC-2", "10002")]);
    await refreshMentions();

    expect(unreadMentionIds()).toEqual(new Set(["ABC-2:10002"]));
  });
});

describe("notifications", () => {
  it("stays quiet about the backlog the first scan turns up", async () => {
    // A fresh install finds a fortnight of mentions at once. Every one of them
    // already arrived by mail; announcing them now would be pure noise.
    backendReturns([mention("ABC-1", "10001"), mention("ABC-2", "10002")]);
    await refreshMentions();

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("announces a mention that arrives after the first scan", async () => {
    backendReturns([mention("ABC-1", "10001")]);
    await refreshMentions();

    backendReturns([mention("ABC-1", "10001"), mention("ABC-2", "10002")]);
    await refreshMentions();

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("ABC-2") }),
    );
  });

  it("treats an empty first scan as having looked", async () => {
    // Nothing found is still a completed scan, so the next mention is new.
    backendReturns([]);
    await refreshMentions();

    backendReturns([mention("ABC-1", "10001")]);
    await refreshMentions();

    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("stays quiet about a mention that only dropped out for a scan", async () => {
    // The candidate search is bounded, so an issue can fall out of one scan
    // and be back in the next. That is not a new mention.
    backendReturns([mention("ABC-1", "10001")]);
    await refreshMentions();

    backendReturns([]);
    await refreshMentions();

    backendReturns([mention("ABC-1", "10001")]);
    await refreshMentions();

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("announces a mention once even when two scans overlap", async () => {
    backendReturns([]);
    await refreshMentions();

    backendReturns([mention("ABC-1", "10001")]);
    await Promise.all([refreshMentions("poll"), refreshMentions("manual")]);

    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("does not treat a failed first check as having looked", async () => {
    // The scan never completed, so the mentions it would have found are still
    // backlog rather than news.
    mockInvoke.mockImplementation(async (command) => {
      if (command === "mentions") throw new Error("Jira returned 503");
      return undefined;
    });
    await refreshMentions();

    backendReturns([mention("ABC-1", "10001")]);
    await refreshMentions();

    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("incomplete scans", () => {
  it("reports a scan that ran out of issues to look at", async () => {
    backendReturns([mention("ABC-1", "10001")], true);
    await refreshMentions();

    expect(getMentionsTruncated()).toBe(true);
  });

  it("clears the flag once a scan gets through everything", async () => {
    backendReturns([mention("ABC-1", "10001")], true);
    await refreshMentions();

    backendReturns([mention("ABC-1", "10001")], false);
    await refreshMentions();

    expect(getMentionsTruncated()).toBe(false);
  });

  it("keeps the warning up when the next check fails", async () => {
    // The list on screen is still the truncated one, so the caveat about it
    // has to stay with it.
    backendReturns([mention("ABC-1", "10001")], true);
    await refreshMentions();

    mockInvoke.mockImplementation(async (command) => {
      if (command === "mentions") throw new Error("Jira returned 503");
      return undefined;
    });
    await refreshMentions();

    expect(getMentionsTruncated()).toBe(true);
  });
});

describe("switching accounts", () => {
  it("starts over when somebody else signs in", async () => {
    backendReturns([mention("ABC-1", "10001")]);
    claimMentionsFor("acme.atlassian.net|first@example.com");
    await refreshMentions();
    markMentionsRead();

    // A second account's fortnight of mentions is not news the first
    // account's notified set can vouch for, nor is it already read.
    claimMentionsFor("acme.atlassian.net|second@example.com");
    await refreshMentions();

    expect(sendNotification).not.toHaveBeenCalled();
    expect(unreadMentionIds()).toEqual(new Set(["ABC-1:10001"]));
  });

  it("keeps the state when the same account signs back in", async () => {
    backendReturns([mention("ABC-1", "10001")]);
    claimMentionsFor("acme.atlassian.net|first@example.com");
    await refreshMentions();
    markMentionsRead();

    claimMentionsFor("acme.atlassian.net|first@example.com");
    await refreshMentions();

    expect(unreadMentionIds()).toEqual(new Set());
  });
});
