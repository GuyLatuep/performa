import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Where "back" leads right now.
 *
 * performa has no router and no history: every view is a nullable in the
 * component above it. So rather than replaying a trail of past states, whichever
 * screen is showing a Back control says so here, and the back gesture calls the
 * very same function the visible button calls. The two cannot drift apart,
 * because there is only one of them.
 *
 * At most one target is ever registered. About and Settings replace the whole
 * shell, the log form and the issue view live in different tabs, and the issue
 * view resolves its own nesting (the link trail, an open transition screen)
 * before it gets here — so a stack would be a stack of one.
 */
export interface BackTarget {
  /** What the Back control on screen says, e.g. "Todo" or "PERF-12". */
  label: string;
  /** Leave this view. The same function the visible Back button calls. */
  back: () => void;
}

/** The mounted screen's own box, so re-registering is not needed every time
 *  its closure changes — which is every render. */
type Slot = { current: BackTarget };

let registered: Slot | null = null;

/** What a back gesture would do, or null when nothing on screen has a way out
 *  — the plain tab views, which are already as far back as the app goes. */
export function backTarget(): BackTarget | null {
  return registered?.current ?? null;
}

/**
 * Register this screen as where back leads while `active`.
 *
 * `target` may be a fresh object on every render; only `active` re-registers.
 */
export function useBackTarget(target: BackTarget, active = true): void {
  const slot = useRef(target);
  // In an effect rather than during render: a gesture can only arrive between
  // commits, by which time this has run.
  useEffect(() => {
    slot.current = target;
  });

  useEffect(() => {
    if (!active) return;
    registered = slot;
    return () => {
      // Guarded because React commits every cleanup before every setup: when
      // one screen replaces another, the outgoing view's cleanup may well run
      // after the incoming one has already claimed the slot.
      if (registered === slot) registered = null;
    };
  }, [active]);
}

/** Go back, if there is anywhere to go. True when something happened. */
export function goBack(): boolean {
  const target = backTarget();
  if (!target) return false;
  target.back();
  return true;
}

/**
 * True for the mouse's back button.
 *
 * `button === 3` is the standard mapping, and what Chromium has always
 * reported. WebKit only started reporting it on macOS in December 2025
 * (webkit.org/b/280755); before that the fourth and fifth buttons both arrived
 * labelled as the middle one. `MouseEvent.buttons` was right either way there —
 * it comes straight from `[NSEvent pressedMouseButtons]`, whose bitmask happens
 * to be the DOM one — so the second clause covers the older WebKits without
 * catching a real middle click, which sets bit 4 rather than bit 8.
 *
 * Read on `mousedown`: `buttons` is already 0 by `mouseup` and `auxclick`.
 */
export function isBackButton(e: MouseEvent): boolean {
  return e.button === 3 || (e.button === 1 && (e.buttons & 8) !== 0);
}

/** Anything overlaying the page: every modal in the app is a `.modal-backdrop`
 *  and the field editor is a `role="dialog"` popover.
 *
 *  None of them registers a back target, and going back *behind* an open modal
 *  would leave it floating over a view it was never opened from. They keep
 *  their own ways out (a Cancel button, the backdrop, Escape) until they are
 *  taught to register too. */
function overlayOpen(): boolean {
  return document.querySelector('.modal-backdrop, [role="dialog"]') !== null;
}

/** The Rust side's name for a swipe towards the right — see
 *  `src-tauri/src/gestures.rs`. */
export const NAVIGATE_BACK = "navigate-back";

/** The back gesture itself. Mounted once, in App.
 *
 *  Two sources, because a mouse's back button is not one thing. Windows hands
 *  it to the webview as a fourth-button `mousedown`; a Mac with a driver like
 *  Logitech's Options+ claims the button and emits a swipe gesture instead,
 *  which reaches no webview event at all and has to be caught natively. The
 *  same swipe is what two fingers on a trackpad produce, so the second source
 *  is the standard macOS way back as much as it is the mouse's. */
export function useBackGestures(): void {
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!isBackButton(e)) return;
      // Chromium treats the button as a history navigation of its own unless
      // this is called. There is no history here to navigate, but a webview
      // deciding otherwise would be hard to see and harder to debug.
      e.preventDefault();
      if (overlayOpen()) return;
      goBack();
    };
    window.addEventListener("mousedown", onMouseDown);

    let unlisten: (() => void) | undefined;
    let gone = false;
    listen(NAVIGATE_BACK, () => {
      if (!overlayOpen()) goBack();
    }).then((fn) => {
      // Subscribing is a round trip to Rust, and a fast unmount can beat it.
      if (gone) fn();
      else unlisten = fn;
    });

    return () => {
      gone = true;
      unlisten?.();
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, []);
}
