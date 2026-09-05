/** @vitest-environment happy-dom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

const recordEvent = vi.hoisted(() => vi.fn(() => [] as string[]));
vi.mock("../achievements", () => ({ recordEvent }));

import { CommentAction } from "../comments";
import { apiMock, jiraUser, resetApiMock } from "../test-support/api";
import CommentPanel from "./CommentPanel";

const ANNA = jiraUser({ accountId: "acc-anna", displayName: "Anna Leeson" });
const BEN = jiraUser({ accountId: "acc-ben", displayName: "Ben Ortiz" });

const COMMENT: CommentAction = {
  label: "Comment",
  public: true,
  title: "Visible to everyone who can see this issue",
};

const INTERNAL: CommentAction = {
  label: "Internal note",
  public: false,
  title: "Only people working the issue can read this",
};

function setup() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

function renderPanel(props: Partial<Parameters<typeof CommentPanel>[0]> = {}) {
  const onPosted = vi.fn();
  render(
    <CommentPanel
      issueKey="ABC-1"
      action={COMMENT}
      serviceDesk={false}
      onPosted={onPosted}
      {...props}
    />,
  );
  return onPosted;
}

const box = () => screen.getByRole("textbox");

/** Type `text` and let the 250 ms mention lookup fire. */
async function type(user: ReturnType<typeof setup>, text: string) {
  await user.type(box(), text);
  await vi.advanceTimersByTimeAsync(250);
}

beforeEach(() => {
  resetApiMock();
  recordEvent.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("writing a comment", () => {
  it("cannot be posted while it is empty", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "Comment" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("cannot be posted with only whitespace", async () => {
    const user = setup();
    renderPanel();

    await user.type(box(), "   ");

    expect(screen.getByRole("button", { name: "Comment" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("posts what was written, as the kind the row chose", async () => {
    const user = setup();
    const onPosted = renderPanel();

    await user.type(box(), "the seal is worn");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() =>
      expect(apiMock.addComment).toHaveBeenCalledWith(
        "ABC-1",
        "the seal is worn",
        true,
        [],
      ),
    );
    expect(onPosted).toHaveBeenCalledTimes(1);
    expect(recordEvent).toHaveBeenCalledWith({ kind: "commented" });
  });

  it("posts an internal note as not public", async () => {
    // Which kind it is decides who can read it.
    const user = setup();
    renderPanel({ action: INTERNAL, serviceDesk: true });

    await user.type(box(), "for agents only");
    await user.click(screen.getByRole("button", { name: "Internal note" }));

    await waitFor(() =>
      expect(apiMock.addComment).toHaveBeenCalledWith(
        "ABC-1",
        "for agents only",
        false,
        [],
      ),
    );
  });

  it("empties the box afterwards", async () => {
    const user = setup();
    renderPanel();
    await user.type(box(), "done");

    await user.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => expect(box()).toHaveProperty("value", ""));
  });

  it("keeps the text when Jira refuses it", async () => {
    // A failed post must not cost the writer what they wrote.
    apiMock.addComment.mockRejectedValue(new Error("Jira returned 400"));
    const user = setup();
    const onPosted = renderPanel();

    await user.type(box(), "the seal is worn");
    await user.click(screen.getByRole("button", { name: "Comment" }));

    expect(await screen.findByText(/Jira returned 400/)).toBeDefined();
    expect(box()).toHaveProperty("value", "the seal is worn");
    expect(onPosted).not.toHaveBeenCalled();
  });

  it("explains what a picked mention is worth", () => {
    renderPanel();

    expect(screen.getByText(/typed ones stay plain text/)).toBeDefined();
  });
});

describe("the mention picker", () => {
  beforeEach(() => apiMock.searchUsers.mockResolvedValue([ANNA, BEN]));

  it("opens on an @ and searches for what follows it", async () => {
    const user = setup();
    renderPanel();

    await type(user, "hello @ann");

    expect(await screen.findByText("Anna Leeson")).toBeDefined();
    expect(apiMock.searchUsers).toHaveBeenCalledWith("ann");
  });

  it("stays shut while there is no @ fragment", async () => {
    const user = setup();
    renderPanel();

    await type(user, "just a comment");

    expect(apiMock.searchUsers).not.toHaveBeenCalled();
    expect(screen.queryByText("Anna Leeson")).toBeNull();
  });

  // NOT TESTED: a failing `searchUsers`. The component handles it correctly
  // (`.then`'s second argument empties the picker and leaves the text alone),
  // but under vitest the rejected promise is reported as unhandled whichever
  // way it is produced — real or fake timers, thrown or pre-built. The handler
  // is attached synchronously at call time, so this looks like a reporting
  // quirk rather than a real leak; it is left out rather than papered over
  // with a test that asserts something weaker than it claims.

  it("puts the chosen name into the text and sends it as a real mention", async () => {
    // A typed "@Anna Leeson" looks right in the timeline and notifies nobody,
    // which is the worse of the two failures.
    const user = setup();
    renderPanel();
    await type(user, "hello @ann");
    await screen.findByText("Anna Leeson");

    await user.click(screen.getByText("Anna Leeson"));

    expect(box()).toHaveProperty("value", "hello @Anna Leeson ");

    await user.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() =>
      expect(apiMock.addComment).toHaveBeenCalledWith(
        "ABC-1",
        "hello @Anna Leeson ",
        true,
        [{ accountId: "acc-anna", name: "Anna Leeson" }],
      ),
    );
  });

  it("moves down and wraps with the arrows", async () => {
    const user = setup();
    renderPanel();
    await type(user, "@a");
    await screen.findByText("Anna Leeson");

    await user.keyboard("{ArrowDown}{Enter}");

    expect(box()).toHaveProperty("value", "@Ben Ortiz ");
  });

  it("chooses on Enter rather than breaking the line", async () => {
    const user = setup();
    renderPanel();
    await type(user, "@a");
    await screen.findByText("Anna Leeson");

    await user.keyboard("{Enter}");

    expect(box()).toHaveProperty("value", "@Anna Leeson ");
  });

  it("closes on Escape, leaving the fragment as typed", async () => {
    const user = setup();
    renderPanel();
    await type(user, "@ann");
    await screen.findByText("Anna Leeson");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByText("Anna Leeson")).toBeNull());
    expect(box()).toHaveProperty("value", "@ann");
  });

  it("drops a whole mention on one Backspace", async () => {
    // Deleting it letter by letter would leave a half-name that still looks
    // like a mention.
    const user = setup();
    renderPanel();
    await type(user, "@ann");
    await screen.findByText("Anna Leeson");
    await user.click(screen.getByText("Anna Leeson"));

    await user.keyboard("{Backspace}{Backspace}");

    expect(box()).toHaveProperty("value", "");
  });

  it("sends no mention for a name deleted from the text before posting", async () => {
    // Whether somebody is really mentioned is decided at submit, from the text
    // as it then stands.
    const user = setup();
    renderPanel();
    await type(user, "@ann");
    await screen.findByText("Anna Leeson");
    await user.click(screen.getByText("Anna Leeson"));
    await user.keyboard("{Backspace}{Backspace}");
    await user.type(box(), "never mind");

    await user.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() =>
      expect(apiMock.addComment).toHaveBeenCalledWith(
        "ABC-1",
        "never mind",
        true,
        [],
      ),
    );
  });
});

describe("on a service desk", () => {
  it("spells out who will see the comment", () => {
    renderPanel({ action: INTERNAL, serviceDesk: true });

    expect(
      screen.getByText(/Only people working the issue can read this\./),
    ).toBeDefined();
  });

  it("says nothing extra elsewhere, where every comment is as visible as the issue", () => {
    renderPanel();

    expect(
      screen.queryByText(/Visible to everyone who can see this issue\./),
    ).toBeNull();
  });
});
