/** @vitest-environment happy-dom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";

vi.mock("./api", async () => {
  const { apiModule } = await import("./test-support/api");
  return apiModule();
});

// Both inbox stores own a poller, which has no business being awake here.
const missing = vi.hoisted(() => ({
  refreshMissing: vi.fn(async () => {}),
  startMissingPolling: vi.fn(),
  stopMissingPolling: vi.fn(),
}));
vi.mock("./missing", () => ({ ...missing, useMissingUnseenCount: () => 0 }));
vi.mock("./mentions", () => ({
  startMentionsPolling: vi.fn(),
  stopMentionsPolling: vi.fn(),
  useMentionsUnreadCount: () => 0,
}));
vi.mock("./savedSearches", () => ({ claimSearchesFor: vi.fn() }));
const rebuild = vi.hoisted(() => ({ forgetDayActivity: vi.fn() }));
vi.mock("./rebuild", () => rebuild);

import type { CredentialsMeta, WorklogInput } from "./api";
import { useAccountWatchers } from "./accountWatchers";
import { reportWorklogFiled } from "./worklogEvents";

const CREDS: CredentialsMeta = {
  site: "https://example.atlassian.net",
  email: "anna@example.com",
};

const WORKLOG: WorklogInput = {
  timeSpentSeconds: 3600,
  date: "2026-03-16",
  time: "09:00",
  comment: "",
  billable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a filed worklog", () => {
  it("rechecks the missing worklogs while signed in", () => {
    renderHook(() => useAccountWatchers(CREDS));

    reportWorklogFiled(WORKLOG);

    expect(missing.refreshMissing).toHaveBeenCalledWith("post-log");
  });

  it("rechecks nothing once signed out", () => {
    const { rerender } = renderHook(
      ({ creds }: { creds: CredentialsMeta | null }) =>
        useAccountWatchers(creds),
      { initialProps: { creds: CREDS as CredentialsMeta | null } },
    );
    rerender({ creds: null });

    reportWorklogFiled(WORKLOG);

    expect(missing.stopMissingPolling).toHaveBeenCalled();
    expect(missing.refreshMissing).not.toHaveBeenCalled();
  });
});

describe("the rebuilt days", () => {
  it("are forgotten when somebody else signs in", () => {
    const { rerender } = renderHook(
      ({ creds }: { creds: CredentialsMeta | null }) =>
        useAccountWatchers(creds),
      { initialProps: { creds: CREDS as CredentialsMeta | null } },
    );
    rebuild.forgetDayActivity.mockClear();

    rerender({ creds: { ...CREDS, email: "ben@example.com" } });

    expect(rebuild.forgetDayActivity).toHaveBeenCalled();
  });

  it("are kept while the same account stays signed in", () => {
    const { rerender } = renderHook(
      ({ creds }: { creds: CredentialsMeta | null }) =>
        useAccountWatchers(creds),
      { initialProps: { creds: CREDS as CredentialsMeta | null } },
    );
    rebuild.forgetDayActivity.mockClear();

    rerender({ creds: { ...CREDS } });

    expect(rebuild.forgetDayActivity).not.toHaveBeenCalled();
  });
});
