import { useEffect, useRef, useState } from "react";
import { useChordRevealed, useChordWatcher } from "../chordReveal";
import { BadgePlacement, placeBadges } from "../shortcuts";

/**
 * Every shortcut badge in the app, in one layer over it.
 *
 * One layer rather than a badge per control, for two reasons that are really the
 * same one: a badge in the flow would shove its row sideways the moment the key
 * went down, and a badge inside a scrolling panel would be clipped by it.
 * Floating them at measured coordinates costs a measurement and buys both.
 *
 * Decorative, and marked so — the shortcut a screen reader is told about is the
 * `aria-keyshortcuts` that `useShortcut` puts on the control itself.
 */
export default function ShortcutBadges() {
  useChordWatcher();
  const revealed = useChordRevealed();
  const [badges, setBadges] = useState<BadgePlacement[]>([]);
  const shown = useRef("");

  useEffect(() => {
    if (!revealed) {
      shown.current = "";
      setBadges([]);
      return;
    }
    /**
     * Re-measured every frame while the key is held, rather than listening for
     * the things that could move a control.
     *
     * That list is long and open-ended — a panel scrolling, the window resizing,
     * a list finishing its load, a view's arrival animation — and a layer that
     * is right about most of them is a layer that is visibly wrong about the
     * rest. A frame's worth of `getBoundingClientRect` over a dozen nodes is
     * nothing, and this loop lives only for the second or two of a hold.
     */
    let frame = 0;
    const tick = () => {
      const next = placeBadges();
      // React would see a new array every frame otherwise.
      const signature = next
        .map((b) => `${b.id}@${b.x},${b.y}${b.standingDown ? "!" : ""}`)
        .join("|");
      if (signature !== shown.current) {
        shown.current = signature;
        setBadges(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [revealed]);

  if (badges.length === 0) return null;

  return (
    <div className="shortcut-layer" aria-hidden>
      {badges.map((b) => (
        // Keyed by id, so a repositioned badge moves an existing node rather
        // than replacing it — the entrance animation runs once, not per frame.
        <span
          key={b.id}
          className={`shortcut-badge${b.standingDown ? " standing-down" : ""}`}
          style={{ left: b.x, top: b.y }}
        >
          {b.key}
        </span>
      ))}
    </div>
  );
}
