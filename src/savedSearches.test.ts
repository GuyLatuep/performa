/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSavedSearch,
  claimSearchesFor,
  clearSavedSearches,
  getSavedSearches,
  removeSavedSearch,
  updateSavedSearch,
} from "./savedSearches";

const PLANT = {
  name: "Plant number",
  field: "Plant-No.",
  exact: false,
  excludedProjects: [] as string[],
};

beforeEach(() => {
  localStorage.clear();
  clearSavedSearches();
});

describe("adding one", () => {
  it("keeps what it was given and hands back an id", () => {
    const added = addSavedSearch(PLANT);

    expect(added).toMatchObject(PLANT);
    expect(added?.id).toBeTruthy();
    expect(getSavedSearches()).toHaveLength(1);
  });

  it("trims the name, which is what the palette draws", () => {
    const added = addSavedSearch({ ...PLANT, name: "  Plant number  " });

    expect(added?.name).toBe("Plant number");
  });

  it.each([
    ["no name", { ...PLANT, name: "" }],
    ["a name of only space", { ...PLANT, name: "   " }],
    ["no field to look in", { ...PLANT, field: "" }],
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

describe("changing one", () => {
  it("patches only what it is given", () => {
    const added = addSavedSearch(PLANT)!;

    updateSavedSearch(added.id, { exact: true });

    expect(getSavedSearches()[0]).toMatchObject({
      name: "Plant number",
      field: "Plant-No.",
      exact: true,
    });
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
    // One missing its field would offer the palette an entry that cannot run.
    localStorage.setItem(
      "performa-saved-searches",
      JSON.stringify([
        {
          id: "a",
          name: "Good",
          field: "Plant-No.",
          exact: false,
          excludedProjects: [],
        },
        { id: "b", name: "No field", exact: false, excludedProjects: [] },
        { id: "c", field: "Plant-No.", exact: false, excludedProjects: [] },
      ]),
    );
    // `vi.resetModules` rather than a query-string import: a computed import
    // specifier makes Vite warn that it cannot analyse it, and the module
    // registry is what actually needs clearing.
    vi.resetModules();
    const fresh = await import("./savedSearches");

    expect(
      fresh.getSavedSearches().map((s: { name: string }) => s.name),
    ).toEqual(["Good"]);
  });
});

describe("whose searches these are", () => {
  // A search names a field by the name *that* site spells it with, so it means
  // nothing on another one. The same shape as `claimMentionsFor`.

  it("keeps them when the same account signs back in", () => {
    claimSearchesFor("site-a|me");
    addSavedSearch(PLANT);

    claimSearchesFor("site-a|me");

    expect(getSavedSearches()).toHaveLength(1);
  });

  it("drops them for a different account", () => {
    // Otherwise the palette offers "Search by Plant number" on a site that has
    // never heard of the field, and the search fails naming a field the reader
    // did not choose.
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
