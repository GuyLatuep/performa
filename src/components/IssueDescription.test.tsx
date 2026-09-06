/** @vitest-environment happy-dom */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import IssueDescription from "./IssueDescription";

// happy-dom does no layout, so the two heights the clamp is measured from are
// both zero and nothing ever overflows. They are defined here instead, which
// is the whole input to the component's one decision.

let scrollHeight = 0;
let clientHeight = 0;
/** The observers the component registered, so a test can fire a resize. */
let observers: (() => void)[] = [];

class FakeResizeObserver {
  constructor(private cb: () => void) {
    observers.push(cb);
  }
  observe() {}
  disconnect() {
    observers = observers.filter((o) => o !== this.cb);
  }
}

beforeEach(() => {
  observers = [];
  scrollHeight = 0;
  clientHeight = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  for (const [prop, get] of [
    ["scrollHeight", () => scrollHeight],
    ["clientHeight", () => clientHeight],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get,
    });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const prop of ["scrollHeight", "clientHeight"]) {
    Reflect.deleteProperty(HTMLElement.prototype, prop);
  }
});

/** Text that needs more room than it has. */
function overflowing() {
  scrollHeight = 200;
  clientHeight = 60;
}

/** Text that fits in the clamp. */
function fitting() {
  scrollHeight = 40;
  clientHeight = 60;
}

const paragraph = () => screen.getByText("A long description");
const toggle = () => screen.queryByRole("button");

describe("a description that fits", () => {
  it("offers no toggle", () => {
    // A character count would put "Show more" on a two-line description.
    fitting();
    render(<IssueDescription text="A long description" />);

    expect(toggle()).toBeNull();
  });

  it("is not marked as expanded", () => {
    fitting();
    render(<IssueDescription text="A long description" />);

    expect(paragraph().className).not.toContain("expanded");
  });
});

describe("a description that overflows", () => {
  it("offers a way to see the rest", () => {
    overflowing();
    render(<IssueDescription text="A long description" />);

    expect(toggle()?.textContent).toBe("Show more ▼");
  });

  it("opens it up", async () => {
    overflowing();
    render(<IssueDescription text="A long description" />);

    await userEvent.click(toggle()!);

    expect(paragraph().className).toContain("expanded");
    expect(toggle()?.textContent).toBe("Show less ▲");
  });

  it("keeps the toggle once open, even though nothing overflows any more", async () => {
    // Expanded, the two heights are equal by definition — losing the toggle
    // there would leave no way back.
    //
    // Three things keep it: the initial check and the observer both skip
    // measuring while expanded, and the render falls back to `expanded`. They
    // are redundant with each other, so removing any one alone changes
    // nothing observable; this case fails once two of them are gone.
    overflowing();
    render(<IssueDescription text="A long description" />);
    await userEvent.click(toggle()!);

    fitting();
    await act(async () => observers.forEach((fire) => fire()));

    expect(toggle()?.textContent).toBe("Show less ▲");
  });

  it("closes again", async () => {
    overflowing();
    render(<IssueDescription text="A long description" />);
    await userEvent.click(toggle()!);

    await userEvent.click(toggle()!);

    expect(paragraph().className).not.toContain("expanded");
    expect(toggle()?.textContent).toBe("Show more ▼");
  });
});

describe("when the window changes size", () => {
  it("offers the toggle once the text no longer fits", async () => {
    // The clamp is a line count, so a narrower window changes what fits.
    fitting();
    render(<IssueDescription text="A long description" />);
    expect(toggle()).toBeNull();

    overflowing();
    await act(async () => observers.forEach((fire) => fire()));

    expect(toggle()?.textContent).toBe("Show more ▼");
  });

  it("takes it away again once it fits", async () => {
    overflowing();
    render(<IssueDescription text="A long description" />);
    expect(toggle()).toBeDefined();

    fitting();
    await act(async () => observers.forEach((fire) => fire()));

    expect(toggle()).toBeNull();
  });

  it("stops measuring once it unmounts", () => {
    overflowing();
    const { unmount } = render(<IssueDescription text="A long description" />);

    unmount();

    expect(observers).toHaveLength(0);
  });
});

describe("new text", () => {
  it("is measured afresh", async () => {
    fitting();
    const { rerender } = render(<IssueDescription text="A long description" />);
    expect(toggle()).toBeNull();

    overflowing();
    rerender(<IssueDescription text="A different description" />);

    expect(screen.getByText("A different description")).toBeDefined();
    expect(toggle()?.textContent).toBe("Show more ▼");
  });
});
