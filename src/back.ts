import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { drafting, overlayOpen } from "./keys";
import { hasPrimaryModifier } from "./platform";

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
  /** Re-enter it, undoing exactly the step `back` takes. Read at the moment
   *  back is pressed, so a screen that leaves by several different routes can
   *  offer the matching way in for whichever one it just took.
   *
   *  Omitted where re-entering is not something anybody reaches for; backing
   *  out of such a screen empties the redo stack rather than leaving a
   *  forward press to skip the hop that cannot be redone. */
  forward?: () => void;
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
  // Published during render, the same as the shortcut and selection registries:
  // a gesture arriving in the same frame as a re-render would otherwise be
  // answered by the target from the render before it.
  slot.current = target;

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

/** Ways back in to what has been backed out of, deepest last.
 *
 *  Module-level, like the slot above: it outlives the screens it refers to,
 *  which is the whole point — the thunk is what re-mounts one. */
const redo: (() => void)[] = [];

/** How many steps forward are available. For tests and for anything that wants
 *  to know whether a forward press would do anything. */
export function forwardDepth(): number {
  return redo.length;
}

/** Drop the redo stack. Any *new* navigation invalidates it: going somewhere
 *  else and then forward would otherwise re-enter a view from a trail the user
 *  has already left. */
export function clearForward(): void {
  redo.length = 0;
}

/** Go back, if there is anywhere to go. True when something happened. */
export function goBack(): boolean {
  const target = backTarget();
  if (!target) return false;
  const { forward } = target;
  target.back();
  // Read before `back` runs and pushed after: the thunk closes over the state
  // the screen was in, which `back` is in the middle of changing.
  if (forward) redo.push(forward);
  else clearForward();
  return true;
}

/** Re-enter the last view backed out of. True when something happened. */
export function goForward(): boolean {
  const forward = redo.pop();
  if (!forward) return false;
  forward();
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

/** The same, one button along — bit 16 rather than bit 8. */
export function isForwardButton(e: MouseEvent): boolean {
  return e.button === 4 || (e.button === 1 && (e.buttons & 16) !== 0);
}

/**
 * True for a keyboard way back.
 *
 * Three spellings, all of them somebody's standard. `⌘[` is what Safari uses
 * and what a Mac user reaches for; `⌘←` is the same thing on a keyboard where
 * `[` is not a key of its own — on a German layout it costs `⌥5`, which is not
 * a shortcut anybody would find. `⌥←` is the Windows one, and harmless on a
 * Mac, where nothing else claims it outside a text box.
 *
 * The bracket and arrow spellings go through `hasPrimaryModifier`, so the chord
 * is ⌘ on a Mac and Ctrl on Windows — the same rule the shortcut catalogue
 * matches by, and the reason the badge on a Back button can be trusted on both.
 * (`⌃⌘←` is Spaces' and is rejected there, as it was before.) `Ctrl+←` is
 * "previous word" inside a text box on Windows, which the typing guard in the
 * handler already stands down for.
 *
 * Shift disqualifies all three. `hasPrimaryModifier` is deliberately indifferent
 * to it — the shortcut catalogue uses Shift to spell a second variant of an
 * action whose plain chord is taken, and `⌘⇧←` is exactly that: the timesheet's
 * previous period. Matching it here would have this handler swallow the press
 * and `preventDefault` it, and the shortcut dispatcher would then stand aside
 * from a key it was the rightful owner of.
 */
export function isBackShortcut(e: KeyboardEvent): boolean {
  if (e.shiftKey) return false;
  if (hasPrimaryModifier(e)) return e.key === "[" || e.key === "ArrowLeft";
  return e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowLeft";
}

/** The other direction, spelled the three matching ways. */
export function isForwardShortcut(e: KeyboardEvent): boolean {
  if (e.shiftKey) return false;
  if (hasPrimaryModifier(e)) return e.key === "]" || e.key === "ArrowRight";
  return e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowRight";
}

/** The Rust side's name for a swipe towards the right — see
 *  `src-tauri/src/gestures.rs`. */
export const NAVIGATE_BACK = "navigate-back";

/** And towards the left. */
export const NAVIGATE_FORWARD = "navigate-forward";

/** The back gesture itself. Mounted once, in App.
 *
 *  Two sources, because a mouse's back button is not one thing. Windows hands
 *  it to the webview as a fourth-button `mousedown`; a Mac with a driver like
 *  Logitech's Options+ claims the button and emits a swipe gesture instead,
 *  which reaches no webview event at all and has to be caught natively. The
 *  same swipe is what two fingers on a trackpad produce, so the second source
 *  is the standard macOS way back as much as it is the mouse's.
 *
 *  Escape and the back chords join them: the app had no answer to either, and
 *  a reader who has just opened an issue reaches for Escape before they reach
 *  for anything else. */
export function useBackGestures(): void {
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const back = isBackButton(e);
      if (!back && !isForwardButton(e)) return;
      // Chromium treats these buttons as a history navigation of its own
      // unless this is called. There is no history here to navigate, but a
      // webview deciding otherwise would be hard to see and harder to debug.
      // Unconditional here, unlike the key handler below, for that reason.
      e.preventDefault();
      // The same draft rule the keyboard follows. It was missing here, and the
      // omission was the wrong way round: a thumb button caught in passing is
      // the *least* deliberate way to leave a view, and it was the one with no
      // protection. `activeElement` rather than the event's target, which for a
      // mouse press is wherever the pointer happened to be.
      if (drafting(document.activeElement) || overlayOpen()) return;
      if (back) goBack();
      else goForward();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // Somebody nearer the key has already dealt with it — the pickers close
      // their suggestion lists on Escape, and that Escape is theirs, not a
      // request to leave the view they are being typed into.
      if (e.defaultPrevented) return;
      // A held key repeats, and going back is a step rather than a rate: a held
      // Escape in the issue view would rewind several hops of the link trail on
      // one press, pushing a redo entry for each. The arrow keys over a list are
      // the one place repeating is the point, and they are handled elsewhere.
      if (e.repeat) return;
      const back = e.key === "Escape" || isBackShortcut(e);
      if (!back && !isForwardShortcut(e)) return;
      // Only a box with something *in* it stands in the way. A form that has
      // just opened autofocuses its first field, and an empty field is no reason
      // to refuse to leave the view it is in — which is what a blanket
      // "is anybody typing" guard did, making ⌘[ dead on arrival at the log
      // form. Where the field does hold words, `⌘←` is "start of line" and
      // Escape is the box's own, and both stay the writer's.
      if (drafting(e.target) || overlayOpen()) return;
      // Claimed only once something actually happened. `goForward` returns false
      // whenever the redo stack is empty, which is nearly always — so swallowing
      // the press regardless left `⌘→` dead app-wide, including in the boxes
      // where it means "end of line", and marked a bare Escape as handled on a
      // plain tab view, which deafens the two sibling listeners for a key this
      // one then declined to act on.
      if (back ? goBack() : goForward()) e.preventDefault();
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);

    const unlisten: (() => void)[] = [];
    let gone = false;
    const subscribe = (name: string, run: () => void) =>
      listen(name, () => {
        // The same draft rule as the other two paths. A swipe is the least
        // deliberate of the three — a trackpad catches one in passing — so it is
        // the last place that should be able to discard what somebody typed.
        if (drafting(document.activeElement) || overlayOpen()) return;
        run();
      }).then((fn) => {
        // Subscribing is a round trip to Rust, and a fast unmount can beat it.
        if (gone) fn();
        else unlisten.push(fn);
      });
    subscribe(NAVIGATE_BACK, goBack);
    subscribe(NAVIGATE_FORWARD, goForward);

    return () => {
      gone = true;
      unlisten.forEach((fn) => fn());
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
