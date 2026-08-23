import { useEffect, useState } from "react";
import { api } from "../api";
import {
  addDetailField,
  isWideField,
  moveDetailField,
  removeDetailField,
  toggleWideField,
  useIssueFieldConfig,
} from "../issueFieldNames";

/** Which of the site's own fields the issue view shows, and in which order.
 *
 *  Only what is *shown* is configured. Whether a field can be changed is asked
 *  of the issue's own edit form instead — it depends on issue type and
 *  permission, so it is not something a setting could get right.
 *
 *  The names are picked from the site's field catalog rather than typed: a name
 *  that doesn't exist resolves to nothing and the field would just silently
 *  never appear, which is a hard thing to debug from the outside. */
export default function SettingsIssueFields() {
  const config = useIssueFieldConfig();
  const [names, setNames] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState("");

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

  const shown = new Set(config.detail.map((n) => n.toLowerCase()));
  const addable = (names ?? []).filter((n) => !shown.has(n.toLowerCase()));

  return (
    <div className="field-block">
      <h3>Issue view fields</h3>
      <p className="hint">
        Shown on an issue below its standard fields, in this order. Summary,
        status, priority, reporter and description are always shown and are not
        listed here. ⇔ gives a field the full width, under the description — for
        the ones holding prose rather than a word or two.
      </p>

      {error && <p className="error">{error}</p>}
      {names === null && <p className="muted">Loading the field catalog…</p>}

      <ul className="field-name-list">
        {config.detail.map((name, i) => (
          <li key={name}>
            <span className="field-name">{name}</span>
            <button
              className={`icon${isWideField(config, name) ? " on" : ""}`}
              title={
                isWideField(config, name)
                  ? `${name} is shown full width — put it back in the grid`
                  : `Show ${name} full width, under the description`
              }
              onClick={() => toggleWideField(name)}
            >
              ⇔
            </button>
            <button
              className="icon"
              title="Move up"
              disabled={i === 0}
              onClick={() => moveDetailField(name, -1)}
            >
              ↑
            </button>
            <button
              className="icon"
              title="Move down"
              disabled={i === config.detail.length - 1}
              onClick={() => moveDetailField(name, 1)}
            >
              ↓
            </button>
            <button
              className="icon"
              title={`Stop showing ${name}`}
              onClick={() => removeDetailField(name)}
            >
              ✕
            </button>
          </li>
        ))}
        {config.detail.length === 0 && (
          <li className="muted empty">
            No extra fields — only the standard ones are shown.
          </li>
        )}
      </ul>

      <div className="field-add">
        <select value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">Add a field…</option>
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
      </div>
    </div>
  );
}
