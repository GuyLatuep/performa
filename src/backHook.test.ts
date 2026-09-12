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

import {
  clearForward,
  NAVIGATE_BACK,
  NAVIGATE_FORWARD,
  useBackGestures,
  useBackTarget,
} from "./back";

// The registry itself is covered in back.test.ts; this file is about the
// listener over it — which presses reach it, and when it stays out of the way.

/** Mount the listener with a target behind it, handing back its spies. */
function listen_() {
  const back = vi.fn();
  const forward = vi.fn();
  renderHook(() => useBackTarget({ label: "Todo", back, forward }));
  renderHook(() => useBackGestures());
  return { back, forward };
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

/** Press a key at `target`, so it bubbles to the window listener with the
 *  target a real element — which is what the typing guard reads. */
function pressKey(
  key: string,
  mods: Partial<KeyboardEventInit> = {},
  target: Element = document.body,
) {
  fireEvent.keyDown(target, { key, ...mods });
}

/** An element in the page, since a detached one never reaches the window. */
function fieldOfType(tag: string, contentEditable = false) {
  const el = document.createElement(tag);
  if (contentEditable) el.contentEditable = "true";
  document.body.append(el);
  return el;
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
  clearForward();
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
  ])("does not go back on the %s button", (_label, button, buttons) => {
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

  it("unsubscribes from both swipes once it unmounts", async () => {
    const { unmount } = renderHook(() => useBackGestures());
    await subscribed();
    // Cleared here rather than between tests: the automatic cleanup unmounts
    // the earlier hooks after this file's own afterEach has already run.
    events.unlisten.mockClear();

    unmount();

    // One each for the two directions.
    expect(events.unlisten).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["Escape", "Escape", {}],
    ["⌘[", "[", { metaKey: true }],
    ["⌘←", "ArrowLeft", { metaKey: true }],
    ["⌥←", "ArrowLeft", { altKey: true }],
  ])("goes back on %s", (_label, key, mods) => {
    const { back } = listen_();

    pressKey(key, mods);

    expect(back).toHaveBeenCalledTimes(1);
  });

  it("ignores a key nobody means as a way back", () => {
    const { back } = listen_();

    pressKey("a");
    pressKey("ArrowLeft");

    expect(back).not.toHaveBeenCalled();
  });

  it.each([
    ["an INPUT", "input", false],
    ["a TEXTAREA", "textarea", false],
    ["a SELECT", "select", false],
    ["a contenteditable", "div", true],
  ])("leaves Escape to whoever is typing in %s", (_label, tag, editable) => {
    // Escape closes what the box has open, and ⌘← goes to the start of the
    // line. Taking either would take it out of the writer's hands.
    const { back } = listen_();

    pressKey("Escape", {}, fieldOfType(tag, editable));
    pressKey("ArrowLeft", { metaKey: true }, fieldOfType(tag, editable));

    expect(back).not.toHaveBeenCalled();
  });

  it("leaves a press something nearer has already claimed", () => {
    // The pickers close their suggestion lists on Escape and call
    // preventDefault on the way; that Escape is theirs, not a request to leave
    // the view they sit in.
    const { back } = listen_();
    const picker = fieldOfType("div");
    picker.addEventListener("keydown", (e) => e.preventDefault());

    pressKey("Escape", {}, picker);

    expect(back).not.toHaveBeenCalled();
  });

  it("still hears a press the same element let through", () => {
    // Only a *claimed* press is somebody else's — the guard must not deafen
    // the app to every key that happens to pass an element with a listener.
    const { back } = listen_();
    const plain = fieldOfType("div");
    plain.addEventListener("keydown", () => {});

    pressKey("Escape", {}, plain);

    expect(back).toHaveBeenCalledTimes(1);
  });

  it("does not go back on Escape behind an overlay", () => {
    const { back } = listen_();
    overlay("modal-backdrop");

    pressKey("Escape");

    expect(back).not.toHaveBeenCalled();
  });

  it("stops listening for keys once it unmounts", () => {
    const back = vi.fn();
    renderHook(() => useBackTarget({ label: "Todo", back }));
    const { unmount } = renderHook(() => useBackGestures());

    unmount();
    pressKey("Escape");

    expect(back).not.toHaveBeenCalled();
  });

  it.each([
    ["the mouse's forward button", () => pressMouse(4, 16)],
    ["⌘]", () => pressKey("]", { metaKey: true })],
    ["⌘→", () => pressKey("ArrowRight", { metaKey: true })],
    ["⌥→", () => pressKey("ArrowRight", { altKey: true })],
  ])("re-enters on %s", (_label, press) => {
    const { back, forward } = listen_();
    pressKey("Escape"); // something to come forward from

    press();

    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("re-enters on the forward swipe", async () => {
    const { forward } = listen_();
    await subscribed();
    await act(async () => events.fire(NAVIGATE_BACK));

    await act(async () => events.fire(NAVIGATE_FORWARD));

    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("does nothing forward when nothing has been backed out of", () => {
    const { forward } = listen_();

    pressMouse(4, 16);

    expect(forward).not.toHaveBeenCalled();
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
