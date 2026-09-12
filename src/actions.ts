import { useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import { goBack, goForward } from "./back";
import { setFunMode } from "./settings";
import {
  boundShortcuts,
  chordLabel,
  ShortcutId,
  shortcutLabel,
} from "./shortcuts";
import { setTextScale, TextScale } from "./textScale";
import { setTheme, Theme } from "./theme";

/**
 * Everything the command palette can offer, by name.
 *
 * Three sources, and the division between them is the point:
 *
 * 1. **Whatever is bound right now.** The shortcut registry already knows which
 *    controls are mounted and what key each answers to, so this half of the
 *    palette is live by construction — it cannot offer an action whose control
 *    has left the screen.
 * 2. **What a screen says it can do.** Controls with no chord of their own, like
 *    the Todo list's five sort columns. A screen registers these while it is up.
 * 3. **The app's own verbs**, hand-written below: switching theme, text size,
 *    opening the handbook. These reach no control at all.
 *
 * The rule that keeps the third list honest, and it is worth stating plainly: a
 * palette entry may only call a module-level store function, or a handler a
 * mounted component registered. Anything deeper is not a palette entry — it is a
 * component's private business, and reaching into it from here would be the
 * palette pretending to a knowledge it does not have.
 */
export interface ActionSpec {
  /** Unique among everything offered at once. */
  id: string;
  /** What it is called, in the imperative. This is what gets matched and drawn. */
  name: string;
  /** The heading it sits under. */
  group: string;
  /** Its chord, spelled out, where it has one. Display only. */
  chord?: string;
  /** Extra words to match on that are not worth showing: "ticket" for an issue,
   *  "dark" for the theme. */
  keywords?: string;
  run: () => void;
}

/** A screen's own actions, for the controls that carry no chord. */
type Slot = { current: ActionSpec[] };
const screens = new Set<Slot>();

/**
 * Offer these while this screen is up.
 *
 * `specs` may be rebuilt on every render; the box is what is registered, so only
 * `active` re-registers.
 */
export function useScreenActions(specs: ActionSpec[], active = true): void {
  const slot = useRef<Slot>({ current: specs });
  useEffect(() => {
    slot.current.current = specs;
  });
  useEffect(() => {
    if (!active) return;
    const mine = slot.current;
    screens.add(mine);
    return () => {
      screens.delete(mine);
    };
  }, [active]);
}

/** The chords somebody else's listener answers, and who to call for each. The
 *  registry holds no handler for these — that is what `external` means — so the
 *  palette needs the one line of wiring. */
const EXTERNAL_RUNNERS: Partial<Record<ShortcutId, () => void>> = {
  back: () => void goBack(),
  forward: () => void goForward(),
};

/** The app's own verbs: no control to press, only a store to set. */
function appActions(): ActionSpec[] {
  const theme = (t: Theme): ActionSpec => ({
    id: `theme.${t}`,
    name:
      t === "dark" ? "Switch to dark appearance" : "Switch to light appearance",
    group: "Appearance",
    keywords: "theme colour color mode",
    run: () => setTheme(t),
  });
  const size = (s: TextScale, name: string): ActionSpec => ({
    id: `text.${s}`,
    name,
    group: "Appearance",
    keywords: "text size scale bigger smaller larger",
    run: () => setTextScale(s),
  });
  return [
    theme("light"),
    theme("dark"),
    size("normal", "Text size: normal"),
    size("large", "Text size: large"),
    size("larger", "Text size: larger"),
    {
      id: "fun.on",
      name: "Turn fun mode on",
      group: "App",
      keywords: "confetti sounds cheer",
      run: () => setFunMode(true),
    },
    {
      id: "fun.off",
      name: "Turn fun mode off",
      group: "App",
      keywords: "confetti sounds quiet",
      run: () => setFunMode(false),
    },
    {
      id: "handbook",
      name: "Open the handbook",
      group: "App",
      keywords: "manual help documentation",
      run: () =>
        void openUrl(
          "https://github.com/GuyLatuep/performa/blob/main/docs/user-manual.en.md",
        ),
    },
    {
      id: "logfolder",
      name: "Open the log folder",
      group: "App",
      keywords: "debug diagnostics",
      run: () => void api.openLogFolder(),
    },
  ];
}

/** Everything on offer this moment, in the order the palette shows it. */
export function allActions(): ActionSpec[] {
  const bound: ActionSpec[] = boundShortcuts().flatMap((b) => {
    const run = b.run ?? EXTERNAL_RUNNERS[b.id];
    if (!run) return [];
    return [
      {
        id: `key.${b.id}`,
        name: shortcutLabel(b.id),
        group: "Available now",
        chord: chordLabel(b.id),
        run,
      },
    ];
  });
  const fromScreens = [...screens].flatMap((s) => s.current);
  return [...bound, ...fromScreens, ...appActions()];
}

/**
 * Which actions match `query`, best first.
 *
 * Ranked rather than merely filtered, because the one you meant is usually the
 * one whose name *starts* with what you typed: "re" should offer Refresh before
 * "Reply to customer", and both before something that merely has "re" in the
 * middle of a keyword.
 */
export function filterActions(
  actions: readonly ActionSpec[],
  query: string,
): ActionSpec[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...actions];
  const scored: { action: ActionSpec; rank: number }[] = [];
  actions.forEach((action) => {
    const name = action.name.toLowerCase();
    const rank = name.startsWith(q)
      ? 0
      : name.split(/\s+/).some((w) => w.startsWith(q))
        ? 1
        : name.includes(q)
          ? 2
          : (action.keywords ?? "").toLowerCase().includes(q)
            ? 3
            : -1;
    if (rank >= 0) scored.push({ action, rank });
  });
  // Stable within a rank, so ties keep the catalogue's own order.
  return scored
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((s) => s.action);
}
