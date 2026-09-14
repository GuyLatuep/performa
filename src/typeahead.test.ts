import { describe, expect, it, vi } from "vitest";
import { typeaheadKey } from "./typeahead";

/** A list of three, with the keyboard wherever `active` says. */
function list(active: number, overrides: Record<string, unknown> = {}) {
  const setActive = vi.fn();
  const choose = vi.fn();
  return {
    matches: ["a", "b", "c"],
    active,
    setActive,
    choose,
    ...overrides,
  };
}

/** What `setActive` was asked to move to, given where the keyboard was. */
function moved(setActive: ReturnType<typeof vi.fn>, from: number): number {
  const update = setActive.mock.calls[0][0] as (i: number) => number;
  return update(from);
}

describe("typeaheadKey", () => {
  it("leaves every key alone when nothing matched", () => {
    const l = list(0, { matches: [] });
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]) {
      expect(typeaheadKey(key, l)).toBe(false);
    }
    expect(l.setActive).not.toHaveBeenCalled();
    expect(l.choose).not.toHaveBeenCalled();
  });

  it("wraps around both ends", () => {
    const down = list(2);
    expect(typeaheadKey("ArrowDown", down)).toBe(true);
    expect(moved(down.setActive, 2)).toBe(0);

    const up = list(0);
    expect(typeaheadKey("ArrowUp", up)).toBe(true);
    expect(moved(up.setActive, 0)).toBe(2);
  });

  it("chooses the highlighted match on Enter and on Tab", () => {
    for (const key of ["Enter", "Tab"]) {
      const l = list(1);
      expect(typeaheadKey(key, l)).toBe(true);
      expect(l.choose).toHaveBeenCalledWith("b");
    }
  });

  it("falls back to the first match when the highlight is out of range", () => {
    // A result set can shrink under the highlight between render and keypress.
    const l = list(9);
    expect(typeaheadKey("Enter", l)).toBe(true);
    expect(l.choose).toHaveBeenCalledWith("a");
  });

  it("closes on Escape only where the list owns it", () => {
    const close = vi.fn();
    expect(typeaheadKey("Escape", list(0, { close }))).toBe(true);
    expect(close).toHaveBeenCalled();

    // The comment box answers Escape itself, so that it works even with an
    // empty list; this must not swallow the press first.
    expect(typeaheadKey("Escape", list(0))).toBe(false);
  });

  it("passes ordinary typing through", () => {
    const l = list(0);
    expect(typeaheadKey("a", l)).toBe(false);
    expect(typeaheadKey("Backspace", l)).toBe(false);
  });
});
