import { useEffect, useState } from "react";
import { useSelectedRow } from "../selection";

/**
 * Says the selected row out loud.
 *
 * The arrow keys move a wash and a coloured bar, which is everything to a reader
 * who can see them and nothing at all to one who cannot. Nothing is
 * *unreachable* without this — every row action is also a button in the row, and
 * Tab reaches all of them — but a layer that moves in silence is a layer a
 * screen-reader user has no way to discover, let alone use.
 *
 * A polite live region rather than moving focus onto the row. The rows hold
 * three to six buttons each: focusing the row would put the global focus ring
 * around the lot of them, competing with the selection wash to mean the same
 * thing, and would need `tabIndex={-1}` on every inner button to keep Tab out —
 * which would take away the very path that makes those actions reachable today.
 */
export default function SelectionAnnouncer() {
  const [said, setSaid] = useState("");
  const selected = useSelectedRow();

  useEffect(() => {
    if (!selected) {
      setSaid("");
      return;
    }
    // Read from the DOM rather than from the store, which holds an id and not a
    // sentence. This effect runs after the commit that marked the row, so the
    // mark is there to find. `aria-current="true"` is the selection's own; the
    // sidebar's nav rows use `"page"`, so they are not candidates.
    const row = document.querySelector('[aria-current="true"]');
    setSaid((row?.textContent ?? "").replace(/\s+/g, " ").trim());
  }, [selected]);

  return (
    <div className="visually-hidden" role="status" aria-live="polite">
      {said}
    </div>
  );
}
