/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import SettingsTimesheet from "./SettingsTimesheet";

const settings = vi.hoisted(() => ({
  hours: 8,
  weekends: false,
  setDailyHours: vi.fn(),
  setShowWeekends: vi.fn(),
}));
vi.mock("../settings", () => ({
  getDailyHours: () => settings.hours,
  setDailyHours: settings.setDailyHours,
  useShowWeekends: () => settings.weekends,
  setShowWeekends: settings.setShowWeekends,
}));

const hoursField = () => screen.getByRole("spinbutton") as HTMLInputElement;
const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.clearAllMocks();
  settings.hours = 8;
  settings.weekends = false;
});

describe("daily hours", () => {
  it("starts from what is stored", () => {
    settings.hours = 7.5;
    render(<SettingsTimesheet />);

    expect(hoursField().value).toBe("7.5");
  });

  it("stores a number as it is typed", async () => {
    render(<SettingsTimesheet />);

    await userEvent.clear(hoursField());
    await userEvent.type(hoursField(), "6");

    expect(settings.setDailyHours).toHaveBeenLastCalledWith(6);
  });

  it("keeps half-typed text in the box rather than rewriting it", async () => {
    // Clearing the field to retype it must not snap a value back under the
    // cursor; the store simply ignores what it cannot parse.
    render(<SettingsTimesheet />);

    await userEvent.clear(hoursField());

    expect(hoursField().value).toBe("");
    expect(settings.setDailyHours).toHaveBeenLastCalledWith(NaN);
  });

  it("snaps back to the stored value when the field is left", async () => {
    render(<SettingsTimesheet />);
    await userEvent.clear(hoursField());
    expect(hoursField().value).toBe("");

    // The store never took the empty string, so blurring restores what it has.
    await userEvent.tab();

    expect(hoursField().value).toBe("8");
  });

  it("stays inside a sensible working day", () => {
    render(<SettingsTimesheet />);

    expect(hoursField().min).toBe("0.5");
    expect(hoursField().max).toBe("24");
    expect(hoursField().step).toBe("0.5");
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
