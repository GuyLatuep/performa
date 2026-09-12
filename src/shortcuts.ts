import { useCallback, useEffect, useRef } from "react";
import { hasPrimaryModifier, isMac } from "./platform";
import { OVERLAY_SELECTOR } from "./keys";

/**
 * Every ⌘-shortcut in the app, declared once.
 *
 * The key, the handler and the badge are three faces of one declaration: the key
 * is in the table below, the handler is handed to `useShortcut` where the control
 * is rendered, and the badge is *derived* from the binding that hook makes.
 * Nobody writes a badge, so no badge can be wrong about a key — and a key with
 * no control on screen does not fire, because the binding is what the ref
 * attaches.
 */
export interface Shortcut {
  /** The character pressed with the primary modifier, spelled the way
   *  `KeyboardEvent.key` spells it: lower case, one character.
   *
   *  `key` and not `code`, so a German keyboard's letters mean what is printed
   *  on them — and so the badge, which draws this very string, can never
   *  disagree with what the press produces. */
  key: string;
  /** Held with Shift as well. A second variant of an action whose plain chord is
   *  already spent: `⌘⇧←` is the previous period where `⌘←` is back. */
  shift?: true;
  /** What it does. Read by `aria-keyshortcuts` and by the conflict test's
   *  failure message; never drawn, because the badge shows the key. */
  label: string;
  /** When this one stands down, and why its badge dims.
   *
   *  - `"draft"` — while the focused text box holds something. Firing would
   *    throw those words away: a tab switch, a refresh.
   *  - `"typing"` — whenever a text box has focus at all, full or empty. The key
   *    is the writer's there either way; `⌘←` means "start of line".
   *
   *  Absent means it fires wherever it is pressed, which is the common case: a
   *  shortcut unusable while typing is not much of a shortcut. */
  standsDown?: "draft" | "typing";
  /**
   * Somebody else's listener answers this chord.
   *
   * `back.ts` owns back and forward, and they are not one chord each: they are
   * three spellings apiece, plus bare Escape, plus a fourth mouse button, plus a
   * swipe arriving from Rust — and their availability is per *screen*, not per
   * control, since a screen can register a way back without drawing a button for
   * it. Re-homing that here would put a second mechanism inside the first.
   *
   * The entry exists so the key is visibly spoken for in one table — no future
   * action can take it without the conflict test saying so — and so the control
   * can carry a badge like any other.
   */
  external?: true;
}

export const SHORTCUTS = {
  // The six tabs, in the order the source list draws them. Leaving a tab throws
  // away nothing but an unsaved draft, which is what `standsDown` covers.
  tabStart: { key: "1", label: "Start tab", standsDown: "draft" },
  tabTodo: { key: "2", label: "Todo tab", standsDown: "draft" },
  tabLog: { key: "3", label: "Log work tab", standsDown: "draft" },
  tabTimesheet: { key: "4", label: "Timesheet tab", standsDown: "draft" },
  tabMissing: { key: "5", label: "Missing worklog tab", standsDown: "draft" },
  tabMentions: { key: "6", label: "Mentions tab", standsDown: "draft" },

  settings: { key: ",", label: "Settings", standsDown: "draft" },

  // One verb, one key, wherever it appears. `⌘R` is "refresh this screen" on all
  // four screens that have a refresh; `⌘J` is "open in Jira" on whatever is
  // open. What each acts on is decided by which control is mounted, which is
  // also what decides whether the key fires at all.
  refresh: { key: "r", label: "Refresh", standsDown: "draft" },
  openInJira: { key: "j", label: "Open in Jira" },
  logWork: { key: "l", label: "Log work" },
  comment: { key: "k", label: "Comment" },
  replyToCustomer: {
    key: "k",
    shift: true,
    label: "Reply to customer",
  },
  attach: { key: "u", label: "Attach files" },
  linkItem: { key: "i", label: "Link work item" },
  arrange: { key: "e", label: "Arrange fields" },

  // Submitting is the one action that must work with a full text box — it is
  // what empties it — so it stands down for nothing.
  submit: { key: "s", label: "Submit" },

  // The timer's one singular control. Starting one is per issue row, which is
  // a different shortcut on a different thing.
  timer: { key: "t", label: "Stop the timer" },

  timesheetView: { key: "y", label: "Week or month" },
  prevPeriod: {
    key: "arrowleft",
    shift: true,
    label: "Previous period",
  },
  nextPeriod: {
    key: "arrowright",
    shift: true,
    label: "Next period",
  },

  // Answered by `back.ts`. "typing" rather than "draft" because that handler
  // stands down whenever a text box has focus, full or empty — `⌘←` means
  // "start of line" there and that is the writer's key regardless. A badge
  // using the draft rule would sit undimmed over an empty box where the key
  // would in fact decline, which is the badge lying.
  back: { key: "[", label: "Back", standsDown: "typing", external: true },
  forward: { key: "]", label: "Forward", standsDown: "typing", external: true },
} as const satisfies Record<string, Shortcut>;

export type ShortcutId = keyof typeof SHORTCUTS;

/** The ids this module's dispatcher answers for. */
export type ActionId = {
  [I in ShortcutId]: (typeof SHORTCUTS)[I] extends { external: true }
    ? never
    : I;
}[ShortcutId];

/** The ids that only want a badge. Binding one to a handler that would never run
 *  is a type error rather than a puzzle. */
export type BadgeId = Exclude<ShortcutId, ActionId>;

/** The same table read as the interface rather than as its literal types, which
 *  is what lets these accessors ask about a field only some entries carry.
 *  `SHORTCUTS` keeps its literals for the tests, which assert against them. */
const TABLE: Record<ShortcutId, Shortcut> = SHORTCUTS;

/**
 * Characters that never arrive, and characters already answered.
 *
 * macOS installs a menu bar whose accelerators AppKit consumes before the
 * webview sees a keydown. That menu is what keeps ⌘C and ⌘V working in every
 * text box in the app, so it stays — which means these are not ours to spend.
 * Reserved on Windows too, where no such menu exists: one key map for both
 * platforms is one fewer thing that is true in one place and false in the other.
 */
export const RESERVED_KEYS = [
  // The default macOS menu bar: Quit, Hide, Close, Minimise, Undo, Cut, Copy,
  // Paste, Select All.
  "q",
  "h",
  "w",
  "m",
  "z",
  "x",
  "c",
  "v",
  "a",
  // The other spellings of back and forward. Those two are catalogue entries in
  // their own right, so `[` and `]` are spoken for by the table; these are the
  // same actions under a second name, which no entry should take either.
  "arrowleft",
  "arrowright",
] as const;

/**
 * How a chord is spelled as one string, for looking one up and for proving two
 * do not collide. Shift is part of the spelling; the primary modifier is not,
 * being on every chord here.
 */
export function chordOf(s: Shortcut): string {
  return (s.shift ? "shift+" : "") + s.key;
}

const BY_CHORD = new Map<string, ShortcutId>(
  (Object.keys(TABLE) as ShortcutId[]).map((id) => [chordOf(TABLE[id]), id]),
);

/** The glyphs a key is drawn as, where its name is not what it looks like. */
const KEY_GLYPHS: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
};

/** What the badge draws. The primary modifier never appears — it is being held,
 *  so the reader knows — but Shift does, because it is not. */
export function keyLabel(id: ShortcutId): string {
  const s = TABLE[id];
  return (s.shift ? "⇧" : "") + (KEY_GLYPHS[s.key] ?? s.key);
}

/**
 * Which shortcut this press is, or null.
 *
 * Alt disqualifies it outright: `⌥⌘H` is Hide Others, and Alt changes what `key`
 * reports at all (`⌥e` is a dead accent), so admitting it would mean every entry
 * carrying a second spelling nothing here wants. Shift is read rather than
 * rejected, because it is how the catalogue spells a second variant of an action
 * whose plain chord is taken — but only where an entry asks for it, so `⇧⌘R`
 * matches nothing rather than quietly refreshing.
 */
export function matchShortcut(e: KeyboardEvent): ShortcutId | null {
  if (!hasPrimaryModifier(e)) return null;
  const chord = (e.shiftKey ? "shift+" : "") + e.key.toLowerCase();
  return BY_CHORD.get(chord) ?? null;
}

/** ARIA's spelling of the chord — "Meta+R" on a Mac, "Control+R" elsewhere.
 *  ARIA names the key, not the glyph, so this is not `primaryGlyph`. */
export function ariaKeyShortcuts(id: ShortcutId): string {
  const s = TABLE[id];
  const primary = isMac() ? "Meta" : "Control";
  // ARIA names the key: "ArrowLeft", not "←".
  const named = s.key.startsWith("arrow")
    ? "Arrow" + s.key.slice(5, 6).toUpperCase() + s.key.slice(6)
    : s.key.toUpperCase();
  return `${primary}+${s.shift ? "Shift+" : ""}${named}`;
}

/**
 * Input types holding words somebody would mind losing.
 *
 * A date box is pre-filled with today and a checkbox holds no words; neither is
 * a draft, and counting them as one would have ⌘2 refuse to work from the log
 * form's date field, which has held a value since it mounted.
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

function textBox(el: Element | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  if (node.isContentEditable) return true;
  if (node.tagName === "TEXTAREA") return true;
  return (
    node.tagName === "INPUT" && TEXTUAL.has((node as HTMLInputElement).type)
  );
}

/**
 * There is something typed and unsaved where the cursor is.
 *
 * The "and something typed" half is what makes this cheap enough to be true: no
 * form registers anything, nothing can go stale, and an untouched comment box
 * does not hold a tab switch hostage. What it deliberately does not cover is a
 * draft in a box that no longer has focus — the same exposure clicking the tab
 * has always had.
 */
function drafting(el: Element | null): boolean {
  if (!textBox(el)) return false;
  const node = el as HTMLElement;
  if (node.isContentEditable) return (node.textContent ?? "").trim() !== "";
  return (node as HTMLInputElement | HTMLTextAreaElement).value.trim() !== "";
}

/**
 * This shortcut will not fire right now, so its badge is drawn dimmed.
 *
 * Dimmed rather than dropped: an absent badge says "no such key", and that is a
 * different statement from "not this second".
 */
export function standingDown(
  id: ShortcutId,
  el: Element | null = document.activeElement,
): boolean {
  const mode = TABLE[id].standsDown;
  if (mode === "draft") return drafting(el);
  if (mode === "typing") return textBox(el);
  return false;
}

interface Binding {
  id: ShortcutId;
  node: HTMLElement;
  /** Null for the `external` entries: somebody else's listener runs those, and
   *  this binding exists only to place their badge. */
  run: (() => void) | null;
}

/**
 * Every mounted control for an id, oldest first.
 *
 * A stack rather than a slot, because two controls for one id genuinely coexist:
 * a modal's Submit opens over the form's Submit underneath it, and the page's
 * button stays mounted the whole time. With a slot, the modal would overwrite
 * the page's binding and then delete it on the way out, leaving `⌘S` bound to
 * nothing while a perfectly good button was still on screen.
 *
 * The innermost control — the last to mount — is the one that answers, which is
 * what "whatever is open" means.
 */
const bindings = new Map<ShortcutId, Binding[]>();

function active(id: ShortcutId): Binding | undefined {
  const stack = bindings.get(id);
  return stack?.[stack.length - 1];
}

/** The control answering for each bound id. For the badge overlay, and for the
 *  tests. */
export function boundShortcuts(): Binding[] {
  return [...bindings.keys()].map((id) => active(id)!).filter(Boolean);
}

export interface ShortcutProps {
  ref: (node: HTMLElement | null) => (() => void) | void;
  "aria-keyshortcuts": string | undefined;
}

/**
 * Give this control its shortcut. Spread the result onto the element:
 *
 *     const refresh = useShortcut("refresh", reload, !busy);
 *     <button className="link" {...refresh}>Refresh</button>
 *
 * The ref is what makes the control *available*: the key fires only while the
 * node is mounted, and the badge is drawn at that same node. There is no
 * separate "is this enabled" to keep in step with what is on screen.
 *
 * `run` may be a fresh closure every render; only `id` and `enabled` re-bind.
 */
export function useShortcut(
  id: ActionId,
  run: () => void,
  enabled = true,
): ShortcutProps {
  return useBinding(id, run, enabled);
}

/**
 * Give this control the badge for a chord somebody else answers.
 *
 * Same registration, no handler: the key already works, and what was missing was
 * any way for the reader to find out. `back.ts` is the only such owner today.
 */
export function useShortcutBadge(id: BadgeId, enabled = true): ShortcutProps {
  return useBinding(id, null, enabled);
}

function useBinding(
  id: ShortcutId,
  run: (() => void) | null,
  enabled: boolean,
): ShortcutProps {
  // The live handler, boxed the way `back.ts` boxes its target: the closure is
  // new on every render, and re-running the ref for that would have React
  // detach and re-attach the node each time.
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });

  const ref = useCallback(
    (node: HTMLElement | null) => {
      if (!node || !enabled) return;
      const stack = bindings.get(id) ?? [];
      stack.push({ id, node, run: run && (() => latest.current?.()) });
      bindings.set(id, stack);
      // React 19 takes a cleanup back from a ref callback, which is the only
      // moment at which *which* node went away is known — and with a stack, the
      // only way to remove the right one. React commits every cleanup before
      // every setup, so an outgoing screen's cleanup can run after the incoming
      // one has already pushed; removing by node rather than by position is what
      // makes that order stop mattering.
      return () => {
        const left = (bindings.get(id) ?? []).filter((b) => b.node !== node);
        if (left.length > 0) bindings.set(id, left);
        else bindings.delete(id);
      };
    },
    // `run` is deliberately not a dependency: whether there *is* one is fixed by
    // which hook was called, and which closure it is, is read live above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, enabled],
  );

  return {
    ref,
    // The badge is decoration; this is the part a screen reader is told.
    "aria-keyshortcuts": enabled ? ariaKeyShortcuts(id) : undefined,
  };
}

/** An open modal covers the page: the controls behind it are not available, so
 *  neither their keys nor their badges are. A modal's own controls are.
 *
 *  One predicate decides both, which is the point — a badge offering a key that
 *  will not fire is worse than no badge. */
function covered(node: HTMLElement): boolean {
  const overlay = document.querySelector(OVERLAY_SELECTOR);
  return overlay !== null && !overlay.contains(node);
}

/** The one keydown listener over the registry. Mounted once, in App. */
export function useShortcutKeys(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Somebody nearer the key has dealt with it already — the same first rule,
      // and the same reason, as `back.ts`'s handler.
      if (e.defaultPrevented) return;
      const id = matchShortcut(e);
      if (!id) return;
      const binding = active(id);
      // No control on screen for it, or a chord somebody else answers: not ours
      // to swallow either way. There is deliberately no blanket typing guard
      // here — ⌘-chords are not typing, and the narrow `standingDown` below is
      // what replaces it.
      if (!binding?.run) return;
      if (covered(binding.node)) return;
      if (standingDown(id, e.target as Element | null)) return;
      e.preventDefault();
      binding.run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** Where one badge goes, and what it says. */
export interface BadgePlacement {
  id: ShortcutId;
  /** The character drawn. The modifier itself never is — it is being held. */
  key: string;
  /** Viewport coordinates of the control's top-right corner. */
  x: number;
  y: number;
  standingDown: boolean;
}

/** A badge on a control at the very top of the window would sit half off it. */
const TOP_EDGE = 12;

/** Where every badge goes, right now. Reads the DOM; called once per frame. */
export function placeBadges(): BadgePlacement[] {
  const focused = document.activeElement;
  const out: BadgePlacement[] = [];
  for (const b of boundShortcuts()) {
    const r = b.node.getBoundingClientRect();
    // Not drawn, or scrolled out of the panel it lives in. A badge floating
    // where its control is not is worse than no badge — and this is the case a
    // corner overlay has to get right, since the control may sit inside
    // something that scrolls independently.
    if (r.width === 0 && r.height === 0) continue;
    if (r.bottom < 0 || r.top > window.innerHeight) continue;
    if (r.right < 0 || r.left > window.innerWidth) continue;
    if (covered(b.node)) continue;
    out.push({
      id: b.id,
      key: keyLabel(b.id),
      x: r.right,
      y: Math.max(r.top, TOP_EDGE),
      standingDown: standingDown(b.id, focused),
    });
  }
  return out;
}
