import { useEffect, useState } from "react";
import { api } from "../api";
import { addDetailField } from "../issueFieldNames";

/**
 * The arrange mode's toolbar: leave the mode, or add a field to the layout.
 *
 * The names come from the site's own field catalog rather than a text box: a
 * name that doesn't exist resolves to nothing, and the field would simply never
 * appear — a hard thing to work out from the outside.
 */
export default function FieldArrangeBar({
  shown,
  onDone,
}: {
  /** Names already on the layout, which are not worth offering twice. */
  shown: string[];
  onDone: () => void;
}) {
  const [names, setNames] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState("");

  // Reference data, held for the life of the process by `memo` in api.ts — so
  // entering arrange mode a second time costs nothing.
  useEffect(() => {
    let cancelled = false;
    api.jiraFieldNames().then(
      (list) => !cancelled && setNames(list),
      (err) => {
        if (cancelled) return;
        setNames([]);
        setError(String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const already = new Set(shown.map((n) => n.toLowerCase()));
  const addable = (names ?? []).filter((n) => !already.has(n.toLowerCase()));

  return (
    <div className="arrange-bar">
      <span className="hint">
        Drag a field to move it · ⇔ resizes · ✕ removes it
      </span>
      <div className="arrange-add">
        <select
          value={picked}
          disabled={names === null}
          onChange={(e) => setPicked(e.target.value)}
        >
          <option value="">
            {names === null ? "Loading fields…" : "Add a field…"}
          </option>
          {addable.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button
          className="secondary"
          disabled={picked === ""}
          onClick={() => {
            addDetailField(picked);
            setPicked("");
          }}
        >
          Add
        </button>
        <button onClick={onDone}>Done</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
