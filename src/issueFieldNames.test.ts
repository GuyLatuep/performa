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
  it("ships the fields this app was built for", async () => {
    const m = await fresh();
    expect(m.getIssueFieldConfig().detail).toContain("Plant-No.");
    expect(m.getIssueFieldConfig().team).toBe("");
  });

  it("keeps what was configured", async () => {
    const m = await fresh({ detail: ["Only This"], team: "Team" });
    expect(m.getIssueFieldConfig()).toEqual({
      detail: ["Only This"],
      team: "Team",
    });
  });

  it("honours an empty list rather than restoring the defaults", async () => {
    // Removing every field is a choice, not a corrupt store.
    const m = await fresh({ detail: [], team: "" });
    expect(m.getIssueFieldConfig().detail).toEqual([]);
  });

  it("falls back to the defaults on junk", async () => {
    for (const junk of ["not json", "[]", '"a string"', "null"]) {
      const m = await fresh(junk);
      expect(m.getIssueFieldConfig().detail).toContain("Plant-No.");
    }
  });

  it("drops non-string entries and blanks", async () => {
    const m = await fresh({ detail: ["Good", 42, "", "  ", null], team: 7 });
    expect(m.getIssueFieldConfig()).toEqual({ detail: ["Good"], team: "" });
  });

  it("dedupes case-insensitively but keeps display order", async () => {
    const m = await fresh({ detail: ["Zeta", "Alpha", "zeta"], team: "" });
    // Order is the display order — the one thing that must not be sorted away.
    expect(m.getIssueFieldConfig().detail).toEqual(["Zeta", "Alpha"]);
  });
});

describe("editing the config", () => {
  it("adds and removes fields", async () => {
    const m = await fresh({ detail: ["A"], team: "" });
    m.addDetailField("B");
    expect(m.getIssueFieldConfig().detail).toEqual(["A", "B"]);
    m.removeDetailField("a");
    expect(m.getIssueFieldConfig().detail).toEqual(["B"]);
  });

  it("ignores an add that repeats a field already shown", async () => {
    const m = await fresh({ detail: ["A"], team: "" });
    m.addDetailField(" a ");
    expect(m.getIssueFieldConfig().detail).toEqual(["A"]);
  });

  it("moves a field up and down", async () => {
    const m = await fresh({ detail: ["A", "B", "C"], team: "" });
    m.moveDetailField("C", -1);
    expect(m.getIssueFieldConfig().detail).toEqual(["A", "C", "B"]);
    m.moveDetailField("A", 1);
    expect(m.getIssueFieldConfig().detail).toEqual(["C", "A", "B"]);
  });

  it("treats a move off either end as a no-op", async () => {
    const m = await fresh({ detail: ["A", "B"], team: "" });
    m.moveDetailField("A", -1);
    m.moveDetailField("B", 1);
    m.moveDetailField("missing", 1);
    expect(m.getIssueFieldConfig().detail).toEqual(["A", "B"]);
  });

  it("persists across a reload", async () => {
    const m = await fresh({ detail: ["A"], team: "" });
    m.addDetailField("B");
    m.setTeamField("Team");
    vi.resetModules();
    const again = await import("./issueFieldNames");
    expect(again.getIssueFieldConfig()).toEqual({
      detail: ["A", "B"],
      team: "Team",
    });
  });
});

describe("requestedFieldNames", () => {
  it("is just the shown fields when nothing is editable", async () => {
    const m = await fresh();
    expect(m.requestedFieldNames({ detail: ["A", "B"], team: "" })).toEqual([
      "A",
      "B",
    ]);
  });

  it("adds the editable field so the view knows its current value", async () => {
    const m = await fresh();
    expect(m.requestedFieldNames({ detail: ["A"], team: "Team" })).toEqual([
      "A",
      "Team",
    ]);
  });

  it("does not ask for the editable field twice", async () => {
    const m = await fresh();
    expect(
      m.requestedFieldNames({ detail: ["A", "Team"], team: "team" }),
    ).toEqual(["A", "Team"]);
  });
});
