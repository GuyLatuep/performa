import { useEffect, useRef, useState } from "react";
import { api, JiraUser } from "../api";
import { useDismissOnOutside } from "../dismiss";
import { userSubtitle } from "../mentionInput";

/**
 * Pick a person for a user field — an assignee, a reporter, an approver.
 *
 * A search rather than a dropdown: Jira sends no `allowedValues` for these,
 * because a site's user list is not something to enumerate into a `<select>`.
 * The value handed back is the account id, which is what identifies somebody;
 * the name shown beside it is only for the reader.
 */
export default function UserSelect({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  /** The chosen account id, or "" for nobody yet. */
  value: string;
  disabled: boolean;
  onChange: (accountId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<JiraUser[]>([]);
  const [chosen, setChosen] = useState<JiraUser | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const activeItem = useRef<HTMLLIElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useDismissOnOutside(box, () => setOpen(false), open);

  // Debounced, like the mention picker: one request per keystroke would be one
  // request per keystroke.
  useEffect(() => {
    if (!open || query.trim() === "") {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.searchUsers(query).then(
        (users) => {
          if (cancelled) return;
          setMatches(users);
          setActive(0);
        },
        // A failed lookup leaves the list empty rather than the field broken.
        () => !cancelled && setMatches([]),
      );
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, open]);

  useEffect(() => {
    activeItem.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(user: JiraUser) {
    setChosen(user);
    onChange(user.accountId);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      choose(matches[active] ?? matches[0]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  // Once somebody is picked the field shows them rather than a search box:
  // leaving a half-typed query beside a chosen name is the state that makes
  // people wonder which of the two counts.
  if (chosen && value === chosen.accountId) {
    return (
      <div className="user-chosen">
        <span className="mention-name">{chosen.displayName}</span>
        <button
          className="link"
          disabled={disabled}
          onClick={() => {
            setChosen(null);
            onChange("");
          }}
        >
          change
        </button>
      </div>
    );
  }

  return (
    <div className="user-select" ref={box}>
      <input
        id={id}
        type="text"
        value={query}
        disabled={disabled}
        placeholder="Search for a person…"
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && matches.length > 0 && (
        <ul className="mention-picker" role="listbox">
          {matches.map((user, i) => (
            <li key={user.accountId} ref={i === active ? activeItem : null}>
              <button
                role="option"
                aria-selected={i === active}
                className={`mention-option${i === active ? " active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(user);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="mention-name">{user.displayName}</span>
                <span className="mention-sub">{userSubtitle(user)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
