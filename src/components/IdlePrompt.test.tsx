/** @vitest-environment happy-dom */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

import { closeIdlePrompt, raiseIdlePrompt } from "../idle";
import { discardDraft, getDrafts } from "../drafts";
import {
  doneLogging,
  elapsedSeconds,
  getTimer,
  getTimersToLog,
  startTimer,
  stopTimer,
  switchTimer,
} from "../timer";
import IdlePrompt from "./IdlePrompt";

const T0 = new Date(2026, 9, 15, 12, 0).getTime();
const MIN = 60_000;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: T0 });
  stopTimer();
  while (getTimersToLog().length > 0) doneLogging();
  for (const d of getDrafts()) discardDraft(d.id);
  act(() => closeIdlePrompt());
  startTimer("ABC-1", "Replace the pump");
  // An hour in, after 45 minutes away from 12:10.
  vi.setSystemTime(T0 + 60 * MIN);
  render(<IdlePrompt />);
  act(() => raiseIdlePrompt({ from: T0 + 10 * MIN, to: T0 + 55 * MIN }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the away question", () => {
  it("says how long and when, on which issue", () => {
    const text = screen.getByRole("dialog").textContent;
    expect(text).toContain("45m");
    expect(text).toContain("12:10–12:55");
    expect(text).toContain("ABC-1");
  });

  it("keeps the time on Enter, its default", async () => {
    expect(document.activeElement?.textContent).toBe("Keep");

    await userEvent.keyboard("{Enter}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(elapsedSeconds(getTimer()!, Date.now())).toBeGreaterThanOrEqual(
      60 * 60,
    );
  });

  it("takes Escape as Keep", async () => {
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(getTimer()?.segments).toHaveLength(1);
  });

  it("discards the away time and runs on", async () => {
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    const secs = elapsedSeconds(getTimer()!, Date.now());
    expect(secs).toBeGreaterThanOrEqual(15 * 60);
    expect(secs).toBeLessThan(16 * 60);
  });

  it("parks the away time as a draft", async () => {
    await userEvent.click(screen.getByRole("button", { name: "Draft" }));

    expect(getDrafts()).toEqual([
      expect.objectContaining({ seconds: 45 * 60, issueKey: "ABC-1" }),
    ]);
  });

  it("stops at the moment of leaving", async () => {
    await userEvent.click(
      screen.getByRole("button", { name: "Discard & stop" }),
    );

    expect(getTimer()).toBeNull();
    expect(getTimersToLog()[0].seconds).toBe(15 * 60);
  });
});

describe("when its timer goes away first", () => {
  it("closes when the timer it asked about is stopped", () => {
    act(() => stopTimer());

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not come back to ask about the next timer", () => {
    act(() => stopTimer());
    act(() => startTimer("XYZ-2", "Something else"));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves the timer switched to alone", () => {
    // Stop & discard on the old question must not cut the new timer.
    act(() => switchTimer("XYZ-2", "Something else"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(getTimer()?.issueKey).toBe("XYZ-2");
    expect(getTimer()?.segments).toHaveLength(1);
  });
});

describe("a second away stretch", () => {
  it("folds into the open question on the same timer", () => {
    act(() => raiseIdlePrompt({ from: T0 + 56 * MIN, to: T0 + 59 * MIN }));

    expect(screen.getByRole("dialog").textContent).toContain("12:10–12:59");
  });
});
