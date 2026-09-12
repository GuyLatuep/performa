/** @vitest-environment happy-dom */
import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";
import { chordRevealed, REVEAL_MS, useChordWatcher } from "./chordReveal";

// Whether the badges are showing — which is not the same question as whether ⌘
// is down, since it is down for the first tenth of every copy and paste.

function watch() {
  return renderHook(() => useChordWatcher());
}

/** Hold the modifier for `ms`. */
function hold(ms = REVEAL_MS) {
  fireEvent.keyDown(document.body, { key: "Meta", metaKey: true });
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("navigator", {
    userAgent: "Macintosh; Intel Mac OS X 10_15_7",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("the hold", () => {
  it("shows nothing at first", () => {
    watch();

    expect(chordRevealed()).toBe(false);
  });

  it("reveals once the modifier has been held alone for long enough", () => {
    watch();

    hold();

    expect(chordRevealed()).toBe(true);
  });

  it("shows nothing yet a moment before that", () => {
    // A copy is ⌘-down-then-C inside about a tenth of a second; the delay is
    // what keeps the layer from flashing on every one of them.
    watch();

    hold(REVEAL_MS - 50);

    expect(chordRevealed()).toBe(false);
  });

  it("does not stack timers when the held key auto-repeats", () => {
    watch();

    fireEvent.keyDown(document.body, { key: "Meta", metaKey: true });
    fireEvent.keyDown(document.body, { key: "Meta", metaKey: true });
    fireEvent.keyDown(document.body, { key: "Meta", metaKey: true });
    act(() => {
      vi.advanceTimersByTime(REVEAL_MS);
    });

    expect(chordRevealed()).toBe(true);
  });
});

describe("a hold spent on a chord", () => {
  it.each([
    ["a copy", "c"],
    ["a paste", "v"],
    ["an app switch", "Tab"],
  ])("never reveals after %s", (_label, key) => {
    watch();

    fireEvent.keyDown(document.body, { key: "Meta", metaKey: true });
    fireEvent.keyDown(document.body, { key, metaKey: true });
    act(() => {
      vi.advanceTimersByTime(REVEAL_MS * 4);
    });

    expect(chordRevealed()).toBe(false);
  });

  it("leaves a reveal already on screen alone", () => {
    // The badges are being read by then, and blinking them out from under the
    // next press would be the wrong kind of helpful.
    watch();
    hold();

    fireEvent.keyDown(document.body, { key: "2", metaKey: true });

    expect(chordRevealed()).toBe(true);
  });

  it("re-arms once the key comes back up", () => {
    watch();
    fireEvent.keyDown(document.body, { key: "Meta", metaKey: true });
    fireEvent.keyDown(document.body, { key: "c", metaKey: true });
    fireEvent.keyUp(document.body, { key: "Meta", metaKey: false });

    hold();

    expect(chordRevealed()).toBe(true);
  });
});

describe("letting go", () => {
  it("hides when the modifier's own key comes up", () => {
    watch();
    hold();

    fireEvent.keyUp(document.body, { key: "Meta", metaKey: false });

    expect(chordRevealed()).toBe(false);
  });

  it("hides on any key-up that reports the modifier released", () => {
    watch();
    hold();

    fireEvent.keyUp(document.body, { key: "Shift", metaKey: false });

    expect(chordRevealed()).toBe(false);
  });
});

describe("a key-up that never arrives", () => {
  // ⌘Tab hands the app away mid-hold; the menu bar does the same; Spotlight
  // takes the press and never hands the release back.

  it("hides when the window loses focus", () => {
    watch();
    hold();

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(chordRevealed()).toBe(false);
  });

  it("hides when the window is hidden", () => {
    watch();
    hold();
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(chordRevealed()).toBe(false);
  });

  it("heals on the first twitch of the mouse", () => {
    // Every mouse event carries the modifier state as the window server knows
    // it, which is the belt to the blur listener's brace.
    watch();
    hold();

    fireEvent.mouseMove(document.body, { metaKey: false });

    expect(chordRevealed()).toBe(false);
  });

  it("stays up while the mouse moves with the key still down", () => {
    watch();
    hold();

    fireEvent.mouseMove(document.body, { metaKey: true });

    expect(chordRevealed()).toBe(true);
  });
});

describe("the watcher itself", () => {
  it("leaves nothing revealed when it unmounts", () => {
    // The store is module-level and would otherwise outlive its watcher.
    const { unmount } = watch();
    hold();

    unmount();

    expect(chordRevealed()).toBe(false);
  });

  it("hears nothing after that", () => {
    const { unmount } = watch();
    unmount();

    hold();

    expect(chordRevealed()).toBe(false);
  });
});
