/** @vitest-environment happy-dom */
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

/** How many times a row body actually ran. Counted by wrapping the real
 *  component in the same `memo` it ships with, so what is measured is the
 *  guard the component claims rather than a stand-in for it. */
const renders = vi.hoisted(() => ({ n: 0 }));
vi.mock("./IssueRow", async () => {
  const actual =
    await vi.importActual<typeof import("./IssueRow")>("./IssueRow");
  const { memo } = await import("react");
  const Real = actual.default;
  return {
    ...actual,
    default: memo(function Counted(props: Parameters<typeof Real>[0]) {
      renders.n += 1;
      return <Real {...props} />;
    }),
  };
});

// Deliberately *not* mocking `../pins`, unlike the main SearchResults suite:
// the point is that a real store change reaches the real rows.
import { apiMock, issueSummary, resetApiMock } from "../test-support/api";
import { togglePin } from "../pins";
import { clearIssueRequest } from "../issueRequest";
import SearchResults from "./SearchResults";

/**
 * `IssueRow` is memoised because a list is a hundred of them and three Lucide
 * icons apiece is the bulk of a row's render cost. That guard holds only while
 * every prop is stable, and a callback written inline at the call site is not.
 *
 * This is a measurement rather than a style rule. With `onSelect={(i) =>
 * open(i.key)}` the figure below was one wasted render per row on every pin —
 * thirty rows, thirty renders, not one of whose own props had changed. The Todo
 * tab, which passes the same callback by reference, scored zero throughout.
 */
describe("the memoised rows", () => {
  beforeEach(() => {
    resetApiMock();
    renders.n = 0;
    localStorage.clear();
    clearIssueRequest();
  });

  it("do not re-render when an issue outside the results is pinned", async () => {
    apiMock.searchText.mockResolvedValue({
      issues: Array.from({ length: 30 }, (_, i) =>
        issueSummary({ key: `ABC-${i}` }),
      ),
      hasMore: false,
    });

    render(
      <SearchResults
        search={{ kind: "text", term: "pump" }}
        site="https://example.atlassian.net"
        backLabel="Todo"
      />,
    );
    await act(async () => {});
    const afterMount = renders.n;

    await act(async () => {
      togglePin({ key: "ZZZ-9", summary: "not in these results" });
    });

    expect(afterMount).toBe(30);
    expect(renders.n - afterMount).toBe(0);
  });
});
