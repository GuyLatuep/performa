/** @vitest-environment happy-dom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import {
  apiMock,
  issueSummary,
  linkedItem,
  linkRelation,
  resetApiMock,
} from "../test-support/api";
import IssueLinks, { groupByRelation } from "./IssueLinks";

const BLOCKS = linkRelation({
  typeName: "Blocks",
  direction: "outward",
  label: "blocks",
});
const CAUSED_BY = linkRelation({
  typeName: "Causes",
  direction: "inward",
  label: "is caused by",
});

function setup() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

function renderLinks(links = [linkedItem()]) {
  const handlers = { onChanged: vi.fn(), onOpen: vi.fn() };
  render(
    <IssueLinks
      issueKey="ABC-1"
      links={links}
      site="https://example.atlassian.net"
      {...handlers}
    />,
  );
  return handlers;
}

/** Open the link form and wait for its relations to arrive. */
async function openForm(user: ReturnType<typeof setup>) {
  await user.click(screen.getByRole("button", { name: /Link work item/ }));
  await screen.findByRole("option", { name: "blocks" });
}

beforeEach(() => {
  resetApiMock();
  apiMock.linkRelations.mockResolvedValue([BLOCKS, CAUSED_BY]);
  openUrl.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("groupByRelation", () => {
  it("gathers the links under each relationship, in first-seen order", () => {
    const grouped = groupByRelation([
      linkedItem({ id: "1", relation: "blocks", key: "ABC-2" }),
      linkedItem({ id: "2", relation: "is caused by", key: "ABC-3" }),
      linkedItem({ id: "3", relation: "blocks", key: "ABC-4" }),
    ]);

    expect(grouped.map(([relation]) => relation)).toEqual([
      "blocks",
      "is caused by",
    ]);
    expect(grouped[0][1].map((i) => i.key)).toEqual(["ABC-2", "ABC-4"]);
  });

  it("is empty for an issue with no links", () => {
    expect(groupByRelation([])).toEqual([]);
  });
});

describe("the list", () => {
  it("groups the links by what they say", () => {
    // The relationship is the term's substance, not the other issue.
    renderLinks([
      linkedItem({ id: "1", relation: "blocks", key: "ABC-2" }),
      linkedItem({ id: "2", relation: "is caused by", key: "ABC-3" }),
    ]);

    expect(screen.getByText("blocks")).toBeDefined();
    expect(screen.getByText("is caused by")).toBeDefined();
  });

  it("says when there are none", () => {
    renderLinks([]);

    expect(screen.getByText("No linked work items.")).toBeDefined();
  });

  it("opens the linked issue here from its summary", async () => {
    const item = linkedItem({ key: "ABC-2", summary: "Order the seal" });
    const { onOpen } = renderLinks([item]);

    await userEvent.click(screen.getByText("Order the seal"));

    expect(onOpen).toHaveBeenCalledWith(item);
  });

  it("keeps the key as the way out to Jira", async () => {
    // The same split the mention rows use.
    renderLinks([linkedItem({ key: "ABC-2" })]);

    await userEvent.click(screen.getByTitle("Open ABC-2 in browser"));

    expect(openUrl).toHaveBeenCalledWith(
      "https://example.atlassian.net/browse/ABC-2",
    );
  });

  it("shows the linked issue's status when it has one", () => {
    renderLinks([linkedItem({ key: "ABC-2", status: "In Progress" })]);

    expect(screen.getByText("In Progress")).toBeDefined();
  });
});

describe("unlinking", () => {
  it("removes the link and tells the caller to reload", async () => {
    const { onChanged } = renderLinks([linkedItem({ id: "l1", key: "ABC-2" })]);

    await userEvent.click(screen.getByTitle("Unlink ABC-2 from ABC-1"));

    await waitFor(() =>
      expect(apiMock.deleteIssueLink).toHaveBeenCalledWith("l1"),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("reports a refused unlink and leaves the row alone", async () => {
    apiMock.deleteIssueLink.mockRejectedValue(new Error("Jira returned 403"));
    const { onChanged } = renderLinks([linkedItem({ id: "l1", key: "ABC-2" })]);

    await userEvent.click(screen.getByTitle("Unlink ABC-2 from ABC-1"));

    expect(await screen.findByText(/Jira returned 403/)).toBeDefined();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("the link form", () => {
  it("offers the site's relationships once they arrive", async () => {
    const user = setup();
    renderLinks();

    await openForm(user);

    expect(screen.getByRole("option", { name: "blocks" })).toBeDefined();
    expect(screen.getByRole("option", { name: "is caused by" })).toBeDefined();
  });

  it("reports a failed relations read", async () => {
    apiMock.linkRelations.mockRejectedValue(new Error("Jira returned 500"));
    const user = setup();
    renderLinks();

    await user.click(screen.getByRole("button", { name: /Link work item/ }));

    expect(await screen.findByText(/Jira returned 500/)).toBeDefined();
  });

  it("cannot be submitted before an issue is chosen", async () => {
    const user = setup();
    renderLinks();

    await openForm(user);

    expect(screen.getByRole("button", { name: "Link" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("backs out on Cancel", async () => {
    const user = setup();
    renderLinks();
    await openForm(user);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("button", { name: /Link work item/ }),
    ).toBeDefined();
  });

  it("links the chosen issue with the chosen relationship", async () => {
    apiMock.searchIssues.mockResolvedValue([issueSummary({ key: "ABC-2" })]);
    const user = setup();
    const { onChanged } = renderLinks();
    await openForm(user);

    await user.selectOptions(screen.getByLabelText("This issue"), "1");
    await user.type(screen.getByRole("textbox"), "seal");
    await vi.advanceTimersByTimeAsync(250);
    await user.click(await screen.findByRole("option", { name: /ABC-2/ }));
    await user.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() =>
      expect(apiMock.linkIssues).toHaveBeenCalledWith(
        "ABC-1",
        "ABC-2",
        "Causes",
        "inward",
      ),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("reports a refused link", async () => {
    apiMock.searchIssues.mockResolvedValue([issueSummary({ key: "ABC-2" })]);
    apiMock.linkIssues.mockRejectedValue(new Error("Jira returned 400"));
    const user = setup();
    renderLinks();
    await openForm(user);

    await user.type(screen.getByRole("textbox"), "seal");
    await vi.advanceTimersByTimeAsync(250);
    await user.click(await screen.findByRole("option", { name: /ABC-2/ }));
    await user.click(screen.getByRole("button", { name: "Link" }));

    expect(await screen.findByText(/Jira returned 400/)).toBeDefined();
  });
});

describe("the issue picker inside the form", () => {
  it("waits for the typing to stop before searching", async () => {
    const user = setup();
    renderLinks();
    await openForm(user);

    await user.type(screen.getByRole("textbox"), "seal");
    expect(apiMock.searchIssues).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(apiMock.searchIssues).toHaveBeenCalledWith("seal");
  });

  it("never offers the issue being linked from", async () => {
    // A link from an issue to itself is not a relationship.
    apiMock.searchIssues.mockResolvedValue([
      issueSummary({ key: "ABC-1" }),
      issueSummary({ key: "ABC-2" }),
    ]);
    const user = setup();
    renderLinks();
    await openForm(user);

    await user.type(screen.getByRole("textbox"), "a");
    await vi.advanceTimersByTimeAsync(250);

    expect(await screen.findByRole("option", { name: /ABC-2/ })).toBeDefined();
    expect(screen.queryByRole("option", { name: /ABC-1/ })).toBeNull();
  });

  it("picks with the keyboard", async () => {
    apiMock.searchIssues.mockResolvedValue([
      issueSummary({ key: "ABC-2" }),
      issueSummary({ key: "ABC-3" }),
    ]);
    const user = setup();
    renderLinks();
    await openForm(user);
    await user.type(screen.getByRole("textbox"), "a");
    await vi.advanceTimersByTimeAsync(250);
    await screen.findByRole("option", { name: /ABC-2/ });

    await user.keyboard("{ArrowDown}{Enter}");

    expect(await screen.findByText("ABC-3")).toBeDefined();
  });

  it("lets the choice be changed again", async () => {
    apiMock.searchIssues.mockResolvedValue([issueSummary({ key: "ABC-2" })]);
    const user = setup();
    renderLinks();
    await openForm(user);
    await user.type(screen.getByRole("textbox"), "a");
    await vi.advanceTimersByTimeAsync(250);
    await user.click(await screen.findByRole("option", { name: /ABC-2/ }));

    await user.click(screen.getByRole("button", { name: "change" }));

    expect(screen.getByRole("textbox")).toBeDefined();
  });
});
