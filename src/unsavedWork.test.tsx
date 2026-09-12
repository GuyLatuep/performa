/** @vitest-environment happy-dom */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "./test-support/dom";
import { anythingUnsaved, drafting, useUnsavedWork } from "./keys";

// A form is more than the box the cursor happens to be in. The log form has a
// duration, a date, a time and a comment: with the cursor in the date field —
// pre-filled, and so not a draft — leaving used to take the typed duration and
// comment with it.

function Form({ unsaved }: { unsaved: boolean }) {
  useUnsavedWork(unsaved);
  return null;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("a form holding unsaved work", () => {
  it("holds nothing while it is empty", () => {
    render(<Form unsaved={false} />);

    expect(anythingUnsaved()).toBe(false);
  });

  it("says so once it holds something", () => {
    render(<Form unsaved />);

    expect(anythingUnsaved()).toBe(true);
  });

  it("makes the guard true wherever the cursor is", () => {
    // The whole point: the date box answers "not a draft" for itself, and the
    // form answers for the fields the cursor is not in.
    render(<Form unsaved />);
    const date = document.createElement("input");
    date.type = "date";
    date.value = "2026-09-12";

    expect(drafting(date)).toBe(true);
  });

  it("lets go when the work is saved", () => {
    const { rerender } = render(<Form unsaved />);

    rerender(<Form unsaved={false} />);

    expect(anythingUnsaved()).toBe(false);
  });

  it("lets go when the form unmounts mid-edit", () => {
    // Otherwise a form closed with words in it would hold the keyboard hostage
    // for the rest of the session.
    const { unmount } = render(<Form unsaved />);

    unmount();

    expect(anythingUnsaved()).toBe(false);
  });

  it("is held while any one of several forms holds something", () => {
    const a = render(<Form unsaved />);
    render(<Form unsaved />);

    a.unmount();

    expect(anythingUnsaved()).toBe(true);
  });
});
