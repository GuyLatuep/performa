/** @vitest-environment happy-dom */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";

vi.mock("./api", async () => {
  const { apiModule } = await import("./test-support/api");
  return apiModule();
});

import { apiMock, resetApiMock } from "./test-support/api";
import { useIssueType, useIssueTypes } from "./issueTypes";

/** What `key in (…)` answers with. The month's rows only ever need the type
 *  and its icon; the rest is what the search happens to carry. */
const found = (...keys: string[]) => ({
  issues: keys.map((key) => ({
    key,
    summary: `${key} summary`,
    issueType: "Bug",
    issueTypeIcon: `https://jira/${key}.png`,
  })),
  hasMore: false,
});

beforeEach(() => {
  resetApiMock();
});

describe("issue types by key", () => {
  it("looks the missing keys up in one search and serves them", async () => {
    apiMock.viewIssues.mockResolvedValue(found("ABC-1", "ABC-2"));
    const { result } = renderHook(() => {
      useIssueTypes(["ABC-1", "ABC-2"]);
      return useIssueType("ABC-2");
    });

    await waitFor(() => expect(result.current?.name).toBe("Bug"));
    expect(result.current?.iconUrl).toBe("https://jira/ABC-2.png");
    expect(apiMock.viewIssues).toHaveBeenCalledTimes(1);
    expect(apiMock.viewIssues).toHaveBeenCalledWith('key in ("ABC-1","ABC-2")');
  });

  it("asks once for a key, however often it is wanted", async () => {
    apiMock.viewIssues.mockResolvedValue(found("DEF-1"));
    const first = renderHook(() => useIssueTypes(["DEF-1"]));
    await waitFor(() => expect(apiMock.viewIssues).toHaveBeenCalledTimes(1));
    first.rerender();
    renderHook(() => useIssueTypes(["DEF-1"]));

    expect(apiMock.viewIssues).toHaveBeenCalledTimes(1);
  });

  it("does not retry a key the search failed to answer for", async () => {
    apiMock.viewIssues.mockRejectedValue("nope");
    renderHook(() => useIssueTypes(["GHI-1"]));
    await waitFor(() => expect(apiMock.viewIssues).toHaveBeenCalledTimes(1));

    renderHook(() => useIssueTypes(["GHI-1"]));
    expect(apiMock.viewIssues).toHaveBeenCalledTimes(1);
  });

  it("asks for nothing when given no keys", async () => {
    renderHook(() => useIssueTypes([]));

    expect(apiMock.viewIssues).not.toHaveBeenCalled();
  });
});
