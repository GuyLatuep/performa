import { useCallback, useEffect, useState } from "react";

/**
 * Dragging one thing onto another, built on pointer events.
 *
 * Not HTML5 drag-and-drop, which cannot work here: the window has Tauri's
 * native drag-drop enabled so that files dropped on it become attachments, and
 * that handler consumes the drop before the page sees it. Turning it off would
 * trade attaching files for arranging fields.
 *
 * Doing it by hand means providing what the browser used to: something that
 * follows the cursor, and a page that does not try to select text while the
 * pointer is held down. Without those the drag works and looks broken, which
 * is worse than not working.
 *
 * Elements taking part carry `data-field="<name>"`; what is under the pointer
 * is read from the document rather than tracked, so a drag works across the
 * gaps between them and over the whole of a wide one.
 */
export interface FieldDrag {
  /** The field in hand, if any. */
  dragging: string | null;
  /** The field it would drop onto. */
  dropTarget: string | null;
  /** Where to draw the thing that follows the cursor. */
  at: { x: number; y: number } | null;
  startDrag: (name: string, e: React.PointerEvent) => void;
}

export function useFieldDrag(
  onDrop: (dragged: string, onto: string) => void,
): FieldDrag {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  const startDrag = useCallback((name: string, e: React.PointerEvent) => {
    // Capture, so the pointer stream keeps reaching us however fast the cursor
    // leaves the grip — a grip is a few pixels wide and easy to outrun.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    setDragging(name);
    setAt({ x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    if (dragging === null) return;

    const fieldUnder = (e: PointerEvent): string | null =>
      document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-field]")?.dataset.field ?? null;

    const onMove = (e: PointerEvent) => {
      setAt({ x: e.clientX, y: e.clientY });
      const over = fieldUnder(e);
      // Itself is not a target: dropping a field on itself is a no-op, and
      // highlighting it would say otherwise.
      setDropTarget(over === dragging ? null : over);
    };

    const onUp = (e: PointerEvent) => {
      const over = fieldUnder(e);
      if (over && over !== dragging) onDrop(dragging, over);
      setDragging(null);
      setDropTarget(null);
      setAt(null);
    };

    // Held down over a page of text, a pointer drag selects it — which fights
    // the gesture and leaves the grid highlighted afterwards.
    document.body.classList.add("dragging-field");

    // On the window, so the gesture survives leaving the grid — and cancelled
    // rather than dropped if the pointer is taken away mid-drag.
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      document.body.classList.remove("dragging-field");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, onDrop]);

  return { dragging, dropTarget, at, startDrag };
}
