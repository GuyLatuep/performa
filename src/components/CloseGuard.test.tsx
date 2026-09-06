/** @vitest-environment happy-dom */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { MissingWorklog } from "../api";
import type { ActiveTimer } from "../timer";
import CloseGuard from "./CloseGuard";

// The guard's job is the decision it makes when the window is asked to close,
// so the two stores it reads are stubbed and driven directly; each has its own
// tests. What is exercised here is which prompt comes up, and what reaches the
// window afterwards.

const tauri = vi.hoisted(() => ({
  onCloseRequested: vi.fn(),
  destroy: vi.fn(),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: tauri.onCloseRequested,
    destroy: tauri.destroy,
  }),
}));

const timer = vi.hoisted(() => ({
  getTimer: vi.fn<() => unknown>(() => null),
  useTimer: vi.fn<() => unknown>(() => null),
  useElapsedSeconds: vi.fn(() => 0),
  formatClock: vi.fn((s: number) => `clock:${s}`),
}));
vi.mock("../timer", () => timer);

const missing = vi.hoisted(() => ({
  getMissing: vi.fn<() => unknown[]>(() => []),
  useMissing: vi.fn<() => unknown[]>(() => []),
  refreshMissing: vi.fn(async () => undefined),
}));
vi.mock("../missing", () => missing);

const activeTimer = (o: Partial<ActiveTimer> = {}): ActiveTimer =>
  ({
    issueKey: "ABC-1",
    issueSummary: "Replace the pump",
    startedAt: Date.now() - 90_000,
    ...o,
  }) as ActiveTimer;

const finding = (issueKey: string): MissingWorklog => ({
  issueKey,
  issueSummary: "Replace the pump",
  kind: "comment",
  detail: "cleaned the filter",
  activityAt: "2026-03-16T09:00:00.000+01:00",
  logKey: issueKey,
  logSummary: "Replace the pump",
});

/** Both the store hook and the live getter, which the guard deliberately reads
 *  separately — the handler consults the getter to avoid a stale closure. */
function timerIs(value: ActiveTimer | null) {
  timer.getTimer.mockReturnValue(value);
  timer.useTimer.mockReturnValue(value);
}

function missingIs(items: MissingWorklog[]) {
  missing.getMissing.mockReturnValue(items);
  missing.useMissing.mockReturnValue(items);
}

/** Mount the guard and hand back a way to ask the window to close, standing in
 *  for the user hitting the red button. */
function mountGuard() {
  const view = render(<CloseGuard />);
  const handler = tauri.onCloseRequested.mock.calls[0]?.[0] as (event: {
    preventDefault: () => void;
  }) => Promise<void>;

  return {
    ...view,
    /** Ask to close; resolves once the guard has finished deciding. */
    async requestClose() {
      const preventDefault = vi.fn();
      await act(async () => {
        await handler({ preventDefault });
      });
      return preventDefault;
    },
    /** Ask to close without awaiting — for the re-entrancy case. */
    fireClose() {
      const preventDefault = vi.fn();
      const done = handler({ preventDefault });
      return { preventDefault, done };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tauri.onCloseRequested.mockResolvedValue(tauri.unlisten);
  timerIs(null);
  missingIs([]);
  missing.refreshMissing.mockResolvedValue(undefined);
});

describe("when nothing is pending", () => {
  it("shows no prompt at all", () => {
    render(<CloseGuard />);

    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("re-checks before letting the app go", async () => {
    // The reminder list is only as fresh as the last poll, a quarter of an
    // hour back — work logged just before quitting would slip past the guard.
    const guard = mountGuard();

    await guard.requestClose();

    expect(missing.refreshMissing).toHaveBeenCalledWith("close");
    expect(tauri.destroy).toHaveBeenCalledTimes(1);
  });

  it("blocks the close first and completes it itself", async () => {
    // preventDefault has to happen synchronously, before the await — so the
    // close is always blocked and then finished by hand.
    const guard = mountGuard();

    const preventDefault = await guard.requestClose();

    expect(preventDefault).toHaveBeenCalled();
    expect(tauri.destroy).toHaveBeenCalled();
  });

  it("stays silent while it checks", async () => {
    // A dialog for the common case would only make quitting look stuck.
    const guard = mountGuard();

    await guard.requestClose();

    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("quits anyway when the check could not reach Jira", async () => {
    // Quitting must not hinge on Jira being reachable. `refreshMissing`
    // swallows the API error itself and leaves the last known list standing,
    // so an offline check reaches the guard as a resolved promise over an
    // empty list — and the app closes.
    missing.refreshMissing.mockImplementation(async () => {
      missingIs([]);
    });
    const guard = mountGuard();

    await guard.requestClose();

    expect(tauri.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("when a timer is still running", () => {
  it("warns instead of quitting", async () => {
    timerIs(activeTimer());
    const guard = mountGuard();

    const preventDefault = await guard.requestClose();

    expect(preventDefault).toHaveBeenCalled();
    expect(tauri.destroy).not.toHaveBeenCalled();
    expect(screen.getByRole("heading").textContent).toBe("Timer still running");
  });

  it("names the issue and how long it has run", async () => {
    timerIs(activeTimer({ issueKey: "DEV-9" }));
    timer.useElapsedSeconds.mockReturnValue(95);
    const guard = mountGuard();

    await guard.requestClose();

    expect(screen.getByText("DEV-9")).toBeDefined();
    expect(screen.getByText("clock:95")).toBeDefined();
  });

  it("does not scan for unlogged work — the timer decides on its own", async () => {
    timerIs(activeTimer());
    const guard = mountGuard();

    await guard.requestClose();

    expect(missing.refreshMissing).not.toHaveBeenCalled();
  });

  it("goes back to work when told to keep working", async () => {
    timerIs(activeTimer());
    const guard = mountGuard();
    await guard.requestClose();

    await userEvent.click(screen.getByRole("button", { name: "Keep working" }));

    expect(screen.queryByRole("heading")).toBeNull();
    expect(tauri.destroy).not.toHaveBeenCalled();
  });

  it("quits and discards the time when told to quit anyway", async () => {
    timerIs(activeTimer());
    const guard = mountGuard();
    await guard.requestClose();

    await userEvent.click(screen.getByRole("button", { name: "Quit anyway" }));

    expect(tauri.destroy).toHaveBeenCalledTimes(1);
  });

  it("wins over pending unlogged work", async () => {
    // Tracked time is lost outright on quit; a reminder is not.
    timerIs(activeTimer());
    missingIs([finding("ABC-1")]);
    const guard = mountGuard();

    await guard.requestClose();

    expect(screen.getByRole("heading").textContent).toBe("Timer still running");
  });
});

describe("when unlogged work is pending", () => {
  it("warns instead of quitting", async () => {
    const guard = mountGuard();
    missing.refreshMissing.mockImplementation(async () => {
      missingIs([finding("ABC-1")]);
    });

    const preventDefault = await guard.requestClose();

    expect(preventDefault).toHaveBeenCalled();
    expect(tauri.destroy).not.toHaveBeenCalled();
    expect(screen.getByRole("heading").textContent).toBe("Unlogged work");
  });

  it("counts one issue in the singular", async () => {
    const guard = mountGuard();
    missing.refreshMissing.mockImplementation(async () => {
      missingIs([finding("ABC-1")]);
    });

    await guard.requestClose();

    expect(
      screen.getByText(/One issue in the Missing worklog tab has/),
    ).toBeDefined();
  });

  it("counts several in the plural", async () => {
    const guard = mountGuard();
    missing.refreshMissing.mockImplementation(async () => {
      missingIs([finding("ABC-1"), finding("ABC-2"), finding("ABC-3")]);
    });

    await guard.requestClose();

    expect(
      screen.getByText(/3 issues in the Missing worklog tab have/),
    ).toBeDefined();
  });

  it("goes back when told to", async () => {
    const guard = mountGuard();
    missing.refreshMissing.mockImplementation(async () => {
      missingIs([finding("ABC-1")]);
    });
    await guard.requestClose();

    await userEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(screen.queryByRole("heading")).toBeNull();
    expect(tauri.destroy).not.toHaveBeenCalled();
  });

  it("quits when told to quit anyway", async () => {
    const guard = mountGuard();
    missing.refreshMissing.mockImplementation(async () => {
      missingIs([finding("ABC-1")]);
    });
    await guard.requestClose();

    await userEvent.click(screen.getByRole("button", { name: "Quit anyway" }));

    expect(tauri.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("a second close request while the first is still checking", () => {
  it("does not start another scan", async () => {
    let release!: () => void;
    missing.refreshMissing.mockImplementation(
      () => new Promise<undefined>((r) => (release = () => r(undefined))),
    );
    const guard = mountGuard();

    const first = guard.fireClose();
    const second = guard.fireClose();

    expect(missing.refreshMissing).toHaveBeenCalledTimes(1);
    // The impatient second request is blocked rather than let through.
    expect(second.preventDefault).toHaveBeenCalled();
    expect(tauri.destroy).not.toHaveBeenCalled();

    await act(async () => {
      release();
      await first.done;
      await second.done;
    });
    expect(tauri.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("cleanup", () => {
  it("stops listening for the close once it unmounts", async () => {
    const { unmount } = render(<CloseGuard />);
    // The listener is registered through a promise, so let it resolve first.
    await act(async () => {});

    unmount();

    expect(tauri.unlisten).toHaveBeenCalledTimes(1);
  });
});
