/** @vitest-environment happy-dom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "./test-support/dom";
import { backTarget, goBack, isBackButton, useBackTarget } from "./back";

// The listeners around this registry are covered in backHook.test.ts; this file
// is about which target is registered and what going back calls.

/** A mousedown as the webview would deliver it. `buttons` defaults to the bit
 *  for `button`, which is what a real press sets. */
function press(button: number, buttons = BUTTONS[button] ?? 0) {
  return new MouseEvent("mousedown", { button, buttons });
}

/** The DOM's `MouseEvent.buttons` bits, by button number. */
const BUTTONS: Record<number, number> = { 0: 1, 1: 4, 2: 2, 3: 8, 4: 16 };

/** Register a target, handing back its spy and a way to toggle `active`. */
function register(label = "Todo", active = true) {
  const back = vi.fn();
  const view = renderHook(
    ({ on }: { on: boolean }) => useBackTarget({ label, back }, on),
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
