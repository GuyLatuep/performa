import { X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  addSavedSearch,
  hasSearchTerm,
  removeSavedSearch,
  SavedSearch,
  SEARCH_TERM_PLACEHOLDER,
  updateSavedSearch,
  useSavedSearches,
} from "../savedSearches";

/**
 * The searches the user builds for themselves.
 *
 * What is worth searching is a property of the Jira site, not of this app, so
 * none are shipped: a site with a plant number wants one search and a site with
 * a customer reference wants another. Each one written here shows up in the
 * command palette as "Search by <name>".
 *
 * A search is a name and a JQL query with a placeholder where the typed term
 * goes. JQL rather than a form of pickers because it says everything a search
 * could want — which projects, which fields, which order — in the language the
 * user already writes filters in on the site.
 *
 * Laid out as a table: one header row names the columns once, a search is then
 * one line, and the blank line at the bottom is how another is added.
 */
export default function SettingsSearches() {
  const searches = useSavedSearches();

  return (
    <div className="field-block">
      <span className="field-label">Searches in the command palette</span>

      <div className="search-grid">
        <span className="field-label">Name</span>
        <span className="field-label">JQL</span>
        <span />

        {searches.map((search) => (
          <SearchRow key={search.id} search={search} />
        ))}

        <NewSearch />
      </div>

      <span className="hint">
        Each one becomes “Search by …” in the palette (⌘P); searching plain text
        is always offered and needs no setting up. Write{" "}
        <code>{SEARCH_TERM_PLACEHOLDER}</code> where the text you type goes — on
        its own it is quoted for you, as in{" "}
        <code>"Plant no." ~ {SEARCH_TERM_PLACEHOLDER}</code>; inside quotes it
        leaves the rest of the string alone, so{" "}
        <code>"{SEARCH_TERM_PLACEHOLDER}*"</code> matches anything starting with
        it.
      </span>
    </div>
  );
}

/**
 * A text box that holds its value until it is left.
 *
 * Neither control here writes through on every keystroke. A search with no name
 * or no JQL is dropped when the list is next read, so persisting mid-edit means
 * select-all-and-retype — an ordinary way to change something — leaves the app
 * one quit away from losing the search. Held here instead and committed on blur
 * or Enter.
 */
function useCommitted(
  stored: string,
  commit: (value: string) => void,
): {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
} {
  const [value, setValue] = useState(stored);
  useEffect(() => setValue(stored), [stored]);
  return {
    value,
    onChange: (e) => setValue(e.target.value),
    onBlur: () => {
      commit(value);
      // An empty box is refused by the store, so put back what it still holds
      // rather than leaving the input disagreeing with the list.
      setValue((typed) => (typed.trim() === "" ? stored : typed));
    },
    onKeyDown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.currentTarget.blur();
      }
    },
  };
}

/** One saved search, editable in place. The labels are built from the *stored*
 *  name, so a screen reader is not re-announcing the field on every letter. */
function SearchRow({ search }: { search: SavedSearch }) {
  const name = useCommitted(search.name, (value) =>
    updateSavedSearch(search.id, { name: value }),
  );
  const jql = useCommitted(search.jql, (value) =>
    updateSavedSearch(search.id, { jql: value }),
  );

  return (
    <>
      <input
        type="text"
        aria-label={`Name of the ${search.name} search`}
        {...name}
      />
      <JqlBox label={`JQL the ${search.name} search runs`} {...jql} />
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
function NewSearch() {
  const [name, setName] = useState("");
  const [jql, setJql] = useState("");

  const ready = name.trim() !== "" && hasSearchTerm(jql);

  function add() {
    if (!ready) return;
    addSavedSearch({ name, jql });
    setName("");
    setJql("");
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
      <JqlBox
        label="JQL to run"
        placeholder={`project in (CTS, DEV) AND "Plant no." ~ ${SEARCH_TERM_PLACEHOLDER} ORDER BY created ASC`}
        value={jql}
        onChange={(e) => setJql(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        // Blank is not yet a mistake here; only JQL that forgot the term is.
        invalid={jql.trim() !== "" && !hasSearchTerm(jql)}
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

/**
 * The query box. Marked when the JQL has nowhere to put the term, since that
 * search would find the same issues whatever is typed — the Rust side refuses to
 * run it, and saying so here is sooner.
 */
function JqlBox({
  label,
  value,
  invalid = !hasSearchTerm(value),
  ...rest
}: {
  label: string;
  value: string;
  placeholder?: string;
  invalid?: boolean;
  onChange: (e: { target: { value: string } }) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <textarea
      className="search-jql"
      aria-label={label}
      aria-invalid={invalid}
      title={
        invalid
          ? `Needs ${SEARCH_TERM_PLACEHOLDER} where the term goes`
          : undefined
      }
      rows={2}
      spellCheck={false}
      value={value}
      {...rest}
    />
  );
}
