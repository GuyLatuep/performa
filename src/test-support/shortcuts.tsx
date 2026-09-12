import { useBackGestures } from "../back";
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
 * Both window listeners, mounted the way `App` mounts them.
 *
 * The navigation chords and the shortcut catalogue are separate handlers over
 * the same keydown, and a chord one of them claims is a chord the other stands
 * aside from. Where that division matters — a shifted arrow against a plain
 * one — only a test with both up can see it.
 */
export function AllKeys() {
  useBackGestures();
  useShortcutKeys();
  return null;
}
