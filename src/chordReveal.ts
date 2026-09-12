import { useEffect } from "react";
import { createStore } from "./store";
import { isMac } from "./platform";

/**
 * Whether the shortcut badges are showing.
 *
 * Deliberately not called "is ⌘ down": it is down for the first tenth of every
 * copy and paste, and the badges are not.
 */
const store = createStore(false);

export function chordRevealed(): boolean {
  return store.get();
}

export function useChordRevealed(): boolean {
  return store.use();
}

/**
 * How long the modifier must be held *alone* before the badges appear.
 *
 * A copy is ⌘-down-then-C inside about a tenth of a second; asking "what can I
 * do here" is a deliberate hold. 300ms is past every chord anybody types and
 * short enough that the answer feels like it was already there.
 */
export const REVEAL_MS = 300;

/** The key whose own keydown starts the reveal. */
function modifierKey(): string {
  return isMac() ? "Meta" : "Control";
}

/** Whether that modifier is down, read off either a keyboard or a mouse event —
 *  which is how a missed key-up heals itself. */
function modifierDown(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac() ? e.metaKey : e.ctrlKey;
}

/**
 * Watch for the hold. Mounted once, by the badge layer — its only consumer.
 */
export function useChordWatcher(): void {
  useEffect(() => {
    let pending: number | undefined;
    /** Raised once this hold has been spent on something — ⌘C, ⌘Tab, ⌘1 — and
     *  lowered only when the key comes back up. Without it, holding ⌘ for a beat
     *  after every copy would flash the whole layer. */
    let spent = false;

    const hide = () => {
      window.clearTimeout(pending);
      pending = undefined;
      spent = false;
      store.set(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === modifierKey()) {
        // A held modifier repeats its keydown on some platforms.
        if (pending !== undefined || spent || store.get()) return;
        pending = window.setTimeout(() => {
          pending = undefined;
          store.set(true);
        }, REVEAL_MS);
        return;
      }
      // Ordinary typing is none of this listener's business.
      if (!modifierDown(e)) return;
      // A chord completed, so this hold was not a question. The pending reveal
      // is cancelled; one already on screen is left alone, because the badges
      // are being read and blinking them out from under the next press would be
      // the wrong kind of helpful.
      window.clearTimeout(pending);
      pending = undefined;
      spent = true;
    };

    const onKeyUp = (e: KeyboardEvent) => {
      // Either spelling: the modifier's own key-up reports it released, and any
      // other key-up carries the live modifier state.
      if (e.key === modifierKey() || !modifierDown(e)) hide();
    };

    /**
     * Every way the key-up can go missing, and one answer to all of them.
     *
     * ⌘Tab hands the app away mid-hold; the menu bar does the same; Mission
     * Control and Spotlight take the press and never hand the release back. In
     * each case the window loses focus first, so `blur` is the primary catch.
     *
     * The pointer listeners are the belt to that brace: every mouse event
     * carries `metaKey` as the window server currently knows it, so the first
     * twitch of the trackpad after a lost key-up corrects the state. Two field
     * reads per event, and only while something is pending or showing.
     */
    const onPointer = (e: MouseEvent) => {
      if (pending === undefined && !store.get()) return;
      if (!modifierDown(e)) hide();
    };
    const onVisibility = () => {
      if (document.hidden) hide();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", hide);
    window.addEventListener("mousemove", onPointer);
    window.addEventListener("mousedown", onPointer);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      // A reveal must not outlive its watcher: the store is module-level.
      hide();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", hide);
      window.removeEventListener("mousemove", onPointer);
      window.removeEventListener("mousedown", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
