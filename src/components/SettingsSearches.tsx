import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ProjectSummary } from "../api";
import {
  addSavedSearch,
  removeSavedSearch,
  SavedSearch,
  updateSavedSearch,
  useSavedSearches,
} from "../savedSearches";

/**
 * The searches the user builds for themselves.
 *
 * Which fields are worth searching is a property of the Jira site, not of this
 * app, so none are shipped: a site with a plant number wants one search and a
 * site with a customer reference wants another. Each one written here shows up in
 * the command palette as "Search by <name>".
 *
 * Laid out as a table rather than a stack of forms. Each search is four small
 * decisions, and giving every one of them its own labelled block repeated the
 * same four words down the screen and pushed the second search out of sight. One
 * header row names the columns once; a search is then one line, and the blank
 * line at the bottom is how another is added.
 */
export default function SettingsSearches() {
  const searches = useSavedSearches();
  // Reference data, held for the life of the process by `memo` in api.ts — so
  // reopening this tab costs nothing.
  const [fields, setFields] = useState<string[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.jiraFieldNames(), api.jiraProjects()]).then(
      ([f, p]) => {
        if (!cancelled) {
          setFields(f);
          setProjects(p);
        }
      },
      (err) => {
        if (!cancelled) setError(String(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="field-block">
      <span className="field-label">Searches in the command palette</span>
      {error && <p className="error">{error}</p>}

      <div className="search-grid">
        <span className="field-label">Name</span>
        <span className="field-label">Field</span>
        <span className="field-label">Exclude projects</span>
        <span className="field-label">Whole value</span>
        <span />

        {searches.map((search) => (
          <SearchRow
            key={search.id}
            search={search}
            fields={fields}
            projects={projects}
          />
        ))}

        <NewSearch fields={fields} projects={projects} />
      </div>

      <span className="hint">
        Each one becomes “Search by …” in the palette (⌘P); searching plain text
        is always offered and needs no setting up. Leave{" "}
        <strong>Whole value</strong> unticked to match anything starting with
        what you type — DE_1979 then also finds DE_1979_03.
      </span>
    </div>
  );
}

/** One saved search, editable in place. Every change applies as it is made, the
 *  way the rest of this screen's settings do. */
function SearchRow({
  search,
  fields,
  projects,
}: {
  search: SavedSearch;
  fields: string[] | null;
  projects: ProjectSummary[] | null;
}) {
  return (
    <>
      <input
        type="text"
        aria-label={`Name of the ${search.name} search`}
        value={search.name}
        onChange={(e) => updateSavedSearch(search.id, { name: e.target.value })}
      />
      <FieldPicker
        label={`Field the ${search.name} search looks in`}
        fields={fields}
        value={search.field}
        onChange={(field) => updateSavedSearch(search.id, { field })}
      />
      <ProjectPicker
        label={`Projects the ${search.name} search leaves out`}
        projects={projects}
        excluded={search.excludedProjects}
        onChange={(excludedProjects) =>
          updateSavedSearch(search.id, { excludedProjects })
        }
      />
      <input
        type="checkbox"
        aria-label={`Match the whole ${search.name} value`}
        checked={search.exact}
        onChange={(e) =>
          updateSavedSearch(search.id, { exact: e.target.checked })
        }
      />
      <button
        className="icon danger-icon"
        title={`Remove the ${search.name} search`}
        onClick={() => removeSavedSearch(search.id)}
      >
        <X size={16} strokeWidth={1.75} aria-hidden />
      </button>
    </>
  );
}

/** The blank line at the bottom. Kept apart from the saved ones so a
 *  half-written search is not in the palette while it is being written. */
function NewSearch({
  fields,
  projects,
}: {
  fields: string[] | null;
  projects: ProjectSummary[] | null;
}) {
  const [name, setName] = useState("");
  const [field, setField] = useState("");
  const [exact, setExact] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);

  const ready = name.trim() !== "" && field !== "";

  function add() {
    if (!ready) return;
    addSavedSearch({ name, field, exact, excludedProjects: excluded });
    setName("");
    setField("");
    setExact(false);
    setExcluded([]);
  }

  return (
    <>
      <input
        type="text"
        aria-label="Name"
        placeholder="Plant number"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <FieldPicker
        label="Field to search"
        fields={fields}
        value={field}
        onChange={setField}
      />
      <ProjectPicker
        label="Leave these projects out"
        projects={projects}
        excluded={excluded}
        onChange={setExcluded}
      />
      <input
        type="checkbox"
        aria-label="Match the whole value"
        checked={exact}
        onChange={(e) => setExact(e.target.checked)}
      />
      <button
        type="button"
        className="secondary"
        onClick={add}
        disabled={!ready}
      >
        Add
      </button>
    </>
  );
}

/** The site's fields, by name. The name is what is stored: it is what the user
 *  recognises, and the Rust side resolves it to an id before it builds any JQL,
 *  which is what keeps an exact spelling from mattering. */
function FieldPicker({
  label,
  fields,
  value,
  onChange,
}: {
  label: string;
  fields: string[] | null;
  value: string;
  onChange: (field: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={fields === null}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">
        {fields === null ? "Loading fields…" : "Pick a field…"}
      </option>
      {/* A field that has since been renamed or removed on the site would
          otherwise vanish from its own search, silently. */}
      {value !== "" && !fields?.includes(value) && (
        <option value={value}>{value} (not on this site)</option>
      )}
      {fields?.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

/**
 * Which projects to leave out.
 *
 * Checkboxes in a box that scrolls, rather than a `select multiple`: choosing
 * several from one of those needs a held modifier, which is a thing people either
 * know or silently cannot do. The box is capped at about three rows, so a site
 * with twenty projects costs the same height as one with two — which is what this
 * setting being the tallest thing on the screen was about.
 */
function ProjectPicker({
  label,
  projects,
  excluded,
  onChange,
}: {
  label: string;
  projects: ProjectSummary[] | null;
  excluded: string[];
  onChange: (keys: string[]) => void;
}) {
  if (projects === null) return <span className="muted">Loading…</span>;
  return (
    <div className="project-exclude" role="group" aria-label={label}>
      {projects.map((p) => (
        // The name is cut to the column's width, so the whole of it lives on the
        // tooltip — a cut name is enough to recognise, not always enough to be
        // sure by.
        <label className="checkbox" key={p.key} title={`${p.key} · ${p.name}`}>
          <input
            type="checkbox"
            checked={excluded.includes(p.key)}
            onChange={() =>
              onChange(
                excluded.includes(p.key)
                  ? excluded.filter((k) => k !== p.key)
                  : [...excluded, p.key],
              )
            }
          />
          <span>
            {p.key} · {p.name}
          </span>
        </label>
      ))}
    </div>
  );
}
