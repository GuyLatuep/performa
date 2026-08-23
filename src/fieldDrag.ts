import { useCallback, useEffect, useState } from "react";
import { logInfo } from "./log";

/**
 * Dragging one thing onto another, built on pointer events.
 *
 * Not HTML5 drag-and-drop, which cannot work here: the window has Tauri's
 * native drag-drop enabled so that files dropped on it become attachments, and
 * that handler consumes the drop before the page sees it. The element still
 * lifts, so the gesture looks right and then does nothing — which is exactly
 * how this failed. Turning the native handler off would trade attaching files
 * for arranging fields.
 *
 * Elements taking part carry `data-field="<name>"`; what is under the pointer
 * is read from the document rather than tracked, so a drag works across the
 * gaps between them and over the whole of a wide one.
 */
export function useFieldDrag(onDrop: (dragged: string, onto: string) => void) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const startDrag = useCallback((name: string) => {
    logInfo(`field drag: started on ${name}`);
    setDragging(name);
  }, []);

  useEffect(() => {
    if (dragging === null) return;

    const fieldUnder = (e: PointerEvent): string | null =>
      document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-field]")?.dataset.field ?? null;

    const onMove = (e: PointerEvent) => {
      const over = fieldUnder(e);
      // Itself is not a target: dropping a field on itself is a no-op, and
      // highlighting it would say otherwise.
      setDropTarget(over === dragging ? null : over);
    };

    const onUp = (e: PointerEvent) => {
      const over = fieldUnder(e);
      logInfo(
        `field drag: released over ${over ?? "nothing"} (had ${dragging})`,
      );
      if (over && over !== dragging) onDrop(dragging, over);
      setDragging(null);
      setDropTarget(null);
    };

    // On the window, so the gesture survives leaving the grid — and cancelled
    // rather than dropped if the pointer is taken away mid-drag.
    logInfo("field drag: listening for move/up");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, onDrop]);

  return { dragging, dropTarget, startDrag };
}
