/** @vitest-environment happy-dom */
import { fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";
import { KONAMI_CODE, useKonamiCode } from "./konami";

// The pure rolling-window functions are covered in konami.test.ts; this file is
// about the hook around them — which keys it listens to, and when it is deaf.

/** Mount the watcher, handing back its spy and a way to toggle `active`. */
function watch(active = true) {
  const onEntered = vi.fn();
  const view = renderHook(
    ({ on }: { on: boolean }) => useKonamiCode(onEntered, on),
    { initialProps: { on: active } },
  );
  return { onEntered, ...view };
}

/** Press keys at `target`, so they bubble to the window listener with the
 *  target a real element — which is what the typing guard reads. */
function press(keys: string[], target: Element = document.body) {
  for (const key of keys) fireEvent.keyDown(target, { key });
}

/** An element in the page, since a detached one never reaches the window. */
function fieldOfType(tag: string, contentEditable = false) {
  const el = document.createElement(tag);
  if (contentEditable) el.contentEditable = "true";
  document.body.append(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useKonamiCode", () => {
  it("fires once the code lands", () => {
    const { onEntered } = watch();

    press(KONAMI_CODE);

    expect(onEntered).toHaveBeenCalledTimes(1);
  });

  it("fires on a code typed after other keys", () => {
    const { onEntered } = watch();

    press(["x", "Enter", "ArrowDown", ...KONAMI_CODE]);

    expect(onEntered).toHaveBeenCalledTimes(1);
  });

  it("does not fire on a near miss", () => {
    const { onEntered } = watch();

    press([...KONAMI_CODE.slice(0, -1), "x"]);

    expect(onEntered).not.toHaveBeenCalled();
  });

  it("re-arms, so the code can be entered twice", () => {
    // Entering it again is a whole fresh run of ten keys either way: the reset
    // on a hit and the rolling window that replaces it agree. What this pins
    // down is that a hit does not leave the watcher spent.
    const { onEntered } = watch();

    press(KONAMI_CODE);
    press(KONAMI_CODE);

    expect(onEntered).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["INPUT", "input"],
    ["TEXTAREA", "textarea"],
  ])("ignores the code typed into an %s", (_label, tag) => {
    // The letters at the end of the code are ordinary letters in a comment
    // box — firing there would hijack someone's typing.
    const { onEntered } = watch();

    press(KONAMI_CODE, fieldOfType(tag));

    expect(onEntered).not.toHaveBeenCalled();
  });

  it("ignores the code typed into a contenteditable", () => {
    const { onEntered } = watch();

    press(KONAMI_CODE, fieldOfType("div", true));

    expect(onEntered).not.toHaveBeenCalled();
  });

  it("still hears the code when a field merely has focus", () => {
    // The guard is about where the keys land, not what is focused elsewhere.
    fieldOfType("input");
    const { onEntered } = watch();

    press(KONAMI_CODE);

    expect(onEntered).toHaveBeenCalledTimes(1);
  });

  it("hears nothing while it is switched off", () => {
    const { onEntered } = watch(false);

    press(KONAMI_CODE);

    expect(onEntered).not.toHaveBeenCalled();
  });

  it("forgets a run that was in progress when it was switched off", () => {
    // Coming back to a half-entered code and finishing it would fire on a
    // sequence nobody actually typed in one go.
    const { onEntered, rerender } = watch();
    press(KONAMI_CODE.slice(0, -1));

    rerender({ on: false });
    rerender({ on: true });
    press(KONAMI_CODE.slice(-1));

    expect(onEntered).not.toHaveBeenCalled();
  });

  it("stops listening once it unmounts", () => {
    const { onEntered, unmount } = watch();

    unmount();
    press(KONAMI_CODE);

    expect(onEntered).not.toHaveBeenCalled();
  });
});
