import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftInput } from "./drafts";

const KEY = "performa-drafts";

const notify = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./notify", () => ({ notify }));

async function freshDrafts(seed?: unknown) {
  localStorage.clear();
  if (seed !== undefined) localStorage.setItem(KEY, JSON.stringify(seed));
  vi.resetModules();
  return import("./drafts");
}

const input = (o: Partial<DraftInput> = {}): DraftInput => ({
  seconds: 5400,
  date: "2026-10-12",
  time: "09:30",
  note: "Server room, order 4711",
  issueKey: null,
  issueSummary: "",
  billable: true,
  ...o,
});

beforeEach(() => {
  notify.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parking time", () => {
  it("keeps a draft, across a restart too", async () => {
    const d = await freshDrafts();
    d.addDraft(input());

    vi.resetModules();
    const again = await import("./drafts");
    expect(again.getDrafts()).toEqual([
      expect.objectContaining({
        seconds: 5400,
        note: "Server room, order 4711",
      }),
    ]);
  });

  it("needs a note when there is no issue", async () => {
    const d = await freshDrafts();
    expect(d.addDraft(input({ note: "  " }))).toBeNull();
    expect(d.getDrafts()).toEqual([]);
  });

  it("does without a note once there is an issue", async () => {
    const d = await freshDrafts();
    expect(d.addDraft(input({ note: "", issueKey: "ABC-1" }))).not.toBeNull();
  });

  it("refuses less than a minute", async () => {
    const d = await freshDrafts();
    expect(d.draftProblem(input({ seconds: 30 }))).toMatch(/at least a minute/);
    expect(d.addDraft(input({ seconds: 0 }))).toBeNull();
  });

  it("keeps whole minutes", async () => {
    const d = await freshDrafts();
    expect(d.addDraft(input({ seconds: 5_429 }))?.seconds).toBe(5_400);
  });

  it("drops unreadable entries but keeps the rest", async () => {
    const good = { id: "a", ...input() };
    const d = await freshDrafts([
      good,
      { id: "b", seconds: "lots", date: "2026-10-12", time: "09:30" },
      { id: "c", seconds: 600, date: "yesterday", time: "09:30" },
      null,
    ]);
    expect(d.getDrafts().map((x) => x.id)).toEqual(["a"]);
  });
});

describe("editing", () => {
  it("changes a draft in place", async () => {
    const d = await freshDrafts();
    const draft = d.addDraft(input())!;

    expect(d.updateDraft(draft.id, { issueKey: "ABC-1", note: "" })).toBe(true);
    expect(d.getDrafts()[0]).toMatchObject({ issueKey: "ABC-1", note: "" });
  });

  it("refuses an edit that would leave it meaningless", async () => {
    const d = await freshDrafts();
    const draft = d.addDraft(input())!;

    expect(d.updateDraft(draft.id, { note: "" })).toBe(false);
    expect(d.getDrafts()[0].note).toBe("Server room, order 4711");
  });

  it("discards only the one asked for", async () => {
    const d = await freshDrafts();
    const a = d.addDraft(input({ note: "a" }))!;
    d.addDraft(input({ note: "b" }));

    d.discardDraft(a.id);
    expect(d.getDrafts().map((x) => x.note)).toEqual(["b"]);
  });
});

describe("booking", () => {
  it("leaves what was not booked, starting where the booked part ended", async () => {
    const d = await freshDrafts();
    const draft = d.addDraft(input({ seconds: 3 * 3600, time: "09:00" }))!;

    d.bookDraft(draft.id, 2 * 3600);

    expect(d.getDrafts()).toEqual([
      expect.objectContaining({ id: draft.id, seconds: 3600, time: "11:00" }),
    ]);
  });

  it("is gone once booked up", async () => {
    const d = await freshDrafts();
    const draft = d.addDraft(input({ seconds: 3600 }))!;

    d.bookDraft(draft.id, 3600);
    expect(d.getDrafts()).toEqual([]);
  });

  it("is gone when more than it held was booked", async () => {
    const d = await freshDrafts();
    const draft = d.addDraft(input({ seconds: 3600 }))!;

    d.bookDraft(draft.id, 5400);
    expect(d.getDrafts()).toEqual([]);
  });

  it("never moves the start past the end of the day", async () => {
    const d = await freshDrafts();
    const draft = d.addDraft(input({ seconds: 4 * 3600, time: "22:00" }))!;

    d.bookDraft(draft.id, 3 * 3600);
    expect(d.getDrafts()[0].time).toBe("23:59");
  });
});

describe("age", () => {
  it("turns stale after a week", async () => {
    const d = await freshDrafts();
    const draft = { id: "x", ...input({ date: "2026-10-01" }) };

    expect(d.draftAgeDays(draft, "2026-10-07")).toBe(6);
    expect(d.isStale(draft, "2026-10-07")).toBe(false);
    expect(d.isStale(draft, "2026-10-08")).toBe(true);
  });
});

describe("the reminder", () => {
  it("says nothing with nothing parked", async () => {
    const d = await freshDrafts();
    d.remindAboutDrafts();
    expect(notify).not.toHaveBeenCalled();
  });

  it("names the amount for one draft", async () => {
    const d = await freshDrafts();
    d.addDraft(input({ seconds: 5400 }));

    d.remindAboutDrafts();
    expect(notify).toHaveBeenCalledWith(
      "Parked time is waiting",
      "1h 30m still needs booking.",
    );
  });

  it("counts and sums several", async () => {
    const d = await freshDrafts();
    d.addDraft(input({ seconds: 3600 }));
    d.addDraft(input({ seconds: 1800 }));

    d.remindAboutDrafts();
    expect(notify).toHaveBeenCalledWith(
      "Parked time is waiting",
      "2 drafts, 1h 30m in all, still need booking.",
    );
  });
});
