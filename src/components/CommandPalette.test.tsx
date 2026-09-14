/** @vitest-environment happy-dom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { useScreenActions } from "../actions";
import { clearIssueRequest, useRequestedIssue } from "../issueRequest";
import { addSavedSearch, clearSavedSearches } from "../savedSearches";
import { clearSearchRequest, useRequestedSearch } from "../searchRequest";
import { clearForward, useBackTarget } from "../back";
import { AllKeys } from "../test-support/shortcuts";
import { useShortcut, useShortcutBadge } from "../shortcuts";
import CommandPalette from "./CommandPalette";

// The ranking is covered in actions.test.ts; this file is the sheet over it.

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

/** A screen with one bound control, one chordless action and a way back, so the
 *  palette has all three of its sources to draw from. */
function Screen({
  refresh = vi.fn(),
  sort = vi.fn(),
  back = vi.fn(),
}: {
  refresh?: () => void;
  sort?: () => void;
  back?: () => void;
}) {
  const refreshKeys = useShortcut("refresh", refresh);
  // A real screen with a way back draws a Back button and badges it; that badge
  // binding is what puts the chord in the registry for the palette to find.
  const backBadge = useShortcutBadge("back");
  useScreenActions([
    { id: "sort.key", name: "Sort by issue key", group: "Todo", run: sort },
  ]);
  useBackTarget({ label: "Todo", back });
  return (
    <>
      <AllKeys />
      <CommandPalette />
      <button {...refreshKeys}>Refresh</button>
      <button {...backBadge} onClick={back}>
        Back to Todo
      </button>
    </>
  );
}

/** Open the palette the way a user does. */
async function openPalette() {
  await act(async () => {
    fireEvent.keyDown(document.body, { key: "p", metaKey: true });
  });
}

function box() {
  return screen.getByLabelText("Find a command");
}

function options() {
  return [...document.querySelectorAll('[role="option"]')] as HTMLElement[];
}

function names() {
  return options().map((o) => o.querySelector(".command-name")?.textContent);
}

beforeEach(() => {
  vi.stubGlobal("navigator", {
    userAgent: "Macintosh; Intel Mac OS X 10_15_7",
  });
});

afterEach(() => {
  clearForward();
  clearIssueRequest();
  clearSearchRequest();
  clearSavedSearches();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("opening it", () => {
  it("is not there until it is asked for", () => {
    render(<Screen />);

    expect(screen.queryByLabelText("Find a command")).toBeNull();
  });

  it("opens on ⌘P", async () => {
    render(<Screen />);

    await openPalette();

    expect(box()).toBeDefined();
  });

  it("closes on a second ⌘P", async () => {
    render(<Screen />);
    await openPalette();

    await openPalette();

    expect(screen.queryByLabelText("Find a command")).toBeNull();
  });

  it("closes on Escape, without also going back", async () => {
    // Escape is claimed here, so the navigation layer does not take it as a way
    // out of the view behind.
    const back = vi.fn();
    render(<Screen back={back} />);
    await openPalette();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByLabelText("Find a command")).toBeNull();
    expect(back).not.toHaveBeenCalled();
  });

  it("closes on a click outside it", async () => {
    render(<Screen />);
    await openPalette();

    await userEvent.click(document.querySelector(".modal-backdrop")!);

    expect(screen.queryByLabelText("Find a command")).toBeNull();
  });
});

describe("what it offers", () => {
  it("lists a bound control by its catalogue name, with its chord", async () => {
    render(<Screen />);

    await openPalette();

    expect(names()).toContain("Refresh");
    const refresh = options().find((o) => o.textContent?.startsWith("Refresh"));
    expect(refresh?.querySelector(".command-chord")?.textContent).toBe("⌘R");
  });

  it("lists a screen's chordless action too, with no chord shown", async () => {
    // The whole reason for a palette: five sort columns are not worth five keys,
    // and this is where they are reachable by keyboard at all.
    render(<Screen />);

    await openPalette();

    const sort = options().find((o) =>
      o.textContent?.startsWith("Sort by issue key"),
    );
    expect(sort).toBeDefined();
    expect(sort?.querySelector(".command-chord")).toBeNull();
  });

  it("lists the app's own verbs, which reach no control at all", async () => {
    render(<Screen />);

    await openPalette();

    expect(names()).toContain("Switch to dark appearance");
  });

  it("lists a chord somebody else's listener answers", async () => {
    // `back.ts` owns ⌘[, so the registry holds no handler for it — the palette
    // carries the one line of wiring rather than leaving a visible gap.
    render(<Screen />);

    await openPalette();

    expect(names()).toContain("Back");
  });
});

describe("using it", () => {
  it("narrows the list as you type", async () => {
    render(<Screen />);
    await openPalette();
    const all = options().length;

    await userEvent.type(box(), "refr");

    expect(options().length).toBeLessThan(all);
    expect(names()[0]).toBe("Refresh");
  });

  it("says so when nothing matches", async () => {
    render(<Screen />);
    await openPalette();

    await userEvent.type(box(), "zzzz");

    expect(screen.getByText("Nothing matches.")).toBeDefined();
  });

  it("runs the first match on Enter", async () => {
    const refresh = vi.fn();
    render(<Screen refresh={refresh} />);
    await openPalette();
    await userEvent.type(box(), "refr");

    await userEvent.keyboard("{Enter}");

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("closes once it has run something", async () => {
    render(<Screen />);
    await openPalette();
    await userEvent.type(box(), "refr");

    await userEvent.keyboard("{Enter}");

    expect(screen.queryByLabelText("Find a command")).toBeNull();
  });

  it("walks the list with the arrows", async () => {
    const sort = vi.fn();
    render(<Screen sort={sort} />);
    await openPalette();
    await userEvent.type(box(), "sort");

    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    // One match, so walking twice comes back round to it.
    expect(sort).toHaveBeenCalledTimes(1);
  });

  it("runs what is clicked", async () => {
    const refresh = vi.fn();
    render(<Screen refresh={refresh} />);
    await openPalette();
    await userEvent.type(box(), "refr");

    fireEvent.mouseDown(options()[0]);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the other key layers out while it is up", async () => {
    // It renders as the app's ordinary modal, so `overlayOpen()` suppresses the
    // navigation chords, the catalogue and the list arrows for free.
    const refresh = vi.fn();
    render(<Screen refresh={refresh} />);
    await openPalette();

    await act(async () => {
      fireEvent.keyDown(box(), { key: "r", metaKey: true });
    });

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("typing an issue key", () => {
  /** What the app would show, read from the store the palette writes. */
  function Opened() {
    const issue = useRequestedIssue();
    return <p>{issue ? `opening ${issue.key}` : "nothing opened"}</p>;
  }

  async function openWith(query: string) {
    render(
      <>
        <Screen />
        <Opened />
      </>,
    );
    await openPalette();
    await userEvent.type(box(), query);
  }

  it("offers to open it", async () => {
    await openWith("ABC-12");

    expect(names()).toContain("Open ABC-12");
  });

  it("offers it first, it being what the query is rather than resembles", async () => {
    // Having typed the key in full, opening it is not a guess about what was
    // meant.
    await openWith("ABC-12");

    expect(names()[0]).toBe("Open ABC-12");
  });

  it("opens it on Enter", async () => {
    await openWith("ABC-12");

    await userEvent.keyboard("{Enter}");

    expect(screen.getByText("opening ABC-12")).toBeDefined();
  });

  it("upper-cases what was typed, as Jira writes them", async () => {
    await openWith("abc-12");

    expect(names()[0]).toBe("Open ABC-12");
  });

  it("offers nothing of the sort for an ordinary word", async () => {
    await openWith("refresh");

    expect(names().some((n) => n?.startsWith("Open ABC"))).toBe(false);
  });

  it("offers nothing while the key is still half typed", async () => {
    // "ABC-" is not yet a key, and offering to open it would be offering to open
    // nothing.
    await openWith("ABC-");

    expect(names().some((n) => n?.startsWith("Open "))).toBe(false);
  });

  it("shows no chord for it, there being no key to press", async () => {
    await openWith("ABC-12");

    expect(options()[0].querySelector(".command-chord")).toBeNull();
  });
});

describe("the searches", () => {
  /** What the app would show, read from the store the palette writes. */
  function Ran() {
    const search = useRequestedSearch();
    if (!search) return <p>no search</p>;
    const what = search.kind === "text" ? "text" : search.search.name;
    return <p>{`searching ${what} for ${search.term}`}</p>;
  }

  /** One of the user's own searches, as the Settings tab would have written it. */
  function saveOne(name = "Plant number") {
    addSavedSearch({ name, jql: '"Plant-No." ~ %SEARCHTERM%' });
  }

  async function pick(query: string) {
    render(
      <>
        <Screen />
        <Ran />
      </>,
    );
    await openPalette();
    await userEvent.type(box(), query);
    await userEvent.keyboard("{Enter}");
  }

  it("always offers a text search, every Jira being able to search its text", async () => {
    render(<Screen />);

    await openPalette();

    expect(names()).toContain("Search by text");
  });

  it("offers nothing else until the user has written one", async () => {
    // Which fields are worth searching is the site's business, so the app ships
    // no field searches at all.
    render(<Screen />);

    await openPalette();

    expect(names().filter((n) => n?.startsWith("Search by "))).toEqual([
      "Search by text",
    ]);
  });

  it("offers one the user wrote, under its own name", async () => {
    saveOne();
    render(<Screen />);

    await openPalette();

    expect(names()).toContain("Search by Plant number");
  });

  it("offers each of several", async () => {
    saveOne("Plant number");
    saveOne("Customer ref");
    render(<Screen />);

    await openPalette();

    expect(names()).toContain("Search by Plant number");
    expect(names()).toContain("Search by Customer ref");
  });

  it("asks for a term rather than running anything", async () => {
    saveOne();

    await pick("Plant number");

    // Still open, now asking — and the field is empty, so what was typed to find
    // the action is not mistaken for the argument to it.
    expect(screen.getByLabelText("Search by Plant number")).toBeDefined();
    expect(screen.getByText("no search")).toBeDefined();
  });

  it("will not search on nothing", async () => {
    saveOne();
    await pick("Plant number");

    await userEvent.keyboard("{Enter}");

    expect(screen.getByText("no search")).toBeDefined();
  });

  it("keeps Tab inside the sheet while it asks", async () => {
    saveOne();
    await pick("Plant number");
    const field = screen.getByLabelText("Search by Plant number");

    await userEvent.keyboard("{Tab}");

    // Nowhere to go: Tab means "take the highlighted action" in the list step,
    // and the asking step has no list, so letting the browser have it would walk
    // focus out to the screen behind the sheet with the prompt still up.
    expect(document.activeElement).toBe(field);
  });

  it("searches with the term, carrying the definition along", async () => {
    saveOne();
    await pick("Plant number");

    await userEvent.type(
      screen.getByLabelText("Search by Plant number"),
      "DE_1979",
    );
    await userEvent.keyboard("{Enter}");

    expect(
      screen.getByText("searching Plant number for DE_1979"),
    ).toBeDefined();
  });

  it("takes any term at all, the format being the field's business", async () => {
    // No shape is imposed: the user said which field to look in, and what goes
    // in it is theirs to know.
    saveOne();
    await pick("Plant number");

    await userEvent.type(
      screen.getByLabelText("Search by Plant number"),
      "DE_19",
    );
    await userEvent.keyboard("{Enter}");

    expect(screen.getByText("searching Plant number for DE_19")).toBeDefined();
  });

  it("searches text with any term", async () => {
    await pick("by text");

    await userEvent.type(
      screen.getByLabelText("Search by text"),
      "broken pump",
    );
    await userEvent.keyboard("{Enter}");

    expect(screen.getByText("searching text for broken pump")).toBeDefined();
  });

  it("goes back to the list on Escape, not out of the palette", async () => {
    saveOne();
    await pick("Plant number");

    await userEvent.keyboard("{Escape}");

    expect(screen.getByLabelText("Find a command")).toBeDefined();
    expect(names()).toContain("Search by text");
  });

  it("closes once a search has been run", async () => {
    await pick("by text");
    await userEvent.type(screen.getByLabelText("Search by text"), "pump");

    await userEvent.keyboard("{Enter}");

    expect(screen.queryByLabelText("Search by text")).toBeNull();
  });
});
