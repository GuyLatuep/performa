import { describe, expect, it, vi } from "vitest";
import { IssueSummary } from "./api";

const KEY = "performa-pinned-issues";

const issue = (key: string, summary = `${key} summary`): IssueSummary => ({
  key,
  summary,
});

/** The store reads localStorage once at import and then keeps its value in
 *  memory, so each case needs the module loaded afresh over its own seed. */
async function freshPins(seed?: unknown) {
  localStorage.clear();
  if (seed !== undefined) localStorage.setItem(KEY, JSON.stringify(seed));
  vi.resetModules();
  return import("./pins");
}

const persisted = (): unknown => JSON.parse(localStorage.getItem(KEY) ?? "[]");

describe("pinned issues", () => {
  it("pins and unpins the same issue", async () => {
    const { togglePin } = await freshPins();

    togglePin(issue("ABC-1"));
    expect(persisted()).toEqual([{ key: "ABC-1", summary: "ABC-1 summary" }]);

    togglePin(issue("ABC-1"));
    expect(persisted()).toEqual([]);
  });

  it("keeps existing pins when adding another", async () => {
    const { togglePin } = await freshPins();

    togglePin(issue("ABC-1"));
    togglePin(issue("ABC-2"));
    togglePin(issue("ABC-1"));

    expect(persisted()).toEqual([{ key: "ABC-2", summary: "ABC-2 summary" }]);
  });

  it("stores only key and summary", async () => {
    const { togglePin } = await freshPins();

    // A snapshotted due date would go stale while the pin sticks around.
    togglePin({ ...issue("ABC-1"), dueDate: "2026-07-16" });

    expect(persisted()).toEqual([{ key: "ABC-1", summary: "ABC-1 summary" }]);
  });

  it("restores what was persisted", async () => {
    const { usePinnedIssues, togglePin } = await freshPins([
      { key: "ABC-9", summary: "restored" },
    ]);
    expect(usePinnedIssues).toBeTypeOf("function");

    // Toggling the restored pin off proves it was actually loaded.
    togglePin(issue("ABC-9", "restored"));
    expect(persisted()).toEqual([]);
  });

  it("survives malformed storage", async () => {
    for (const junk of ["not json", '{"not":"an array"}', "[1, null, 2]"]) {
      localStorage.clear();
      localStorage.setItem(KEY, junk);
      vi.resetModules();
      const { togglePin } = await import("./pins");

      // Nothing usable was restored, so this is the only pin.
      togglePin(issue("ABC-1"));
      expect(persisted()).toEqual([{ key: "ABC-1", summary: "ABC-1 summary" }]);
    }
  });

  it("drops entries that are missing the fields it needs", async () => {
    const { togglePin } = await freshPins([
      { key: "ABC-1", summary: "keep me" },
      { key: "ABC-2" }, // no summary — unusable
      { summary: "no key" },
    ]);

    togglePin(issue("ABC-3"));

    expect(persisted()).toEqual([
      { key: "ABC-1", summary: "keep me" },
      { key: "ABC-3", summary: "ABC-3 summary" },
    ]);
  });
});
