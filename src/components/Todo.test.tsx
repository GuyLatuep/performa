/** @vitest-environment happy-dom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

const konami = vi.hoisted(() => ({
  useKonamiCode: vi.fn<(onEntered: () => void, active: boolean) => void>(),
}));
vi.mock("../konami", () => konami);

// Both are covered by their own files; here they only need to be identifiable.
vi.mock("./IssueRow", () => ({
  default: ({
    issue,
    selected,
    onSelect,
  }: {
    issue: { key: string };
    selected?: boolean;
    onSelect: (i: unknown) => void;
  }) => (
    // `aria-current` is what the real row marks the selection with, so the
    // assertions here read the same attribute the app does.
    <li aria-current={selected ? "true" : undefined}>
      <button onClick={() => onSelect(issue)}>{issue.key}</button>
    </li>
  ),
}));
// The way back *in* outlives the view that offered it — it is what a forward
// gesture calls once the view is gone — so it is caught here rather than left
// on a button that unmounts with it.
const wayForward = vi.hoisted(() => ({
  run: undefined as (() => void) | undefined,
}));
vi.mock("./IssueView", () => ({
  default: ({
    issue,
    onBack,
    onForward,
  }: {
    issue: { key: string };
    onBack: () => void;
    onForward?: () => void;
  }) => {
    wayForward.run = onForward;
    return (
      <div>
        <p>viewing {issue.key}</p>
        <button onClick={onBack}>back</button>
      </div>
    );
  },
}));

import { setFunMode, setShowIssueTypeIcons } from "../settings";
import { apiMock, issueSummary, resetApiMock } from "../test-support/api";
import { setTodoSort } from "../todoSort";
import { setIgnoredStatuses } from "../todoStatuses";
import { AllKeys } from "../test-support/shortcuts";
import Todo from "./Todo";

const ISSUES = [
  issueSummary({ key: "ABC-2", summary: "Order the seal", priority: "Low" }),
  issueSummary({ key: "ABC-1", summary: "Replace the pump", priority: "High" }),
];

function renderTodo() {
  const onLogged = vi.fn();
  render(
    <>
      {/* The app mounts its key listeners once, in `App`; a screen on its own
          has to bring them, or its keys go into registries nobody listens
          over. */}
      <AllKeys />
      <Todo site="https://example.atlassian.net" onLogged={onLogged} />
    </>,
  );
  return onLogged;
}

beforeEach(() => {
  vi.stubGlobal("navigator", {
    userAgent: "Macintosh; Intel Mac OS X 10_15_7",
  });
  resetApiMock();
  localStorage.clear();
  // Module-level stores outlive a test.
  setTodoSort(null);
  setIgnoredStatuses({});
  setFunMode(false);
  setShowIssueTypeIcons(true);
  konami.useKonamiCode.mockReset();
});

describe("loading the list", () => {
  it("says so while the issues are on their way", () => {
    apiMock.todoIssues.mockReturnValue(new Promise(() => {}));

    renderTodo();

    expect(screen.getByText("Loading…")).toBeDefined();
  });

  it("lists what came back, with a count", async () => {
    apiMock.todoIssues.mockResolvedValue(ISSUES);

    renderTodo();

    expect(await screen.findByRole("button", { name: "ABC-2" })).toBeDefined();
    expect(screen.getByText(/Waiting on me · 2/)).toBeDefined();
  });

  it("says when there is nothing waiting", async () => {
    renderTodo();

    expect(await screen.findByText("Nothing waiting on you.")).toBeDefined();
  });

  it("reports a failed read", async () => {
    apiMock.todoIssues.mockRejectedValue(new Error("Jira returned 500"));

    renderTodo();

    expect(await screen.findByText(/Jira returned 500/)).toBeDefined();
    expect(screen.queryByText("Nothing waiting on you.")).toBeNull();
  });

  it("re-reads when the ignored statuses change", async () => {
    apiMock.todoIssues.mockResolvedValue(ISSUES);
    renderTodo();
    await screen.findByRole("button", { name: "ABC-2" });

    setIgnoredStatuses({ ABC: ["In Review"] });

    await waitFor(() => expect(apiMock.todoIssues).toHaveBeenCalledTimes(2));
    expect(apiMock.todoIssues).toHaveBeenLastCalledWith({ ABC: ["In Review"] });
  });
});

describe("refreshing", () => {
  it("drops the read cache first, since the change was made in Jira", async () => {
    // The 60s read cache would otherwise hide a status the user just changed
    // in the browser.
    apiMock.todoIssues.mockResolvedValue(ISSUES);
    renderTodo();
    await screen.findByRole("button", { name: "ABC-2" });

    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(apiMock.invalidateCachedReads).toHaveBeenCalled();
    await waitFor(() => expect(apiMock.todoIssues).toHaveBeenCalledTimes(2));
  });

  it("cannot be clicked while a read is in flight", () => {
    apiMock.todoIssues.mockReturnValue(new Promise(() => {}));

    renderTodo();

    expect(screen.getByRole("button", { name: "Refresh" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("sorting", () => {
  beforeEach(() => apiMock.todoIssues.mockResolvedValue(ISSUES));

  it("keeps Jira's own order until a column is picked", async () => {
    renderTodo();

    const keys = (await screen.findAllByRole("button", { name: /^ABC-/ })).map(
      (b) => b.textContent,
    );
    expect(keys).toEqual(["ABC-2", "ABC-1"]);
  });

  it("reorders the list when a column header is clicked", async () => {
    renderTodo();
    await screen.findByRole("button", { name: "ABC-2" });

    await userEvent.click(screen.getByTitle("Sort by issue key"));

    const keys = screen
      .getAllByRole("button", { name: /^ABC-/ })
      .map((b) => b.textContent);
    expect(keys).toEqual(["ABC-1", "ABC-2"]);
  });

  it("reverses on a second click and marks the direction", async () => {
    renderTodo();
    await screen.findByRole("button", { name: "ABC-2" });
    // The accessible name is the visible text ("Issue"); the tooltip is what
    // says which way it is sorted, so query by that.
    const header = () => screen.getByTitle(/issue key/);

    // The direction is an icon now; lucide stamps its name onto the svg class.
    const arrow = () => header().querySelector("svg")?.getAttribute("class");

    await userEvent.click(header());
    expect(arrow()).toContain("chevron-up");

    await userEvent.click(header());
    expect(arrow()).toContain("chevron-down");
  });

  it("offers a way back to Jira's order only once sorted", async () => {
    renderTodo();
    await screen.findByRole("button", { name: "ABC-2" });
    expect(
      screen.queryByRole("button", { name: "Restore default" }),
    ).toBeNull();

    await userEvent.click(screen.getByTitle("Sort by issue key"));

    await userEvent.click(
      screen.getByRole("button", { name: "Restore default" }),
    );

    const keys = screen
      .getAllByRole("button", { name: /^ABC-/ })
      .map((b) => b.textContent);
    expect(keys).toEqual(["ABC-2", "ABC-1"]);
  });

  it("drops the type column with its header when icons are off", async () => {
    setShowIssueTypeIcons(false);

    renderTodo();
    await screen.findByRole("button", { name: "ABC-2" });

    expect(screen.queryByTitle(/issue type/)).toBeNull();
  });
});

describe("walking the list with the arrow keys", () => {
  /** The row the keyboard is on, by its key. */
  function selected() {
    const row = document.querySelector('li[aria-current="true"]');
    return row?.textContent ?? null;
  }

  function arrow(key: "ArrowDown" | "ArrowUp") {
    fireEvent.keyDown(document.body, { key });
  }

  it("starts on the first row", async () => {
    apiMock.todoIssues.mockResolvedValue(ISSUES);
    renderTodo();
    await screen.findByRole("button", { name: "ABC-1" });

    await act(async () => arrow("ArrowDown"));

    // The fixture arrives as [ABC-2, ABC-1] and an unsorted list keeps Jira's
    // order, so the first row is ABC-2.
    expect(selected()).toBe("ABC-2");
  });

  it("walks down the list and back up", async () => {
    apiMock.todoIssues.mockResolvedValue(ISSUES);
    renderTodo();
    await screen.findByRole("button", { name: "ABC-1" });

    await act(async () => arrow("ArrowDown"));
    await act(async () => arrow("ArrowDown"));
    expect(selected()).toBe("ABC-1");

    await act(async () => arrow("ArrowUp"));
    expect(selected()).toBe("ABC-2");
  });

  it("opens the selected issue on Enter", async () => {
    apiMock.todoIssues.mockResolvedValue(ISSUES);
    renderTodo();
    await screen.findByRole("button", { name: "ABC-1" });
    await act(async () => arrow("ArrowDown"));

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Enter" });
    });

    expect(screen.getByText("viewing ABC-2")).toBeDefined();
  });

  it("walks the order on screen, not the order Jira sent", async () => {
    // The scope reads the *sorted* list. Reading the unsorted one would have ↓
    // land somewhere other than the row below.
    apiMock.todoIssues.mockResolvedValue(ISSUES);
    renderTodo();
    await screen.findByRole("button", { name: "ABC-1" });
    // Sort by key descending, so the first row is no longer ABC-1.
    await userEvent.click(screen.getByRole("button", { name: /Issue/ }));
    await userEvent.click(screen.getByRole("button", { name: /Issue/ }));

    await act(async () => arrow("ArrowDown"));

    const first = document.querySelector("li:not(.todo-columns) button");
    expect(selected()).toBe(first?.textContent);
  });

  it("stays on the same issue when the list is re-sorted under it", async () => {
    // The whole reason rows are identified rather than counted.
    apiMock.todoIssues.mockResolvedValue(ISSUES);
    renderTodo();
    await screen.findByRole("button", { name: "ABC-1" });
    await act(async () => arrow("ArrowDown"));
    const held = selected();

    await userEvent.click(screen.getByRole("button", { name: /Issue/ }));

    expect(selected()).toBe(held);
  });
});

describe("the refresh shortcut", () => {
  it("re-reads the list on ⌘R, the same as the button", async () => {
    apiMock.todoIssues.mockResolvedValue(ISSUES);
    renderTodo();
    await screen.findByRole("button", { name: "ABC-1" });

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "r", metaKey: true });
    });

    expect(apiMock.invalidateCachedReads).toHaveBeenCalled();
    await waitFor(() => expect(apiMock.todoIssues).toHaveBeenCalledTimes(2));
  });

  it("is not offered while the list is still loading", async () => {
    // The button is disabled then, and the key goes with it rather than queueing
    // a second read behind the first.
    renderTodo();

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "r", metaKey: true });
    });

    expect(apiMock.invalidateCachedReads).not.toHaveBeenCalled();
  });
});

describe("opening an issue", () => {
  it("replaces the list with the issue view", async () => {
    apiMock.todoIssues.mockResolvedValue(ISSUES);
    renderTodo();

    await userEvent.click(await screen.findByRole("button", { name: "ABC-1" }));

    expect(screen.getByText("viewing ABC-1")).toBeDefined();
    expect(screen.queryByText(/Waiting on me/)).toBeNull();
  });

  it("re-reads on the way back, since the issue may have moved", async () => {
    // The list stayed mounted behind the view and would otherwise still show
    // the status the issue had on the way in.
    apiMock.todoIssues.mockResolvedValue(ISSUES);
    renderTodo();
    await userEvent.click(await screen.findByRole("button", { name: "ABC-1" }));

    await userEvent.click(screen.getByRole("button", { name: "back" }));

    expect(apiMock.invalidateCachedReads).toHaveBeenCalled();
    await waitFor(() => expect(apiMock.todoIssues).toHaveBeenCalledTimes(2));
  });

  it("offers the way back in, for a forward gesture", async () => {
    apiMock.todoIssues.mockResolvedValue(ISSUES);
    renderTodo();
    await userEvent.click(await screen.findByRole("button", { name: "ABC-1" }));
    await userEvent.click(screen.getByRole("button", { name: "back" }));
    expect(screen.queryByText("viewing ABC-1")).toBeNull();

    await act(async () => wayForward.run?.());

    expect(screen.getByText("viewing ABC-1")).toBeDefined();
  });
});

describe("the easter egg", () => {
  it("is armed only on the list, and only in fun mode", async () => {
    apiMock.todoIssues.mockResolvedValue(ISSUES);
    setFunMode(true);
    renderTodo();
    await screen.findByRole("button", { name: "ABC-1" });

    expect(konami.useKonamiCode).toHaveBeenLastCalledWith(
      expect.any(Function),
      true,
    );

    // Not while an issue is open: the arrows belong to whatever is read there.
    await userEvent.click(screen.getByRole("button", { name: "ABC-1" }));
    expect(konami.useKonamiCode).toHaveBeenLastCalledWith(
      expect.any(Function),
      false,
    );
  });

  it("is disarmed with fun mode off", async () => {
    apiMock.todoIssues.mockResolvedValue(ISSUES);

    renderTodo();
    await screen.findByRole("button", { name: "ABC-1" });

    expect(konami.useKonamiCode).toHaveBeenLastCalledWith(
      expect.any(Function),
      false,
    );
  });

  it("can always be clicked away again", async () => {
    // An easter egg with no way out of it is a bug wearing a costume.
    apiMock.todoIssues.mockResolvedValue(ISSUES);
    setFunMode(true);
    let enter = () => {};
    konami.useKonamiCode.mockImplementation((onEntered) => {
      enter = onEntered;
    });
    renderTodo();
    await screen.findByRole("button", { name: "ABC-1" });

    await userEvent.click(document.body); // flush
    enter();

    const egg = await screen.findByRole("button", { name: /alle Tickets/ });
    await userEvent.click(egg);

    expect(await screen.findByText(/Waiting on me/)).toBeDefined();
  });
});
