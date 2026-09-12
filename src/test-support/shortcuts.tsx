import { useBackGestures } from "../back";
import { useSelectionKeys } from "../selection";
import { useShortcutKeys } from "../shortcuts";

/**
 * The ⌘-shortcut dispatcher, which the app mounts once in `App`.
 *
 * A component test rendering one screen on its own has to bring it, or the
 * screen's controls bind their keys into a registry nothing is listening over —
 * and every shortcut assertion quietly passes for the wrong reason.
 */
export function ShortcutKeys() {
  useShortcutKeys();
  return null;
}

/**
 * Every window key listener, mounted the way `App` mounts them.
 *
 * The navigation chords, the shortcut catalogue and the list arrows are three
 * separate handlers over one keydown, and a press one of them claims is a press
 * the others stand aside from. Where that division matters — a shifted arrow
 * against a chorded one against a bare one — only a test with all three up can
 * see it.
 *
 * Add any future listener here too: a harness missing one turns a real collision
 * into a passing test.
 */
export function AllKeys() {
  useBackGestures();
  useShortcutKeys();
  useSelectionKeys();
  return null;
}
