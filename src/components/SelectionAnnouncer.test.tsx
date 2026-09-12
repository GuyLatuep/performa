/** @vitest-environment happy-dom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "../test-support/dom";
import {
  clearSelection,
  useRowSelected,
  useSelectionKeys,
  useSelectionScope,
} from "../selection";
import SelectionAnnouncer from "./SelectionAnnouncer";

// The arrow keys move a wash and a bar. This is what a reader who cannot see
// them gets instead — nothing here is unreachable without it, since every row
// action is also a button Tab reaches, but a layer that moves in silence is one
// nobody could discover.

const ROWS = [
  { id: "ABC-1", text: "ABC-1 Replace the pump" },
  { id: "ABC-2", text: "ABC-2 Order the seal" },
];

/** A row that marks itself the way the real ones do. */
function Row({ id, text }: { id: string; text: string }) {
  const selected = useRowSelected("list", id);
  return <li aria-current={selected ? "true" : undefined}>{text}</li>;
}

function List() {
  useSelectionScope({ id: "list", rows: ROWS.map((r) => r.id) });
  useSelectionKeys();
  return (
    <>
      <SelectionAnnouncer />
      <ul aria-label="The rows">
        {ROWS.map((r) => (
          <Row key={r.id} {...r} />
        ))}
      </ul>
    </>
  );
}

function down() {
  fireEvent.keyDown(document.body, { key: "ArrowDown" });
}

/** What the live region currently says. */
function announced() {
  return screen.getByRole("status").textContent;
}

afterEach(() => {
  clearSelection();
  document.body.innerHTML = "";
});

describe("the announcer", () => {
  it("says nothing before anything is selected", () => {
    render(<List />);

    expect(announced()).toBe("");
  });

  it("says the row the arrows landed on", () => {
    render(<List />);

    act(() => down());

    expect(announced()).toBe("ABC-1 Replace the pump");
  });

  it("says the next one as the selection moves", () => {
    render(<List />);
    act(() => down());

    act(() => down());

    expect(announced()).toBe("ABC-2 Order the seal");
  });

  it("says nothing again once the selection is let go", () => {
    render(<List />);
    act(() => down());

    act(() => clearSelection());

    expect(announced()).toBe("");
  });

  it("is polite, so it waits rather than interrupting", () => {
    // An assertive region would cut across whatever is being read, and moving a
    // selection is not an emergency.
    render(<List />);

    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("is not in the view, only in the reading of it", () => {
    render(<List />);

    expect(screen.getByRole("status").className).toContain("visually-hidden");
  });

  it("ignores the sidebar, whose rows mark themselves differently", () => {
    // Nav rows carry `aria-current="page"`; the selection's own mark is "true".
    render(
      <>
        <button aria-current="page">Todo</button>
        <List />
      </>,
    );

    act(() => down());

    expect(announced()).toBe("ABC-1 Replace the pump");
  });
});
