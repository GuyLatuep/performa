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
    const m = await fresh({ detail: ["Plant-No."], sizes: {}, version: 3 });
    expect(m.getIssueFieldConfig().detail).toEqual(["Plant-No."]);
  });

  it("keeps what was configured", async () => {
    const m = await fresh({ detail: ["Only This"], version: 3 });
    expect(m.getIssueFieldConfig()).toEqual({
      detail: ["Only This"],
      sizes: {},
    });
  });

  it("honours an empty list rather than restoring the defaults", async () => {
    // Removing every field is a choice, not a corrupt store.
    const m = await fresh({ detail: [], version: 3 });
    expect(m.getIssueFieldConfig().detail).toEqual([]);
  });

  it("falls back to the defaults on junk", async () => {
    for (const junk of ["not json", "[]", '"a string"', "null"]) {
      const m = await fresh(junk);
      expect(m.getIssueFieldConfig().detail).toContain("Plant-No.");
    }
  });

  it("drops non-string entries and blanks", async () => {
    const m = await fresh({ detail: ["Good", 42, "", "  ", null], version: 3 });
    expect(m.getIssueFieldConfig()).toEqual({ detail: ["Good"], sizes: {} });
  });

  it("dedupes case-insensitively but keeps display order", async () => {
    const m = await fresh({ detail: ["Zeta", "Alpha", "zeta"], version: 3 });
    // Order is the display order — the one thing that must not be sorted away.
    expect(m.getIssueFieldConfig().detail).toEqual(["Zeta", "Alpha"]);
  });
});

describe("editing the config", () => {
  it("adds and removes fields", async () => {
    const m = await fresh({ detail: ["A"], version: 3 });
    m.addDetailField("B");
    expect(m.getIssueFieldConfig().detail).toEqual(["A", "B"]);
    m.removeDetailField("a");
    expect(m.getIssueFieldConfig().detail).toEqual(["B"]);
  });

  it("ignores an add that repeats a field already shown", async () => {
    const m = await fresh({ detail: ["A"], version: 3 });
    m.addDetailField(" a ");
    expect(m.getIssueFieldConfig().detail).toEqual(["A"]);
  });

  it("moves a field up and down", async () => {
    const m = await fresh({ detail: ["A", "B", "C"], version: 3 });
    m.moveDetailField("C", -1);
    expect(m.getIssueFieldConfig().detail).toEqual(["A", "C", "B"]);
    m.moveDetailField("A", 1);
    expect(m.getIssueFieldConfig().detail).toEqual(["C", "A", "B"]);
  });

  it("treats a move off either end as a no-op", async () => {
    const m = await fresh({ detail: ["A", "B"], version: 3 });
    m.moveDetailField("A", -1);
    m.moveDetailField("B", 1);
    m.moveDetailField("missing", 1);
    expect(m.getIssueFieldConfig().detail).toEqual(["A", "B"]);
  });

  it("persists across a reload", async () => {
    const m = await fresh({ detail: ["A"], version: 3 });
    m.addDetailField("B");
    vi.resetModules();
    const again = await import("./issueFieldNames");
    expect(again.getIssueFieldConfig()).toEqual({
      detail: ["A", "B"],
      sizes: {},
    });
  });
});

describe("field sizes", () => {
  it("defaults to normal and cycles through the three", async () => {
    const m = await fresh({ detail: ["Analysis"], sizes: {}, version: 3 });
    expect(m.fieldSize(m.getIssueFieldConfig(), "Analysis")).toBe("normal");
    m.setFieldSize("Analysis", "wide");
    expect(m.fieldSize(m.getIssueFieldConfig(), "analysis")).toBe("wide");
    m.setFieldSize("Analysis", "full");
    expect(m.fieldSize(m.getIssueFieldConfig(), "Analysis")).toBe("full");
  });

  it("cycles normal → wide → full → normal", async () => {
    const m = await fresh();
    expect(m.nextFieldSize("normal")).toBe("wide");
    expect(m.nextFieldSize("wide")).toBe("full");
    expect(m.nextFieldSize("full")).toBe("normal");
  });

  it("matches the name however it is punctuated", async () => {
    const m = await fresh({ detail: ["Plant-No."], sizes: {}, version: 3 });
    m.setFieldSize("plant no", "full");
    expect(m.fieldSize(m.getIssueFieldConfig(), "Plant-No.")).toBe("full");
  });

  it("does not store the default", async () => {
    const m = await fresh({ detail: ["A"], sizes: {}, version: 3 });
    m.setFieldSize("A", "normal");
    expect(m.getIssueFieldConfig().sizes).toEqual({});
  });

  it("drops a size whose field is no longer shown", async () => {
    // It would otherwise linger invisibly and surprise on re-adding.
    const m = await fresh({
      detail: ["A", "B"],
      sizes: { b: "full" },
      version: 3,
    });
    m.removeDetailField("B");
    expect(m.getIssueFieldConfig().sizes).toEqual({});
  });

  it("brings a version 2 wide list forward as full", async () => {
    // "wide" then meant a row to itself, which is "full" now.
    const m = await fresh({ detail: ["A", "B"], wide: ["B"], version: 2 });
    const config = m.getIssueFieldConfig();
    expect(m.fieldSize(config, "B")).toBe("full");
    expect(m.fieldSize(config, "A")).toBe("normal");
  });
});

describe("reorderDetailField", () => {
  const order = async () =>
    await fresh({ detail: ["A", "B", "C", "D"], sizes: {}, version: 3 });

  it("moves a field to an absolute position", async () => {
    const m = await order();
    m.reorderDetailField("D", 1);
    expect(m.getIssueFieldConfig().detail).toEqual(["A", "D", "B", "C"]);
  });

  it("reads the index against the list without the dragged field", async () => {
    // Dropping A where B is means "put it before B" — B is at 0 once A is out.
    const m = await order();
    m.reorderDetailField("A", 0);
    expect(m.getIssueFieldConfig().detail).toEqual(["A", "B", "C", "D"]);
    m.reorderDetailField("A", 2);
    expect(m.getIssueFieldConfig().detail).toEqual(["B", "C", "A", "D"]);
  });

  it("clamps a drop past either end", async () => {
    const m = await order();
    m.reorderDetailField("B", 99);
    expect(m.getIssueFieldConfig().detail).toEqual(["A", "C", "D", "B"]);
    m.reorderDetailField("B", -5);
    expect(m.getIssueFieldConfig().detail).toEqual(["B", "A", "C", "D"]);
  });

  it("ignores a field that is not shown", async () => {
    const m = await order();
    m.reorderDetailField("Ghost", 0);
    expect(m.getIssueFieldConfig().detail).toEqual(["A", "B", "C", "D"]);
  });
});
