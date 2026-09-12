/** @vitest-environment happy-dom */
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { REVEAL_MS } from "../chordReveal";
import { ActionId, useShortcut } from "../shortcuts";
import ShortcutBadges from "./ShortcutBadges";

// happy-dom lays nothing out, so every control here says how big it is and the
// frame loop is driven by hand — which is also what makes the geometry
// assertable at all.

/** One control carrying a shortcut, beside the layer that badges it. */
function Scene({
  id = "tabTodo" as ActionId,
  rect,
  inModal = false,
}: {
  id?: ActionId;
  rect: Partial<DOMRect>;
  inModal?: boolean;
}) {
  const props = useShortcut(id, vi.fn());
  const button = (
    <button
      {...props}
      ref={(node) => {
        if (node) sized(node, rect);
        return props.ref(node);
      }}
    >
      control
    </button>
  );
  return (
    <>
      {inModal ? <div className="modal-backdrop">{button}</div> : button}
      <ShortcutBadges />
    </>
  );
}

/** The control's measurements, since happy-dom reports a zero rect for all. */
function sized(el: HTMLElement, rect: Partial<DOMRect>) {
  el.getBoundingClientRect = () =>
    ({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      ...rect,
    }) as DOMRect;
}

/** One frame at a time, rather than a loop a test cannot stop. */
let queue: FrameRequestCallback[] = [];
function nextFrame() {
  act(() => {
    queue.splice(0).forEach((cb) => cb(0));
  });
}

/** Hold the modifier long enough for the badges to appear. */
function hold() {
  fireEvent.keyDown(document.body, { key: "Meta", metaKey: true });
  act(() => {
    vi.advanceTimersByTime(REVEAL_MS);
  });
  nextFrame();
}

const ON_SCREEN = { top: 100, right: 240, width: 80, height: 24 };

function badges() {
  return [...document.querySelectorAll(".shortcut-badge")] as HTMLElement[];
}

beforeEach(() => {
  queue = [];
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    queue.push(cb),
  );
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("navigator", {
    userAgent: "Macintosh; Intel Mac OS X 10_15_7",
  });
  vi.stubGlobal("innerHeight", 900);
  vi.stubGlobal("innerWidth", 1200);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("before the modifier is held", () => {
  it("draws nothing", () => {
    render(<Scene rect={ON_SCREEN} />);

    expect(badges()).toHaveLength(0);
  });
});

describe("while it is held", () => {
  it("names the key at the control's top-right corner", () => {
    render(<Scene rect={ON_SCREEN} />);

    hold();

    expect(badges()).toHaveLength(1);
    expect(badges()[0].textContent).toBe("2");
    expect(badges()[0].style.left).toBe("240px");
    expect(badges()[0].style.top).toBe("100px");
  });

  it("is decoration, so nothing reads it twice", () => {
    // The shortcut a screen reader is told about is the `aria-keyshortcuts` on
    // the control itself.
    render(<Scene rect={ON_SCREEN} />);
    hold();

    const layer = document.querySelector(".shortcut-layer");
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps clear of the window's top edge", () => {
    render(<Scene rect={{ ...ON_SCREEN, top: 2 }} />);

    hold();

    expect(badges()[0].style.top).toBe("12px");
  });

  it("follows a control that moves, without remounting it", () => {
    // Keyed by id, so the entrance animation runs once rather than every frame.
    const { getByRole } = render(<Scene rect={ON_SCREEN} />);
    hold();
    const before = badges()[0];

    sized(getByRole("button"), { ...ON_SCREEN, top: 300 });
    nextFrame();

    expect(badges()[0]).toBe(before);
    expect(badges()[0].style.top).toBe("300px");
  });

  it("dims a key that would not fire", () => {
    render(<Scene rect={ON_SCREEN} />);
    const box = document.createElement("textarea");
    document.body.append(box);
    box.value = "half a comment";
    box.focus();

    hold();

    expect(badges()[0].className).toContain("standing-down");
  });

  it("undims it once there is nothing left to lose", () => {
    render(<Scene rect={ON_SCREEN} />);
    const box = document.createElement("textarea");
    document.body.append(box);
    box.value = "half a comment";
    box.focus();
    hold();

    box.value = "";
    nextFrame();

    expect(badges()[0].className).not.toContain("standing-down");
  });
});

describe("controls it skips", () => {
  it.each([
    ["one that is not drawn", { top: 0, right: 0, width: 0, height: 0 }],
    ["one scrolled above its panel", { ...ON_SCREEN, top: -80, bottom: -56 }],
    [
      "one scrolled below the window",
      { ...ON_SCREEN, top: 2000, bottom: 2024 },
    ],
  ])("draws no badge for %s", (_label, rect) => {
    // A badge floating where its control is not is worse than no badge.
    render(<Scene rect={rect} />);

    hold();

    expect(badges()).toHaveLength(0);
  });

  it("draws none for a control behind a modal", () => {
    render(<Scene rect={ON_SCREEN} />);
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    document.body.append(backdrop);

    hold();

    expect(badges()).toHaveLength(0);
  });

  it("draws one for a control inside a modal", () => {
    render(<Scene rect={ON_SCREEN} inModal />);

    hold();

    expect(badges()).toHaveLength(1);
  });
});

describe("letting go", () => {
  it("takes the badges away", () => {
    render(<Scene rect={ON_SCREEN} />);
    hold();

    fireEvent.keyUp(document.body, { key: "Meta", metaKey: false });

    expect(badges()).toHaveLength(0);
  });
});
