/**
 * Which platform this window is on, for the two things that have to know.
 *
 * Read off the user agent rather than through a Tauri plugin: both callers want
 * an answer before first paint — one picks the CSS for the window's material,
 * the other decides which modifier every keyboard shortcut is spelled with —
 * and being wrong costs a background colour or a glyph, not correctness. That
 * is not worth a dependency and an async call. (The reasoning is `vibrancy.ts`'s
 * originally; this is its check, lifted so the shortcut layer can share it
 * rather than write a second one.)
 */
export function isMac(): boolean {
  return /Macintosh|Mac OS X/.test(navigator.userAgent);
}

/**
 * True when the event carries the modifier this platform spells shortcuts
 * with — Command on a Mac, Control everywhere else.
 *
 * The other modifier is rejected rather than ignored: `⌃⌘←` is Spaces' on a Mac
 * and `⌃⌥` combinations are AltGr on a European Windows keyboard, so a chord
 * carrying both belongs to somebody else. Shift is allowed through — it is how
 * the catalogue spells the second variant of an action — and Alt is not.
 */
export function hasPrimaryModifier(e: KeyboardEvent): boolean {
  if (e.altKey) return false;
  return isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/** How a shortcut badge prints that modifier. */
export function primaryGlyph(): string {
  return isMac() ? "⌘" : "Ctrl";
}
