import { useEffect, useRef } from "react";
import { api } from "./api";
import { goBack, goForward } from "./back";
import { HANDBOOK_URL, openExternal } from "./external";
import { parseIssueKey } from "./issueKey";
import { getSavedSearches, isView } from "./savedSearches";
import {
  requestSavedSearch,
  requestTextSearch,
  requestView,
} from "./searchRequest";
import { requestIssue } from "./issueRequest";
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
  run?: () => void;
  /**
   * Ask for something before doing anything.
   *
   * An action that needs a term cannot run the moment it is chosen, so instead of
   * a handler it carries a prompt: picking it puts the palette into a second
   * step, where what you type is the argument rather than a filter. `parse`
   * rejects what is not an argument at all, which is what keeps a plant search
   * from being run on a word.
   */
  prompt?: {
    /** Shown in place of the palette's own placeholder. */
    placeholder: string;
    /** What this step is called, above the field. */
    title: string;
    /** The typed text, cleaned up — or null while it is not yet usable, which is
     *  what greys out the confirmation. */
    parse: (text: string) => string | null;
    /** Run with the parsed value. */
    submit: (value: string) => void;
  };
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

/**
 * The searches on offer: the one every site has, and the ones this user wrote.
 *
 * Text search is built in because every Jira can search its text. Which *fields*
 * are worth searching is a property of the site — one keeps a plant number,
 * another a customer reference — so those are the user's to describe, under
 * Settings, and each one they write shows up here.
 */
function searchActions(): ActionSpec[] {
  const text: ActionSpec = {
    id: "search.text",
    name: "Search by text",
    group: "Search",
    keywords: "find words summary description comment",
    prompt: {
      title: "Search by text",
      placeholder: "Words in any field",
      // Anything at all, so long as it is something.
      parse: (typed) => typed.trim() || null,
      submit: requestTextSearch,
    },
  };
  // One list, two shapes. Which one a definition takes is decided by its own
  // JQL: one that says where a term goes has to ask for it, so it carries a
  // prompt; one that does not already describes the issues it means, so picking
  // it is the whole interaction and it runs on the spot.
  const own = getSavedSearches().map((search): ActionSpec => {
    if (isView(search)) {
      return {
        id: `view.${search.id}`,
        name: `View: ${search.name}`,
        group: "Search",
        keywords: "filter list saved",
        run: () => requestView(search),
      };
    }
    return {
      id: `search.${search.id}`,
      name: `Search by ${search.name}`,
      group: "Search",
      keywords: "find",
      prompt: {
        title: `Search by ${search.name}`,
        placeholder: search.name,
        parse: (typed) => typed.trim() || null,
        submit: (term) => requestSavedSearch(search, term),
      },
    };
  });
  return [text, ...own];
}

/** The app's own verbs: no control to press, only a store to set. */
function appActions(): ActionSpec[] {
  const theme = (which: Theme): ActionSpec => ({
    id: `theme.${which}`,
    name:
      which === "dark"
        ? "Switch to dark appearance"
        : "Switch to light appearance",
    group: "Appearance",
    keywords: "theme colour color mode",
    run: () => setTheme(which),
  });
  const size = (scale: TextScale, name: string): ActionSpec => ({
    id: `text.${scale}`,
    name,
    group: "Appearance",
    keywords: "text size scale bigger smaller larger",
    run: () => setTextScale(scale),
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
      run: () => void openExternal(HANDBOOK_URL),
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
  const bound: ActionSpec[] = boundShortcuts().flatMap((binding) => {
    const run = binding.run ?? EXTERNAL_RUNNERS[binding.id];
    if (!run) return [];
    return {
      id: `key.${binding.id}`,
      name: shortcutLabel(binding.id),
      group: "Available now",
      chord: chordLabel(binding.id),
      run,
    };
  });
  const fromScreens = [...screens].flatMap((screen) => screen.current);
  return [...bound, ...fromScreens, ...searchActions(), ...appActions()];
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
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...actions];
  const scored = actions.flatMap((action) => {
    const name = action.name.toLowerCase();
    const rank = name.startsWith(needle)
      ? 0
      : name.split(/\s+/).some((word) => word.startsWith(needle))
        ? 1
        : name.includes(needle)
          ? 2
          : (action.keywords ?? "").toLowerCase().includes(needle)
            ? 3
            : -1;
    return rank < 0 ? [] : { action, rank };
  });
  // Sorting is stable, so ties keep the catalogue's own order.
  return scored.sort((a, b) => a.rank - b.rank).map((hit) => hit.action);
}

/**
 * The action a query *is*, rather than one it matches.
 *
 * Everything else on offer is a fixed list the query filters. An issue key is
 * not in any list — there are a hundred thousand of them — so typing one means
 * something the palette has to read rather than find. Null for every query that
 * is not one, which is nearly all of them.
 *
 * Kept apart from `allActions` because it depends on the query: that list is
 * read once when the palette opens, and this is recomputed on every keystroke.
 */
export function typedAction(query: string): ActionSpec | null {
  const key = parseIssueKey(query);
  if (!key) return null;
  return {
    id: `open.${key}`,
    name: `Open ${key}`,
    group: "Issue",
    run: () => requestIssue(key),
  };
}
