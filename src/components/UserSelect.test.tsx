/** @vitest-environment happy-dom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test-support/dom";

vi.mock("../api", async () => {
  const { apiModule } = await import("../test-support/api");
  return apiModule();
});

import { apiMock, jiraUser, resetApiMock } from "../test-support/api";
import UserSelect from "./UserSelect";

const ANNA = jiraUser({ accountId: "acc-anna", displayName: "Anna Leeson" });
const BEN = jiraUser({ accountId: "acc-ben", displayName: "Ben Ortiz" });

function setup() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

function renderSelect(value = "") {
  const onChange = vi.fn();
  render(
    <UserSelect
      id="assignee"
      value={value}
      disabled={false}
      onChange={onChange}
    />,
  );
  return onChange;
}

/** Type into the box and let the 250 ms debounce elapse. */
async function search(user: ReturnType<typeof setup>, text: string) {
  await user.type(screen.getByRole("textbox"), text);
  await vi.advanceTimersByTimeAsync(250);
}

beforeEach(() => {
  resetApiMock();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("searching", () => {
  it("waits for the typing to stop, then asks once", async () => {
    const user = setup();
    renderSelect();

    await user.type(screen.getByRole("textbox"), "ann");
    expect(apiMock.searchUsers).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(apiMock.searchUsers).toHaveBeenCalledTimes(1);
    expect(apiMock.searchUsers).toHaveBeenCalledWith("ann");
  });

  it("asks for nothing while the box is empty", async () => {
    // A blank query would fetch the whole site's user list.
    renderSelect();

    await vi.advanceTimersByTimeAsync(500);

    expect(apiMock.searchUsers).not.toHaveBeenCalled();
  });

  it("lists what came back", async () => {
    apiMock.searchUsers.mockResolvedValue([ANNA, BEN]);
    const user = setup();
    renderSelect();

    await search(user, "a");

    expect(await screen.findByText("Anna Leeson")).toBeDefined();
    expect(screen.getByText("Ben Ortiz")).toBeDefined();
  });

  it("leaves the list empty when the lookup fails, rather than the field broken", async () => {
    // Jira answers an empty list for a user without "Browse users" anyway, so
    // a failure here is not worth a banner.
    apiMock.searchUsers.mockRejectedValue(new Error("403"));
    const user = setup();
    renderSelect();

    await search(user, "a");

    await waitFor(() => expect(apiMock.searchUsers).toHaveBeenCalled());
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("keyboard", () => {
  beforeEach(() => apiMock.searchUsers.mockResolvedValue([ANNA, BEN]));

  it("starts on the first match", async () => {
    const user = setup();
    renderSelect();

    await search(user, "a");

    const options = await screen.findAllByRole("option");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
  });

  it("moves down and wraps round the end", async () => {
    const user = setup();
    renderSelect();
    await search(user, "a");
    await screen.findAllByRole("option");

    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe(
      "true",
    );

    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("moves up from the first to the last", async () => {
    const user = setup();
    renderSelect();
    await search(user, "a");
    await screen.findAllByRole("option");

    await user.keyboard("{ArrowUp}");

    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("chooses the active match on Enter", async () => {
    const user = setup();
    const onChange = renderSelect();
    await search(user, "a");
    await screen.findAllByRole("option");

    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("acc-ben");
  });

  it("chooses on Tab as well, since the field is in a form", async () => {
    const user = setup();
    const onChange = renderSelect();
    await search(user, "a");
    await screen.findAllByRole("option");

    await user.keyboard("{Tab}");

    expect(onChange).toHaveBeenCalledWith("acc-anna");
  });

  it("closes the list on Escape without choosing", async () => {
    const user = setup();
    const onChange = renderSelect();
    await search(user, "a");
    await screen.findAllByRole("option");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("once somebody is chosen", () => {
  it("shows the name instead of the search box", async () => {
    // A half-typed query beside a chosen name is the state that makes people
    // wonder which of the two counts.
    apiMock.searchUsers.mockResolvedValue([ANNA]);
    const user = setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <UserSelect
        id="assignee"
        value=""
        disabled={false}
        onChange={onChange}
      />,
    );

    await search(user, "ann");
    await user.click(await screen.findByText("Anna Leeson"));

    // The caller stores the id and feeds it back in.
    rerender(
      <UserSelect
        id="assignee"
        value="acc-anna"
        disabled={false}
        onChange={onChange}
      />,
    );

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Anna Leeson")).toBeDefined();
  });

  it("goes back to searching on change, clearing the field", async () => {
    apiMock.searchUsers.mockResolvedValue([ANNA]);
    const user = setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <UserSelect
        id="assignee"
        value=""
        disabled={false}
        onChange={onChange}
      />,
    );
    await search(user, "ann");
    await user.click(await screen.findByText("Anna Leeson"));
    rerender(
      <UserSelect
        id="assignee"
        value="acc-anna"
        disabled={false}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "change" }));

    expect(onChange).toHaveBeenLastCalledWith("");
    expect(screen.getByRole("textbox")).toBeDefined();
  });
});

describe("disabled", () => {
  it("takes no input while a save is in flight", () => {
    render(<UserSelect id="assignee" value="" disabled onChange={vi.fn()} />);

    expect(screen.getByRole("textbox")).toHaveProperty("disabled", true);
  });
});
