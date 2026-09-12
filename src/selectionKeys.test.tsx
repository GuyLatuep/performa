/** @vitest-environment happy-dom */
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";
import {
  clearSelection,
  selectedRow,
  useSelectionKeys,
  useSelectionScope,
} from "./selection";

// The registry itself is covered in selection.test.ts; this file is the listener
// over it — which presses reach it, and when it stays out of the way.

/** A list with the arrow listener above it. */
function List({
  open,
  rows = ["a", "b", "c"],
}: {
  open: () => void;
  rows?: string[];
}) {
  useSelectionScope({ id: "todo", rows, open });
  useSelectionKeys();
  return null;
}

/** Press a key at `target`, so it bubbles to the window listener with the target
 *  a real element — which is what the typing guard reads. Returns false when
 *  something called `preventDefault`. */
function press(
  key: string,
  target: Element = document.body,
  mods: Partial<KeyboardEventInit> = {},
) {
  return fireEvent.keyDown(target, { key, ...mods });
}

/** An element in the page, since a detached one never reaches the window. */
function el(tag: string, contentEditable = false) {
  const node = document.createElement(tag);
  if (contentEditable) node.contentEditable = "true";
  document.body.append(node);
  return node;
}

afterEach(() => {
  clearSelection();
  document.body.innerHTML = "";
});

describe("the arrow keys", () => {
  it("move the selection down", () => {
    render(<List open={vi.fn()} />);

    press("ArrowDown");

    expect(selectedRow()?.rowId).toBe("a");
  });

  it("move it up", () => {
    render(<List open={vi.fn()} />);
    press("ArrowDown");
    press("ArrowDown");

    press("ArrowUp");

    expect(selectedRow()?.rowId).toBe("a");
  });

  it("claim the press, so the page does not also scroll", () => {
    render(<List open={vi.fn()} />);

    expect(press("ArrowDown")).toBe(false);
  });

  it("leave the press alone when there is nowhere to go", () => {
    // An arrow with no list on screen must still scroll the page.
    render(<List open={vi.fn()} rows={[]} />);

    expect(press("ArrowDown")).toBe(true);
  });
});

describe("Enter", () => {
  it("opens the selected row", () => {
    const open = vi.fn();
    render(<List open={open} />);
    press("ArrowDown");

    press("Enter");

    expect(open).toHaveBeenCalledWith("a");
  });

  it("does nothing with nothing selected", () => {
    const open = vi.fn();
    render(<List open={open} />);

    expect(press("Enter")).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves a focused button to answer for itself", () => {
    // A native button fires its click on Enter keydown, so opening the row here
    // as well would do two things at once.
    const open = vi.fn();
    render(<List open={open} />);
    press("ArrowDown");

    press("Enter", el("button"));

    expect(open).not.toHaveBeenCalled();
  });
});

describe("the guards", () => {
  it.each([
    ["an INPUT", "input", false],
    ["a TEXTAREA", "textarea", false],
    ["a SELECT, which answers the arrows itself", "select", false],
    ["a contenteditable", "div", true],
  ])("stays out of %s", (_label, tag, editable) => {
    const open = vi.fn();
    render(<List open={open} />);

    press("ArrowDown", el(tag, editable));

    expect(selectedRow()).toBeNull();
  });

  it("stays behind a modal", () => {
    render(<List open={vi.fn()} />);
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    document.body.append(backdrop);

    press("ArrowDown");

    expect(selectedRow()).toBeNull();
  });

  it("stands aside for a press something nearer already claimed", () => {
    render(<List open={vi.fn()} />);
    const picker = el("div");
    picker.addEventListener("keydown", (e) => e.preventDefault());

    press("ArrowDown", picker);

    expect(selectedRow()).toBeNull();
  });

  it.each([
    ["⌘", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Alt", { altKey: true }],
    ["Shift", { shiftKey: true }],
  ])("leaves an arrow carrying %s to the chord layers", (_label, mods) => {
    // ⌘← is back's and ⌘⇧← is the timesheet's; this layer claims only the
    // unmodified keys.
    render(<List open={vi.fn()} />);

    press("ArrowDown", document.body, mods);

    expect(selectedRow()).toBeNull();
  });

  it("stops listening once it unmounts", () => {
    const { unmount } = render(<List open={vi.fn()} />);

    unmount();
    press("ArrowDown");

    expect(selectedRow()).toBeNull();
  });
});
