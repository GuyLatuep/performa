import { useEffect, useState } from "react";
import { api } from "../api";
import {
  addDetailField,
  moveDetailField,
  removeDetailField,
  setTeamField,
  useIssueFieldConfig,
} from "../issueFieldNames";

/** Which of the site's own fields the issue view shows, in which order, and
 *  which one it can change.
 *
 *  The names are picked from the site's field catalog rather than typed: a
 *  name that doesn't exist resolves to nothing and the field would just
 *  silently never appear, which is a hard thing to debug from the outside. */
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
        listed here.
      </p>

      {error && <p className="error">{error}</p>}
      {names === null && <p className="muted">Loading the field catalog…</p>}

      <ul className="field-name-list">
        {config.detail.map((name, i) => (
          <li key={name}>
            <span className="field-name">{name}</span>
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

      <h3>Editable field</h3>
      <p className="hint">
        The one field the issue view offers to change — the team an issue
        belongs to, on most sites. Everything else is read-only there. What it
        accepts comes from Jira, so only values the field actually allows are
        offered.
      </p>
      <select
        value={config.team}
        onChange={(e) => setTeamField(e.target.value)}
      >
        <option value="">None — nothing is editable</option>
        {(names ?? []).map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
