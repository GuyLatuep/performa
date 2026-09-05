import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorklogEntry } from "./api";
import {
  MonthColumn,
  buildMonthGrid,
  dayTone,
  decimalHours,
  dedupeEntries,
  monthColumns,
  rowOrderOf,
} from "./monthGrid";

// August 2026: starts on a Saturday, ends on a Monday.
const START = "2026-08-01";
const END = "2026-08-31";

let nextId = 0;

const log = (
  issueKey: string,
  date: string,
  hours: number,
  summary = `${issueKey} summary`,
): WorklogEntry => ({
  id: `w${nextId++}`,
  issueKey,
  issueSummary: summary,
  timeSpentSeconds: hours * 3600,
  date,
  time: "09:00",
  comment: "",
  billable: true,
});

beforeEach(() => {
  nextId = 0;
  // Mid-month, so there are both past and future columns to tell apart.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 17, 10, 0));
});

const dates = (cols: { date: string }[]) => cols.map((c) => c.date);

describe("monthColumns", () => {
  it("gives every weekday a column", () => {
    const cols = monthColumns(START, END, []);
    expect(cols).toHaveLength(21); // August 2026 has 21 weekdays
    expect(cols.every((c) => !c.weekend)).toBe(true);
  });

  it("adds back a weekend day that was worked, in date order", () => {
    const cols = dates(monthColumns(START, END, ["2026-08-15"]));
    expect(cols.slice(cols.indexOf("2026-08-14"), cols.indexOf("2026-08-17"))) //
      .toEqual(["2026-08-14", "2026-08-15"]); // Fri, then the booked Sat
    expect(cols).not.toContain("2026-08-16"); // the Sunday stays out
  });

  it("ignores a booked day outside the range", () => {
    expect(dates(monthColumns(START, END, ["2026-07-25"]))).not.toContain(
      "2026-07-25",
    );
  });

  it("marks today and the days after it", () => {
    const cols = monthColumns(START, END, []);
    expect(cols.find((c) => c.date === "2026-08-17")?.isToday).toBe(true);
    expect(cols.find((c) => c.date === "2026-08-17")?.future).toBe(false);
    expect(cols.find((c) => c.date === "2026-08-18")?.future).toBe(true);
    expect(cols.find((c) => c.date === "2026-08-14")?.future).toBe(false);
  });
});

describe("buildMonthGrid", () => {
  it("adds a cell, a row, a day and the whole month up", () => {
    const grid = buildMonthGrid(
      [
        log("ABC-1", "2026-08-03", 2),
        log("ABC-1", "2026-08-04", 1),
        log("ABC-2", "2026-08-03", 3),
      ],
      START,
      END,
    );
    expect(grid.rows).toHaveLength(2);
    const abc1 = grid.rows.find((r) => r.issueKey === "ABC-1")!;
    expect(abc1.cells.get("2026-08-03")!.seconds).toBe(2 * 3600);
    expect(abc1.total).toBe(3 * 3600);
    expect(grid.dayTotals.get("2026-08-03")).toBe(5 * 3600);
    expect(grid.total).toBe(6 * 3600);
  });

  it("balances: both margins add up to the same grand total", () => {
    const grid = buildMonthGrid(
      [
        log("ABC-1", "2026-08-03", 2),
        log("ABC-2", "2026-08-04", 1.5),
        log("ABC-1", "2026-08-05", 4),
      ],
      START,
      END,
    );
    const byRow = grid.rows.reduce((s, r) => s + r.total, 0);
    const byDay = [...grid.dayTotals.values()].reduce((s, v) => s + v, 0);
    expect(byRow).toBe(grid.total);
    expect(byDay).toBe(grid.total);
  });

  it("keeps two worklogs on one issue and day together in one cell", () => {
    const grid = buildMonthGrid(
      [log("ABC-1", "2026-08-03", 1), log("ABC-1", "2026-08-03", 0.5)],
      START,
      END,
    );
    const cell = grid.rows[0].cells.get("2026-08-03")!;
    expect(cell.entries).toHaveLength(2);
    expect(cell.seconds).toBe(1.5 * 3600);
  });

  it("leaves out worklogs from outside the month", () => {
    // The month is fetched as whole weeks, so entries either side of it are
    // ordinary — not a caller mistake to be surprised by.
    const grid = buildMonthGrid(
      [log("ABC-1", "2026-07-31", 8), log("ABC-1", "2026-08-03", 1)],
      START,
      END,
    );
    expect(grid.total).toBe(1 * 3600);
    expect(grid.rows[0].cells.has("2026-07-31")).toBe(false);
  });

  it("shows a weekend booking rather than swallowing it", () => {
    const grid = buildMonthGrid([log("ABC-1", "2026-08-15", 4)], START, END);
    expect(dates(grid.columns)).toContain("2026-08-15");
    expect(grid.total).toBe(4 * 3600);
  });

  it("orders rows by month total, then by key", () => {
    const grid = buildMonthGrid(
      [
        log("ABC-9", "2026-08-03", 1),
        log("ABC-1", "2026-08-03", 5),
        log("ABC-4", "2026-08-03", 1),
      ],
      START,
      END,
    );
    expect(grid.rows.map((r) => r.issueKey)).toEqual([
      "ABC-1",
      "ABC-4",
      "ABC-9",
    ]);
  });

  it("holds a pinned row still when its total changes", () => {
    const before = buildMonthGrid(
      [log("ABC-1", "2026-08-03", 5), log("ABC-2", "2026-08-03", 1)],
      START,
      END,
    );
    const order = rowOrderOf(before);
    // ABC-2 overtakes ABC-1 — but the rows must not swap under the cursor.
    const after = buildMonthGrid(
      [log("ABC-1", "2026-08-03", 5), log("ABC-2", "2026-08-03", 40)],
      START,
      END,
      order,
    );
    expect(after.rows.map((r) => r.issueKey)).toEqual(order);
  });

  it("puts an issue the pin never heard of at the end", () => {
    const grid = buildMonthGrid(
      [log("ABC-1", "2026-08-03", 1), log("NEW-1", "2026-08-03", 99)],
      START,
      END,
      ["ABC-1", "GONE-1"],
    );
    expect(grid.rows.map((r) => r.issueKey)).toEqual(["ABC-1", "NEW-1"]);
  });

  it("keeps a stable order among several rows the pin doesn't cover", () => {
    // Regression: ranking the unpinned ones as Infinity made every pair of
    // them compare NaN, which leaves the sort order undefined.
    const grid = buildMonthGrid(
      [
        log("NEW-1", "2026-08-03", 1),
        log("NEW-2", "2026-08-03", 5),
        log("NEW-3", "2026-08-03", 3),
      ],
      START,
      END,
      ["ABC-1"],
    );
    expect(grid.rows.map((r) => r.issueKey)).toEqual([
      "NEW-2",
      "NEW-3",
      "NEW-1",
    ]);
  });

  it("still has its columns when nothing was booked at all", () => {
    const grid = buildMonthGrid([], START, END);
    expect(grid.columns).toHaveLength(21);
    expect(grid.rows).toEqual([]);
    expect(grid.total).toBe(0);
  });
});

describe("dayTone", () => {
  const workday = {
    date: "2026-03-16",
    weekend: false,
    future: false,
  } as MonthColumn;
  const hours = (h: number) => h * 3600;

  it("marks a full day, a partial one and a thin one apart", () => {
    expect(dayTone(hours(8), workday)).toBe(" tone-full");
    expect(dayTone(hours(4), workday)).toBe(" tone-part");
    expect(dayTone(hours(1), workday)).toBe(" tone-thin");
  });

  it("counts an empty workday as thin", () => {
    expect(dayTone(0, workday)).toBe(" tone-thin");
  });

  it("puts the boundaries where the thresholds say", () => {
    // Six hours exactly is not yet "full"; three exactly is already "part".
    expect(dayTone(hours(6), workday)).toBe(" tone-part");
    expect(dayTone(hours(3), workday)).toBe(" tone-part");
    expect(dayTone(hours(2.99), workday)).toBe(" tone-thin");
  });

  it("says nothing about a weekend, which is not expected to be full", () => {
    expect(dayTone(0, { ...workday, weekend: true })).toBe("");
    expect(dayTone(hours(8), { ...workday, weekend: true })).toBe("");
  });

  it("says nothing about a day that has not happened yet", () => {
    // A future day is not behind.
    expect(dayTone(0, { ...workday, future: true })).toBe("");
  });
});

describe("decimalHours", () => {
  it("drops the trailing zeros a column has no room for", () => {
    expect(decimalHours(3600)).toBe("1");
    expect(decimalHours(2 * 3600)).toBe("2");
  });

  it("keeps the fraction that matters", () => {
    expect(decimalHours(5400)).toBe("1.5");
    expect(decimalHours(900)).toBe("0.25");
    expect(decimalHours(2700)).toBe("0.75");
  });

  it("reads zero as one character, not as an empty cell", () => {
    // The `|| "0"` fallback: stripping the zeros off "0.00" leaves nothing.
    expect(decimalHours(0)).toBe("0");
  });

  it("rounds to what two decimals can say", () => {
    // 10 minutes is 0.1666…; the column has room for neither.
    expect(decimalHours(600)).toBe("0.17");
  });
});

describe("dedupeEntries", () => {
  const entry = (id: string, seconds = 3600): WorklogEntry => ({
    id,
    issueKey: "ABC-1",
    issueSummary: "Replace the pump",
    timeSpentSeconds: seconds,
    date: "2026-03-16",
    time: "09:00",
    comment: "",
    billable: true,
  });

  it("keeps one worklog per id", () => {
    // The month is fetched a week at a time and the weeks overlap at their
    // edges, so the same worklog arrives twice.
    const deduped = dedupeEntries([entry("1"), entry("2"), entry("1")]);

    expect(deduped.map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("leaves a list with no repeats alone", () => {
    const entries = [entry("1"), entry("2")];

    expect(dedupeEntries(entries)).toHaveLength(2);
  });

  it("is empty for nothing", () => {
    expect(dedupeEntries([])).toEqual([]);
  });
});
