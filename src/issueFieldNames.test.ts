import { describe, expect, it, vi } from "vitest";

const KEY = "performa-issue-fields";

/** The store reads localStorage once at import and then keeps its value in
 *  memory, so each case needs the module loaded afresh over its own seed. */
async function fresh(seed?: unknown) {
  localStorage.clear();
  if (seed !== undefined)
    localStorage.setItem(
      KEY,
      typeof seed === "string" ? seed : JSON.stringify(seed),
    );
  vi.resetModules();
  return import("./issueFieldNames");
}

describe("reading the stored config", () => {
  it("ships the standard layout, standard fields first", async () => {
    const m = await fresh();
    const { detail } = m.getIssueFieldConfig();
    expect(detail.slice(0, 5)).toEqual(m.STANDARD_FIELD_NAMES);
    expect(detail).toContain("Plant-No.");
  });

  it("brings a config written before the standard fields were listed forward", async () => {
    // Left alone it would now hide Type, Priority and the rest entirely.
    const m = await fresh({ detail: ["Plant-No."] });
    const { detail } = m.getIssueFieldConfig();
    expect(detail).toEqual([...m.STANDARD_FIELD_NAMES, "Plant-No."]);
  });

  it("leaves a config of this version alone", async () => {
    // Including one where the standard fields were deliberately removed.
    const m = await fresh({ detail: ["Plant-No."], wide: [], version: 2 });
    expect(m.getIssueFieldConfig().detail).toEqual(["Plant-No."]);
  });

  it("keeps what was configured", async () => {
    const m = await fresh({ detail: ["Only This"], version: 2 });
    expect(m.getIssueFieldConfig()).toEqual({
      detail: ["Only This"],
      wide: [],
    });
  });

  it("honours an empty list rather than restoring the defaults", async () => {
    // Removing every field is a choice, not a corrupt store.
    const m = await fresh({ detail: [], version: 2 });
    expect(m.getIssueFieldConfig().detail).toEqual([]);
  });

  it("falls back to the defaults on junk", async () => {
    for (const junk of ["not json", "[]", '"a string"', "null"]) {
      const m = await fresh(junk);
      expect(m.getIssueFieldConfig().detail).toContain("Plant-No.");
    }
  });

  it("drops non-string entries and blanks", async () => {
    const m = await fresh({ detail: ["Good", 42, "", "  ", null], version: 2 });
    expect(m.getIssueFieldConfig()).toEqual({ detail: ["Good"], wide: [] });
  });

  it("dedupes case-insensitively but keeps display order", async () => {
    const m = await fresh({ detail: ["Zeta", "Alpha", "zeta"], version: 2 });
    // Order is the display order — the one thing that must not be sorted away.
    expect(m.getIssueFieldConfig().detail).toEqual(["Zeta", "Alpha"]);
  });
});

describe("editing the config", () => {
  it("adds and removes fields", async () => {
    const m = await fresh({ detail: ["A"], version: 2 });
    m.addDetailField("B");
    expect(m.getIssueFieldConfig().detail).toEqual(["A", "B"]);
    m.removeDetailField("a");
    expect(m.getIssueFieldConfig().detail).toEqual(["B"]);
  });

  it("ignores an add that repeats a field already shown", async () => {
    const m = await fresh({ detail: ["A"], version: 2 });
    m.addDetailField(" a ");
    expect(m.getIssueFieldConfig().detail).toEqual(["A"]);
  });

  it("moves a field up and down", async () => {
    const m = await fresh({ detail: ["A", "B", "C"], version: 2 });
    m.moveDetailField("C", -1);
    expect(m.getIssueFieldConfig().detail).toEqual(["A", "C", "B"]);
    m.moveDetailField("A", 1);
    expect(m.getIssueFieldConfig().detail).toEqual(["C", "A", "B"]);
  });

  it("treats a move off either end as a no-op", async () => {
    const m = await fresh({ detail: ["A", "B"], version: 2 });
    m.moveDetailField("A", -1);
    m.moveDetailField("B", 1);
    m.moveDetailField("missing", 1);
    expect(m.getIssueFieldConfig().detail).toEqual(["A", "B"]);
  });

  it("persists across a reload", async () => {
    const m = await fresh({ detail: ["A"], version: 2 });
    m.addDetailField("B");
    vi.resetModules();
    const again = await import("./issueFieldNames");
    expect(again.getIssueFieldConfig()).toEqual({
      detail: ["A", "B"],
      wide: [],
    });
  });
});

describe("full-width fields", () => {
  it("marks a field wide and back again", async () => {
    const m = await fresh({ detail: ["Analysis"], wide: [], version: 2 });
    m.toggleWideField("Analysis");
    expect(m.isWideField(m.getIssueFieldConfig(), "analysis")).toBe(true);
    m.toggleWideField("Analysis");
    expect(m.isWideField(m.getIssueFieldConfig(), "Analysis")).toBe(false);
  });

  it("drops a wide entry whose field is no longer shown", async () => {
    // It would otherwise linger invisibly and reappear on re-adding the field.
    const m = await fresh({ detail: ["A", "B"], wide: ["B"], version: 2 });
    m.removeDetailField("B");
    expect(m.getIssueFieldConfig().wide).toEqual([]);
  });

  it("ignores a wide entry for a field that was never shown", async () => {
    const m = await fresh({ detail: ["A"], wide: ["Ghost"], version: 2 });
    expect(m.getIssueFieldConfig().wide).toEqual([]);
  });

  it("keeps the name as the field list spells it", async () => {
    const m = await fresh({
      detail: ["Plant-No."],
      wide: ["plant-no."],
      version: 2,
    });
    expect(m.getIssueFieldConfig().wide).toEqual(["Plant-No."]);
  });
});
