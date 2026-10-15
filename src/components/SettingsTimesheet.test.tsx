/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { today } from "../time";
import {
  addAbsences,
  getAbsences,
  getHolidayState,
  getWeekdayHours,
  removeAbsence,
  setHolidayState,
  setWeekdayHours,
} from "../workdays";
import SettingsTimesheet from "./SettingsTimesheet";

const settings = vi.hoisted(() => ({
  weekends: false,
  setShowWeekends: vi.fn(),
  idle: 10,
  setIdleMinutes: vi.fn(),
}));
vi.mock("../settings", () => ({
  useShowWeekends: () => settings.weekends,
  setShowWeekends: settings.setShowWeekends,
  getIdleMinutes: () => settings.idle,
  setIdleMinutes: settings.setIdleMinutes,
  MAX_IDLE_MINUTES: 240,
}));

const dayField = (day: string) =>
  screen.getByRole("spinbutton", { name: `${day} hours` }) as HTMLInputElement;
const idleField = () =>
  screen.getByRole("spinbutton", { name: "Idle minutes" }) as HTMLInputElement;
const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  // The calendar stores are the real ones, and outlive a test.
  setWeekdayHours([8, 8, 8, 8, 8, 0, 0]);
  setHolidayState(null);
  for (const a of getAbsences()) removeAbsence(a.date);
  settings.weekends = false;
  settings.idle = 10;
});

describe("hours per weekday", () => {
  it("starts from what is stored, Monday first", () => {
    setWeekdayHours([8, 8, 8, 8, 6, 0, 0]);
    render(<SettingsTimesheet />);

    expect(dayField("Fri").value).toBe("6");
    expect(dayField("Sat").value).toBe("0");
  });

  it("stores one day's hours as they are typed", async () => {
    render(<SettingsTimesheet />);

    await userEvent.clear(dayField("Fri"));
    await userEvent.type(dayField("Fri"), "4");

    expect(getWeekdayHours()).toEqual([8, 8, 8, 8, 4, 0, 0]);
  });

  it("keeps half-typed text in the box rather than rewriting it", async () => {
    render(<SettingsTimesheet />);

    await userEvent.clear(dayField("Mon"));

    expect(dayField("Mon").value).toBe("");
    expect(getWeekdayHours()[0]).toBe(8);
  });

  it("snaps back to the stored value when the field is left", async () => {
    render(<SettingsTimesheet />);
    await userEvent.clear(dayField("Mon"));

    await userEvent.tab();

    expect(dayField("Mon").value).toBe("8");
  });

  it("stays inside a day", () => {
    render(<SettingsTimesheet />);

    expect(dayField("Mon").min).toBe("0");
    expect(dayField("Mon").max).toBe("24");
  });
});

describe("public holidays", () => {
  it("offers every state, and none", () => {
    render(<SettingsTimesheet />);

    const select = screen.getByRole("combobox", {
      name: "Public holidays",
    }) as HTMLSelectElement;
    expect(select.options).toHaveLength(17);
    expect(select.value).toBe("");
  });

  it("stores the state picked", async () => {
    render(<SettingsTimesheet />);

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Public holidays" }),
      "NW",
    );

    expect(getHolidayState()).toBe("NW");
  });
});

describe("days off", () => {
  it("marks one day", async () => {
    render(<SettingsTimesheet />);

    await userEvent.clear(screen.getByLabelText("Day off from"));
    await userEvent.type(screen.getByLabelText("Day off from"), "2026-12-24");
    await userEvent.selectOptions(
      screen.getByLabelText("How much of the day"),
      "0.5",
    );
    await userEvent.click(button("Add"));

    expect(getAbsences()).toEqual([
      { date: "2026-12-24", portion: 0.5, kind: "vacation" },
    ]);
    expect(
      screen.getByRole("list", { name: "Days off" }).textContent,
    ).toContain("half day");
  });

  it("marks a stretch, skipping the weekend", async () => {
    render(<SettingsTimesheet />);

    await userEvent.clear(screen.getByLabelText("Day off from"));
    await userEvent.type(screen.getByLabelText("Day off from"), "2026-11-06");
    await userEvent.type(screen.getByLabelText("Day off until"), "2026-11-10");
    await userEvent.click(button("Add"));

    // Fri 6th, then Mon 9th and Tue 10th.
    expect(getAbsences().map((a) => a.date)).toEqual([
      "2026-11-06",
      "2026-11-09",
      "2026-11-10",
    ]);
  });

  it("removes one again", async () => {
    addAbsences([{ date: today(), portion: 1, kind: "sick" }]);
    render(<SettingsTimesheet />);

    await userEvent.click(
      screen.getByRole("button", { name: `Remove ${today()}` }),
    );

    expect(getAbsences()).toEqual([]);
  });
});

describe("which days the timesheet shows", () => {
  it("marks the working week when weekends are off", () => {
    render(<SettingsTimesheet />);

    expect(button("Mon–Fri").className).toContain("active");
    expect(button("Full week").className).not.toContain("active");
  });

  it("marks the full week when they are on", () => {
    settings.weekends = true;
    render(<SettingsTimesheet />);

    expect(button("Full week").className).toContain("active");
    expect(button("Mon–Fri").className).not.toContain("active");
  });

  it("turns weekends on", async () => {
    render(<SettingsTimesheet />);

    await userEvent.click(button("Full week"));

    expect(settings.setShowWeekends).toHaveBeenCalledWith(true);
  });

  it("turns them off again", async () => {
    settings.weekends = true;
    render(<SettingsTimesheet />);

    await userEvent.click(button("Mon–Fri"));

    expect(settings.setShowWeekends).toHaveBeenCalledWith(false);
  });
});

describe("idle time", () => {
  it("starts from what is stored", () => {
    settings.idle = 25;
    render(<SettingsTimesheet />);

    expect(idleField().value).toBe("25");
  });

  it("stores whole minutes as they are typed, zero included", async () => {
    render(<SettingsTimesheet />);

    await userEvent.clear(idleField());
    await userEvent.type(idleField(), "0");

    expect(settings.setIdleMinutes).toHaveBeenLastCalledWith(0);
  });

  it("snaps back to the stored value when the field is left", async () => {
    render(<SettingsTimesheet />);

    await userEvent.clear(idleField());
    await userEvent.type(idleField(), "9999");
    await userEvent.tab();

    expect(idleField().value).toBe("10");
  });
});
