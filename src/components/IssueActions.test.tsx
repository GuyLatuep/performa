/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import IssueActions from "./IssueActions";

// The panels have their own tests; here they are markers that also expose the
// callback the row wires into them.
vi.mock("./CommentPanel", () => ({
  default: (p: { action: { label: string }; onPosted: () => void }) => (
    <div>
      comment panel · {p.action.label}
      <button onClick={p.onPosted}>post it</button>
    </div>
  ),
}));
vi.mock("./LogPanel", () => ({
  default: (p: { onLogged: () => void }) => (
    <div>
      log panel
      <button onClick={p.onLogged}>file it</button>
    </div>
  ),
}));

function renderRow(serviceDesk = false) {
  const onPosted = vi.fn();
  const onLogged = vi.fn();
  render(
    <IssueActions
      issueKey="ABC-1"
      serviceDesk={serviceDesk}
      onPosted={onPosted}
      onLogged={onLogged}
    />,
  );
  return { onPosted, onLogged };
}

const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("what the row offers", () => {
  it("is one comment and logging work on an ordinary issue", () => {
    renderRow(false);

    expect(button("Comment")).toBeDefined();
    expect(button("Log work")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Internal note" })).toBeNull();
  });

  it("splits the comment in two on a service-desk issue", () => {
    // Which kind it is decides who can read it, so the choice is made up front
    // rather than by a checkbox inside one panel.
    renderRow(true);

    expect(button("Internal note")).toBeDefined();
    expect(button("Reply to customer")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
  });

  it("shows no panel until something is chosen", () => {
    // A textarea and a duration box stacked permanently are most of the
    // view's height, and at most one is wanted on any visit.
    renderRow();

    expect(screen.queryByText(/comment panel/)).toBeNull();
    expect(screen.queryByText("log panel")).toBeNull();
  });
});

describe("choosing an action", () => {
  it("opens the comment panel for the action picked", async () => {
    renderRow(true);

    await userEvent.click(button("Reply to customer"));

    expect(screen.getByText(/comment panel · Reply to customer/)).toBeDefined();
  });

  it("opens the log panel", async () => {
    renderRow();

    await userEvent.click(button("Log work"));

    expect(screen.getByText("log panel")).toBeDefined();
  });

  it("marks the open one", async () => {
    renderRow();

    await userEvent.click(button("Log work"));

    expect(button("Log work").className).not.toContain("secondary");
    expect(button("Comment").className).toContain("secondary");
  });

  it("swaps panels rather than stacking them", async () => {
    renderRow();
    await userEvent.click(button("Log work"));

    await userEvent.click(button("Comment"));

    expect(screen.getByText(/comment panel/)).toBeDefined();
    expect(screen.queryByText("log panel")).toBeNull();
  });

  it("swaps between the two comment kinds", async () => {
    renderRow(true);
    await userEvent.click(button("Internal note"));

    await userEvent.click(button("Reply to customer"));

    expect(screen.getByText(/comment panel · Reply to customer/)).toBeDefined();
    // The button stays; it is the panel that must have swapped.
    expect(screen.queryByText(/comment panel · Internal note/)).toBeNull();
  });
});

describe("picking the same action again", () => {
  it("closes the comment panel, so the row doubles as a way back", async () => {
    renderRow();
    await userEvent.click(button("Comment"));

    await userEvent.click(button("Comment"));

    expect(screen.queryByText(/comment panel/)).toBeNull();
  });

  it("closes the log panel too", async () => {
    renderRow();
    await userEvent.click(button("Log work"));

    await userEvent.click(button("Log work"));

    expect(screen.queryByText("log panel")).toBeNull();
  });
});

describe("once the panel has done its job", () => {
  it("closes itself and tells the caller a comment was posted", async () => {
    const { onPosted } = renderRow();
    await userEvent.click(button("Comment"));

    await userEvent.click(button("post it"));

    expect(onPosted).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/comment panel/)).toBeNull();
  });

  it("closes itself and tells the caller work was logged", async () => {
    const { onLogged } = renderRow();
    await userEvent.click(button("Log work"));

    await userEvent.click(button("file it"));

    expect(onLogged).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("log panel")).toBeNull();
  });
});
