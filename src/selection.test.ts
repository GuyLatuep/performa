/** @vitest-environment happy-dom */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";
import {
  Anchor,
  clearSelection,
  moveSelection,
  openSelected,
  reselect,
  selectedRow,
  selectRow,
  useSelectionScope,
} from "./selection";

// The key listener over this registry is covered in selectionKeys.test.tsx; this
// file is the registry and the arithmetic of moving about in it.

/** Register a list, handing back its `open` spy and a way to change its rows. */
function list(
  id: string,
  rows: string[],
  opts: { order?: number; open?: boolean } = {},
) {
  const open = vi.fn();
  const view = renderHook(
    ({ r }: { r: string[] }) =>
      useSelectionScope({
        id,
        rows: r,
        order: opts.order,
        open: opts.open === false ? undefined : open,
      }),
    { initialProps: { r: rows } },
  );
  return { open, ...view };
}

const at = (rowId: string, index: number): Anchor => ({
  scopeId: "todo",
  rowId,
  index,
});

afterEach(clearSelection);

describe("reselect", () => {
  it("follows a row that moved, which is why rows are named and not counted", () => {
    // A Todo re-sort keeps you on PERF-12 even though it went from second to
    // seventeenth.
    expect(reselect(at("b", 1), ["c", "d", "b", "a"])).toEqual(at("b", 2));
  });

  it("takes the place of a row that is gone", () => {
    // Deleting a worklog leaves the selection on whatever is now in that row.
    expect(reselect(at("b", 1), ["a", "c", "d"])).toEqual(at("c", 1));
  });

  it("lands on the last row when the list got shorter than the index", () => {
    expect(reselect(at("d", 3), ["a", "b"])).toEqual(at("b", 1));
  });

  it("is nothing when the list empties", () => {
    expect(reselect(at("a", 0), [])).toBeNull();
  });

  it("is nothing when there was nothing", () => {
    expect(reselect(null, ["a", "b"])).toBeNull();
  });
});

describe("moving about", () => {
  it("starts on the first row when the list is entered downwards", () => {
    list("todo", ["a", "b", "c"]);

    expect(moveSelection(1)).toBe(true);
    expect(selectedRow()).toEqual(at("a", 0));
  });

  it("starts on the last row when it is entered upwards", () => {
    // So a long list can be read from the bottom without a click first.
    list("todo", ["a", "b", "c"]);

    moveSelection(-1);

    expect(selectedRow()?.rowId).toBe("c");
  });

  it("walks down and back up", () => {
    list("todo", ["a", "b", "c"]);

    moveSelection(1);
    moveSelection(1);
    expect(selectedRow()?.rowId).toBe("b");

    moveSelection(-1);
    expect(selectedRow()?.rowId).toBe("a");
  });

  it("stops at the ends rather than wrapping", () => {
    // Deliberately unlike the typeahead pickers, which do wrap: those are five
    // options in a popover, and a Todo list is two hundred rows.
    list("todo", ["a", "b"]);
    moveSelection(1);

    expect(moveSelection(-1)).toBe(false);
    expect(selectedRow()?.rowId).toBe("a");
  });

  it("does nothing at all with no list on screen", () => {
    expect(moveSelection(1)).toBe(false);
    expect(selectedRow()).toBeNull();
  });

  it("does nothing in an empty list", () => {
    list("todo", []);

    expect(moveSelection(1)).toBe(false);
  });
});

describe("two lists on one screen", () => {
  it("walks them in the order they are given", () => {
    list("due", ["a"], { order: 0 });
    list("missing", ["x"], { order: 1 });

    moveSelection(1);
    expect(selectedRow()?.scopeId).toBe("due");

    moveSelection(1);
    expect(selectedRow()).toMatchObject({ scopeId: "missing", rowId: "x" });
  });

  it("crosses from the end of one into the start of the next", () => {
    list("due", ["a", "b"], { order: 0 });
    list("missing", ["x", "y"], { order: 1 });
    moveSelection(1);
    moveSelection(1);

    moveSelection(1);

    expect(selectedRow()).toMatchObject({ scopeId: "missing", rowId: "x" });
  });

  it("walks back across the boundary too", () => {
    list("due", ["a", "b"], { order: 0 });
    list("missing", ["x"], { order: 1 });
    selectRow("missing", "x");

    moveSelection(-1);

    expect(selectedRow()).toMatchObject({ scopeId: "due", rowId: "b" });
  });

  it("falls back on registration order when none is given", () => {
    list("first", ["a"]);
    list("second", ["x"]);

    moveSelection(1);

    expect(selectedRow()?.scopeId).toBe("first");
  });
});

describe("opening what is selected", () => {
  it("goes through the scope that owns the row", () => {
    // The host knows what opening means; the row does not.
    const { open } = list("todo", ["a", "b"]);
    moveSelection(1);

    expect(openSelected()).toBe(true);
    expect(open).toHaveBeenCalledWith("a");
  });

  it("does nothing with nothing selected", () => {
    list("todo", ["a"]);

    expect(openSelected()).toBe(false);
  });

  it("does nothing for a list that cannot be entered", () => {
    list("todo", ["a"], { open: false });
    moveSelection(1);

    expect(openSelected()).toBe(false);
  });
});

describe("a list that changes underneath the selection", () => {
  it("keeps hold of the row through a re-sort", () => {
    const { rerender } = list("todo", ["a", "b", "c"]);
    selectRow("todo", "b");

    rerender({ r: ["c", "b", "a"] });

    expect(selectedRow()).toEqual(at("b", 1));
  });

  it("moves to what replaced a row that went away", () => {
    const { rerender } = list("todo", ["a", "b", "c"]);
    selectRow("todo", "b");

    rerender({ r: ["a", "c"] });

    expect(selectedRow()?.rowId).toBe("c");
  });

  it("lets go when the list empties", () => {
    const { rerender } = list("todo", ["a"]);
    selectRow("todo", "a");

    rerender({ r: [] });

    expect(selectedRow()).toBeNull();
  });

  it("sits still through a re-render that changed nothing", () => {
    const { rerender } = list("todo", ["a", "b"]);
    selectRow("todo", "b");

    rerender({ r: ["a", "b"] });

    expect(selectedRow()?.rowId).toBe("b");
  });

  it("holds on while a form opens over it and closes again", () => {
    // The scope deactivates while the form is up. Clearing the selection then
    // meant coming back to the list at the top of it, having lost the row that
    // was being worked on.
    const { rerender } = renderHook(
      ({ on }: { on: boolean }) =>
        useSelectionScope({ id: "missing", rows: ["a", "b", "c"] }, on),
      { initialProps: { on: true } },
    );
    selectRow("missing", "b");

    rerender({ on: false });
    rerender({ on: true });

    expect(selectedRow()?.rowId).toBe("b");
  });

  it("lets go when the list itself unmounts", () => {
    const { unmount } = list("todo", ["a"]);
    selectRow("todo", "a");

    unmount();

    expect(selectedRow()).toBeNull();
  });
});
