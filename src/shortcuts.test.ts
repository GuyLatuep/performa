/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ariaKeyShortcuts,
  matchShortcut,
  RESERVED_KEYS,
  SHORTCUTS,
  Shortcut,
  ShortcutId,
  standingDown,
} from "./shortcuts";

// The registry and the listener over it are covered in shortcutsHook.test.ts;
// this file is the catalogue and the predicates around it.

const ENTRIES = Object.entries(SHORTCUTS) as [ShortcutId, Shortcut][];

/** A press as the webview would deliver it. Mac by default — the platform
 *  itself is covered in platform.test.ts. */
function press(key: string, mods: Partial<KeyboardEventInit> = {}) {
  return new KeyboardEvent("keydown", { key, metaKey: true, ...mods });
}

/** A focused field in the page, since `document.activeElement` is what is read. */
function field(tag: string, value = "", type?: string) {
  const el = document.createElement(tag) as HTMLInputElement;
  if (type) el.type = type;
  document.body.append(el);
  el.value = value;
  el.focus();
  return el;
}

// The chord is ⌘ here, so `press` below means what it says. Which modifier a
// platform uses is platform.test.ts's business, not this file's.
beforeEach(() => {
  vi.stubGlobal("navigator", {
    userAgent: "Macintosh; Intel Mac OS X 10_15_7",
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the catalogue", () => {
  it("gives every action a key of its own", () => {
    // Global, not per screen. Two screens could in principle each spend "R" on
    // something different, since they are never mounted together — but proving
    // that needs a model of what can be on screen with what, and every such
    // model is one screen behind the app.
    const byKey = new Map<string, ShortcutId[]>();
    for (const [id, s] of ENTRIES) {
      byKey.set(s.key, [...(byKey.get(s.key) ?? []), id]);
    }
    const clashes = [...byKey].filter(([, ids]) => ids.length > 1);

    expect(clashes).toEqual([]);
  });

  it.each(ENTRIES)(
    "%s does not take a key the system already has",
    (_id, s) => {
      expect(RESERVED_KEYS).not.toContain(s.key.toLowerCase());
    },
  );

  it.each(ENTRIES)("%s spells its key the way KeyboardEvent does", (_id, s) => {
    // Lower case and one character: `matchShortcut` lower-cases what it is
    // handed, so an entry spelled "R" or "Cmd+R" would simply never match.
    expect(s.key).toBe(s.key.toLowerCase());
    expect(s.key).toHaveLength(1);
  });

  it.each(ENTRIES)("%s can be found by its key", (id, s) => {
    // The reverse map is built at import, so a duplicate would be swallowed
    // there rather than above — this is what proves the promise reached the
    // dispatcher.
    expect(matchShortcut(press(s.key))).toBe(id);
  });

  it("reserves what the macOS menu bar eats", () => {
    // If this list shrinks, check src-tauri: the app installs Tauri's default
    // menu, and that menu is why ⌘C and ⌘V still work in every text box.
    expect(RESERVED_KEYS).toEqual(
      expect.arrayContaining(["q", "w", "z", "x", "c", "v", "a"]),
    );
  });

  it("reserves the second spellings of back and forward", () => {
    // Those two are entries in their own right, so `[` and `]` are spoken for by
    // the table above. These are the same actions under another name, which no
    // entry should take either.
    expect(RESERVED_KEYS).toEqual(
      expect.arrayContaining(["arrowleft", "arrowright"]),
    );
  });

  it("holds the chords somebody else answers, so nothing can take them", () => {
    // The whole reason back and forward are in the table: `back.ts` runs them,
    // and a future action reaching for ⌘[ has to be told it is taken.
    expect(SHORTCUTS.back.key).toBe("[");
    expect(SHORTCUTS.forward.key).toBe("]");
    expect(SHORTCUTS.back.external).toBe(true);
    expect(SHORTCUTS.forward.external).toBe(true);
  });

  it("stands those two down for typing rather than for a draft", () => {
    // `back.ts` declines whenever a text box has focus, full or empty, because
    // `⌘←` is "start of line" there. A badge on the draft rule would sit
    // undimmed over an empty box where the key would in fact decline.
    expect(SHORTCUTS.back.standsDown).toBe("typing");

    const box = field("textarea", "");

    expect(standingDown("back", box)).toBe(true);
    expect(standingDown("tabTodo", box)).toBe(false);
  });
});

describe("matchShortcut", () => {
  it("is null for a key nothing has claimed", () => {
    expect(matchShortcut(press("k"))).toBeNull();
  });

  it("is null without the modifier", () => {
    expect(matchShortcut(press("1", { metaKey: false }))).toBeNull();
  });

  it.each([
    [
      "Shift, which is Redo's and changes what `key` reports",
      { shiftKey: true },
    ],
    ["Alt, which is Hide Others' and produces a dead accent", { altKey: true }],
    ["Control as well, which belongs to Spaces", { ctrlKey: true }],
  ])("is null for a chord also carrying %s", (_label, mods) => {
    expect(matchShortcut(press("1", mods))).toBeNull();
  });
});

describe("standingDown", () => {
  it("is false with nothing focused", () => {
    expect(standingDown("tabTodo")).toBe(false);
  });

  it("is false over an empty text box", () => {
    // Nothing to lose, so the tab switch is not held hostage.
    field("textarea");

    expect(standingDown("tabTodo")).toBe(false);
  });

  it("is true over a text box with something in it", () => {
    field("textarea", "half a comment");

    expect(standingDown("tabTodo")).toBe(true);
  });

  it("is false over whitespace, which is nothing written", () => {
    field("textarea", "   \n ");

    expect(standingDown("tabTodo")).toBe(false);
  });

  it("is false over a date box, which has held a value since it mounted", () => {
    // Counting a pre-filled date as a draft would have ⌘2 refuse to work from
    // the log form for no reason anybody could see.
    field("input", "2026-09-12", "date");

    expect(standingDown("tabTodo")).toBe(false);
  });

  it("is true over a contenteditable with text", () => {
    const el = document.createElement("div");
    el.contentEditable = "true";
    el.textContent = "words";
    document.body.append(el);
    el.focus();

    expect(standingDown("tabTodo", el)).toBe(true);
  });

  it("reads the element it is given, not only the focused one", () => {
    // The dispatcher passes the event's target; the badge asks about focus.
    const typed = document.createElement("textarea");
    typed.value = "words";

    expect(standingDown("tabTodo", typed)).toBe(true);
  });
});

describe("ariaKeyShortcuts", () => {
  it("names the key rather than drawing the glyph", () => {
    vi.stubGlobal("navigator", { userAgent: "Macintosh" });
    expect(ariaKeyShortcuts("tabTodo")).toBe("Meta+2");

    vi.stubGlobal("navigator", { userAgent: "Windows NT 10.0" });
    expect(ariaKeyShortcuts("tabTodo")).toBe("Control+2");
  });
});
