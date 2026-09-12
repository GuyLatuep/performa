/** @vitest-environment happy-dom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../pins", () => ({
  usePinnedIssues: () => [],
  togglePin: vi.fn(),
}));

import { apiMock, issueSummary, resetApiMock } from "../test-support/api";
import { clearIssueRequest, useRequestedIssue } from "../issueRequest";
import { SavedSearch } from "../savedSearches";
import { SearchRequest } from "../searchRequest";
import { clearSelection } from "../selection";
import { AllKeys } from "../test-support/shortcuts";
import SearchResults from "./SearchResults";

const PLANT_SEARCH: SavedSearch = {
  id: "s1",
  name: "Plant number",
  field: "Plant-No.",
  exact: false,
  excludedProjects: ["DEV"],
};

const PLANT: SearchRequest = {
  kind: "field",
  term: "DE_1979",
  search: PLANT_SEARCH,
};

/** The view, with the key listeners the app mounts and a marker for what it
 *  asks to open. */
function renderResults(search: SearchRequest = PLANT) {
  function Opened() {
    const issue = useRequestedIssue();
    return <p>{issue ? `opening ${issue.key}` : "nothing opened"}</p>;
  }
  render(
    <>
      <AllKeys />
      <SearchResults search={search} site="https://example.atlassian.net" />
      <Opened />
    </>,
  );
}

beforeEach(() => {
  resetApiMock();
  vi.stubGlobal("navigator", {
    userAgent: "Macintosh; Intel Mac OS X 10_15_7",
  });
});

afterEach(() => {
  clearSelection();
  clearIssueRequest();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("running the search", () => {
  it("hands the backend the whole definition, not just the term", async () => {
    apiMock.searchField.mockResolvedValue([]);

    renderResults();

    await act(async () => {});
    expect(apiMock.searchField).toHaveBeenCalledWith(
      "Plant-No.",
      "DE_1979",
      false,
      ["DEV"],
    );
  });

  it("says it is searching before anything arrives", () => {
    apiMock.searchField.mockReturnValue(new Promise(() => {}));

    renderResults();

    expect(screen.getByText("Searching…")).toBeDefined();
  });

  it("lists what came back, with a count", async () => {
    apiMock.searchField.mockResolvedValue([
      issueSummary({ key: "ABC-1" }),
      issueSummary({ key: "ABC-2" }),
    ]);

    renderResults();

    expect(await screen.findByText("ABC-1")).toBeDefined();
    expect(
      screen.getByText(/Results for Plant number DE_1979 · 2/),
    ).toBeDefined();
  });

  it("names the plant in its empty state, so it is clear what found nothing", async () => {
    apiMock.searchField.mockResolvedValue([]);

    renderResults();

    expect(
      await screen.findByText("Nothing found for Plant number DE_1979."),
    ).toBeDefined();
  });

  it("quotes the term for a text search instead", async () => {
    apiMock.searchField.mockResolvedValue([]);

    apiMock.searchText.mockResolvedValue([]);
    renderResults({ kind: "text", term: "broken pump" });

    expect(await screen.findByText(/“broken pump”/)).toBeDefined();
  });

  it("reports a refusal from Jira rather than an empty list", async () => {
    // The plant field has to be text-searchable for the wildcard to work. If it
    // is not, Jira says so and the reader should see that rather than "nothing
    // found".
    apiMock.searchField.mockRejectedValue(
      new Error("Field 'Plant-No.' does not support the ~ operator"),
    );

    renderResults();

    expect(await screen.findByText(/does not support/)).toBeDefined();
  });
});

describe("the results themselves", () => {
  it("are walked with the arrow keys, being an ordinary issue list", async () => {
    apiMock.searchField.mockResolvedValue([
      issueSummary({ key: "ABC-1" }),
      issueSummary({ key: "ABC-2" }),
    ]);
    renderResults();
    await screen.findByText("ABC-1");

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "ArrowDown" });
    });

    expect(
      document.querySelector('[aria-current="true"]')?.textContent,
    ).toContain("ABC-1");
  });

  it("open the issue on Enter", async () => {
    apiMock.searchField.mockResolvedValue([issueSummary({ key: "ABC-1" })]);
    renderResults();
    await screen.findByText("ABC-1");
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "ArrowDown" });
    });

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Enter" });
    });

    expect(screen.getByText("opening ABC-1")).toBeDefined();
  });

  it("open the issue when one is clicked", async () => {
    apiMock.searchField.mockResolvedValue([
      issueSummary({ key: "ABC-1", summary: "Replace the pump" }),
    ]);
    renderResults();

    await userEvent.click(await screen.findByText("Replace the pump"));

    expect(screen.getByText("opening ABC-1")).toBeDefined();
  });
});
