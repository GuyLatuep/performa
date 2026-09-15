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
import type { LinkedItem } from "../api";
import { backTarget, clearForward, goBack, goForward } from "../back";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("../achievements", () => ({ recordEvent: vi.fn(() => []) }));

// The four heavy children have their own concerns (and their own tests); here
// they are markers, so this file is about the view that arranges them.
vi.mock("./IssueFacts", () => ({
  default: ({ issueKey }: { issueKey: string }) => <p>facts for {issueKey}</p>,
}));
vi.mock("./IssueAttachments", () => ({
  default: ({ issueKey }: { issueKey: string }) => <p>files for {issueKey}</p>,
}));
vi.mock("./IssueLinks", () => ({
  default: ({
    issueKey,
    onOpen,
  }: {
    issueKey: string;
    onOpen: (item: LinkedItem) => void;
  }) => (
    <div>
      <p>links for {issueKey}</p>
      <button
        onClick={() =>
          onOpen({
            id: "l1",
            relation: "blocks",
            key: "ABC-2",
            summary: "Order the seal",
          })
        }
      >
        follow to ABC-2
      </button>
    </div>
  ),
}));
vi.mock("./IssueActions", () => ({
  default: ({ issueKey }: { issueKey: string }) => (
    <p>actions for {issueKey}</p>
  ),
}));

import {
  apiMock,
  fieldMeta,
  issueDetail,
  issueSummary,
  resetApiMock,
  transition,
} from "../test-support/api";
import { ShortcutKeys } from "../test-support/shortcuts";
import IssueView from "./IssueView";

const ISSUE = issueSummary({ key: "ABC-1", summary: "Replace the pump" });

// The redo stack is module-level and deliberately outlives its screens.
beforeEach(clearForward);

function renderView(props: Partial<Parameters<typeof IssueView>[0]> = {}) {
  const handlers = { onBack: vi.fn() };
  render(
    <>
      {/* The app mounts the dispatcher once, in `App`. */}
      <ShortcutKeys />
      <IssueView
        issue={ISSUE}
        site="https://example.atlassian.net"
        backLabel="Todo"
        {...handlers}
        {...props}
      />
    </>,
  );
  return handlers;
}

/** Press a chord at the body, so it bubbles to the window listener. */
function chord(key: string, mods: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(document.body, { key, metaKey: true, ...mods });
}

beforeEach(() => {
  resetApiMock();
  vi.stubGlobal("navigator", {
    userAgent: "Macintosh; Intel Mac OS X 10_15_7",
  });
});

describe("opening an issue", () => {
  it("reads the detail, the timeline and the workflow", async () => {
    renderView();

    await waitFor(() => {
      // The field list is the user's configured one, which ships with
      // defaults — what matters here is that all three reads went out.
      expect(apiMock.issueDetail).toHaveBeenCalledWith(
        "ABC-1",
        expect.any(Array),
      );
      expect(apiMock.issueActivity).toHaveBeenCalledWith("ABC-1");
      expect(apiMock.issueTransitions).toHaveBeenCalledWith("ABC-1");
    });
  });

  it("shows the caller's summary until the detail lands", () => {
    apiMock.issueDetail.mockReturnValue(new Promise(() => {}));

    renderView();

    expect(screen.getByText("Replace the pump")).toBeDefined();
    // The timeline says it too, so there is more than one.
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  });

  it("shows the issue once it arrives", async () => {
    apiMock.issueDetail.mockResolvedValue(
      issueDetail({ summary: "Replace the pump seal", status: "In Progress" }),
    );

    renderView();

    expect(await screen.findByText("Replace the pump seal")).toBeDefined();
    expect(screen.getByText("facts for ABC-1")).toBeDefined();
  });

  it("reports a failed detail read", async () => {
    apiMock.issueDetail.mockRejectedValue(new Error("Jira returned 404"));

    renderView();

    expect(await screen.findByText(/Jira returned 404/)).toBeDefined();
  });

  it("keeps the issue readable when only the workflow could not be read", async () => {
    // Losing the status picker is not losing the issue.
    apiMock.issueTransitions.mockRejectedValue(new Error("Jira returned 403"));

    renderView();

    expect(await screen.findByText("facts for ABC-1")).toBeDefined();
    expect(screen.getByText("workflow unavailable")).toBeDefined();
  });
});

describe("the way out", () => {
  it("returns to the tab it was opened from", async () => {
    const { onBack } = renderView({ backLabel: "Todo" });

    await userEvent.click(screen.getByRole("button", { name: /Back to Todo/ }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("is the same way out the back gesture takes", async () => {
    // The mouse's back button calls what the registered target says, and the
    // corner button calls the same function — so they cannot come to mean
    // different things.
    const { onBack } = renderView({ backLabel: "Todo" });
    await screen.findByRole("button", { name: /Back to Todo/ });

    await act(async () => {
      goBack();
    });

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("names where it leads, so the gesture and the button agree", async () => {
    renderView({ backLabel: "Mentions" });
    await screen.findByRole("button", { name: /Back to Mentions/ });

    expect(backTarget()?.label).toBe("Mentions");
  });

  it("opens the issue in Jira", async () => {
    renderView();

    await userEvent.click(screen.getByTitle("Open ABC-1 in browser"));

    expect(openUrl).toHaveBeenCalledWith(
      "https://example.atlassian.net/browse/ABC-1",
    );
  });
});

describe("following a link", () => {
  it("reads the other issue in the same view", async () => {
    renderView();
    await screen.findByText("links for ABC-1");

    await userEvent.click(
      screen.getByRole("button", { name: "follow to ABC-2" }),
    );

    expect(await screen.findByText("facts for ABC-2")).toBeDefined();
    await waitFor(() =>
      expect(apiMock.issueDetail).toHaveBeenCalledWith(
        "ABC-2",
        expect.any(Array),
      ),
    );
  });

  it("offers the way back to where the detour started", async () => {
    // A trail rather than a swap: following a link is a detour.
    renderView({ backLabel: "Todo" });
    await screen.findByText("links for ABC-1");

    await userEvent.click(
      screen.getByRole("button", { name: "follow to ABC-2" }),
    );

    expect(
      await screen.findByRole("button", { name: /Back to ABC-1/ }),
    ).toBeDefined();
  });

  it("makes the gesture step up the trail too", async () => {
    const { onBack } = renderView();
    await screen.findByText("links for ABC-1");
    await userEvent.click(
      screen.getByRole("button", { name: "follow to ABC-2" }),
    );
    await screen.findByRole("button", { name: /Back to ABC-1/ });

    await act(async () => {
      goBack();
    });

    expect(await screen.findByText("facts for ABC-1")).toBeDefined();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("comes forward down the trail again", async () => {
    // Backing out of a detour and changing your mind is the one thing forward
    // is for; the hop it re-enters has to be the one that was just left.
    renderView();
    await screen.findByText("links for ABC-1");
    await userEvent.click(
      screen.getByRole("button", { name: "follow to ABC-2" }),
    );
    await screen.findByRole("button", { name: /Back to ABC-1/ });
    await act(async () => {
      goBack();
    });
    await screen.findByText("facts for ABC-1");

    await act(async () => {
      goForward();
    });

    expect(await screen.findByText("facts for ABC-2")).toBeDefined();
  });

  it("drops the way forward when a new detour is taken instead", async () => {
    // ABC-2 is not on the way forward from a trail that went somewhere else.
    renderView();
    await screen.findByText("links for ABC-1");
    await userEvent.click(
      screen.getByRole("button", { name: "follow to ABC-2" }),
    );
    await screen.findByRole("button", { name: /Back to ABC-1/ });
    await act(async () => {
      goBack();
    });
    await screen.findByText("links for ABC-1");

    await userEvent.click(
      screen.getByRole("button", { name: "follow to ABC-2" }),
    );

    expect(goForward()).toBe(false);
  });

  it("steps back up the trail rather than leaving the view", async () => {
    const { onBack } = renderView();
    await screen.findByText("links for ABC-1");
    await userEvent.click(
      screen.getByRole("button", { name: "follow to ABC-2" }),
    );
    await screen.findByRole("button", { name: /Back to ABC-1/ });

    await userEvent.click(
      screen.getByRole("button", { name: /Back to ABC-1/ }),
    );

    expect(await screen.findByText("facts for ABC-1")).toBeDefined();
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe("the issue view's shortcuts", () => {
  it("opens the issue in Jira on ⌘J", async () => {
    renderView();
    await screen.findByText("facts for ABC-1");

    await act(async () => chord("j"));

    expect(openUrl).toHaveBeenCalledWith(
      "https://example.atlassian.net/browse/ABC-1",
    );
  });

  it("follows the trail, so ⌘J opens whichever issue is being read", async () => {
    // One verb, one key; what it acts on is whatever is open.
    renderView();
    await screen.findByText("links for ABC-1");
    await userEvent.click(
      screen.getByRole("button", { name: "follow to ABC-2" }),
    );
    await screen.findByText("facts for ABC-2");

    await act(async () => chord("j"));

    expect(openUrl).toHaveBeenCalledWith(
      "https://example.atlassian.net/browse/ABC-2",
    );
  });

  it("names the back chord on the Back button", async () => {
    // The chord itself is `back.ts`'s — covered in backHook.test.ts, and this
    // view's `goBack()` test above. What this view owns is saying where the
    // badge for it belongs, and telling a screen reader the same thing.
    renderView();
    await screen.findByText("facts for ABC-1");

    expect(
      screen
        .getByRole("button", { name: /Back to Todo/ })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("Meta+[");
  });
});

describe("moving the issue through its workflow", () => {
  it("runs a move that needs no screen", async () => {
    apiMock.issueTransitions.mockResolvedValue([
      transition({ id: "31", to: "In Progress" }),
    ]);
    renderView();
    await screen.findByRole("option", { name: "In Progress" });

    await userEvent.selectOptions(screen.getByRole("combobox"), "31");

    await waitFor(() =>
      expect(apiMock.transitionIssue).toHaveBeenCalledWith(
        "ABC-1",
        "31",
        undefined,
      ),
    );
  });

  it("re-reads the issue once it has moved", async () => {
    apiMock.issueTransitions.mockResolvedValue([transition({ id: "31" })]);
    renderView();
    await screen.findByRole("option", { name: "In Progress" });
    await waitFor(() => expect(apiMock.issueDetail).toHaveBeenCalledTimes(1));

    await userEvent.selectOptions(screen.getByRole("combobox"), "31");

    await waitFor(() => expect(apiMock.issueDetail).toHaveBeenCalledTimes(2));
  });

  it("says why a refused move did not happen", async () => {
    // Unlike the timer's status nudge, this one was asked for.
    apiMock.issueTransitions.mockResolvedValue([transition({ id: "31" })]);
    apiMock.transitionIssue.mockRejectedValue(new Error("Jira returned 400"));
    renderView();
    await screen.findByRole("option", { name: "In Progress" });

    await userEvent.selectOptions(screen.getByRole("combobox"), "31");

    expect(await screen.findByText(/Jira returned 400/)).toBeDefined();
  });

  it("opens a screen for a move that asks for something first", async () => {
    apiMock.issueTransitions.mockResolvedValue([
      transition({
        id: "41",
        name: "Resolve",
        to: "Resolved",
        fields: [
          fieldMeta({
            id: "resolution",
            name: "Resolution",
            required: true,
            schemaType: "option",
            allowedValues: [{ id: "1", label: "Done" }],
          }),
        ],
      }),
    ]);
    renderView();
    await screen.findByRole("option", { name: /Resolved/ });

    await userEvent.selectOptions(screen.getByRole("combobox"), "41");

    // The move's own name heads the screen; it is also the option's label.
    expect(
      await screen.findByRole("heading", { name: "Resolve" }),
    ).toBeDefined();
    // Nothing is sent until the screen is filled in and submitted.
    expect(apiMock.transitionIssue).not.toHaveBeenCalled();
  });

  it("backs out of an open screen before it leaves the issue", async () => {
    // The screen sits on the issue. Leaving for the list while a half-filled
    // one is up would skip past the thing being read.
    apiMock.issueTransitions.mockResolvedValue([
      transition({
        id: "41",
        name: "Resolve",
        to: "Resolved",
        fields: [
          fieldMeta({ id: "resolution", name: "Resolution", required: true }),
        ],
      }),
    ]);
    const { onBack } = renderView({ backLabel: "Todo" });
    await screen.findByRole("option", { name: /Resolved/ });
    await userEvent.selectOptions(screen.getByRole("combobox"), "41");
    await screen.findByRole("heading", { name: "Resolve" });

    await userEvent.click(
      screen.getByRole("button", { name: /Back to ABC-1/ }),
    );

    expect(screen.queryByRole("heading", { name: "Resolve" })).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
  });
});
