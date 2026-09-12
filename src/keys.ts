/**
 * What a key press is allowed to mean, for every listener in the app.
 *
 * Three window-level handlers already read the same two questions — is somebody
 * typing, and is something covering the page — and a fourth is on the way. They
 * live here so there is one answer rather than four that drift.
 */

/**
 * Somebody is typing here, so the keys belong to them.
 *
 * `⌘←` means "start of line" in a text box and Escape closes whatever the box
 * has open; taking either would be taking it out of the writer's hands. A
 * `<select>` is in the list for the same reason by a different route: it
 * answers the arrow keys itself, natively, and a list watching for ↑/↓ would
 * otherwise move its selection while the user is choosing an option.
 */
export function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    el?.tagName === "INPUT" ||
    el?.tagName === "TEXTAREA" ||
    el?.tagName === "SELECT" ||
    el?.isContentEditable === true
  );
}

/**
 * This element answers Enter and Space on its own.
 *
 * A native button fires its click on Enter *keydown*, so a window-level Enter
 * handler over a list would open the selected row *and* press whichever button
 * inside it happened to have focus. Nobody finds that until they Tab into a row
 * and press Enter, by which time it reads as a haunting.
 */
export function isActivatable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"].includes(
    el.tagName,
  );
}

/** Every modal in the app is a `.modal-backdrop`, and the field editor is a
 *  `role="dialog"` popover. Exported so anything drawing over the page can ask
 *  the same question with the same string. */
export const OVERLAY_SELECTOR = '.modal-backdrop, [role="dialog"]';

/** Something is overlaying the page.
 *
 *  Nothing that does so registers a way out with the navigation layer, and
 *  acting *behind* an open modal would leave it floating over a view it was
 *  never opened from. They keep their own ways out — a Cancel button, the
 *  backdrop, Escape — until they are taught to register too. */
export function overlayOpen(): boolean {
  return document.querySelector(OVERLAY_SELECTOR) !== null;
}
