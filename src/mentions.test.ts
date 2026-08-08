import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Mention } from "./api";
import {
  getMentions,
  markMentionsRead,
  refreshMentions,
  unreadMentionIds,
} from "./mentions";

// Desktop notifications reach for a Tauri plugin that does not exist under
// vitest; `notifyNew` runs on every refresh, so it has to be stubbed out.
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => false,
  requestPermission: async () => "denied",
  sendNotification: () => {},
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
function backendReturns(items: Mention[]) {
  mockInvoke.mockImplementation(async (command) =>
    command === "mentions" ? items : undefined,
  );
}

beforeEach(() => {
  mockInvoke.mockReset();
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
