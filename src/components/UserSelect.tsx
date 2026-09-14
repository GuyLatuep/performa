import React, { useRef, useState } from "react";
import { api, JiraUser } from "../api";
import { useDismissOnOutside } from "../dismiss";
import { userSubtitle } from "../mentionInput";
import { typeaheadKey, useTypeahead } from "../typeahead";
import OptionList from "./OptionList";

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
  const [chosen, setChosen] = useState<JiraUser | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useDismissOnOutside(box, () => setOpen(false), open);

  const people = useTypeahead(
    open && query.trim() !== "" ? query : null,
    api.searchUsers,
  );

  function choose(user: JiraUser) {
    setChosen(user);
    onChange(user.accountId);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (typeaheadKey(e.key, { ...people, choose, close: () => setOpen(false) }))
      e.preventDefault();
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
      {open && people.matches.length > 0 && (
        <OptionList
          options={people.matches.map((user) => ({
            key: user.accountId,
            name: user.displayName,
            sub: userSubtitle(user),
          }))}
          active={people.active}
          onHover={people.setActive}
          onChoose={(i) => choose(people.matches[i])}
        />
      )}
    </div>
  );
}
