import { describe, expect, it, vi } from "vitest";

const KEY = "performa-todo-ignored-statuses";

/** The store reads localStorage once at import and then keeps its value in
 *  memory, so each case needs the module loaded afresh over its own seed. */
async function freshStatuses(seed?: unknown) {
  localStorage.clear();
  if (seed !== undefined)
    localStorage.setItem(
      KEY,
      typeof seed === "string" ? seed : JSON.stringify(seed),
    );
  vi.resetModules();
  return import("./todoStatuses");
}

const persisted = (): unknown => JSON.parse(localStorage.getItem(KEY) ?? "{}");

describe("ignored todo statuses", () => {
  it("starts empty", async () => {
    // A status name that doesn't exist on the site makes Jira reject the whole
    // query, so nothing may be ignored that the user didn't pick themselves.
    const { getIgnoredStatuses } = await freshStatuses();
    expect(getIgnoredStatuses()).toEqual({});
  });

  it("adds and removes a status", async () => {
    const { toggleIgnoredStatus, getIgnoredStatuses } = await freshStatuses();

    toggleIgnoredStatus("DEV", "Waiting for customer");
    expect(getIgnoredStatuses()).toEqual({ DEV: ["Waiting for customer"] });
    expect(persisted()).toEqual({ DEV: ["Waiting for customer"] });

    // A project left ignoring nothing is dropped, not kept as an empty list —
    // an empty entry would only add a dead term to the query.
    toggleIgnoredStatus("DEV", "Waiting for customer");
    expect(getIgnoredStatuses()).toEqual({});
  });

  it("keeps each project's list to itself", async () => {
    const { toggleIgnoredStatus, getIgnoredStatuses } = await freshStatuses();

    toggleIgnoredStatus("DEV", "In Arbeit");
    toggleIgnoredStatus("OPS", "Review");

    expect(getIgnoredStatuses()).toEqual({
      DEV: ["In Arbeit"],
      OPS: ["Review"],
    });
  });

  it("matches an existing entry regardless of case when toggling off", async () => {
    const { toggleIgnoredStatus, getIgnoredStatuses } = await freshStatuses({
      DEV: ["Waiting for customer"],
    });

    toggleIgnoredStatus("DEV", "waiting FOR customer");

    expect(getIgnoredStatuses()).toEqual({});
  });

  it("sorts and dedupes so the read cache key is stable", async () => {
    const { setIgnoredStatuses, getIgnoredStatuses } = await freshStatuses();

    setIgnoredStatuses({
      OPS: ["Review"],
      DEV: ["  Review  ", "Backlog", "review", "", "   "],
    });

    expect(JSON.stringify(getIgnoredStatuses())).toBe(
      JSON.stringify({ DEV: ["Backlog", "Review"], OPS: ["Review"] }),
    );
  });

  it("notifies subscribers with a new object", async () => {
    const { toggleIgnoredStatus, getIgnoredStatuses } = await freshStatuses();
    const before = getIgnoredStatuses();

    toggleIgnoredStatus("DEV", "Backlog");

    expect(getIgnoredStatuses()).not.toBe(before);
  });

  it("survives whatever is in storage", async () => {
    for (const seed of ["not json", ["an", "array"], { DEV: "not a list" }]) {
      const { getIgnoredStatuses } = await freshStatuses(seed);
      expect(getIgnoredStatuses()).toEqual({});
    }
    // A partly-mangled list keeps the entries that are still usable.
    const { getIgnoredStatuses } = await freshStatuses({
      DEV: [1, null, "Backlog"],
    });
    expect(getIgnoredStatuses()).toEqual({ DEV: ["Backlog"] });
  });
});

describe("copying a project's list", () => {
  it("gives the targets the source's list, replacing theirs", async () => {
    const { copyIgnoredStatuses, getIgnoredStatuses } = await freshStatuses({
      DEV: ["Backlog", "Review"],
      OPS: ["Something else"],
    });

    copyIgnoredStatuses("DEV", ["OPS", "SUP"]);

    expect(getIgnoredStatuses()).toEqual({
      DEV: ["Backlog", "Review"],
      OPS: ["Backlog", "Review"],
      SUP: ["Backlog", "Review"],
    });
  });

  it("leaves projects that weren't targeted alone", async () => {
    const { copyIgnoredStatuses, getIgnoredStatuses } = await freshStatuses({
      DEV: ["Backlog"],
      INT: ["Untouched"],
    });

    copyIgnoredStatuses("DEV", ["OPS"]);

    expect(getIgnoredStatuses().INT).toEqual(["Untouched"]);
  });

  it("clears the targets when the source hides nothing", async () => {
    // Replacing is what makes it a copy: afterwards the targets match the
    // source, including when the source is empty.
    const { copyIgnoredStatuses, getIgnoredStatuses } = await freshStatuses({
      OPS: ["Review"],
    });

    copyIgnoredStatuses("DEV", ["OPS"]);

    expect(getIgnoredStatuses()).toEqual({});
  });

  it("copies a fresh list rather than sharing one", async () => {
    const { copyIgnoredStatuses, toggleIgnoredStatus, getIgnoredStatuses } =
      await freshStatuses({ DEV: ["Backlog"] });

    copyIgnoredStatuses("DEV", ["OPS"]);
    toggleIgnoredStatus("OPS", "Review");

    expect(getIgnoredStatuses().DEV).toEqual(["Backlog"]);
    expect(getIgnoredStatuses().OPS).toEqual(["Backlog", "Review"]);
  });
});
