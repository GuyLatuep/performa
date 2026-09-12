/** @vitest-environment happy-dom */
import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";

// The swipe arrives from Rust rather than from the DOM, so the bridge is stood
// up here — the shared setup's stub only keeps mounting from throwing.
const events = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  const unlisten = vi.fn();
  return {
    unlisten,
    fire: (name: string) => handlers.get(name)?.(),
    listen: vi.fn(async (name: string, cb: () => void) => {
      handlers.set(name, cb);
      return unlisten;
    }),
    reset: () => handlers.clear(),
  };
});
vi.mock("@tauri-apps/api/event", () => ({ listen: events.listen }));

import { NAVIGATE_BACK, useBackGestures, useBackTarget } from "./back";

// The registry itself is covered in back.test.ts; this file is about the
// listener over it — which presses reach it, and when it stays out of the way.

/** Mount the listener with a target behind it, handing back its spy. */
function listen_() {
  const back = vi.fn();
  renderHook(() => useBackTarget({ label: "Todo", back }));
  renderHook(() => useBackGestures());
  return { back };
}

/** Press at `target`, so it bubbles to the window listener with the target a
 *  real element — which is what the overlay guard reads around. */
function pressMouse(
  button: number,
  buttons: number,
  target: Element = document.body,
) {
  fireEvent.mouseDown(target, { button, buttons });
}

/** Put an overlay in the page, the way every modal and the field editor do. */
function overlay(className: string, role?: string) {
  const el = document.createElement("div");
  el.className = className;
  if (role) el.setAttribute("role", role);
  document.body.append(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  events.reset();
});

/** Let the subscription to Rust settle — `listen` is a round trip. */
async function subscribed() {
  await act(async () => {});
}

describe("useBackGestures", () => {
  it("goes back on the mouse's back button", () => {
    const { back } = listen_();

    pressMouse(3, 8);

    expect(back).toHaveBeenCalledTimes(1);
  });

  it("goes back on a pre-2025 WebKit, which called that button the middle one", () => {
    const { back } = listen_();

    pressMouse(1, 8);

    expect(back).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["left", 0, 1],
    ["middle", 1, 4],
    ["right", 2, 2],
    ["forward", 4, 16],
  ])("ignores the %s button", (_label, button, buttons) => {
    const { back } = listen_();

    pressMouse(button, buttons);

    expect(back).not.toHaveBeenCalled();
  });

  it.each([
    ["a modal", "modal-backdrop", undefined],
    ["the field editor", "field-editor", "dialog"],
  ])("does not go back behind %s", (_label, className, role) => {
    // Nothing overlaying the page registers a way out, so going back would
    // leave it floating over a view it was never opened from.
    const { back } = listen_();
    overlay(className, role);

    pressMouse(3, 8);

    expect(back).not.toHaveBeenCalled();
  });

  it("goes back again once the overlay is gone", () => {
    const { back } = listen_();
    overlay("modal-backdrop").remove();

    pressMouse(3, 8);

    expect(back).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no screen has a way out", () => {
    // The plain tab views are already as far back as the app goes.
    renderHook(() => useBackGestures());

    expect(() => pressMouse(3, 8)).not.toThrow();
  });

  it("stops listening once it unmounts", () => {
    const back = vi.fn();
    renderHook(() => useBackTarget({ label: "Todo", back }));
    const { unmount } = renderHook(() => useBackGestures());

    unmount();
    pressMouse(3, 8);

    expect(back).not.toHaveBeenCalled();
  });

  it("goes back on a swipe, which is what a mouse driver may send instead", async () => {
    // Logitech's Options+ and its like claim the thumb buttons and emit a
    // gesture, which reaches no mouse event at all. It is caught natively and
    // arrives here as an ordinary Tauri event.
    const { back } = listen_();
    await subscribed();

    await act(async () => events.fire(NAVIGATE_BACK));

    expect(back).toHaveBeenCalledTimes(1);
  });

  it("does not go back on a swipe behind an overlay either", async () => {
    const { back } = listen_();
    await subscribed();
    overlay("modal-backdrop");

    await act(async () => events.fire(NAVIGATE_BACK));

    expect(back).not.toHaveBeenCalled();
  });

  it("unsubscribes from the swipe once it unmounts", async () => {
    const { unmount } = renderHook(() => useBackGestures());
    await subscribed();
    // Cleared here rather than between tests: the automatic cleanup unmounts
    // the earlier hooks after this file's own afterEach has already run.
    events.unlisten.mockClear();

    unmount();

    expect(events.unlisten).toHaveBeenCalledTimes(1);
  });

  it("stops the webview taking the press for a history navigation of its own", () => {
    listen_();
    const event = new MouseEvent("mousedown", {
      button: 3,
      buttons: 8,
      bubbles: true,
      cancelable: true,
    });

    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
