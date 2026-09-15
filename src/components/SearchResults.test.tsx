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
import { getRequestedSearch, SearchRequest } from "../searchRequest";
import { clearSelection } from "../selection";
import { backTarget, clearForward, goBack, goForward } from "../back";
import { AllKeys } from "../test-support/shortcuts";
import { setShowIssueTypeIcons } from "../settings";
import SearchResults from "./SearchResults";

/** What the backend answers with: the rows, plus whether there were more. */
function page(issues: ReturnType<typeof issueSummary>[], hasMore = false) {
  return { issues, hasMore };
}

const PLANT_SEARCH: SavedSearch = {
  id: "s1",
  name: "Plant number",
  jql: 'project != DEV AND "Plant-No." ~ %SEARCHTERM%',
};

const PLANT: SearchRequest = {
  kind: "saved",
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
      <SearchResults
        search={search}
        site="https://example.atlassian.net"
        backLabel="Todo"
      />
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
  clearForward();
  clearIssueRequest();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("running the search", () => {
  it("hands the backend the whole definition, not just the term", async () => {
    apiMock.searchJql.mockResolvedValue(page([]));

    renderResults();

    await act(async () => {});
    expect(apiMock.searchJql).toHaveBeenCalledWith(
      'project != DEV AND "Plant-No." ~ %SEARCHTERM%',
      "DE_1979",
    );
  });

  it("says it is searching before anything arrives", () => {
    apiMock.searchJql.mockReturnValue(new Promise(() => {}));

    renderResults();

    expect(screen.getByText("Searching…")).toBeDefined();
  });

  it("lists what came back, with a count", async () => {
    apiMock.searchJql.mockResolvedValue(
      page([issueSummary({ key: "ABC-1" }), issueSummary({ key: "ABC-2" })]),
    );

    renderResults();

    expect(await screen.findByText("ABC-1")).toBeDefined();
    expect(
      screen.getByText(/Results for Plant number DE_1979 · 2/),
    ).toBeDefined();
  });

  it("names the plant in its empty state, so it is clear what found nothing", async () => {
    apiMock.searchJql.mockResolvedValue(page([]));

    renderResults();

    expect(
      await screen.findByText("Nothing found for Plant number DE_1979."),
    ).toBeDefined();
  });

  it("quotes the term for a text search instead", async () => {
    apiMock.searchJql.mockResolvedValue(page([]));

    apiMock.searchText.mockResolvedValue(page([]));
    renderResults({ kind: "text", term: "broken pump" });

    expect(await screen.findByText(/“broken pump”/)).toBeDefined();
  });

  it("says so when Jira had more than it showed", async () => {
    // A full page is not proof there is nothing after it, and these searches
    // keep closed issues on purpose — so a plant with years of history reaches
    // the limit as a matter of course.
    apiMock.searchJql.mockResolvedValue(
      page([issueSummary({ key: "ABC-1" })], true),
    );

    renderResults();

    expect(
      await screen.findByText(/narrow the term to see the rest/),
    ).toBeDefined();
  });

  it("says nothing of the sort when that was all of them", async () => {
    apiMock.searchJql.mockResolvedValue(page([issueSummary({ key: "ABC-1" })]));

    renderResults();

    await screen.findByText("ABC-1");
    expect(screen.queryByText(/narrow the term/)).toBeNull();
  });

  it("reports a refusal from Jira rather than an empty list", async () => {
    // The plant field has to be text-searchable for the wildcard to work. If it
    // is not, Jira says so and the reader should see that rather than "nothing
    // found".
    apiMock.searchJql.mockRejectedValue(
      new Error("Field 'Plant-No.' does not support the ~ operator"),
    );

    renderResults();

    expect(await screen.findByText(/does not support/)).toBeDefined();
  });
});

describe("the results themselves", () => {
  it("are walked with the arrow keys, being an ordinary issue list", async () => {
    apiMock.searchJql.mockResolvedValue(
      page([issueSummary({ key: "ABC-1" }), issueSummary({ key: "ABC-2" })]),
    );
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
    apiMock.searchJql.mockResolvedValue(page([issueSummary({ key: "ABC-1" })]));
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
    apiMock.searchJql.mockResolvedValue(
      page([issueSummary({ key: "ABC-1", summary: "Replace the pump" })]),
    );
    renderResults();

    await userEvent.click(await screen.findByText("Replace the pump"));

    expect(screen.getByText("opening ABC-1")).toBeDefined();
  });
});

describe("leaving the results", () => {
  // Every view that replaces the content area registers a way out. Without one,
  // Escape, ⌘[, the mouse's back button and the swipe all did nothing here.

  it("registers one, named for the tab underneath", async () => {
    apiMock.searchJql.mockResolvedValue(page([]));

    renderResults();

    await act(async () => {});
    expect(backTarget()?.label).toBe("Todo");
  });

  it("clears the search, so the tab comes back", async () => {
    apiMock.searchJql.mockResolvedValue(page([]));
    renderResults();
    await act(async () => {});

    await act(async () => {
      goBack();
    });

    expect(getRequestedSearch()).toBeNull();
  });

  it("runs the same search again on the way forward", async () => {
    // Re-entering results means the search as it was — the request carries its
    // own copy of the definition, not whatever the settings have since become.
    apiMock.searchJql.mockResolvedValue(page([]));
    renderResults();
    await act(async () => {});
    await act(async () => {
      goBack();
    });

    await act(async () => {
      goForward();
    });

    expect(getRequestedSearch()).toMatchObject({
      kind: "saved",
      term: "DE_1979",
    });
  });
});

describe("the row grid", () => {
  // The rows draw a type-icon cell whenever the setting is on, and the grid
  // only holds a column for it when the list says so. Getting that wrong left
  // the icon in the key's column and pushed the key onto a second line.
  it("reserves the type-icon column while the icons are shown", async () => {
    setShowIssueTypeIcons(true);
    apiMock.searchJql.mockResolvedValue(page([issueSummary({ key: "ABC-1" })]));

    renderResults();
    await act(async () => {});

    expect(screen.getByLabelText("Search results").className).not.toContain(
      "no-type-icons",
    );
  });

  it("drops the column again when the icons are turned off", async () => {
    setShowIssueTypeIcons(false);
    apiMock.searchJql.mockResolvedValue(page([issueSummary({ key: "ABC-1" })]));

    renderResults();
    await act(async () => {});

    expect(screen.getByLabelText("Search results").className).toContain(
      "no-type-icons",
    );
  });
});
