import { useEffect, useRef } from "react";
import { isActivatable, overlayOpen, typingIn } from "./keys";
import { createStore } from "./store";

/**
 * Which row the keyboard is on.
 *
 * A list screen registers the rows it is showing, in the order it is showing
 * them, and the arrow keys walk that list while Enter opens what they land on.
 * The rows themselves are told only whether they are the selected one — which
 * keeps the shared row components usable where selection has no meaning at all,
 * like the issue picker.
 *
 * The store is module-level, the way `back.ts`'s registry is, because the things
 * that need to read the selection sit outside the list: the key listener here,
 * and later the badge overlay and the command palette.
 */
export type RowId = string;

/** Where the selection is, and where it was in the list. The index is kept so a
 *  row that disappears can hand the selection to whatever took its place. */
export interface Anchor {
  scopeId: string;
  rowId: RowId;
  index: number;
}

export interface SelectionScope {
  /** Unique while mounted: "todo", "start.due", "week". */
  id: string;
  /** Row ids in the order they are on screen — already sorted and filtered, so
   *  the arrows match what the reader sees rather than what the data arrived
   *  as. */
  rows: readonly RowId[];
  /** Where this scope sits among the others on one screen. Registration order
   *  when omitted. Explicit numbers rather than comparing DOM positions: this
   *  stays testable without a layout, and there is nothing to get wrong about a
   *  list that has not painted yet. */
  order?: number;
  /** What Enter does. The host knows — opening a row means one thing on the Todo
   *  tab and another on the Start tab — and the row does not. */
  open?: (row: RowId) => void;
}

type Slot = { current: SelectionScope; seq: number };

const scopes = new Map<string, Slot>();
let sequence = 0;

const store = createStore<Anchor | null>(null);

/** Where the selection is, or null — which is where every screen starts. */
export function selectedRow(): Anchor | null {
  return store.get();
}

/** Whether this row is the selected one. A boolean, so a moved selection
 *  re-renders the two rows it concerns and no others. */
export function useRowSelected(scopeId: string, rowId: RowId): boolean {
  return store.useSelector(
    (a) => a !== null && a.scopeId === scopeId && a.rowId === rowId,
  );
}

export function selectRow(scopeId: string, rowId: RowId): void {
  const rows = scopes.get(scopeId)?.current.rows ?? [];
  const index = rows.indexOf(rowId);
  if (index >= 0) store.set({ scopeId, rowId, index });
}

export function clearSelection(): void {
  store.set(null);
}

/**
 * Where the selection lands in a list that changed underneath it.
 *
 * The rules, in order, and each one is somebody's expectation:
 *
 * - **The row is still there** — follow it, wherever it moved to. Re-sorting the
 *   Todo list keeps you on PERF-12 even though it went from second to
 *   seventeenth. This is the whole reason rows are identified rather than
 *   counted.
 * - **It is gone** — take its place, by index. Deleting a worklog leaves the
 *   selection on whatever is now in that row, which is what anybody expects
 *   after a delete.
 * - **The list is empty** — nothing is selected.
 */
export function reselect(
  previous: Anchor | null,
  rows: readonly RowId[],
): Anchor | null {
  if (!previous || rows.length === 0) return null;
  const found = rows.indexOf(previous.rowId);
  if (found >= 0) return { ...previous, rowId: rows[found], index: found };
  const at = Math.min(previous.index, rows.length - 1);
  return { ...previous, rowId: rows[at], index: at };
}

/** Every row on screen, in reading order, scope by scope. */
function everyRow(): { scopeId: string; rowId: RowId }[] {
  return [...scopes.values()]
    .sort((a, b) => (a.current.order ?? a.seq) - (b.current.order ?? b.seq))
    .flatMap((s) =>
      s.current.rows.map((rowId) => ({ scopeId: s.current.id, rowId })),
    );
}

/**
 * Move the selection one row. True when it went somewhere.
 *
 * From nothing, a press down selects the first row and a press up the last, so
 * the list can be entered from either end without a click first.
 *
 * Clamps at the ends rather than wrapping — a deliberate departure from the
 * typeahead pickers in this app, which do wrap. Those are five options in a
 * popover; a Todo list is two hundred rows, and leaping from the bottom of it
 * back to the top is disorienting rather than helpful.
 */
export function moveSelection(delta: 1 | -1): boolean {
  const all = everyRow();
  if (all.length === 0) return false;
  const now = store.get();
  const at = now
    ? all.findIndex((r) => r.scopeId === now.scopeId && r.rowId === now.rowId)
    : -1;
  // Entering the list: down lands on the first row, up on the last.
  const next = at < 0 ? (delta === 1 ? 0 : all.length - 1) : at + delta;
  if (next < 0 || next >= all.length) return false;
  const { scopeId, rowId } = all[next];
  const index = (scopes.get(scopeId)?.current.rows ?? []).indexOf(rowId);
  store.set({ scopeId, rowId, index });
  return true;
}

/** Open the selected row, through the scope that owns it. True when something
 *  happened — a scope with no `open` is a list you can walk but not enter. */
export function openSelected(): boolean {
  const now = store.get();
  if (!now) return false;
  const open = scopes.get(now.scopeId)?.current.open;
  if (!open) return false;
  open(now.rowId);
  return true;
}

/**
 * Register this screen's rows as somewhere the arrow keys can go.
 *
 * `scope` may be a fresh object on every render; only `id` and `active`
 * re-register. A changed row list reselects, which is where `reselect` above
 * earns its keep.
 */
export function useSelectionScope(scope: SelectionScope, active = true): void {
  const slot = useRef<Slot>({ current: scope, seq: 0 });
  // Published during render rather than from an effect.
  //
  // An arrow press can land in the same frame a list first paints — a list whose
  // rows arrived from a cache, or a second list on a screen where the first is
  // still loading — and an effect publishes after that frame. Until it ran, the
  // scope still held the empty row list it mounted with, so the press went to
  // whichever list *had* published, or to nothing at all. Assigning a plain box
  // is idempotent and repeating it costs nothing, which is what makes it safe to
  // do here.
  slot.current.current = scope;

  useEffect(() => {
    if (!active) return;
    // Captured here rather than read in the cleanup: the box is this scope's own
    // for as long as it is mounted, and the cleanup has to compare against the
    // same one it registered.
    const mine = slot.current;
    mine.seq = sequence++;
    scopes.set(scope.id, mine);
    return () => {
      // Guarded the way `back.ts` guards its slot: React commits every cleanup
      // before every setup, so a scope replacing another sees the outgoing one's
      // cleanup run after the incoming one has claimed the id.
      if (scopes.get(scope.id) === mine) scopes.delete(scope.id);
    };
  }, [scope.id, active]);

  // Letting go of the selection is a *different* lifetime from holding the
  // registration, which is why it is its own effect rather than a second line in
  // the cleanup above.
  //
  // That one runs whenever `active` flips, and a list does that without going
  // anywhere: the missing-worklog tab deactivates its scope while the log form
  // is up. Clearing there meant closing the form and finding yourself back at
  // the top of the list, having lost the row you were working on. Keyed on the
  // id alone, this runs only when the scope truly goes — and the selection then
  // survives a round trip through a form, to be re-homed by `reselect` when the
  // rows come back.
  useEffect(() => {
    const id = scope.id;
    return () => {
      // Unless something has taken the id over, in which case the selection is
      // now that scope's business.
      if (!scopes.has(id) && store.get()?.scopeId === id) store.set(null);
    };
  }, [scope.id]);

  // A stable key for "the rows changed", so an ordinary re-render does not
  // disturb a selection the user is holding.
  const signature = JSON.stringify(scope.rows);
  useEffect(() => {
    if (!active) return;
    const now = store.get();
    if (now?.scopeId !== scope.id) return;
    store.set(reselect(now, scope.rows));
    // `scope.rows` is read through the signature, which is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, scope.id, active]);
}

/**
 * The bare arrow and Enter keys. Mounted once, in App.
 *
 * The third window listener over one keydown, beside the navigation chords and
 * the shortcut catalogue — and the only one claiming keys with no modifier at
 * all, because that is what every list everywhere answers to.
 */
export function useSelectionKeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Somebody nearer the key has dealt with it — the same first rule as the
      // other two listeners.
      if (e.defaultPrevented) return;
      // Every chord belongs to one of the other two. This layer claims only the
      // unmodified keys.
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (typingIn(e.target) || overlayOpen()) return;

      let acted = false;
      if (e.key === "ArrowDown") acted = moveSelection(1);
      else if (e.key === "ArrowUp") acted = moveSelection(-1);
      else if (e.key === "Enter") {
        // A native button fires its click on Enter keydown, so opening the row
        // here as well would do two things at once. Whatever has focus wins.
        if (isActivatable(e.target)) return;
        acted = openSelected();
      } else return;

      // Only once something happened: an arrow press with no list on screen must
      // still scroll the page.
      if (acted) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
