/** @vitest-environment happy-dom */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

import { apiMock, resetApiMock } from "../test-support/api";
import {
  addSavedSearch,
  clearSavedSearches,
  getSavedSearches,
} from "../savedSearches";
import SettingsSearches from "./SettingsSearches";

const FIELDS = ["Plant-No.", "Plant name", "Customer reference"];
const PROJECTS = [
  { key: "PERF", name: "Performa" },
  { key: "DEV", name: "Development" },
];

async function renderTab() {
  render(<SettingsSearches />);
  // The field and project lists arrive through promises, and both pickers stay
  // disabled until they do. Waiting on an option by name would not do: a saved
  // search's own picker offers the same ones.
  // Both pickers are absent or disabled until the lists arrive.
  await screen.findByRole("group", { name: "Leave these projects out" });
}

/** The table itself, so a header can be told from the same words in the hint
 *  below it. */
function grid() {
  return document.querySelector(".search-grid") as HTMLElement;
}

beforeEach(() => {
  resetApiMock();
  localStorage.clear();
  clearSavedSearches();
  apiMock.jiraFieldNames.mockResolvedValue(FIELDS);
  apiMock.jiraProjects.mockResolvedValue(PROJECTS);
});

describe("with nothing written yet", () => {
  it("says what a search here is for", async () => {
    await renderTab();

    expect(screen.getByText(/becomes .Search by/)).toBeDefined();
  });

  it("names its columns once rather than per search", async () => {
    // The whole point of the table: four labels, not four per row.
    await renderTab();

    for (const column of ["Name", "Field", "Exclude projects", "Whole value"]) {
      expect(within(grid()).getByText(column)).toBeDefined();
    }
  });

  it("offers the site's own fields to choose from", async () => {
    // Which fields exist is the site's business, so they are read from it rather
    // than listed in the app.
    await renderTab();

    expect(
      await screen.findByRole("option", { name: "Plant-No." }),
    ).toBeDefined();
    expect(screen.getByRole("option", { name: "Plant name" })).toBeDefined();
  });

  it("offers every project as one to leave out", async () => {
    await renderTab();

    const box = screen.getByRole("group", { name: "Leave these projects out" });

    expect(within(box).getByLabelText(/PERF · Performa/)).toBeDefined();
    expect(within(box).getByLabelText(/DEV · Development/)).toBeDefined();
  });

  it("will not add one without a name and a field", async () => {
    await renderTab();

    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("writing one", () => {
  /** Fill in the form, leaving the Add press to the caller. */
  async function fillIn(name = "Plant number", field = "Plant-No.") {
    await renderTab();
    await userEvent.type(screen.getByLabelText("Name"), name);
    await userEvent.selectOptions(
      screen.getByLabelText("Field to search"),
      field,
    );
  }

  it("saves the name and the field", async () => {
    await fillIn();

    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(getSavedSearches()).toHaveLength(1);
    expect(getSavedSearches()[0]).toMatchObject({
      name: "Plant number",
      field: "Plant-No.",
      exact: false,
      excludedProjects: [],
    });
  });

  it("saves it as a partial match unless asked otherwise", async () => {
    // The forgiving default: DE_1979 should find DE_1979_03.
    await fillIn();

    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(getSavedSearches()[0].exact).toBe(false);
  });

  it("saves an exact match when that is ticked", async () => {
    await fillIn();

    await userEvent.click(screen.getByLabelText("Match the whole value"));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(getSavedSearches()[0].exact).toBe(true);
  });

  it("explains which way round the tick is, once for the table", async () => {
    await renderTab();

    expect(
      screen.getByText(/DE_1979 then also finds DE_1979_03/),
    ).toBeDefined();
  });

  it("saves the projects to leave out", async () => {
    await fillIn();

    const box = screen.getByRole("group", { name: "Leave these projects out" });
    await userEvent.click(within(box).getByLabelText(/DEV · Development/));
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(getSavedSearches()[0].excludedProjects).toEqual(["DEV"]);
  });

  it("empties the form afterwards, ready for the next one", async () => {
    await fillIn();

    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByLabelText("Name")).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("one already written", () => {
  beforeEach(() => {
    addSavedSearch({
      name: "Plant number",
      field: "Plant-No.",
      exact: false,
      excludedProjects: [],
    });
  });

  it("is listed under its name", async () => {
    await renderTab();

    expect(
      screen.getByLabelText("Name of the Plant number search"),
    ).toHaveProperty("value", "Plant number");
  });

  it("is renamed as it is typed, the name being what the palette draws", async () => {
    await renderTab();

    await userEvent.type(
      screen.getByLabelText("Name of the Plant number search"),
      "s",
    );

    expect(getSavedSearches()[0].name).toBe("Plant numbers");
  });

  it("changes which field it looks in", async () => {
    await renderTab();

    await userEvent.selectOptions(
      screen.getByLabelText("Field the Plant number search looks in"),
      "Plant name",
    );

    expect(getSavedSearches()[0].field).toBe("Plant name");
  });

  it("can be removed", async () => {
    await renderTab();

    await userEvent.click(screen.getByTitle("Remove the Plant number search"));

    expect(getSavedSearches()).toEqual([]);
  });

  it("carries the whole project name on the row, the list cutting it short", async () => {
    // The column is narrower than some project names, so the name is what gives
    // way — and the tooltip is where the rest of it goes.
    await renderTab();
    const box = screen.getByRole("group", {
      name: "Projects the Plant number search leaves out",
    });

    expect(within(box).getByTitle("DEV · Development")).toBeDefined();
  });

  it("excludes more than one project at a time", async () => {
    await renderTab();

    // No held modifier required, which a `select multiple` would have needed.
    const box = screen.getByRole("group", {
      name: "Projects the Plant number search leaves out",
    });
    await userEvent.click(within(box).getByLabelText(/PERF · Performa/));
    await userEvent.click(within(box).getByLabelText(/DEV · Development/));

    expect(getSavedSearches()[0].excludedProjects).toEqual(["PERF", "DEV"]);
  });

  it("keeps a field the site no longer has, saying so", async () => {
    // A renamed or removed field would otherwise vanish from its own search
    // silently, leaving a search that looks complete and finds nothing.
    clearSavedSearches();
    addSavedSearch({
      name: "Old",
      field: "Retired field",
      exact: false,
      excludedProjects: [],
    });

    await renderTab();

    expect(
      await screen.findByRole("option", {
        name: /Retired field \(not on this site\)/,
      }),
    ).toBeDefined();
  });
});

describe("when the site cannot be read", () => {
  it("says so rather than offering an empty picker", async () => {
    apiMock.jiraFieldNames.mockRejectedValue(new Error("Jira returned 403"));

    render(<SettingsSearches />);

    expect(await screen.findByText(/Jira returned 403/)).toBeDefined();
  });
});
