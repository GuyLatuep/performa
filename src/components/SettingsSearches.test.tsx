/** @vitest-environment happy-dom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import "../test-support/dom";

import {
  addSavedSearch,
  clearSavedSearches,
  getSavedSearches,
} from "../savedSearches";
import SettingsSearches from "./SettingsSearches";

const PLANT_JQL = 'project in (CTS, DEV) AND "Plant-No." ~ %SEARCHTERM%';

function renderTab() {
  render(<SettingsSearches />);
}

/** The table itself, so a header can be told from the same words in the hint
 *  below it. */
function grid() {
  return document.querySelector(".search-grid") as HTMLElement;
}

/** Type into a box without user-event reading `%` or `{` as key syntax. */
function typeInto(box: HTMLElement, text: string) {
  fireEvent.change(box, { target: { value: text } });
}

beforeEach(() => {
  localStorage.clear();
  clearSavedSearches();
});

describe("with nothing written yet", () => {
  it("says what a search here is for", () => {
    renderTab();

    expect(screen.getByText(/becomes .Search by/)).toBeDefined();
  });

  it("names its columns once rather than per search", () => {
    renderTab();

    for (const column of ["Name", "JQL"]) {
      expect(within(grid()).getByText(column)).toBeDefined();
    }
  });

  it("explains where the typed term goes", () => {
    renderTab();

    expect(
      screen.getByText(/where the text you type goes/).textContent,
    ).toContain("%SEARCHTERM%");
  });

  it("will not add one without a name and JQL", () => {
    renderTab();

    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("writing one", () => {
  /** Fill in the form, leaving the Add press to the caller. */
  async function fillIn(name = "Plant number", jql = PLANT_JQL) {
    renderTab();
    await userEvent.type(screen.getByLabelText("Name"), name);
    typeInto(screen.getByLabelText("JQL to run"), jql);
  }

  it("saves the name and the JQL", async () => {
    await fillIn();

    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(getSavedSearches()).toHaveLength(1);
    expect(getSavedSearches()[0]).toMatchObject({
      name: "Plant number",
      jql: PLANT_JQL,
    });
  });

  it("will not add JQL with nowhere to put the term, and says so", async () => {
    // It would find the same issues whatever was typed.
    await fillIn("Plant number", "project = DEV");

    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.getByLabelText("JQL to run").getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("adds on Enter in the JQL box", async () => {
    await fillIn();

    await userEvent.type(screen.getByLabelText("JQL to run"), "{Enter}");

    expect(getSavedSearches()).toHaveLength(1);
  });

  it("empties the form afterwards, ready for the next one", async () => {
    await fillIn();

    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByLabelText("Name")).toHaveProperty("value", "");
    expect(screen.getByLabelText("JQL to run")).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("one already written", () => {
  beforeEach(() => {
    addSavedSearch({ name: "Plant number", jql: PLANT_JQL });
  });

  const jqlBox = () =>
    screen.getByLabelText("JQL the Plant number search runs");

  it("is listed under its name, with its JQL", () => {
    renderTab();

    expect(
      screen.getByLabelText("Name of the Plant number search"),
    ).toHaveProperty("value", "Plant number");
    expect(jqlBox()).toHaveProperty("value", PLANT_JQL);
  });

  it("is renamed once the name box is left", async () => {
    renderTab();

    await userEvent.type(
      screen.getByLabelText("Name of the Plant number search"),
      "s",
    );
    await userEvent.tab();

    expect(getSavedSearches()[0].name).toBe("Plant numbers");
  });

  it("is renamed on Enter too, without having to click away", async () => {
    renderTab();

    await userEvent.type(
      screen.getByLabelText("Name of the Plant number search"),
      "s{Enter}",
    );

    expect(getSavedSearches()[0].name).toBe("Plant numbers");
  });

  it("is not rewritten on every keystroke", async () => {
    // Held in the row until the box is left: writing through as it is typed
    // means the stored value is briefly empty, which is the state that loses
    // the search.
    renderTab();

    await userEvent.type(
      screen.getByLabelText("Name of the Plant number search"),
      "s",
    );
    typeInto(jqlBox(), "summary ~ %SEARCHTERM%");

    expect(getSavedSearches()[0]).toMatchObject({
      name: "Plant number",
      jql: PLANT_JQL,
    });
  });

  it("changes its JQL once the box is left", () => {
    renderTab();

    typeInto(jqlBox(), "summary ~ %SEARCHTERM%");
    fireEvent.blur(jqlBox());

    expect(getSavedSearches()[0].jql).toBe("summary ~ %SEARCHTERM%");
  });

  it("survives its name being cleared to retype it", async () => {
    renderTab();
    const box = screen.getByLabelText("Name of the Plant number search");

    await userEvent.clear(box);
    await userEvent.tab();

    expect(getSavedSearches()).toHaveLength(1);
    expect(getSavedSearches()[0].name).toBe("Plant number");
    expect(box).toHaveProperty("value", "Plant number");
  });

  it("puts its JQL back when an empty one is refused", () => {
    renderTab();

    typeInto(jqlBox(), "");
    fireEvent.blur(jqlBox());

    expect(getSavedSearches()[0].jql).toBe(PLANT_JQL);
    expect(jqlBox()).toHaveProperty("value", PLANT_JQL);
  });

  it("marks JQL that has lost its placeholder", () => {
    renderTab();

    typeInto(jqlBox(), "project = DEV");

    expect(jqlBox().getAttribute("aria-invalid")).toBe("true");
  });

  it("can be removed", async () => {
    renderTab();

    await userEvent.click(screen.getByTitle("Remove the Plant number search"));

    expect(getSavedSearches()).toEqual([]);
  });
});
