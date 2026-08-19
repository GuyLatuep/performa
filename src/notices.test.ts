import { describe, expect, it, vi } from "vitest";

const KEY = "performa-notices-seen";

/** The store reads localStorage once at import and then keeps its value in
 *  memory, so each case needs the module loaded afresh over its own seed. */
async function freshNotices(seed?: unknown) {
  localStorage.clear();
  if (seed !== undefined)
    localStorage.setItem(
      KEY,
      typeof seed === "string" ? seed : JSON.stringify(seed),
    );
  vi.resetModules();
  return import("./notices");
}

const persisted = (): unknown => JSON.parse(localStorage.getItem(KEY) ?? "[]");

describe("one-off notices", () => {
  it("owes an unseen notice and settles it once", async () => {
    const { dismissNotice, TODO_FILTER_NOTICE } = await freshNotices();

    dismissNotice(TODO_FILTER_NOTICE);
    expect(persisted()).toEqual([TODO_FILTER_NOTICE]);

    // Dismissing again must not pile up duplicates — the tab notice and a
    // future one share this list.
    dismissNotice(TODO_FILTER_NOTICE);
    expect(persisted()).toEqual([TODO_FILTER_NOTICE]);
  });

  it("keeps notices already seen when settling another", async () => {
    const { dismissNotice, TODO_FILTER_NOTICE } = await freshNotices([
      "some-older-notice",
    ]);

    dismissNotice(TODO_FILTER_NOTICE);

    expect(persisted()).toEqual(["some-older-notice", TODO_FILTER_NOTICE]);
  });

  it("survives whatever is in storage", async () => {
    for (const seed of ["not json", { not: "an array" }]) {
      const { dismissNotice, TODO_FILTER_NOTICE } = await freshNotices(seed);
      // A user whose storage is unreadable sees the notice again rather than
      // never — annoying beats silently withholding it.
      dismissNotice(TODO_FILTER_NOTICE);
      expect(persisted()).toEqual([TODO_FILTER_NOTICE]);
    }
  });
});
