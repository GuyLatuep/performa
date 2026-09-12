/** @vitest-environment happy-dom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";
import {
  backTarget,
  clearForward,
  forwardDepth,
  goBack,
  goForward,
  isBackButton,
  isBackShortcut,
  isForwardButton,
  isForwardShortcut,
  useBackTarget,
} from "./back";

// The listeners around this registry are covered in backHook.test.ts; this file
// is about which target is registered and what going back calls.

/** A mousedown as the webview would deliver it. `buttons` defaults to the bit
 *  for `button`, which is what a real press sets. */
function press(button: number, buttons = BUTTONS[button] ?? 0) {
  return new MouseEvent("mousedown", { button, buttons });
}

/** The DOM's `MouseEvent.buttons` bits, by button number. */
const BUTTONS: Record<number, number> = { 0: 1, 1: 4, 2: 2, 3: 8, 4: 16 };

// The redo stack is module-level and outlives a test, which is the whole
// point of it — so each one starts from empty deliberately.
beforeEach(clearForward);

/** Register a target, handing back its spy and a way to toggle `active`. */
function register(label = "Todo", active = true, forward?: () => void) {
  const back = vi.fn();
  const view = renderHook(
    ({ on }: { on: boolean }) => useBackTarget({ label, back, forward }, on),
    { initialProps: { on: active } },
  );
  return { back, ...view };
}

describe("isBackButton", () => {
  it("is true for the standard back button", () => {
    expect(isBackButton(press(3))).toBe(true);
  });

  it("is true for the back button on a pre-2025 WebKit, which called it the middle one", () => {
    // macOS reported the fourth and fifth buttons as the middle button until
    // webkit.org/b/280755. `buttons` was right there all along.
    expect(isBackButton(press(1, 8))).toBe(true);
  });

  it.each([
    ["left", 0],
    ["middle", 1],
    ["right", 2],
    ["forward", 4],
  ])("is false for the %s button", (_label, button) => {
    expect(isBackButton(press(button))).toBe(false);
  });

  it("is false for a left click while the back button is held", () => {
    // `buttons` carries every button down, so reading it alone would take this
    // for a back press. Which button was *pressed* is what `button` says.
    expect(isBackButton(press(0, 1 | 8))).toBe(false);
  });
});

describe("isForwardButton", () => {
  it("is true for the standard forward button", () => {
    expect(isForwardButton(press(4))).toBe(true);
  });

  it("is true for it on a pre-2025 WebKit, which called it the middle one", () => {
    expect(isForwardButton(press(1, 16))).toBe(true);
  });

  it.each([
    ["left", 0],
    ["middle", 1],
    ["right", 2],
    ["back", 3],
  ])("is false for the %s button", (_label, button) => {
    expect(isForwardButton(press(button))).toBe(false);
  });
});

describe("isBackShortcut", () => {
  /** A keypress as the webview would deliver it. */
  function key(k: string, mods: Partial<KeyboardEventInit> = {}) {
    return new KeyboardEvent("keydown", { key: k, ...mods });
  }

  it.each([
    ["⌘[", "[", { metaKey: true }],
    ["⌘←", "ArrowLeft", { metaKey: true }],
    ["⌥←", "ArrowLeft", { altKey: true }],
  ])("is true for %s", (_label, k, mods) => {
    expect(isBackShortcut(key(k, mods))).toBe(true);
  });

  it.each([
    ["a bare [", "[", {}],
    ["a bare arrow", "ArrowLeft", {}],
    ["the other direction", "ArrowRight", { metaKey: true }],
    ["the other bracket", "]", { metaKey: true }],
    ["⌥[", "[", { altKey: true }],
  ])("is false for %s", (_label, k, mods) => {
    expect(isBackShortcut(key(k, mods))).toBe(false);
  });

  it("is false for ⌃⌘←, which belongs to Spaces", () => {
    // Taking a system chord would move the desktop and the view at once.
    expect(
      isBackShortcut(key("ArrowLeft", { metaKey: true, ctrlKey: true })),
    ).toBe(false);
  });
});

describe("the registered target", () => {
  it("is nothing when no screen has a way out", () => {
    expect(backTarget()).toBeNull();
    expect(goBack()).toBe(false);
  });

  it("is the screen that registered, by label", () => {
    register("PERF-12");

    expect(backTarget()?.label).toBe("PERF-12");
  });

  it("goes back through the screen's own function", () => {
    const { back } = register();

    expect(goBack()).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("keeps up with a label that changes without re-registering", () => {
    // The trail renames the way out on every hop; re-running the effect for
    // that would drop and re-take the slot on an ordinary render.
    const back = vi.fn();
    const { rerender } = renderHook(
      ({ label }: { label: string }) => useBackTarget({ label, back }),
      { initialProps: { label: "Todo" } },
    );

    rerender({ label: "PERF-9" });

    expect(backTarget()?.label).toBe("PERF-9");
  });

  it("calls the newest version of a function that changed", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ back }: { back: () => void }) =>
        useBackTarget({ label: "Todo", back }),
      { initialProps: { back: first } },
    );

    rerender({ back: second });
    goBack();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("is nothing while the screen is switched off", () => {
    register("Todo", false);

    expect(backTarget()).toBeNull();
  });

  it("goes away when the screen unmounts", () => {
    const { unmount } = register();

    unmount();

    expect(backTarget()).toBeNull();
  });

  it("leaves the slot to whoever took it, however the commits interleave", () => {
    // React commits every cleanup before every setup, so a screen replacing
    // another sees the outgoing one's cleanup run *after* it has claimed the
    // slot. Clearing unconditionally there would leave no way out at all.
    const outgoing = register("Todo");
    register("Mentions");

    outgoing.unmount();

    expect(backTarget()?.label).toBe("Mentions");
  });
});

describe("isForwardShortcut", () => {
  function key(k: string, mods: Partial<KeyboardEventInit> = {}) {
    return new KeyboardEvent("keydown", { key: k, ...mods });
  }

  it.each([
    ["⌘]", "]", { metaKey: true }],
    ["⌘→", "ArrowRight", { metaKey: true }],
    ["⌥→", "ArrowRight", { altKey: true }],
  ])("is true for %s", (_label, k, mods) => {
    expect(isForwardShortcut(key(k, mods))).toBe(true);
  });

  it("is false for the back chords", () => {
    expect(isForwardShortcut(key("[", { metaKey: true }))).toBe(false);
    expect(isForwardShortcut(key("ArrowLeft", { metaKey: true }))).toBe(false);
  });

  it("is false for ⌃⌘→, which belongs to Spaces", () => {
    expect(
      isForwardShortcut(key("ArrowRight", { metaKey: true, ctrlKey: true })),
    ).toBe(false);
  });
});

describe("going forward", () => {
  it("does nothing when nothing has been backed out of", () => {
    expect(goForward()).toBe(false);
  });

  it("re-enters what was just left", () => {
    const forward = vi.fn();
    register("PERF-1", true, forward);

    goBack();

    expect(forwardDepth()).toBe(1);
    expect(goForward()).toBe(true);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("spends the step, so a second press does nothing", () => {
    const forward = vi.fn();
    register("PERF-1", true, forward);
    goBack();

    goForward();
    goForward();

    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("stacks hops, coming back out of them newest first", () => {
    const first = vi.fn();
    const second = vi.fn();
    register("one", true, first).unmount();
    goBack();
    // The second screen registers where the first was.
    register("two", true, second);
    goBack();

    goForward();

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("forgets everything when a hop cannot be re-entered", () => {
    // A forward press must not skip the step it cannot redo and re-enter the
    // one below, which is a view the user left two navigations ago.
    const deeper = vi.fn();
    register("deeper", true, deeper).unmount();
    goBack();
    register("no way in"); // no forward
    goBack();

    expect(forwardDepth()).toBe(0);
    expect(goForward()).toBe(false);
  });

  it("forgets everything a new navigation invalidates", () => {
    const forward = vi.fn();
    register("PERF-1", true, forward);
    goBack();

    clearForward();

    expect(forwardDepth()).toBe(0);
    expect(forward).not.toHaveBeenCalled();
  });
});
