/**
 * What a key press is allowed to mean, for every listener in the app.
 *
 * Five listeners now read the same three questions — is somebody typing, is
 * there something unsaved, and is something covering the page. They live here so
 * there is one answer rather than five that drift.
 */

import { useEffect, useRef } from "react";

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
  // A number box holds something typed as much as a text one does — the daily
  // hours, a duration. It is only the *pre-filled* kinds below that are not
  // drafts.
  "number",
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
 * Forms that say they are holding something unsaved.
 *
 * The focused box answers for itself — see [`drafting`] — but a form is more
 * than the box the cursor happens to be in. The log form has a duration, a date,
 * a time and a comment: with the cursor in the date field, which is pre-filled
 * and therefore not a draft, Escape used to leave and take the typed duration
 * and comment with it. A form that knows it holds words says so here, and then
 * the question is about the form rather than about one of its fields.
 *
 * Identity is a box per mounted form rather than a count, so a form that
 * unmounts mid-edit takes its own entry with it and cannot leave the count
 * standing.
 */
const holding = new Set<object>();

/**
 * Say that this form holds something the user would mind losing.
 *
 * Registered only while `unsaved` — a form that has just opened, or has just
 * been submitted, holds nothing, and an empty form must not hold the keyboard
 * hostage.
 */
export function useUnsavedWork(unsaved: boolean): void {
  const token = useRef({});
  useEffect(() => {
    if (!unsaved) return;
    // Captured, so the cleanup removes the entry it added rather than whatever
    // the ref points at by then.
    const mine = token.current;
    holding.add(mine);
    return () => {
      holding.delete(mine);
    };
  }, [unsaved]);
}

/** Whether any mounted form is holding unsaved work. */
export function anythingUnsaved(): boolean {
  return holding.size > 0;
}

/**
 * There is something typed and unsaved.
 *
 * The guard for anything that would throw those words away — leaving the view,
 * switching tab, reloading the list. Two sources, because "unsaved" is asked
 * about two different things:
 *
 * - **The box under the cursor**, which answers for itself. This half is what
 *   makes the common case cheap and impossible to get stale: a box that has only
 *   just been focused holds nothing, so a freshly opened form — which autofocuses
 *   its first field — can still be left.
 * - **Any form that has said so**, for the fields the cursor is *not* in.
 *
 * What it still does not cover is a draft in a box belonging to no form that
 * registers — the same exposure clicking the control has always had.
 */
export function drafting(target: EventTarget | null): boolean {
  if (anythingUnsaved()) return true;
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
