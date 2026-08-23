import { RefObject, useEffect } from "react";

/**
 * Close something floating when the next click lands outside it.
 *
 * Anything that overlays the page owes the reader a way out that isn't a
 * button: clicking elsewhere is what people try first, and a picker that stays
 * up afterwards reads as stuck.
 *
 * Listens on `pointerdown` rather than `click`. A picker's own options are
 * chosen on mousedown — they have to be, or the field would blur before a
 * click ever landed — so waiting for `click` would dismiss the list in the
 * same gesture that picks from it.
 */
export function useDismissOnOutside(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  active = true,
): void {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) onDismiss();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [ref, onDismiss, active]);
}
