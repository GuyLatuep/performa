/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import { FieldKind, FormField, FormValues } from "../issueFields";
import FieldForm from "./FieldForm";

// The "user" kind delegates to UserSelect, which searches Jira over IPC. That
// is UserSelect's own concern; here it only has to be something rendered.
vi.mock("./UserSelect", () => ({
  default: ({ id, disabled }: { id: string; disabled: boolean }) => (
    <input id={id} disabled={disabled} data-testid="user-select" />
  ),
}));

function field(overrides: Partial<FormField> = {}): FormField {
  return {
    id: "customfield_1",
    name: "Plant",
    required: false,
    kind: "text",
    options: [],
    ...overrides,
  };
}

const OPTIONS = [
  { id: "10", label: "Berlin" },
  { id: "20", label: "Hamburg" },
];

/** Render one field and hand back the change spy the form was given. */
function renderField(f: FormField, values: FormValues = {}) {
  const onChange = vi.fn();
  render(<FieldForm fields={[f]} values={values} onChange={onChange} />);
  return onChange;
}

describe("the field label", () => {
  it("names the field", () => {
    renderField(field({ name: "Plant no." }));

    expect(screen.getByText("Plant no.")).toBeDefined();
  });

  it("marks a required field and leaves an optional one unmarked", () => {
    const { unmount } = render(
      <FieldForm
        fields={[field({ required: true })]}
        values={{}}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTitle("Required")).toBeDefined();
    unmount();

    renderField(field({ required: false }));
    expect(screen.queryByTitle("Required")).toBeNull();
  });
});

describe("every field kind renders an input", () => {
  // The point of the sweep: a kind that falls through the switch renders
  // nothing at all, and a field missing from a form reads as a field the
  // screen does not have.
  const kinds: FieldKind[] = [
    "text",
    "textarea",
    "number",
    "date",
    "datetime",
    "select",
    "radio",
    "multiselect",
    "checkboxes",
    "labels",
    "user",
    "unsupported",
  ];

  it.each(kinds)("renders something for %s", (kind) => {
    const { container } = render(
      <FieldForm
        fields={[field({ kind, options: OPTIONS })]}
        values={{}}
        onChange={vi.fn()}
      />,
    );

    const rendered = container.querySelector(
      "input, textarea, select, .field-unsupported",
    );
    expect(rendered).not.toBeNull();
  });
});

describe("text-shaped fields", () => {
  it("reports what was typed", async () => {
    // One character: the input is controlled by the `values` prop, which this
    // test does not feed back, so a second keystroke would be applied to the
    // unchanged old value rather than to the first one.
    const onChange = renderField(field({ kind: "text" }));

    await userEvent.type(screen.getByLabelText(/Plant/), "K");

    expect(onChange).toHaveBeenLastCalledWith("customfield_1", "K");
  });

  it("appends to the value it was given", async () => {
    const onChange = renderField(field({ kind: "text" }), {
      customfield_1: "K",
    });

    await userEvent.type(screen.getByLabelText(/Plant/), "1");

    expect(onChange).toHaveBeenLastCalledWith("customfield_1", "K1");
  });

  it("shows the stored value", () => {
    renderField(field({ kind: "textarea" }), { customfield_1: "some notes" });

    expect(screen.getByLabelText(/Plant/)).toHaveProperty(
      "value",
      "some notes",
    );
  });

  it("picks the input type from the kind", () => {
    const { container, unmount } = render(
      <FieldForm
        fields={[field({ kind: "number" })]}
        values={{}}
        onChange={vi.fn()}
      />,
    );
    expect(container.querySelector("input")?.type).toBe("number");
    unmount();

    render(
      <FieldForm
        fields={[field({ kind: "date" })]}
        values={{}}
        onChange={vi.fn()}
      />,
    );
    expect(document.querySelector("input")?.type).toBe("date");
  });

  it("says how labels are separated, since one text box is the whole editor", () => {
    renderField(field({ kind: "labels" }));

    expect(screen.getByText(/Separated by spaces or commas/)).toBeDefined();
  });

  it("survives a value of the wrong shape", () => {
    // Values arrive from Jira; an array where a string belongs must render an
    // empty box rather than crash the whole screen.
    renderField(field({ kind: "text" }), { customfield_1: ["unexpected"] });

    expect(screen.getByLabelText(/Plant/)).toHaveProperty("value", "");
  });
});

describe("select", () => {
  it("offers a blank option even when the field is required", () => {
    // A select starting on a real value would have the user submit a choice
    // they never made.
    renderField(field({ kind: "select", required: true, options: OPTIONS }));

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveProperty("value", "");
    expect(options).toHaveLength(3);
  });

  it("reports the chosen option's id", async () => {
    const onChange = renderField(field({ kind: "select", options: OPTIONS }));

    await userEvent.selectOptions(screen.getByLabelText(/Plant/), "20");

    expect(onChange).toHaveBeenCalledWith("customfield_1", "20");
  });

  it("falls back to the label when an option has no id", async () => {
    const onChange = renderField(
      field({ kind: "select", options: [{ id: "", label: "Unspecified" }] }),
    );

    await userEvent.selectOptions(
      screen.getByLabelText(/Plant/),
      "Unspecified",
    );

    expect(onChange).toHaveBeenCalledWith("customfield_1", "Unspecified");
  });
});

describe("radio", () => {
  it("checks only the stored choice", () => {
    renderField(field({ kind: "radio", options: OPTIONS }), {
      customfield_1: "20",
    });

    const [berlin, hamburg] = screen.getAllByRole("radio");
    expect(berlin).toHaveProperty("checked", false);
    expect(hamburg).toHaveProperty("checked", true);
  });

  it("reports the picked option", async () => {
    const onChange = renderField(field({ kind: "radio", options: OPTIONS }));

    await userEvent.click(screen.getByLabelText("Berlin"));

    expect(onChange).toHaveBeenCalledWith("customfield_1", "10");
  });
});

describe("the multi-value kinds", () => {
  it.each(["checkboxes", "multiselect"] as FieldKind[])(
    "adds to the selection for %s",
    async (kind) => {
      const onChange = renderField(field({ kind, options: OPTIONS }), {
        customfield_1: ["10"],
      });

      await userEvent.click(screen.getByLabelText("Hamburg"));

      expect(onChange).toHaveBeenCalledWith("customfield_1", ["10", "20"]);
    },
  );

  it("removes from the selection when unticked", async () => {
    const onChange = renderField(
      field({ kind: "checkboxes", options: OPTIONS }),
      { customfield_1: ["10", "20"] },
    );

    await userEvent.click(screen.getByLabelText("Berlin"));

    expect(onChange).toHaveBeenCalledWith("customfield_1", ["20"]);
  });

  it("ticks exactly what is stored", () => {
    renderField(field({ kind: "multiselect", options: OPTIONS }), {
      customfield_1: ["20"],
    });

    const [berlin, hamburg] = screen.getAllByRole("checkbox");
    expect(berlin).toHaveProperty("checked", false);
    expect(hamburg).toHaveProperty("checked", true);
  });
});

describe("an unsupported field", () => {
  it("says so instead of rendering nothing", () => {
    // Hiding it would read as a field the screen doesn't have.
    renderField(field({ kind: "unsupported" }));

    expect(screen.getByText(/no input for this kind of field/)).toBeDefined();
  });
});

describe("disabled", () => {
  it("disables every kind of input while a save is in flight", () => {
    const { container } = render(
      <FieldForm
        fields={[
          field({ id: "a", kind: "text" }),
          field({ id: "b", kind: "select", options: OPTIONS }),
          field({ id: "c", kind: "checkboxes", options: OPTIONS }),
          field({ id: "d", kind: "textarea" }),
        ]}
        values={{}}
        onChange={vi.fn()}
        disabled
      />,
    );

    const inputs = container.querySelectorAll("input, select, textarea");
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input).toHaveProperty("disabled", true);
    }
  });
});

describe("several fields", () => {
  it("renders them all and reports each by its own id", async () => {
    const onChange = vi.fn();
    render(
      <FieldForm
        fields={[
          field({ id: "a", name: "Plant" }),
          field({ id: "b", name: "Line" }),
        ]}
        values={{}}
        onChange={onChange}
      />,
    );

    await userEvent.type(screen.getByLabelText("Line"), "x");

    expect(onChange).toHaveBeenLastCalledWith("b", "x");
  });
});
