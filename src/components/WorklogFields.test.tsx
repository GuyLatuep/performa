/** @vitest-environment happy-dom */
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../test-support/dom";
import {
  toWorklogInput,
  useWorklogDraft,
  WorklogDraft,
  WorklogFields,
} from "./WorklogFields";

function draft(overrides: Partial<WorklogDraft> = {}): WorklogDraft {
  return {
    duration: "",
    date: "2026-03-15",
    time: "09:00",
    comment: "",
    nonBillable: false,
    ...overrides,
  };
}

/** Render the quartet and hand back the patch spy it was given. */
function renderFields(
  d: WorklogDraft = draft(),
  seconds: number | null = null,
  props: Partial<Parameters<typeof WorklogFields>[0]> = {},
) {
  const patch = vi.fn();
  render(
    <WorklogFields draft={d} patch={patch} seconds={seconds} {...props} />,
  );
  return patch;
}

describe("toWorklogInput", () => {
  it("inverts the billable flag the form asks for", () => {
    // The form asks "non-billable"; the API takes "billable". Getting this
    // backwards would mis-bill every worklog silently.
    expect(toWorklogInput(draft({ nonBillable: true }), 3600).billable).toBe(
      false,
    );
    expect(toWorklogInput(draft({ nonBillable: false }), 3600).billable).toBe(
      true,
    );
  });

  it("takes the seconds it is handed rather than re-parsing", () => {
    const input = toWorklogInput(draft({ duration: "nonsense" }), 5400);

    expect(input.timeSpentSeconds).toBe(5400);
    expect(input).toMatchObject({ date: "2026-03-15", time: "09:00" });
  });
});

describe("useWorklogDraft", () => {
  it("starts from today and now when given nothing", () => {
    const { result } = renderHook(() => useWorklogDraft());

    expect(result.current.draft.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.current.draft.time).toMatch(/^\d{2}:\d{2}$/);
    expect(result.current.draft.duration).toBe("");
    expect(result.current.seconds).toBeNull();
  });

  it("takes the initial values it is given", () => {
    const { result } = renderHook(() =>
      useWorklogDraft({
        duration: "1h 30m",
        comment: "seal",
        date: "2026-01-02",
      }),
    );

    expect(result.current.draft.comment).toBe("seal");
    expect(result.current.draft.date).toBe("2026-01-02");
    expect(result.current.seconds).toBe(5400);
  });

  it("patches one field without disturbing the rest", () => {
    const { result } = renderHook(() => useWorklogDraft({ comment: "seal" }));

    act(() => result.current.patch({ duration: "45m" }));

    expect(result.current.draft.duration).toBe("45m");
    expect(result.current.draft.comment).toBe("seal");
    expect(result.current.seconds).toBe(2700);
  });

  it("reports an unparseable duration as no seconds", () => {
    const { result } = renderHook(() => useWorklogDraft({ duration: "soon" }));

    expect(result.current.seconds).toBeNull();
  });
});

describe("the duration field", () => {
  it("reports what was typed", async () => {
    const patch = renderFields();

    await userEvent.type(screen.getByLabelText(/Time spent/), "1");

    expect(patch).toHaveBeenLastCalledWith({ duration: "1" });
  });

  it("takes the caller's own label", () => {
    renderFields(draft(), null, { durationLabel: "How long did it take" });

    expect(screen.getByLabelText(/How long did it take/)).toBeDefined();
  });

  it("previews the parsed duration once it makes sense", () => {
    renderFields(draft({ duration: "90m" }), 5400);

    expect(screen.getByText("= 1h 30m")).toBeDefined();
  });

  it("previews nothing while the duration cannot be read", () => {
    const { container } = render(
      <WorklogFields
        draft={draft({ duration: "soon" })}
        patch={vi.fn()}
        seconds={null}
      />,
    );

    expect(container.querySelector(".hint")).toBeNull();
  });
});

describe("the quick-add buttons", () => {
  it("adds to what is already there, so twice reads as the sum", async () => {
    const patch = renderFields(draft({ duration: "30m" }), 1800);

    await userEvent.click(screen.getByRole("button", { name: "+30m" }));

    expect(patch).toHaveBeenCalledWith({ duration: "1h" });
  });

  it("treats an unreadable duration as zero rather than refusing", async () => {
    const patch = renderFields(draft({ duration: "soon" }), null);

    await userEvent.click(screen.getByRole("button", { name: "+15m" }));

    expect(patch).toHaveBeenCalledWith({ duration: "15m" });
  });

  it("offers the three increments", () => {
    renderFields();

    for (const label of ["+15m", "+30m", "+1h"]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
  });
});

describe("the other fields", () => {
  it("reports a changed date and refuses a future one", async () => {
    const patch = renderFields();
    const date = screen.getByLabelText("Date");

    // Time cannot be logged before it is worked.
    expect(date.getAttribute("max")).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await userEvent.clear(date);
    await userEvent.type(date, "2026-03-14");

    expect(patch).toHaveBeenCalled();
  });

  it("reports a comment", async () => {
    const patch = renderFields();

    await userEvent.type(screen.getByLabelText(/Comment/), "x");

    expect(patch).toHaveBeenLastCalledWith({ comment: "x" });
  });

  it("reports the non-billable tick", async () => {
    const patch = renderFields();

    await userEvent.click(screen.getByLabelText("Non-billable"));

    expect(patch).toHaveBeenCalledWith({ nonBillable: true });
  });

  it("shows the stored values", () => {
    renderFields(
      draft({ comment: "swapped the seal", nonBillable: true, time: "14:30" }),
    );

    expect(screen.getByLabelText(/Comment/)).toHaveProperty(
      "value",
      "swapped the seal",
    );
    expect(screen.getByLabelText("Non-billable")).toHaveProperty(
      "checked",
      true,
    );
    expect(screen.getByLabelText("Start time")).toHaveProperty(
      "value",
      "14:30",
    );
  });
});

describe("fastTabOrder", () => {
  it("keeps Tab on duration → comment → submit", () => {
    // The fields that usually stay at their default are reachable by click or
    // shift-tab, not by tabbing past them on the way to the button.
    renderFields(draft(), null, { fastTabOrder: true });

    expect(screen.getByLabelText("Date").getAttribute("tabindex")).toBe("-1");
    expect(screen.getByLabelText("Start time").getAttribute("tabindex")).toBe(
      "-1",
    );
    expect(screen.getByLabelText("Non-billable").getAttribute("tabindex")).toBe(
      "-1",
    );
    expect(
      screen.getByRole("button", { name: "+15m" }).getAttribute("tabindex"),
    ).toBe("-1");
    // The two on the straight path keep their natural order.
    expect(
      screen.getByLabelText(/Time spent/).getAttribute("tabindex"),
    ).toBeNull();
    expect(
      screen.getByLabelText(/Comment/).getAttribute("tabindex"),
    ).toBeNull();
  });

  it("leaves every field in the tab order by default", () => {
    renderFields();

    expect(screen.getByLabelText("Date").getAttribute("tabindex")).toBeNull();
    expect(
      screen.getByLabelText("Non-billable").getAttribute("tabindex"),
    ).toBeNull();
  });
});
