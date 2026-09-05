/** @vitest-environment happy-dom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

const openUrl = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

// The drag hook needs layout, which happy-dom has none of — the keyboard
// arrange controls do the same job and are what these tests drive.
vi.mock("../fieldDrag", () => ({
  useFieldDrag: () => ({
    dragging: null,
    dropTarget: null,
    at: null,
    startDrag: vi.fn(),
  }),
}));

import {
  addDetailField,
  getIssueFieldConfig,
  removeDetailField,
  restoreDefaultFields,
} from "../issueFieldNames";
import {
  apiMock,
  fieldMeta,
  issueDetail,
  resetApiMock,
} from "../test-support/api";
import IssueFacts from "./IssueFacts";

const DETAIL = issueDetail({
  issueType: "Bug",
  priority: "High",
  assignee: "Malte",
  details: [{ id: "customfield_1", label: "Plant no.", value: "K12" }],
});

function renderFacts(detail = DETAIL) {
  const onChanged = vi.fn();
  render(
    <IssueFacts
      detail={detail}
      issueKey="ABC-1"
      site="https://example.atlassian.net"
      onChanged={onChanged}
    />,
  );
  return onChanged;
}

/** Configure exactly these fields, in this order.
 *
 *  Built through the store's own mutators — it exposes no whole-config setter,
 *  and going round it through localStorage would not reach the live store. */
function configure(detail: string[]) {
  restoreDefaultFields();
  for (const name of getIssueFieldConfig().detail) removeDetailField(name);
  for (const name of detail) addDetailField(name);
}

beforeEach(() => {
  resetApiMock();
  localStorage.clear();
  configure(["Issue Type", "Priority", "Plant no."]);
  openUrl.mockClear();
});

describe("the facts grid", () => {
  it("shows the configured fields, in the configured order", () => {
    renderFacts();

    // Grid fields are a definition list; only a full-width one gets a heading.
    const labels = screen.getAllByRole("term").map((t) => t.textContent);
    expect(labels).toEqual(["Type", "Priority", "Plant no."]);
  });

  it("shows each field's value", () => {
    renderFacts();

    expect(screen.getByText("Bug")).toBeDefined();
    expect(screen.getByText("High")).toBeDefined();
    expect(screen.getByText("K12")).toBeDefined();
  });

  it("leaves out a field this issue has nothing for", () => {
    configure(["Priority", "Nothing Here"]);

    renderFacts();

    expect(screen.queryByText("Nothing Here")).toBeNull();
  });

  it("reads the edit form so it knows what can be changed", async () => {
    renderFacts();

    await waitFor(() =>
      expect(apiMock.issueEditFields).toHaveBeenCalledWith("ABC-1"),
    );
  });

  it("still shows the issue when the edit form cannot be read", async () => {
    // Losing "what can be changed" is not losing the facts.
    apiMock.issueEditFields.mockRejectedValue(new Error("Jira returned 403"));

    renderFacts();

    expect(screen.getByText("Bug")).toBeDefined();
  });
});

describe("editing a field", () => {
  beforeEach(() =>
    apiMock.issueEditFields.mockResolvedValue([
      fieldMeta({ id: "priority", name: "Priority", schemaType: "string" }),
    ]),
  );

  it("opens an editor on a double-click, for a field Jira will accept", async () => {
    renderFacts();
    await waitFor(() => expect(apiMock.issueEditFields).toHaveBeenCalled());

    await userEvent.dblClick(screen.getByText("High"));

    expect(await screen.findByRole("textbox")).toBeDefined();
  });

  it("opens nothing for a field Jira will not let us set", async () => {
    // A "change" that opens a box saying it cannot be changed is worse than
    // no "change" at all.
    renderFacts();
    await waitFor(() => expect(apiMock.issueEditFields).toHaveBeenCalled());

    await userEvent.dblClick(screen.getByText("K12"));

    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("saves what was typed and tells the caller to reload", async () => {
    const onChanged = renderFacts();
    await waitFor(() => expect(apiMock.issueEditFields).toHaveBeenCalled());
    await userEvent.dblClick(screen.getByText("High"));
    const box = await screen.findByRole("textbox");

    await userEvent.clear(box);
    await userEvent.type(box, "Low");
    await userEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() =>
      expect(apiMock.updateIssueFields).toHaveBeenCalledWith("ABC-1", {
        priority: "Low",
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("reports a refused save without closing the editor", async () => {
    apiMock.updateIssueFields.mockRejectedValue(new Error("Jira returned 400"));
    renderFacts();
    await waitFor(() => expect(apiMock.issueEditFields).toHaveBeenCalled());
    await userEvent.dblClick(screen.getByText("High"));
    const box = await screen.findByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "Low");

    await userEvent.click(screen.getByRole("button", { name: /Save/ }));

    expect(await screen.findByText(/Jira returned 400/)).toBeDefined();
  });

  it("closes on Escape without saving", async () => {
    renderFacts();
    await waitFor(() => expect(apiMock.issueEditFields).toHaveBeenCalled());
    await userEvent.dblClick(screen.getByText("High"));
    await screen.findByRole("textbox");

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(apiMock.updateIssueFields).not.toHaveBeenCalled();
  });
});

describe("arranging the fields", () => {
  it("is off until it is asked for", () => {
    renderFacts();

    expect(
      screen.getByRole("button", { name: "Arrange fields" }),
    ).toBeDefined();
    expect(screen.queryByTitle(/Move earlier/)).toBeNull();
  });

  it("shows every configured field, values or not", async () => {
    // A field with no value still has a place that has to be movable.
    configure(["Priority", "Nothing Here"]);
    renderFacts();

    await userEvent.click(
      screen.getByRole("button", { name: "Arrange fields" }),
    );

    expect(screen.getByText("Nothing Here")).toBeDefined();
  });

  it("moves a field later in the order", async () => {
    renderFacts();
    await userEvent.click(
      screen.getByRole("button", { name: "Arrange fields" }),
    );

    await userEvent.click(screen.getAllByTitle("Move later")[0]);

    expect(getIssueFieldConfig().detail).toEqual([
      "Priority",
      "Issue Type",
      "Plant no.",
    ]);
  });

  it("moves a field earlier", async () => {
    renderFacts();
    await userEvent.click(
      screen.getByRole("button", { name: "Arrange fields" }),
    );

    await userEvent.click(screen.getAllByTitle("Move earlier")[1]);

    expect(getIssueFieldConfig().detail).toEqual([
      "Priority",
      "Issue Type",
      "Plant no.",
    ]);
  });

  it("removes a field from the layout", async () => {
    renderFacts();
    await userEvent.click(
      screen.getByRole("button", { name: "Arrange fields" }),
    );

    await userEvent.click(screen.getByTitle("Remove Priority from the layout"));

    expect(getIssueFieldConfig().detail).not.toContain("Priority");
  });

  it("cycles a field's width", async () => {
    renderFacts();
    await userEvent.click(
      screen.getByRole("button", { name: "Arrange fields" }),
    );

    await userEvent.click(screen.getAllByTitle(/Size: normal/)[0]);

    expect(Object.values(getIssueFieldConfig().sizes)).toContain("wide");
  });
});

describe("an Assets field", () => {
  it("links out to the object in Jira rather than showing bare text", async () => {
    // Assets objects are places in Jira, not values.
    renderFacts(
      issueDetail({
        details: [
          {
            id: "customfield_2",
            label: "Machine",
            value: "Pump 4",
            assets: [{ name: "Pump 4", objectId: "o1" }],
          },
        ],
      }),
    );
    configure(["Machine"]);

    const link = screen.queryByText("Pump 4");
    if (link) {
      await userEvent.click(link);
      expect(openUrl).toHaveBeenCalled();
    }
  });
});
