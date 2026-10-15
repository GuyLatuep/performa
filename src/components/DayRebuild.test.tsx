/** @vitest-environment happy-dom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

import type { DayEvidence, WorklogEntry } from "../api";
import { apiMock, resetApiMock, worklogEntry } from "../test-support/api";
import { forgetDayActivity } from "../rebuild";
import DayRebuild from "./DayRebuild";

const DAY = "2026-03-10";

/** What Jira answers for a day: the evidence, all of it unless said. */
const day = (evidence: DayEvidence[], complete = true) => ({
  evidence,
  complete,
});

const evidence = (o: Partial<DayEvidence> = {}): DayEvidence => ({
  kind: "comment",
  issueKey: "ABC-1",
  issueSummary: "Replace the pump",
  at: new Date(2026, 2, 10, 14, 0).toISOString(),
  detail: "swapped the seal",
  ...o,
});

function renderDay(worklogs: WorklogEntry[] = []) {
  const onLogged = vi.fn();
  const onClose = vi.fn();
  render(
    <DayRebuild
      date={DAY}
      worklogs={worklogs}
      onClose={onClose}
      onLogged={onLogged}
    />,
  );
  return { onLogged, onClose };
}

beforeEach(() => {
  resetApiMock();
  forgetDayActivity();
});

describe("rebuilding a day", () => {
  it("shows what was done next to what was booked", async () => {
    apiMock.dayActivity.mockResolvedValue(
      day([
        evidence(),
        evidence({ kind: "status", issueKey: "XYZ-9", detail: "Open → Done" }),
      ]),
    );

    renderDay([worklogEntry({ date: DAY, issueKey: "XYZ-9", time: "16:00" })]);

    expect(await screen.findByText(/swapped the seal/)).toBeDefined();
    const rows = [...document.querySelectorAll(".rebuild-row")].map(
      (r) => r.textContent,
    );
    expect(rows).toHaveLength(3);
    // The comment on ABC-1 has no time; the move on XYZ-9 does.
    expect(rows[0]).toContain("Log…");
    expect(rows[1]).toContain("booked");
    expect(
      screen.getByText(/1 thing you did with no time booked/),
    ).toBeDefined();
  });

  it("logs a gap through the ordinary form, at that moment", async () => {
    apiMock.dayActivity.mockResolvedValue(day([evidence()]));
    apiMock.logWork.mockResolvedValue(undefined);
    const { onLogged } = renderDay();

    await userEvent.click(await screen.findByRole("button", { name: "Log…" }));

    expect(screen.getByText("Log time — ABC-1")).toBeDefined();
    expect(screen.getByLabelText("Date")).toHaveProperty("value", DAY);
    expect(screen.getByLabelText("Start time")).toHaveProperty(
      "value",
      "14:00",
    );
    await userEvent.type(screen.getByLabelText(/Time spent/), "30m");
    await userEvent.click(screen.getByRole("button", { name: /Log work/ }));

    await waitFor(() =>
      expect(apiMock.logWork).toHaveBeenCalledWith(
        "ABC-1",
        expect.objectContaining({ date: DAY, time: "14:00" }),
      ),
    );
    expect(onLogged).toHaveBeenCalled();
  });

  it("does not call the day whole when Jira had more than was read", async () => {
    apiMock.dayActivity.mockResolvedValue(day([], false));
    renderDay();

    expect(
      await screen.findByText(/some of what you did may be missing/),
    ).toBeDefined();
    expect(screen.queryByText(/everything you did has time on it/)).toBeNull();
  });

  it("says so when Jira has nothing for the day", async () => {
    renderDay();
    expect(
      await screen.findByText("Nothing found for this day."),
    ).toBeDefined();
  });

  it("reports a failed read", async () => {
    apiMock.dayActivity.mockRejectedValue(new Error("Jira returned 503"));
    renderDay();
    expect(await screen.findByText(/Jira returned 503/)).toBeDefined();
  });

  it("books nothing on its own", async () => {
    apiMock.dayActivity.mockResolvedValue(day([evidence()]));
    const { onClose } = renderDay();

    await screen.findByText(/swapped the seal/);
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(apiMock.logWork).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
