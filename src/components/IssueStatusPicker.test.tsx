/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { FieldMeta, Transition } from "../api";
import IssueStatusPicker from "./IssueStatusPicker";

// Built through the real `transitions.ts`, which is already tested — these are
// Jira's own shapes, so the picker is exercised against what it really gets.
function transition(overrides: Partial<Transition> = {}): Transition {
  return {
    id: "31",
    name: "Start work",
    to: "In Progress",
    fields: [],
    ...overrides,
  } as Transition;
}

function fieldMeta(overrides: Partial<FieldMeta> = {}): FieldMeta {
  return {
    id: "customfield_1",
    name: "A field",
    required: false,
    schemaType: "string",
    // Always an array by the time it reaches the webview — the Rust client
    // defaults it, so a field Jira described without one arrives with [].
    operations: ["set"],
    allowedValues: [],
    ...overrides,
  };
}

function renderPicker(props: Partial<Parameters<typeof IssueStatusPicker>[0]>) {
  const onPick = vi.fn();
  render(
    <IssueStatusPicker
      current="Open"
      transitions={[]}
      error={null}
      busy={false}
      onPick={onPick}
      {...props}
    />,
  );
  return onPick;
}

describe("the current status", () => {
  it("is what the closed picker shows", () => {
    renderPicker({ current: "In Review", transitions: [transition()] });

    expect(screen.getByRole("combobox")).toHaveProperty("value", "");
    expect(screen.getByText("In Review")).toBeDefined();
  });

  it("falls back to a dash when the issue has no status", () => {
    renderPicker({ current: undefined, transitions: [transition()] });

    expect(screen.getByText("—")).toBeDefined();
  });
});

describe("when the workflow could not be read", () => {
  it("says so and offers no picker at all", () => {
    // Better than an empty select the user can click at forever.
    renderPicker({ error: "Jira returned 403", current: "Open" });

    expect(screen.getByText("workflow unavailable")).toBeDefined();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByTitle("Jira returned 403")).toBeDefined();
  });
});

describe("the offered moves", () => {
  it("lists a direct move by the status it leads to", () => {
    renderPicker({ transitions: [transition({ to: "In Progress" })] });

    expect(screen.getByRole("option", { name: "In Progress" })).toBeDefined();
  });

  it("hands the whole move to the caller when picked", async () => {
    const onPick = renderPicker({ transitions: [transition({ id: "31" })] });

    await userEvent.selectOptions(screen.getByRole("combobox"), "31");

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toMatchObject({
      id: "31",
      to: "In Progress",
    });
  });

  it("marks a move that needs a screen", async () => {
    // Offered, and opening one is the point — the ellipsis says a form is
    // coming rather than the move happening on the spot.
    renderPicker({
      transitions: [
        transition({
          id: "41",
          to: "Resolved",
          fields: [
            fieldMeta({
              id: "resolution",
              name: "Resolution",
              required: true,
              schemaType: "option",
              allowedValues: [{ id: "1", label: "Done" }],
            }),
          ],
        }),
      ],
    });

    expect(screen.getByRole("option", { name: /Resolved …/ })).toBeDefined();
  });

  it("keeps a move this app cannot make, disabled and saying why", () => {
    // Knowing a status exists but is out of reach here beats a shorter list
    // that silently omits it.
    renderPicker({
      transitions: [
        transition({
          id: "51",
          to: "Escalated",
          fields: [
            fieldMeta({
              id: "customfield_9",
              name: "Weird thing",
              required: true,
              schemaType: "any",
              schemaCustom: "com.example:unknown",
            }),
          ],
        }),
      ],
    });

    const option = screen.getByRole("option", { name: /needs Jira/ });
    expect(option).toHaveProperty("disabled", true);
  });
});

describe("the picker is dead when there is nothing to pick", () => {
  it("is disabled while the transitions are still loading", () => {
    renderPicker({ transitions: null });

    expect(screen.getByRole("combobox")).toHaveProperty("disabled", true);
  });

  it("is disabled when the workflow offers no move at all", () => {
    renderPicker({ transitions: [] });

    expect(screen.getByRole("combobox")).toHaveProperty("disabled", true);
  });

  it("is disabled and says so while a move is in flight", () => {
    renderPicker({ transitions: [transition()], busy: true });

    expect(screen.getByRole("combobox")).toHaveProperty("disabled", true);
    expect(screen.getByText("Moving…")).toBeDefined();
  });
});
