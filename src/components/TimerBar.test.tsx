/** @vitest-environment happy-dom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

// The tray's "stop timer" routes through the same modal; capture the listener
// so the test can fire it.
const events = vi.hoisted(() => {
  let handler: (() => void) | undefined;
  const unlisten = vi.fn();
  return {
    unlisten,
    fire: () => handler?.(),
    listen: vi.fn(async (_name: string, cb: () => void) => {
      handler = cb;
      return unlisten;
    }),
    reset() {
      handler = undefined;
    },
  };
});
vi.mock("@tauri-apps/api/event", () => ({ listen: events.listen }));

import { apiMock, resetApiMock } from "../test-support/api";
import { startTimer, stopTimer } from "../timer";
import TimerBar from "./TimerBar";

const NOW = new Date(2026, 2, 18, 12, 0, 0);

function renderBar() {
  const onLogged = vi.fn();
  render(<TimerBar onLogged={onLogged} />);
  return onLogged;
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
    const { container } = render(<TimerBar onLogged={vi.fn()} />);

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
    const { unmount } = render(<TimerBar onLogged={vi.fn()} />);
    // `listen` is async, and the cleanup can only call an unlisten it already
    // holds — so let the subscription land before unmounting.
    await waitFor(() => expect(events.listen).toHaveBeenCalled());
    await Promise.resolve();

    unmount();

    expect(events.unlisten).toHaveBeenCalled();
  });
});

describe("logging the tracked time", () => {
  it("sends it and tells the caller", async () => {
    runningFor(30);
    const onLogged = renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    await userEvent.click(screen.getByRole("button", { name: "Log work" }));

    await waitFor(() =>
      expect(apiMock.logWork).toHaveBeenCalledWith(
        "ABC-1",
        expect.objectContaining({ timeSpentSeconds: 1800 }),
      ),
    );
    expect(onLogged).toHaveBeenCalledTimes(1);
  });

  it("keeps the modal open and says why when Jira refuses", async () => {
    apiMock.logWork.mockRejectedValue(new Error("Jira returned 400"));
    runningFor(30);
    const onLogged = renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    await userEvent.click(screen.getByRole("button", { name: "Log work" }));

    expect(await screen.findByText(/Jira returned 400/)).toBeDefined();
    expect(onLogged).not.toHaveBeenCalled();
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
    const onLogged = renderBar();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.queryByText("Log time — ABC-1")).toBeNull();
    expect(apiMock.logWork).not.toHaveBeenCalled();
    expect(onLogged).not.toHaveBeenCalled();
  });
});
