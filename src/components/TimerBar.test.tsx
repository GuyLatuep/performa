/** @vitest-environment happy-dom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

// The tray's "stop timer" routes through the same modal, and its pause item
// through the same toggle as the bar's button; capture the listeners by event
// name so the test can fire either.
const events = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  const unlisten = vi.fn();
  return {
    unlisten,
    fire: (name = "stop-timer") => handlers.get(name)?.(),
    listen: vi.fn(async (name: string, cb: () => void) => {
      handlers.set(name, cb);
      return unlisten;
    }),
    reset() {
      handlers.clear();
    },
  };
});
vi.mock("@tauri-apps/api/event", () => ({ listen: events.listen }));

import { apiMock, resetApiMock, worklogEntry } from "../test-support/api";
import { ShortcutKeys } from "../test-support/shortcuts";
import {
  doneLogging,
  getTimer,
  getTimersToLog,
  isPaused,
  startTimer,
  stopTimer,
  switchTimer,
} from "../timer";
import TimerBar from "./TimerBar";

const NOW = new Date(2026, 2, 18, 12, 0, 0);

function renderBar() {
  render(
    <>
      <ShortcutKeys />
      <TimerBar />
    </>,
  );
}

/** Let `minutes` pass on the wall clock and let the bar catch up. The last
 *  second is spent advancing the timers, so the pending tick fires and the
 *  clock lands exactly `minutes` later. */
async function after(minutes: number) {
  await act(async () => {
    vi.setSystemTime(new Date(Date.now() + minutes * 60_000 - 1000));
    await vi.advanceTimersByTimeAsync(1000);
  });
}

/** Start a timer that has been running for `minutes`. */
function runningFor(minutes: number) {
  vi.setSystemTime(new Date(NOW.getTime() - minutes * 60_000));
  startTimer("ABC-1", "Replace the pump");
  vi.setSystemTime(NOW);
}

beforeEach(() => {
  resetApiMock();
  localStorage.clear();
  stopTimer();
  // The queue of stopped timers lives as long as the module; a form one test
  // left open must not greet the next.
  while (getTimersToLog().length > 0) doneLogging();
  events.listen.mockClear();
  events.unlisten.mockClear();
  events.reset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("with no timer running", () => {
  it("renders nothing at all", () => {
    const { container } = render(<TimerBar />);

    expect(container).toHaveProperty("textContent", "");
  });
});

describe("with a timer running", () => {
  it("shows the issue and a running clock", () => {
    runningFor(5);

    renderBar();

    expect(screen.getByText("ABC-1")).toBeDefined();
    expect(screen.getByText("Replace the pump")).toBeDefined();
    // Hours are dropped below an hour, so five minutes reads "05:00".
    expect(screen.getByText("05:00")).toBeDefined();
  });

  it("opens the log modal on Stop, with the time rounded up", async () => {
    // Quarter-hour rounding is what the timer is for: 5 minutes booked is
    // 15 minutes of somebody's day.
    runningFor(5);
    renderBar();

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(screen.getByText("Log time — ABC-1")).toBeDefined();
    expect(screen.getByLabelText(/Time spent/)).toHaveProperty("value", "15m");
  });

  it("shows the time already logged on the issue", async () => {
    // A timer is often the second or third stint on the same issue, so the
    // modal says what is already booked before another entry goes on top.
    apiMock.issueWorklogs.mockResolvedValue([
      worklogEntry({ id: "w1", timeSpentSeconds: 1800, comment: "first pass" }),
    ]);
    runningFor(5);
    renderBar();

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(await screen.findByText("first pass")).toBeDefined();
    // Twice over: the entry's own duration and the issue's running total.
    expect(screen.getAllByText("30m")).toHaveLength(2);
    expect(apiMock.issueWorklogs).toHaveBeenCalledWith("ABC-1");
  });

  it("stops the clock when the modal opens", async () => {
    runningFor(5);
    renderBar();

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(screen.queryByText("Stop")).toBeNull();
  });
});

describe("the tray's stop", () => {
  it("opens the same modal", async () => {
    runningFor(30);
    renderBar();

    events.fire();

    expect(await screen.findByText("Log time — ABC-1")).toBeDefined();
    expect(screen.getByLabelText(/Time spent/)).toHaveProperty("value", "30m");
  });

  it("does nothing when no timer is running", async () => {
    renderBar();

    events.fire();

    await waitFor(() => expect(screen.queryByText(/Log time/)).toBeNull());
  });

  it("stops listening when the bar goes away", async () => {
    runningFor(5);
    const { unmount } = render(<TimerBar />);
    // `listen` is async, and the cleanup can only call an unlisten it already
    // holds — so let the subscription land before unmounting.
    await waitFor(() => expect(events.listen).toHaveBeenCalled());
    await Promise.resolve();

    unmount();

    expect(events.unlisten).toHaveBeenCalled();
  });
});

describe("pausing", () => {
  it("freezes the clock and offers to resume", async () => {
    runningFor(5);
    renderBar();

    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    await after(10);

    expect(screen.getByText("05:00")).toBeDefined();
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  });

  it("counts on from where it stood after a resume", async () => {
    runningFor(5);
    renderBar();

    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    await after(10);
    await userEvent.click(screen.getByRole("button", { name: "Resume" }));
    await after(2);

    // 5 before the break + 2 after it; the 10 paused minutes are left out.
    expect(screen.getByText("07:00")).toBeDefined();
  });

  it("logs only the running time, from when the work began", async () => {
    runningFor(20);
    renderBar();

    await userEvent.click(screen.getByRole("button", { name: "Pause" }));
    await after(60);
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    // 20 minutes rounds up to 30, not 1h 30m with the hour's pause in it.
    expect(screen.getByLabelText(/Time spent/)).toHaveProperty("value", "30m");
    // The start is the first start — 11:40 — not the moment of the pause.
    expect(screen.getByLabelText(/Start/)).toHaveProperty("value", "11:40");
  });

  it("answers to the Shift chord as well", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Macintosh; Intel Mac OS X 10_15_7",
    });
    runningFor(5);
    renderBar();
    const press = () =>
      act(() => {
        fireEvent.keyDown(document.body, {
          key: "T",
          metaKey: true,
          shiftKey: true,
        });
      });

    press();
    expect(isPaused(getTimer()!)).toBe(true);

    press();
    expect(isPaused(getTimer()!)).toBe(false);
  });

  it("flips from the tray without opening anything", async () => {
    runningFor(5);
    renderBar();
    await waitFor(() =>
      expect(events.listen).toHaveBeenCalledWith(
        "toggle-pause-timer",
        expect.any(Function),
      ),
    );

    act(() => events.fire("toggle-pause-timer"));

    expect(await screen.findByRole("button", { name: "Resume" })).toBeDefined();
    expect(screen.queryByText(/Log time/)).toBeNull();
  });
});

describe("logging the tracked time", () => {
  it("sends it and closes the modal", async () => {
    runningFor(30);
    renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    await userEvent.click(screen.getByRole("button", { name: "Log work" }));

    await waitFor(() =>
      expect(apiMock.logWork).toHaveBeenCalledWith(
        "ABC-1",
        expect.objectContaining({ timeSpentSeconds: 1800 }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText("Log time — ABC-1")).toBeNull(),
    );
  });

  it("keeps the modal open and says why when Jira refuses", async () => {
    apiMock.logWork.mockRejectedValue(new Error("Jira returned 400"));
    runningFor(30);
    renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    await userEvent.click(screen.getByRole("button", { name: "Log work" }));

    expect(await screen.findByText(/Jira returned 400/)).toBeDefined();
    expect(screen.getByText("Log time — ABC-1")).toBeDefined();
  });

  it("refuses a duration it cannot read", async () => {
    runningFor(30);
    renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    await userEvent.clear(screen.getByLabelText(/Time spent/));
    await userEvent.type(screen.getByLabelText(/Time spent/), "soon");
    await userEvent.click(screen.getByRole("button", { name: "Log work" }));

    expect(apiMock.logWork).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter a valid duration/)).toBeDefined();
  });
});

describe("discarding", () => {
  it("asks before throwing tracked time away", async () => {
    runningFor(30);
    renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.getByText("Discard tracked time?")).toBeDefined();
  });

  it("keeps the modal open on Keep", async () => {
    runningFor(30);
    renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    await userEvent.click(screen.getByRole("button", { name: "Keep" }));

    expect(screen.getByRole("button", { name: "Log work" })).toBeDefined();
  });

  it("closes without logging once confirmed", async () => {
    runningFor(30);
    renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.queryByText("Log time — ABC-1")).toBeNull();
    expect(apiMock.logWork).not.toHaveBeenCalled();
  });
});

describe("switching to another issue", () => {
  it("opens the old timer's form while the new one runs", async () => {
    runningFor(20);
    renderBar();

    act(() => switchTimer("XYZ-2", "Something urgent"));

    // The form is about the old issue, with its time and its start…
    expect(await screen.findByText("Log time — ABC-1")).toBeDefined();
    expect(screen.getByLabelText(/Time spent/)).toHaveProperty("value", "30m");
    expect(screen.getByLabelText(/Start/)).toHaveProperty("value", "11:40");
    // …while the bar already shows the new one.
    expect(screen.getByText("XYZ-2")).toBeDefined();
  });

  it("logs the old issue and keeps the new timer running", async () => {
    runningFor(20);
    renderBar();
    act(() => switchTimer("XYZ-2", "Something urgent"));

    await userEvent.click(
      await screen.findByRole("button", { name: "Log work" }),
    );

    await waitFor(() => expect(screen.queryByText(/Log time/)).toBeNull());
    expect(apiMock.logWork).toHaveBeenCalledWith(
      "ABC-1",
      expect.objectContaining({ timeSpentSeconds: 1800 }),
    );
    expect(getTimer()?.issueKey).toBe("XYZ-2");
  });

  it("works through two switches one form at a time", async () => {
    runningFor(20);
    renderBar();
    act(() => switchTimer("XYZ-2", "Second"));
    act(() => switchTimer("XYZ-3", "Third"));

    expect(await screen.findByText("Log time — ABC-1")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(await screen.findByText("Log time — XYZ-2")).toBeDefined();
  });
});
