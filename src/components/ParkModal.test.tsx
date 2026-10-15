/** @vitest-environment happy-dom */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

import { apiMock, issueSummary, resetApiMock } from "../test-support/api";
import {
  addDraft,
  closeParkRequest,
  discardDraft,
  getDrafts,
  requestPark,
} from "../drafts";
import ParkModalHost from "./ParkModal";

function renderHost() {
  render(<ParkModalHost site="https://example.atlassian.net" />);
}

beforeEach(() => {
  resetApiMock();
  for (const d of getDrafts()) discardDraft(d.id);
  act(() => closeParkRequest());
});

describe("the park form", () => {
  it("stays out of the way until asked for", () => {
    renderHost();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("parks time with a note and closes", async () => {
    renderHost();
    act(() => requestPark());

    await userEvent.type(screen.getByLabelText(/Time spent/), "45m");
    await userEvent.type(
      screen.getByLabelText(/what was it/),
      "Walk-in: printer jam",
    );
    await userEvent.click(screen.getByRole("button", { name: "Park it" }));

    expect(getDrafts()).toEqual([
      expect.objectContaining({
        seconds: 45 * 60,
        note: "Walk-in: printer jam",
        issueKey: null,
      }),
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("starts from the note it was asked with", () => {
    renderHost();
    act(() => requestPark({ note: "order 4711" }));

    expect(screen.getByLabelText(/what was it/)).toHaveProperty(
      "value",
      "order 4711",
    );
  });

  it("says why it will not park time with nothing to go by", async () => {
    renderHost();
    act(() => requestPark());

    await userEvent.type(screen.getByLabelText(/Time spent/), "30m");
    await userEvent.click(screen.getByRole("button", { name: "Park it" }));

    expect(screen.getByText(/Say what it was/)).toBeDefined();
    expect(getDrafts()).toEqual([]);
  });

  it("takes an issue instead of a note", async () => {
    apiMock.searchIssues.mockResolvedValue([
      issueSummary({ key: "OPS-7", summary: "Order 4711" }),
    ]);
    renderHost();
    act(() => requestPark());

    await userEvent.click(
      screen.getByRole("button", { name: /Pick the issue/ }),
    );
    await userEvent.click(await screen.findByTitle("Order 4711"));
    await userEvent.type(screen.getByLabelText(/Time spent/), "1h");
    await userEvent.click(screen.getByRole("button", { name: "Park it" }));

    expect(getDrafts()).toEqual([
      expect.objectContaining({
        issueKey: "OPS-7",
        issueSummary: "Order 4711",
      }),
    ]);
  });

  it("edits an existing draft rather than adding one", async () => {
    const draft = addDraft({
      seconds: 3600,
      date: "2026-10-12",
      time: "09:00",
      note: "first try",
      issueKey: null,
      issueSummary: "",
      billable: true,
    })!;
    renderHost();
    act(() => requestPark(draft));

    const note = screen.getByLabelText(/what was it/);
    await userEvent.clear(note);
    await userEvent.type(note, "Server room");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(getDrafts()).toEqual([
      expect.objectContaining({
        id: draft.id,
        note: "Server room",
        seconds: 3600,
      }),
    ]);
  });

  it("leaves everything as it was on Cancel", async () => {
    renderHost();
    act(() => requestPark({ note: "never mind" }));

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(getDrafts()).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
