/** @vitest-environment happy-dom */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { apiMock, resetApiMock } from "../test-support/api";
import { DURATION_ERROR } from "./WorklogFields";
import LogPanel from "./LogPanel";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

function renderPanel() {
  const onLogged = vi.fn();
  render(<LogPanel issueKey="ABC-1" onLogged={onLogged} />);
  return onLogged;
}

const duration = () => screen.getByPlaceholderText(/1h 30m/i);
const logButton = () => screen.getByRole("button", { name: "Log work" });

beforeEach(() => {
  resetApiMock();
  vi.clearAllMocks();
});

describe("filing the work", () => {
  it("sends the duration in seconds against the open issue", async () => {
    const onLogged = renderPanel();

    await userEvent.type(duration(), "1h 30m");
    await userEvent.click(logButton());

    await waitFor(() =>
      expect(apiMock.logWork).toHaveBeenCalledWith(
        "ABC-1",
        expect.objectContaining({ timeSpentSeconds: 5400 }),
      ),
    );
    expect(onLogged).toHaveBeenCalledTimes(1);
  });

  it("clears the form so the panel is ready for the next one", async () => {
    renderPanel();
    await userEvent.type(duration(), "30m");

    await userEvent.click(logButton());

    await waitFor(() => expect(duration()).toHaveProperty("value", ""));
  });

  it("says nothing on success — the timeline says it instead", async () => {
    // A success message the user has to dismiss, next to the worklog that
    // just appeared, is one confirmation too many.
    renderPanel();
    await userEvent.type(duration(), "30m");

    await userEvent.click(logButton());

    await waitFor(() => expect(apiMock.logWork).toHaveBeenCalled());
    expect(screen.queryByText(/logged|saved|success/i)).toBeNull();
  });
});

describe("a duration that makes no sense", () => {
  it("refuses to file it and says why", async () => {
    const onLogged = renderPanel();

    await userEvent.type(duration(), "banana");
    await userEvent.click(logButton());

    expect(screen.getByText(DURATION_ERROR)).toBeDefined();
    expect(apiMock.logWork).not.toHaveBeenCalled();
    expect(onLogged).not.toHaveBeenCalled();
  });

  it("refuses an empty one too", async () => {
    renderPanel();

    await userEvent.click(logButton());

    expect(screen.getByText(DURATION_ERROR)).toBeDefined();
    expect(apiMock.logWork).not.toHaveBeenCalled();
  });

  it("files it once it is fixed", async () => {
    renderPanel();
    await userEvent.type(duration(), "banana");
    await userEvent.click(logButton());
    await userEvent.clear(duration());

    await userEvent.type(duration(), "45m");
    await userEvent.click(logButton());

    await waitFor(() => expect(apiMock.logWork).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(DURATION_ERROR)).toBeNull();
  });
});

describe("while it is filing", () => {
  it("says so and refuses a second click", async () => {
    let finish!: () => void;
    apiMock.logWork.mockImplementation(
      () => new Promise<void>((r) => (finish = () => r())),
    );
    renderPanel();
    await userEvent.type(duration(), "30m");

    await userEvent.click(logButton());

    const button = screen.getByRole("button", { name: "Logging…" });
    expect(button).toHaveProperty("disabled", true);
    await userEvent.click(button);
    expect(apiMock.logWork).toHaveBeenCalledTimes(1);

    await act(async () => finish());
  });
});

describe("when Jira refuses the worklog", () => {
  it("shows why and keeps what was typed", async () => {
    apiMock.logWork.mockRejectedValue(new Error("issue is closed"));
    const onLogged = renderPanel();
    await userEvent.type(duration(), "30m");

    await userEvent.click(logButton());

    expect(await screen.findByText(/Error: issue is closed/)).toBeDefined();
    expect(onLogged).not.toHaveBeenCalled();
    // Retyping a lost duration after a failure is the worst moment for it.
    expect(duration()).toHaveProperty("value", "30m");
    expect(logButton()).toHaveProperty("disabled", false);
  });
});
