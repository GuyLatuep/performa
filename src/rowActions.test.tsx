/** @vitest-environment happy-dom */
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";
import { AllKeys } from "./test-support/shortcuts";
import { issueSummary } from "./test-support/api";
import { clearSelection, useSelectionScope } from "./selection";
import { boundShortcuts } from "./shortcuts";
import IssueRow from "./components/IssueRow";
import { useRowSelected } from "./selection";

// One key serves two hundred rows because only the selected row binds it, and
// only one row in the whole app is ever selected. That property is what this
// file is about; the individual actions are covered in IssueRow.test.tsx.

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

const ISSUES = [
  issueSummary({ key: "ABC-1", summary: "Replace the pump" }),
  issueSummary({ key: "ABC-2", summary: "Order the seal" }),
  issueSummary({ key: "ABC-3", summary: "Check the seal" }),
];

const SCOPE = "list";

function Row(props: Parameters<typeof IssueRow>[0]) {
  const selected = useRowSelected(SCOPE, props.issue.key);
  return <IssueRow {...props} selected={selected} />;
}

/** A list of three issues, under every key listener. */
function List() {
  useSelectionScope({ id: SCOPE, rows: ISSUES.map((i) => i.key) });
  return (
    <>
      <AllKeys />
      <ul>
        {ISSUES.map((issue) => (
          <Row
            key={issue.key}
            issue={issue}
            site="https://example.atlassian.net"
            pinned={false}
            onSelect={vi.fn()}
          />
        ))}
      </ul>
    </>
  );
}

function press(key: string, mods: Partial<KeyboardEventInit> = {}) {
  return fireEvent.keyDown(document.body, { key, ...mods });
}

beforeEach(() => {
  vi.stubGlobal("navigator", {
    userAgent: "Macintosh; Intel Mac OS X 10_15_7",
  });
  openUrl.mockClear();
  localStorage.clear();
});

afterEach(() => {
  clearSelection();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("a row action", () => {
  it("binds nothing at all until a row is selected", () => {
    render(<List />);

    // Three rows on screen, no keys claimed by any of them.
    expect(boundShortcuts()).toEqual([]);
  });

  it("is bound by exactly one row once there is a selection", () => {
    render(<List />);

    press("ArrowDown");

    // The four an issue row offers: pin, open in Jira, start the timer — and
    // nothing from the other two rows.
    expect(
      boundShortcuts()
        .map((b) => b.id)
        .sort(),
    ).toEqual(["openInJira", "pin", "timer"]);
  });

  it("acts on the selected row, and follows the selection", () => {
    render(<List />);

    press("ArrowDown");
    press("j", { metaKey: true });
    expect(openUrl).toHaveBeenLastCalledWith(
      "https://example.atlassian.net/browse/ABC-1",
    );

    press("ArrowDown");
    press("j", { metaKey: true });
    expect(openUrl).toHaveBeenLastCalledWith(
      "https://example.atlassian.net/browse/ABC-2",
    );
  });

  it("pins the selected issue on ⌘B", () => {
    render(<List />);
    press("ArrowDown");

    press("b", { metaKey: true });

    // The pin store is what the row's star reads, and it persists.
    expect(localStorage.getItem("performa-pinned-issues")).toContain("ABC-1");
  });

  it("lets go of its keys when the selection does", () => {
    render(<List />);
    press("ArrowDown");
    expect(boundShortcuts()).not.toEqual([]);

    act(() => clearSelection());

    expect(boundShortcuts()).toEqual([]);
  });
});
