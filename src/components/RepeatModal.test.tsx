/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

const addTemplate = vi.hoisted(() => vi.fn());
vi.mock("../templates", () => ({ addTemplate }));

import { apiMock, resetApiMock } from "../test-support/api";
import RepeatModal from "./RepeatModal";

function renderModal(props: Partial<Parameters<typeof RepeatModal>[0]> = {}) {
  const handlers = { onClose: vi.fn(), onSaved: vi.fn() };
  render(
    <RepeatModal
      issueKey="ABC-1"
      issueSummary="Replace the pump"
      initial={{ duration: "1h" }}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

beforeEach(() => {
  resetApiMock();
  addTemplate.mockClear();
});

describe("what the modal shows", () => {
  it("names the issue it will log against", () => {
    renderModal();

    expect(screen.getByText("Log again — ABC-1")).toBeDefined();
    expect(screen.getByText("Replace the pump")).toBeDefined();
  });

  it("takes a caller's own heading", () => {
    // The month matrix logs a *first* booking through this form, where
    // "Log again" would be a lie.
    renderModal({ title: "Log work — 16 March" });

    expect(screen.getByText("Log work — 16 March")).toBeDefined();
    expect(screen.queryByText("Log again — ABC-1")).toBeNull();
  });

  it("prefills the duration it was given", () => {
    renderModal({ initial: { duration: "2h 30m", comment: "swapped a seal" } });

    expect(screen.getByLabelText(/Time spent/)).toHaveProperty(
      "value",
      "2h 30m",
    );
    expect(screen.getByLabelText(/Comment/)).toHaveProperty(
      "value",
      "swapped a seal",
    );
  });
});

describe("logging", () => {
  it("sends the draft and tells the caller", async () => {
    const { onSaved } = renderModal({ initial: { duration: "1h 30m" } });

    await userEvent.click(screen.getByRole("button", { name: "Log work" }));

    expect(apiMock.logWork).toHaveBeenCalledWith(
      "ABC-1",
      expect.objectContaining({ timeSpentSeconds: 5400, billable: true }),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("refuses a duration it cannot read, without calling the backend", async () => {
    renderModal({ initial: { duration: "soon" } });

    await userEvent.click(screen.getByRole("button", { name: "Log work" }));

    expect(apiMock.logWork).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter a valid duration/)).toBeDefined();
  });

  it("keeps the form open and says why when Jira refuses", async () => {
    // The user's text is still in the box; closing would throw it away.
    apiMock.logWork.mockRejectedValue(new Error("Jira returned 400"));
    const { onSaved } = renderModal();

    await userEvent.click(screen.getByRole("button", { name: "Log work" }));

    expect(await screen.findByText(/Jira returned 400/)).toBeDefined();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Log work" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});

describe("saving as a template", () => {
  it("is not offered unless the caller asks", () => {
    renderModal();

    expect(screen.queryByText(/Save as template/)).toBeNull();
  });

  it("saves one alongside the worklog when ticked", async () => {
    renderModal({
      allowSaveTemplate: true,
      initial: { duration: "1h", comment: "weekly check", nonBillable: true },
    });

    await userEvent.click(screen.getByLabelText(/Save as template/));
    await userEvent.click(screen.getByRole("button", { name: "Log work" }));

    expect(addTemplate).toHaveBeenCalledWith({
      issueKey: "ABC-1",
      issueSummary: "Replace the pump",
      duration: "1h",
      comment: "weekly check",
      nonBillable: true,
    });
  });

  it("saves no template when the box is left alone", async () => {
    renderModal({ allowSaveTemplate: true });

    await userEvent.click(screen.getByRole("button", { name: "Log work" }));

    expect(apiMock.logWork).toHaveBeenCalled();
    expect(addTemplate).not.toHaveBeenCalled();
  });
});

describe("closing", () => {
  it("closes on Cancel", async () => {
    const { onClose } = renderModal();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a click outside, but not on one inside", async () => {
    const { onClose } = renderModal();

    await userEvent.click(screen.getByText("Replace the pump"));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(document.querySelector(".modal-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
