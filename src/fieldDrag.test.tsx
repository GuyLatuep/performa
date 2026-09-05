/** @vitest-environment happy-dom */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test-support/dom";
import { useFieldDrag } from "./fieldDrag";

const FIELDS = ["due", "status", "assignee"];

/** A grid of fields, each with its own grip — the shape `IssueFacts` gives the
 *  hook. The state is rendered so a case can read what the hook is holding. */
function Harness({
  onDrop,
}: {
  onDrop: (dragged: string, onto: string) => void;
}) {
  const { dragging, dropTarget, at, startDrag } = useFieldDrag(onDrop);
  return (
    <div>
      {FIELDS.map((name) => (
        <div key={name} data-field={name}>
          <button
            data-testid={`grip-${name}`}
            onPointerDown={(e) => startDrag(name, e)}
          >
            {name}
          </button>
        </div>
      ))}
      <div data-testid="state">
        {JSON.stringify({ dragging, dropTarget, at })}
      </div>
    </div>
  );
}

const state = () =>
  JSON.parse(screen.getByTestId("state").textContent ?? "{}") as {
    dragging: string | null;
    dropTarget: string | null;
    at: { x: number; y: number } | null;
  };

/**
 * happy-dom does no layout, so `document.elementFromPoint` always answers
 * null. Stand in for the hit-test with a map from x-coordinate to field —
 * which is the only thing the hook asks the document for.
 *
 * Answers with the *grip* rather than the field box, so the `closest` walk up
 * to `[data-field]` is exercised the way a real pointer over a grip would.
 */
function pointerLandsOn(byX: Record<number, string | null>) {
  vi.spyOn(document, "elementFromPoint").mockImplementation((x: number) => {
    const field = byX[x] ?? null;
    return field
      ? document.querySelector<HTMLElement>(`[data-field="${field}"] button`)
      : null;
  });
}

/** Grab a field's grip, as a pointer coming down on it would. */
function grab(name: string, x = 0, pointerId = 7) {
  const grip = screen.getByTestId(`grip-${name}`);
  const capture = vi.spyOn(grip, "setPointerCapture");
  fireEvent.pointerDown(grip, { pointerId, clientX: x, clientY: 100 });
  return capture;
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.className = "";
});

describe("useFieldDrag", () => {
  it("takes the field in hand and follows the cursor", () => {
    pointerLandsOn({ 10: "due", 20: "status" });
    render(<Harness onDrop={vi.fn()} />);

    grab("due", 10);
    expect(state().dragging).toBe("due");
    expect(state().at).toEqual({ x: 10, y: 100 });

    fireEvent.pointerMove(window, { clientX: 20, clientY: 140 });
    // Something has to follow the cursor: the browser's own drag image is not
    // available here, so the position is the hook's job.
    expect(state().at).toEqual({ x: 20, y: 140 });
  });

  it("captures the pointer so a fast drag off the grip is not lost", () => {
    // A grip is a few pixels wide and easy to outrun.
    pointerLandsOn({});
    render(<Harness onDrop={vi.fn()} />);

    const capture = grab("due", 10, 42);

    expect(capture).toHaveBeenCalledWith(42);
  });

  it("marks the field under the pointer as the drop target", () => {
    pointerLandsOn({ 10: "due", 20: "status" });
    render(<Harness onDrop={vi.fn()} />);

    grab("due", 10);
    fireEvent.pointerMove(window, { clientX: 20, clientY: 100 });

    expect(state().dropTarget).toBe("status");
  });

  it("offers no target over the gap between fields", () => {
    pointerLandsOn({ 10: "due", 99: null });
    render(<Harness onDrop={vi.fn()} />);

    grab("due", 10);
    fireEvent.pointerMove(window, { clientX: 99, clientY: 100 });

    expect(state().dropTarget).toBeNull();
  });

  it("does not offer the dragged field as its own target", () => {
    // Dropping a field on itself is a no-op; highlighting it would say
    // otherwise.
    pointerLandsOn({ 10: "due", 20: "status" });
    render(<Harness onDrop={vi.fn()} />);

    grab("due", 10);
    fireEvent.pointerMove(window, { clientX: 20, clientY: 100 });
    expect(state().dropTarget).toBe("status");

    fireEvent.pointerMove(window, { clientX: 10, clientY: 100 });
    expect(state().dropTarget).toBeNull();
  });

  it("drops the field onto the one under the pointer", () => {
    pointerLandsOn({ 10: "due", 30: "assignee" });
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);

    grab("due", 10);
    fireEvent.pointerMove(window, { clientX: 30, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 30, clientY: 100 });

    expect(onDrop).toHaveBeenCalledWith("due", "assignee");
    expect(state()).toEqual({ dragging: null, dropTarget: null, at: null });
  });

  it("drops nothing when let go over a gap", () => {
    pointerLandsOn({ 10: "due", 99: null });
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);

    grab("due", 10);
    fireEvent.pointerUp(window, { clientX: 99, clientY: 100 });

    expect(onDrop).not.toHaveBeenCalled();
    expect(state().dragging).toBeNull();
  });

  it("drops nothing when let go on the field it started from", () => {
    pointerLandsOn({ 10: "due" });
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);

    grab("due", 10);
    fireEvent.pointerUp(window, { clientX: 10, clientY: 100 });

    expect(onDrop).not.toHaveBeenCalled();
    expect(state().dragging).toBeNull();
  });

  it("stops the page selecting text while the pointer is held down", () => {
    // Without this the drag works and looks broken — the grid stays
    // highlighted afterwards, which is worse than not working.
    pointerLandsOn({ 10: "due", 30: "assignee" });
    render(<Harness onDrop={vi.fn()} />);

    expect(document.body.classList.contains("dragging-field")).toBe(false);
    grab("due", 10);
    expect(document.body.classList.contains("dragging-field")).toBe(true);

    fireEvent.pointerUp(window, { clientX: 30, clientY: 100 });
    expect(document.body.classList.contains("dragging-field")).toBe(false);
  });

  it("lets go of the window once the drag is over", () => {
    pointerLandsOn({ 10: "due", 30: "assignee" });
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);

    grab("due", 10);
    fireEvent.pointerUp(window, { clientX: 30, clientY: 100 });
    expect(onDrop).toHaveBeenCalledTimes(1);

    // Ordinary pointer traffic after the drop must not move a field again.
    fireEvent.pointerMove(window, { clientX: 30, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 30, clientY: 100 });

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(state().at).toBeNull();
  });

  it("leaves nothing behind on the page when it unmounts mid-drag", () => {
    pointerLandsOn({ 10: "due" });
    const onDrop = vi.fn();
    const { unmount } = render(<Harness onDrop={onDrop} />);

    grab("due", 10);
    expect(document.body.classList.contains("dragging-field")).toBe(true);
    unmount();

    // A body left with the class would keep the whole app unselectable.
    expect(document.body.classList.contains("dragging-field")).toBe(false);
    fireEvent.pointerUp(window, { clientX: 10, clientY: 100 });
    expect(onDrop).not.toHaveBeenCalled();
  });
});
