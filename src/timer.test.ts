import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatClock,
  isPlayfulClock,
  msToNextSecond,
  roundUpToQuarterHour,
} from "./timer";

const KEY = "performa-active-timer";

async function freshTimer(seed?: unknown) {
  localStorage.clear();
  if (seed !== undefined) localStorage.setItem(KEY, JSON.stringify(seed));
  vi.resetModules();
  return import("./timer");
}

describe("roundUpToQuarterHour", () => {
  it("rounds up to the next quarter, with a 15 minute floor", () => {
    expect(roundUpToQuarterHour(0)).toBe(900);
    expect(roundUpToQuarterHour(1)).toBe(900);
    expect(roundUpToQuarterHour(900)).toBe(900);
    expect(roundUpToQuarterHour(901)).toBe(1800);
    expect(roundUpToQuarterHour(3600)).toBe(3600);
    expect(roundUpToQuarterHour(3601)).toBe(4500);
  });
});

describe("msToNextSecond", () => {
  it("waits only for the rest of the current second", () => {
    // The point of the exercise: a tick that arrives mid-second schedules the
    // next one at the boundary, so the delay shrinks instead of the lateness
    // accumulating into a skipped second.
    expect(msToNextSecond(1_400, 0)).toBe(600);
    expect(msToNextSecond(1_999, 0)).toBe(1);
  });

  it("waits a full second when already on a boundary", () => {
    expect(msToNextSecond(0, 0)).toBe(1000);
    expect(msToNextSecond(2_000, 0)).toBe(1000);
  });

  it("measures against the timer's start, not the epoch", () => {
    expect(msToNextSecond(5_250, 4_000)).toBe(750);
  });

  it("never returns a negative delay for a start in the future", () => {
    // A clock correction mid-timer; setTimeout would fire immediately and spin.
    expect(msToNextSecond(0, 3_000)).toBe(3_000);
  });

  it("stays within a second however far the timer has run", () => {
    for (const elapsed of [0, 1, 999, 1_000, 60_000, 3_600_500, 86_400_123]) {
      const delay = msToNextSecond(elapsed, 0);
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(1000);
    }
  });
});

describe("formatClock", () => {
  it("switches to hours only past the hour", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(95)).toBe("01:35");
    expect(formatClock(3599)).toBe("59:59");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3725)).toBe("1:02:05");
  });

  it("matches the Rust tray formatter", () => {
    // src-tauri/src/tray.rs renders the same clock next to the menu bar icon;
    // these are the exact cases its `clock_formats` test asserts.
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(95)).toBe("01:35");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3725)).toBe("1:02:05");
  });
});

describe("isPlayfulClock", () => {
  const mmss = (m: number, s: number) => m * 60 + s;
  const hmmss = (h: number, m: number, s: number) => h * 3600 + m * 60 + s;

  it("winks at Schnapszahlen below an hour", () => {
    for (const n of [11, 22, 33, 44, 55]) {
      expect(isPlayfulClock(mmss(n, n))).toBe(true);
    }
  });

  it("winks at Schnapszahlen past an hour", () => {
    // 1:11:11 through 5:55:55 — minutes cap at 59, so the next one after
    // that is 11:11:11.
    for (const n of [1, 2, 3, 4, 5]) {
      expect(isPlayfulClock(hmmss(n, n * 11, n * 11))).toBe(true);
    }
    expect(isPlayfulClock(hmmss(11, 11, 11))).toBe(true);
  });

  it("winks at 13:37, whatever the hour", () => {
    expect(isPlayfulClock(mmss(13, 37))).toBe(true);
    expect(isPlayfulClock(hmmss(1, 13, 37))).toBe(true);
  });

  it("stays quiet the rest of the time", () => {
    expect(isPlayfulClock(mmss(12, 34))).toBe(false);
    expect(isPlayfulClock(mmss(11, 12))).toBe(false);
    // "05:55" — the leading zero breaks the run of digits.
    expect(isPlayfulClock(mmss(5, 55))).toBe(false);
    // "1:00:00" — a round hour is not a Schnapszahl.
    expect(isPlayfulClock(3600)).toBe(false);
  });

  it("does not wink at a timer that just started", () => {
    // Without the guard, "00:00" would be all-identical digits and every
    // single timer would flash on its first tick.
    expect(isPlayfulClock(0)).toBe(false);
    expect(isPlayfulClock(-1)).toBe(false);
    expect(isPlayfulClock(1)).toBe(false);
  });
});

describe("active timer", () => {
  it("persists a started timer and clears it on stop", async () => {
    const { startTimer, stopTimer, getTimer, isPaused } = await freshTimer();

    startTimer("ABC-1", "Fix the thing");

    const running = getTimer();
    expect(running?.issueKey).toBe("ABC-1");
    expect(running?.issueSummary).toBe("Fix the thing");
    expect(running && isPaused(running)).toBe(false);
    expect(localStorage.getItem(KEY)).not.toBeNull();

    stopTimer();

    expect(getTimer()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("restores a timer left running by a previous session", async () => {
    // Elapsed time is derived from the stored stretches, so closing the app
    // with a timer running must not lose it.
    const from = Date.now() - 5000;
    const { getTimer } = await freshTimer({
      issueKey: "ABC-2",
      issueSummary: "Still running",
      segments: [{ from, to: null }],
    });

    expect(getTimer()).toEqual({
      issueKey: "ABC-2",
      issueSummary: "Still running",
      segments: [{ from, to: null }],
    });
  });

  it("restores a paused timer as paused", async () => {
    const seed = {
      issueKey: "ABC-2",
      issueSummary: "On hold",
      segments: [{ from: 1_000, to: 61_000 }],
    };
    const { getTimer, isPaused, elapsedSeconds } = await freshTimer(seed);

    const t = getTimer()!;
    expect(isPaused(t)).toBe(true);
    // Paused: the clock reads the same however much later it is asked.
    expect(elapsedSeconds(t, 10_000_000)).toBe(60);
  });

  it("keeps a timer stored before pausing existed", async () => {
    // Installs updating with a timer running hold the old bare `startedAt`;
    // the update must not silently drop that time.
    const startedAt = Date.now() - 5000;
    const { getTimer } = await freshTimer({
      issueKey: "ABC-2",
      issueSummary: "Still running",
      startedAt,
    });

    expect(getTimer()).toEqual({
      issueKey: "ABC-2",
      issueSummary: "Still running",
      segments: [{ from: startedAt, to: null }],
    });
  });

  it("ignores malformed or incomplete stored timers", async () => {
    const junk = [
      "not json",
      { issueKey: "ABC-3" }, // no time at all — elapsed would be NaN
      { startedAt: 1 }, // no issue to log against
      { issueKey: "ABC-3", startedAt: "soon" },
      { issueKey: "ABC-3", segments: [] }, // nothing tracked
      { issueKey: "ABC-3", segments: [{ from: "soon", to: null }] },
      // An open stretch before the last: two clocks running at once.
      {
        issueKey: "ABC-3",
        segments: [
          { from: 1, to: null },
          { from: 2, to: 3 },
        ],
      },
    ];
    for (const seed of junk) {
      localStorage.clear();
      localStorage.setItem(
        KEY,
        typeof seed === "string" ? seed : JSON.stringify(seed),
      );
      vi.resetModules();
      const { getTimer } = await import("./timer");
      expect(getTimer()).toBeNull();
    }
  });
});

describe("pausing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function timerAt(start: number) {
    vi.useFakeTimers({ now: start });
    const mod = await freshTimer();
    mod.startTimer("ABC-1", "Fix the thing");
    return mod;
  }

  it("leaves paused stretches out of the elapsed time", async () => {
    const t = await timerAt(0);
    vi.setSystemTime(60_000);
    t.pauseTimer();
    vi.setSystemTime(600_000); // a ten-minute-odd break
    expect(t.elapsedSeconds(t.getTimer()!, Date.now())).toBe(60);

    t.resumeTimer();
    vi.setSystemTime(630_000);
    expect(t.elapsedSeconds(t.getTimer()!, Date.now())).toBe(90);
  });

  it("keeps the start of the first stretch as when the work began", async () => {
    const t = await timerAt(1_000);
    vi.setSystemTime(2_000);
    t.pauseTimer();
    vi.setSystemTime(9_000);
    t.resumeTimer();

    expect(t.timerStartedAt(t.getTimer()!)).toBe(1_000);
  });

  it("ticks on from the same reading after a resume", async () => {
    // The clock origin is what the tray and the bar count from; after a
    // resume it must make the clock read exactly what it read at the pause.
    const t = await timerAt(0);
    vi.setSystemTime(45_000);
    t.pauseTimer();
    vi.setSystemTime(100_000);
    t.resumeTimer();

    expect(t.clockOrigin(t.getTimer()!)).toBe(100_000 - 45_000);
  });

  it("has no clock origin while paused", async () => {
    const t = await timerAt(0);
    t.pauseTimer();
    expect(t.clockOrigin(t.getTimer()!)).toBeNull();
  });

  it("survives a restart while paused", async () => {
    const t = await timerAt(0);
    vi.setSystemTime(30_000);
    t.pauseTimer();

    vi.resetModules();
    const again = await import("./timer");
    const restored = again.getTimer()!;
    expect(again.isPaused(restored)).toBe(true);
    expect(again.elapsedSeconds(restored, 999_999)).toBe(30);
  });

  it("ignores a pause while paused and a resume while running", async () => {
    const t = await timerAt(0);
    t.resumeTimer();
    expect(t.getTimer()!.segments).toHaveLength(1);

    vi.setSystemTime(10_000);
    t.pauseTimer();
    vi.setSystemTime(20_000);
    t.pauseTimer();
    expect(t.getTimer()!.segments).toEqual([{ from: 0, to: 10_000 }]);
  });

  it("does nothing without a timer", async () => {
    const t = await freshTimer();
    t.pauseTimer();
    t.resumeTimer();
    expect(t.getTimer()).toBeNull();
  });

  it("mirrors a pause and a resume to the tray", async () => {
    const t = await timerAt(0);
    const { invoke } = await import("@tauri-apps/api/core");
    const calls = vi.mocked(invoke);
    calls.mockClear();

    vi.setSystemTime(95_000);
    t.pauseTimer();
    expect(calls).toHaveBeenCalledWith("timer_paused", {
      issueKey: "ABC-1",
      elapsedSeconds: 95,
    });

    vi.setSystemTime(200_000);
    t.resumeTimer();
    expect(calls).toHaveBeenCalledWith("timer_started", {
      issueKey: "ABC-1",
      startedAt: 200_000 - 95_000,
    });
  });
});

describe("switching", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function timerAt(start: number) {
    vi.useFakeTimers({ now: start });
    const mod = await freshTimer();
    mod.startTimer("ABC-1", "Fix the thing");
    return mod;
  }

  it("starts the new timer at once and queues the old one's time", async () => {
    const t = await timerAt(0);
    vi.setSystemTime(20 * 60_000);

    t.switchTimer("XYZ-2", "Something urgent");

    const now = t.getTimer()!;
    expect(now.issueKey).toBe("XYZ-2");
    expect(t.timerStartedAt(now)).toBe(20 * 60_000);
    const [old] = t.getTimersToLog();
    expect(old.timer.issueKey).toBe("ABC-1");
    // Rounded at the moment of the switch: 20 minutes is half an hour booked.
    expect(old.seconds).toBe(30 * 60);
  });

  it("hands over a paused timer without its paused time", async () => {
    const t = await timerAt(0);
    vi.setSystemTime(40 * 60_000);
    t.pauseTimer();
    vi.setSystemTime(3 * 3600_000);

    t.switchTimer("XYZ-2", "Something urgent");

    expect(t.getTimersToLog()[0].seconds).toBe(45 * 60);
  });

  it("is a plain start when nothing is running", async () => {
    const t = await freshTimer();
    t.switchTimer("XYZ-2", "Something urgent");

    expect(t.getTimer()?.issueKey).toBe("XYZ-2");
    expect(t.getTimersToLog()).toEqual([]);
  });

  it("leaves a timer alone that is already on that issue", async () => {
    const t = await timerAt(0);
    const before = t.getTimer();

    t.switchTimer("ABC-1", "Fix the thing");

    expect(t.getTimer()).toBe(before);
    expect(t.getTimersToLog()).toEqual([]);
  });

  it("keeps every switched-away timer, oldest first", async () => {
    // A second switch while the first one's form is still open must not
    // push that earlier time out.
    const t = await timerAt(0);
    vi.setSystemTime(10 * 60_000);
    t.switchTimer("XYZ-2", "Second");
    vi.setSystemTime(70 * 60_000);
    t.switchTimer("XYZ-3", "Third");

    expect(t.getTimersToLog().map((s) => s.timer.issueKey)).toEqual([
      "ABC-1",
      "XYZ-2",
    ]);

    t.doneLogging();
    expect(t.getTimersToLog().map((s) => s.timer.issueKey)).toEqual(["XYZ-2"]);
  });
});

describe("a timer without a ticket", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parks its time as a draft when stopped", async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 15, 9, 0) });
    const t = await freshTimer();
    const drafts = await import("./drafts");
    t.startTimer(null, "Printer on 3rd floor");
    vi.setSystemTime(new Date(2026, 9, 15, 9, 20));

    t.stopForLogging();

    expect(t.getTimer()).toBeNull();
    // Nothing for the log form: there is no issue to log to.
    expect(t.getTimersToLog()).toEqual([]);
    expect(drafts.getDrafts()).toEqual([
      expect.objectContaining({
        seconds: 30 * 60,
        date: "2026-10-15",
        time: "09:00",
        note: "Printer on 3rd floor",
        issueKey: null,
      }),
    ]);
  });

  it("moves no issue in Jira", async () => {
    const t = await freshTimer();
    const { api } = await import("./api");
    const nudge = vi.spyOn(api, "startIssueWork");

    t.startTimer(null, "Walk-in request");

    expect(nudge).not.toHaveBeenCalled();
  });

  it("survives a restart", async () => {
    const seed = {
      issueKey: null,
      issueSummary: "Walk-in request",
      segments: [{ from: 1_000, to: null }],
    };
    const { getTimer } = await freshTimer(seed);
    expect(getTimer()).toEqual(seed);
  });

  it("is switched away from like any other, into a draft", async () => {
    vi.useFakeTimers({ now: 0 });
    const t = await freshTimer();
    const drafts = await import("./drafts");
    t.startTimer(null, "Walk-in request");
    vi.setSystemTime(10 * 60_000);

    t.switchTimer("ABC-1", "The ticket");

    expect(t.getTimer()?.issueKey).toBe("ABC-1");
    expect(t.getTimersToLog()).toEqual([]);
    expect(drafts.getDrafts()).toHaveLength(1);
  });

  it("starts a second ticket-less timer as a switch, not a no-op", async () => {
    const t = await freshTimer();
    const drafts = await import("./drafts");
    t.startTimer(null, "First");

    t.switchTimer(null, "Second");

    expect(t.getTimer()?.issueSummary).toBe("Second");
    expect(drafts.getDrafts().map((d) => d.note)).toEqual(["First"]);
  });
});

describe("Later", () => {
  it("parks a stopped timer with its issue", async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 15, 14, 0) });
    const t = await freshTimer();
    const drafts = await import("./drafts");
    t.startTimer("ABC-1", "Fix the thing");
    vi.setSystemTime(new Date(2026, 9, 15, 14, 40));
    t.stopForLogging();

    t.parkStopped(t.getTimersToLog()[0]);

    expect(drafts.getDrafts()).toEqual([
      expect.objectContaining({
        seconds: 45 * 60,
        time: "14:00",
        issueKey: "ABC-1",
        issueSummary: "Fix the thing",
      }),
    ]);
    vi.useRealTimers();
  });
});

describe("cutting idle time out", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("splits a stretch around the cut and keeps the rest running", async () => {
    const { removeInterval } = await freshTimer();
    expect(removeInterval([{ from: 0, to: null }], 10, 20)).toEqual([
      { from: 0, to: 10 },
      { from: 20, to: null },
    ]);
  });

  it("leaves stretches outside the cut alone and trims overlapping ones", async () => {
    const { removeInterval } = await freshTimer();
    expect(
      removeInterval(
        [
          { from: 0, to: 5 },
          { from: 8, to: 15 },
          { from: 30, to: null },
        ],
        10,
        20,
      ),
    ).toEqual([
      { from: 0, to: 5 },
      { from: 8, to: 10 },
      { from: 30, to: null },
    ]);
  });

  it("keeps the start when everything is cut away", async () => {
    const { removeInterval } = await freshTimer();
    expect(removeInterval([{ from: 5, to: null }], 0, Infinity)).toEqual([
      { from: 5, to: 5 },
    ]);
  });

  it("counts only running time inside a span", async () => {
    const t = await freshTimer();
    const timer = {
      issueKey: "ABC-1",
      issueSummary: "",
      segments: [
        { from: 0, to: 10 * 60_000 },
        { from: 40 * 60_000, to: null },
      ],
    };
    // 0–60 min: 10 running, 30 paused, 20 running.
    expect(t.runningMsWithin(timer, 0, 60 * 60_000)).toBe(30 * 60_000);
  });

  async function timingSince(start: number, now: number) {
    vi.useFakeTimers({ now: start });
    const t = await freshTimer();
    const drafts = await import("./drafts");
    t.startTimer("ABC-1", "Fix the thing");
    vi.setSystemTime(now);
    return { t, drafts };
  }

  it("Discard: the away time no longer counts, the timer runs on", async () => {
    const { t } = await timingSince(0, 90 * 60_000);

    t.discardAway(30 * 60_000, 75 * 60_000);

    const timer = t.getTimer()!;
    expect(t.isPaused(timer)).toBe(false);
    expect(t.elapsedSeconds(timer, Date.now())).toBe(45 * 60);
  });

  it("Draft: cut out and parked on the same issue", async () => {
    const { t, drafts } = await timingSince(
      new Date(2026, 9, 15, 12, 0).getTime(),
      new Date(2026, 9, 15, 13, 30).getTime(),
    );

    t.parkAway(
      new Date(2026, 9, 15, 12, 15).getTime(),
      new Date(2026, 9, 15, 13, 0).getTime(),
    );

    expect(t.elapsedSeconds(t.getTimer()!, Date.now())).toBe(45 * 60);
    expect(drafts.getDrafts()).toEqual([
      expect.objectContaining({
        seconds: 45 * 60,
        time: "12:15",
        issueKey: "ABC-1",
        note: "Away from the timer, 12:15–13:00",
      }),
    ]);
  });

  it("Discard & stop with nothing left ends the timer without inventing time", async () => {
    // Left right after starting: the quarter-hour minimum must not turn
    // seconds into a fifteen-minute form or draft.
    const { t, drafts } = await timingSince(0, 3600_000);

    t.stopAtAway(20_000);

    expect(t.getTimer()).toBeNull();
    expect(t.getTimersToLog()).toEqual([]);
    expect(drafts.getDrafts()).toEqual([]);
  });

  it("Discard & stop: the log form gets only the time before leaving", async () => {
    const { t } = await timingSince(0, 3 * 3600_000);

    t.stopAtAway(40 * 60_000);

    expect(t.getTimer()).toBeNull();
    // 40 minutes rounds up to 45.
    expect(t.getTimersToLog()[0].seconds).toBe(45 * 60);
  });
});

describe("the log queue across a restart", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a switched-away timer's form waiting", async () => {
    // Switch A → B, quit with A's form still open: after the restart A's
    // time is still waiting to be logged rather than gone.
    vi.useFakeTimers({ now: 0 });
    const t = await freshTimer();
    t.startTimer("ABC-1", "Fix the thing");
    vi.setSystemTime(20 * 60_000);
    t.switchTimer("XYZ-2", "Something urgent");

    vi.resetModules();
    const again = await import("./timer");

    expect(again.getTimersToLog()).toEqual([
      expect.objectContaining({
        timer: expect.objectContaining({ issueKey: "ABC-1" }),
        seconds: 30 * 60,
      }),
    ]);
    expect(again.getTimer()?.issueKey).toBe("XYZ-2");
  });

  it("forgets it once logged or discarded", async () => {
    const t = await freshTimer();
    t.startTimer("ABC-1", "Fix the thing");
    t.stopForLogging();
    t.doneLogging();

    vi.resetModules();
    const again = await import("./timer");
    expect(again.getTimersToLog()).toEqual([]);
  });

  it("drops entries it cannot read and keeps the rest", async () => {
    const good = {
      timer: {
        issueKey: "ABC-1",
        issueSummary: "",
        segments: [{ from: 0, to: 60_000 }],
      },
      seconds: 900,
    };
    localStorage.clear();
    localStorage.setItem(
      "performa-timers-to-log",
      JSON.stringify([
        good,
        { timer: { issueKey: "ABC-2" }, seconds: 900 },
        { timer: good.timer, seconds: "lots" },
        // Ticket-less timers are parked, never queued.
        { timer: { ...good.timer, issueKey: null }, seconds: 900 },
        null,
      ]),
    );
    vi.resetModules();
    const t = await import("./timer");

    expect(t.getTimersToLog()).toEqual([good]);
  });
});
