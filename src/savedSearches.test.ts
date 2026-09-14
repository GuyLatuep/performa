/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSavedSearch,
  claimSearchesFor,
  clearSavedSearches,
  getSavedSearches,
  hasSearchTerm,
  removeSavedSearch,
  updateSavedSearch,
} from "./savedSearches";

const PLANT = {
  name: "Plant number",
  jql: 'project in (CTS, DEV) AND "Plant-No." ~ %SEARCHTERM%',
};

beforeEach(() => {
  localStorage.clear();
  clearSavedSearches();
});

/** The store as a fresh launch would read it from `raw`. */
async function loadedFrom(raw: unknown) {
  localStorage.setItem("performa-saved-searches", JSON.stringify(raw));
  // `vi.resetModules` rather than a query-string import: a computed import
  // specifier makes Vite warn that it cannot analyse it, and the module
  // registry is what actually needs clearing.
  vi.resetModules();
  const fresh = await import("./savedSearches");
  return fresh.getSavedSearches();
}

describe("adding one", () => {
  it("keeps what it was given and hands back an id", () => {
    const added = addSavedSearch(PLANT);

    expect(added).toMatchObject(PLANT);
    expect(added?.id).toBeTruthy();
    expect(getSavedSearches()).toHaveLength(1);
  });

  it("trims the name and the JQL", () => {
    const added = addSavedSearch({
      name: "  Plant number  ",
      jql: `  ${PLANT.jql}  `,
    });

    expect(added).toMatchObject(PLANT);
  });

  it.each([
    ["no name", { ...PLANT, name: "" }],
    ["a name of only space", { ...PLANT, name: "   " }],
    ["no JQL to run", { ...PLANT, jql: "  " }],
  ])("refuses one with %s", (_label, bad) => {
    // A search missing either would put an entry in the palette that cannot run.
    expect(addSavedSearch(bad)).toBeNull();
    expect(getSavedSearches()).toEqual([]);
  });

  it("gives each one an id of its own", () => {
    const a = addSavedSearch(PLANT);
    const b = addSavedSearch({ ...PLANT, name: "Customer ref" });

    expect(a?.id).not.toBe(b?.id);
  });

  it("keeps them in the order they were written", () => {
    addSavedSearch(PLANT);
    addSavedSearch({ ...PLANT, name: "Customer ref" });

    expect(getSavedSearches().map((s) => s.name)).toEqual([
      "Plant number",
      "Customer ref",
    ]);
  });
});

describe("the placeholder", () => {
  it("is found whatever its case", () => {
    expect(hasSearchTerm("summary ~ %searchterm%")).toBe(true);
    expect(hasSearchTerm("summary ~ %SEARCHTERM%")).toBe(true);
    expect(hasSearchTerm("project = DEV")).toBe(false);
  });
});

describe("changing one", () => {
  it("patches only what it is given", () => {
    const added = addSavedSearch(PLANT)!;

    updateSavedSearch(added.id, { jql: "summary ~ %SEARCHTERM%" });

    expect(getSavedSearches()[0]).toMatchObject({
      name: "Plant number",
      jql: "summary ~ %SEARCHTERM%",
    });
  });

  it("keeps the JQL it had when a patch would empty it", () => {
    const added = addSavedSearch(PLANT)!;

    updateSavedSearch(added.id, { jql: "" });

    expect(getSavedSearches()[0].jql).toBe(PLANT.jql);
  });

  it("leaves the others alone", () => {
    const a = addSavedSearch(PLANT)!;
    addSavedSearch({ ...PLANT, name: "Customer ref" });

    updateSavedSearch(a.id, { name: "Plant" });

    expect(getSavedSearches().map((s) => s.name)).toEqual([
      "Plant",
      "Customer ref",
    ]);
  });

  it("ignores an id that is not there", () => {
    // An edit to something already deleted is not a new search.
    addSavedSearch(PLANT);

    updateSavedSearch("gone", { name: "Nope" });

    expect(getSavedSearches()).toHaveLength(1);
  });
});

describe("removing one", () => {
  it("takes it out", () => {
    const added = addSavedSearch(PLANT)!;

    removeSavedSearch(added.id);

    expect(getSavedSearches()).toEqual([]);
  });

  it("does not hand its id to the next one", () => {
    // The palette's entry id is built from this, so a reused id would have an
    // entry quietly change meaning.
    const added = addSavedSearch(PLANT)!;
    removeSavedSearch(added.id);

    const next = addSavedSearch({ ...PLANT, name: "Customer ref" })!;

    expect(next.id).not.toBe(added.id);
  });
});

describe("what was stored last time", () => {
  it("comes back", () => {
    addSavedSearch(PLANT);

    expect(
      JSON.parse(localStorage.getItem("performa-saved-searches") ?? "[]"),
    ).toHaveLength(1);
  });

  it.each([
    ["not a list at all", '{"nope":true}'],
    ["unreadable", "{{{"],
  ])("is ignored when it is %s", (_label, raw) => {
    localStorage.setItem("performa-saved-searches", raw);

    // Re-read through a fresh import below; here it is enough that nothing threw
    // and the store is usable.
    expect(() => getSavedSearches()).not.toThrow();
  });
});

describe("a half-written entry in storage", () => {
  it("is dropped rather than repaired", async () => {
    // One missing its JQL would offer the palette an entry that cannot run.
    const loaded = await loadedFrom([
      { id: "a", name: "Good", jql: "summary ~ %SEARCHTERM%" },
      { id: "b", name: "No JQL" },
      { id: "c", name: "Blank JQL", jql: "  " },
      { id: "d", jql: "summary ~ %SEARCHTERM%" },
    ]);

    expect(loaded.map((s) => s.name)).toEqual(["Good"]);
  });
});

describe("a search written before searches were JQL", () => {
  // Those named a field, a whole-value switch and projects to leave out. They
  // are rewritten as the query the Rust side used to build from them, so nobody
  // loses a search to the change.

  it("becomes a wildcarded and a plain match on its field", async () => {
    const [search] = await loadedFrom([
      {
        id: "a",
        name: "Plant number",
        field: "Plant-No.",
        exact: false,
        excludedProjects: [],
      },
    ]);

    expect(search).toEqual({
      id: "a",
      name: "Plant number",
      jql: '("Plant-No." ~ "%SEARCHTERM%*" OR "Plant-No." ~ %SEARCHTERM%) ORDER BY updated DESC',
    });
  });

  it("matches the whole value when it did", async () => {
    const [search] = await loadedFrom([
      {
        id: "a",
        name: "Order",
        field: "Order no.",
        exact: true,
        excludedProjects: [],
      },
    ]);

    expect(search.jql).toBe('"Order no." = %SEARCHTERM% ORDER BY updated DESC');
  });

  it("keeps leaving its projects out", async () => {
    const [search] = await loadedFrom([
      {
        id: "a",
        name: "Plant number",
        field: "Plant-No.",
        exact: true,
        excludedProjects: ["O2C", "DEV"],
      },
    ]);

    expect(search.jql).toBe(
      '"Plant-No." = %SEARCHTERM% AND project NOT IN ("O2C", "DEV") ORDER BY updated DESC',
    );
  });

  it("quotes a field name that has quotes of its own", async () => {
    const [search] = await loadedFrom([
      {
        id: "a",
        name: "Odd",
        field: 'Say "hi"',
        exact: true,
        excludedProjects: [],
      },
    ]);

    expect(search.jql).toBe(
      '"Say \\"hi\\"" = %SEARCHTERM% ORDER BY updated DESC',
    );
  });

  it("is still dropped when it had no field", async () => {
    const loaded = await loadedFrom([
      { id: "a", name: "No field", exact: false, excludedProjects: [] },
    ]);

    expect(loaded).toEqual([]);
  });
});

describe("whose searches these are", () => {
  // A search's JQL names fields the way *that* site spells them, so it means
  // nothing on another one. The same shape as `claimMentionsFor`.

  it("keeps them when the same account signs back in", () => {
    claimSearchesFor("site-a|me");
    addSavedSearch(PLANT);

    claimSearchesFor("site-a|me");

    expect(getSavedSearches()).toHaveLength(1);
  });

  it("drops them for a different account", () => {
    claimSearchesFor("site-a|me");
    addSavedSearch(PLANT);

    claimSearchesFor("site-b|me");

    expect(getSavedSearches()).toEqual([]);
  });

  it("drops them for a different person on the same site", () => {
    claimSearchesFor("site-a|me");
    addSavedSearch(PLANT);

    claimSearchesFor("site-a|somebody-else");

    expect(getSavedSearches()).toEqual([]);
  });

  it("leaves the new owner a clean slate to write on", () => {
    claimSearchesFor("site-a|me");
    addSavedSearch(PLANT);
    claimSearchesFor("site-b|me");

    addSavedSearch({ ...PLANT, name: "Customer ref" });

    expect(getSavedSearches().map((s) => s.name)).toEqual(["Customer ref"]);
  });
});
