/** @vitest-environment happy-dom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

import { apiMock, projectSummary, resetApiMock } from "../test-support/api";
import { getIgnoredStatuses, setIgnoredStatuses } from "../todoStatuses";
import SettingsTodo from "./SettingsTodo";

const PROJECTS = [
  projectSummary({ key: "ABC", name: "Pumps" }),
  projectSummary({ key: "DEV", name: "Escalations" }),
];

/** Mount with projects and statuses already answered, and wait for both. */
async function renderReady(statuses = ["Open", "In Review"]) {
  apiMock.jiraProjects.mockResolvedValue(PROJECTS);
  apiMock.projectStatuses.mockResolvedValue(statuses);
  render(<SettingsTodo />);
  await screen.findByLabelText("Open");
}

beforeEach(() => {
  resetApiMock();
  localStorage.clear();
  // The ignore list is a module-level store; clearing storage alone leaves the
  // previous test's value in memory.
  setIgnoredStatuses({});
});

describe("the project picker", () => {
  it("loads the projects and starts on the first", async () => {
    apiMock.jiraProjects.mockResolvedValue(PROJECTS);
    render(<SettingsTodo />);

    expect(
      await screen.findByRole("option", { name: "ABC · Pumps" }),
    ).toBeDefined();
    expect(screen.getByRole("combobox")).toHaveProperty("value", "ABC");
    await waitFor(() =>
      expect(apiMock.projectStatuses).toHaveBeenCalledWith("ABC"),
    );
  });

  it("says the projects are on their way", () => {
    apiMock.jiraProjects.mockReturnValue(new Promise(() => {}));
    render(<SettingsTodo />);

    expect(screen.getByRole("option", { name: "Loading…" })).toBeDefined();
    expect(screen.getByRole("combobox")).toHaveProperty("disabled", true);
  });

  it("reports a failed project read", async () => {
    apiMock.jiraProjects.mockRejectedValue(new Error("Jira returned 403"));
    render(<SettingsTodo />);

    expect(await screen.findByText(/Jira returned 403/)).toBeDefined();
  });

  it("re-reads the statuses when the project changes", async () => {
    await renderReady();
    apiMock.projectStatuses.mockResolvedValue(["Triage"]);

    await userEvent.selectOptions(screen.getByRole("combobox"), "DEV");

    expect(await screen.findByLabelText("Triage")).toBeDefined();
    expect(apiMock.projectStatuses).toHaveBeenLastCalledWith("DEV");
  });
});

describe("the status list", () => {
  it("offers each of the project's open statuses", async () => {
    await renderReady(["Open", "In Review"]);

    expect(screen.getByLabelText("Open")).toHaveProperty("checked", false);
    expect(screen.getByLabelText("In Review")).toHaveProperty("checked", false);
  });

  it("ticks the ones already hidden", async () => {
    setIgnoredStatuses({ ABC: ["In Review"] });

    await renderReady();

    expect(screen.getByLabelText("In Review")).toHaveProperty("checked", true);
    expect(screen.getByLabelText("Open")).toHaveProperty("checked", false);
  });

  it("hides a status when it is ticked", async () => {
    await renderReady();

    await userEvent.click(screen.getByLabelText("In Review"));

    expect(getIgnoredStatuses()).toEqual({ ABC: ["In Review"] });
  });

  it("unhides it again", async () => {
    setIgnoredStatuses({ ABC: ["In Review"] });
    await renderReady();

    await userEvent.click(screen.getByLabelText("In Review"));

    expect(getIgnoredStatuses().ABC ?? []).toEqual([]);
  });

  it("still lists a hidden status the project no longer offers", async () => {
    // A renamed or retired status would otherwise be stuck hidden with no way
    // to untick it.
    setIgnoredStatuses({ ABC: ["Withdrawn"] });

    await renderReady(["Open", "In Review"]);

    expect(screen.getByLabelText("Withdrawn")).toHaveProperty("checked", true);
  });

  it("says so when the project has no open statuses", async () => {
    apiMock.jiraProjects.mockResolvedValue(PROJECTS);
    apiMock.projectStatuses.mockResolvedValue([]);
    render(<SettingsTodo />);

    expect(
      await screen.findByText("This project has no open statuses."),
    ).toBeDefined();
  });

  it("reports a failed status read", async () => {
    apiMock.jiraProjects.mockResolvedValue(PROJECTS);
    apiMock.projectStatuses.mockRejectedValue(new Error("Jira returned 500"));
    render(<SettingsTodo />);

    expect(await screen.findByText(/Jira returned 500/)).toBeDefined();
  });
});

describe("copying to other projects", () => {
  it("offers the other projects, never the current one", async () => {
    setIgnoredStatuses({ ABC: ["In Review"] });
    await renderReady();

    await userEvent.click(
      screen.getByRole("button", { name: "Copy to other projects…" }),
    );

    expect(screen.getByLabelText("DEV · Escalations")).toBeDefined();
    expect(screen.queryByLabelText("ABC · Pumps")).toBeNull();
  });

  it("copies the current list to the ticked projects", async () => {
    setIgnoredStatuses({ ABC: ["In Review"] });
    await renderReady();
    await userEvent.click(
      screen.getByRole("button", { name: "Copy to other projects…" }),
    );

    await userEvent.click(screen.getByLabelText("DEV · Escalations"));
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(getIgnoredStatuses()).toEqual({
      ABC: ["In Review"],
      DEV: ["In Review"],
    });
    expect(screen.getByText("copied to 1 project")).toBeDefined();
  });

  it("cannot copy to nobody", async () => {
    await renderReady();
    await userEvent.click(
      screen.getByRole("button", { name: "Copy to other projects…" }),
    );

    expect(screen.getByRole("button", { name: "Copy" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("abandons a copy when the project underneath changes", async () => {
    // A copy is about the project that was on screen when it was opened.
    await renderReady();
    await userEvent.click(
      screen.getByRole("button", { name: "Copy to other projects…" }),
    );

    await userEvent.selectOptions(screen.getByRole("combobox"), "DEV");

    expect(
      await screen.findByRole("button", { name: "Copy to other projects…" }),
    ).toBeDefined();
  });

  it("backs out on Cancel", async () => {
    await renderReady();
    await userEvent.click(
      screen.getByRole("button", { name: "Copy to other projects…" }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("DEV · Escalations")).toBeNull();
  });
});
