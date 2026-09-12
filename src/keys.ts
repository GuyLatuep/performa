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
 * Input types holding words somebody would mind losing.
 *
 * A date box is pre-filled with today and a checkbox holds no words; neither is
 * a draft, and counting them as one would have a shortcut refuse to work from
 * the log form's date field, which has held a value since it mounted.
 */
const TEXTUAL = new Set([
  "",
  "text",
  "search",
  "url",
  "email",
  "tel",
  "password",
]);

/** A box words get typed into. Narrower than `typingIn`: a `<select>` is not
 *  one, however much it answers the arrow keys. */
export function textBox(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA") return true;
  return (
    el.tagName === "INPUT" && TEXTUAL.has((el as HTMLInputElement).type ?? "")
  );
}

/**
 * There is something typed and unsaved here.
 *
 * The guard for anything that would throw those words away — leaving the view,
 * switching tab, reloading the list. The "and something typed" half is what
 * makes it cheap enough to be true: no form registers anything, nothing can go
 * stale, and a box that has only just been focused does not hold the whole
 * keyboard hostage. A freshly opened form autofocuses its first field, and an
 * empty field is not a reason to refuse to go back out of it.
 *
 * What it deliberately does not cover is a draft in a box that no longer has
 * focus — the same exposure clicking the control has always had.
 */
export function drafting(target: EventTarget | null): boolean {
  if (!textBox(target)) return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return (el.textContent ?? "").trim() !== "";
  return (el as HTMLInputElement | HTMLTextAreaElement).value.trim() !== "";
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
