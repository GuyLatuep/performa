import { ExternalLink, X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { openExternal } from "../external";
import { api, IssueSummary, LinkedItem, LinkRelation } from "../api";
import { useDismissOnOutside } from "../dismiss";
import { logInfo } from "../log";
import { useShortcut } from "../shortcuts";
import { typeaheadKey, useTypeahead } from "../typeahead";
import OptionList from "./OptionList";

/** The work items this issue is linked to, and a way to link another one.
 *
 *  Grouped by relationship, because that is what a link *is*: "blocks" and "is
 *  blocked by" are two different things to know about an issue, and a flat
 *  list mixing them reads as one pile of related keys. The relationship is
 *  named once per group rather than once per row for the same reason a heading
 *  is not repeated on every line under it. */
export default function IssueLinks({
  issueKey,
  site,
  links,
  onChanged,
  onOpen,
}: {
  issueKey: string;
  site: string;
  links: LinkedItem[];
  onChanged: () => void;
  /** Read the linked issue here, in this same view. */
  onOpen: (item: LinkedItem) => void;
}) {
  const [adding, setAdding] = useState(false);
  const startAdding = () => setAdding(true);
  // Only while the form is closed: once it is open the key has nothing left to
  // do, and the badge would sit on a button that is no longer there.
  const linkKeys = useShortcut("linkItem", startAdding, !adding);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  async function unlink(item: LinkedItem) {
    setRemoving(item.id);
    setError(null);
    try {
      await api.deleteIssueLink(item.id);
      logInfo(`unlinked ${item.key} from ${issueKey}`);
      onChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="issue-links">
      <ul className="link-list">
        {groupByRelation(links).map(([relation, items]) => (
          <li key={relation} className="link-group">
            <span className="link-relation">{relation}</span>
            <ul>
              {items.map((item) => (
                <li key={item.id || item.key}>
                  {/* The same split the mention rows use: the summary opens
                      the issue here, and the key stays the way out to Jira for
                      what this view cannot do. */}
                  <button
                    className="link linked-key"
                    title={`Open ${item.key} in browser`}
                    onClick={() => openExternal(`${site}/browse/${item.key}`)}
                  >
                    {item.key}
                    <ExternalLink size={13} strokeWidth={2} aria-hidden />
                  </button>
                  <button
                    className="linked-summary"
                    title={`Open ${item.key}`}
                    onClick={() => onOpen(item)}
                  >
                    {item.summary || item.key}
                  </button>
                  {item.status && (
                    <span className="linked-status">{item.status}</span>
                  )}
                  {/* One click, unlike deleting a file: this removes the
                      relationship and nothing else — both issues stay, and
                      linking them again costs the same two fields it did the
                      first time. */}
                  <button
                    className="icon link-remove"
                    title={`Unlink ${item.key} from ${issueKey}`}
                    disabled={removing !== null || busy || item.id === ""}
                    onClick={() => unlink(item)}
                  >
                    <X size={16} strokeWidth={1.75} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
        {links.length === 0 && (
          <li className="muted empty">No linked work items.</li>
        )}
      </ul>

      {error && <p className="error">{error}</p>}

      {adding ? (
        <LinkForm
          issueKey={issueKey}
          busy={busy}
          setBusy={setBusy}
          onFailed={setError}
          onLinked={() => {
            setAdding(false);
            setError(null);
            onChanged();
          }}
          onCancel={() => {
            setAdding(false);
            setError(null);
          }}
        />
      ) : (
        <div className="panel-actions">
          <button className="secondary" {...linkKeys} onClick={startAdding}>
            Link work item…
          </button>
        </div>
      )}
    </div>
  );
}

/** Pick a relationship and an issue, then link them.
 *
 *  Two fields in that order on purpose: the relationship decides what the
 *  sentence about the other issue will say, so choosing it first is choosing
 *  what is being asked about. */
function LinkForm({
  issueKey,
  busy,
  setBusy,
  onLinked,
  onFailed,
  onCancel,
}: {
  issueKey: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onLinked: () => void;
  onFailed: (message: string) => void;
  onCancel: () => void;
}) {
  const [relations, setRelations] = useState<LinkRelation[] | null>(null);
  const [picked, setPicked] = useState(0);
  const [chosen, setChosen] = useState<IssueSummary | null>(null);

  // Reference data, memoized in the api layer — the request only ever runs on
  // the first issue linked in a session.
  useEffect(() => {
    let cancelled = false;
    api.linkRelations().then(
      (r) => !cancelled && setRelations(r),
      (err) => !cancelled && onFailed(String(err)),
    );
    return () => {
      cancelled = true;
    };
    // Once per mount: the failure handler is the parent's setState, which is
    // stable, and re-running on a new identity would re-fetch for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const relation = relations?.[picked];

  async function submit() {
    if (!relation || !chosen) return;
    setBusy(true);
    onFailed("");
    try {
      await api.linkIssues(
        issueKey,
        chosen.key,
        relation.typeName,
        relation.direction,
      );
      logInfo(`linked ${issueKey} ${relation.label} ${chosen.key}`);
      onLinked();
    } catch (err) {
      onFailed(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="link-form">
      <label htmlFor="link-relation">This issue</label>
      <select
        id="link-relation"
        value={picked}
        disabled={busy || !relations}
        onChange={(e) => setPicked(Number(e.target.value))}
      >
        {relations ? (
          relations.map((r, i) => (
            <option key={`${r.typeName}:${r.direction}`} value={i}>
              {r.label}
            </option>
          ))
        ) : (
          <option value={0}>Loading…</option>
        )}
      </select>

      <IssuePicker
        disabled={busy}
        chosen={chosen}
        onChoose={setChosen}
        exclude={issueKey}
      />

      <div className="panel-actions">
        <button disabled={busy || !chosen || !relation} onClick={submit}>
          {busy ? "Linking…" : "Link"}
        </button>
        <button className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Find the other issue by key or by words from its summary.
 *
 *  A search rather than a list, like the user field: the issue to link to is
 *  as often one being worked on right now as one from this project, and
 *  neither is a set small enough to offer up front. */
function IssuePicker({
  disabled,
  chosen,
  onChoose,
  exclude,
}: {
  disabled: boolean;
  chosen: IssueSummary | null;
  onChoose: (issue: IssueSummary | null) => void;
  /** This issue: linking it to itself is the one match worth hiding. */
  exclude: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useDismissOnOutside(box, () => setOpen(false), open);

  const search = useCallback(
    (text: string) =>
      api
        .searchIssues(text)
        .then((found) =>
          found.filter((i) => i.key.toUpperCase() !== exclude.toUpperCase()),
        ),
    [exclude],
  );
  const issues = useTypeahead(
    open && query.trim() !== "" ? query : null,
    search,
  );

  function choose(issue: IssueSummary) {
    onChoose(issue);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (typeaheadKey(e.key, { ...issues, choose, close: () => setOpen(false) }))
      e.preventDefault();
  }

  // Once an issue is picked the box shows it instead of a query, for the
  // reason the user field does: a half-typed search beside a chosen issue
  // leaves it unclear which of the two would be linked.
  if (chosen) {
    return (
      <div className="issue-chosen">
        <span className="mention-name">{chosen.key}</span>
        <span className="mention-sub">{chosen.summary}</span>
        <button
          className="link"
          disabled={disabled}
          onClick={() => onChoose(null)}
        >
          change
        </button>
      </div>
    );
  }

  return (
    <div className="issue-select" ref={box}>
      <input
        type="text"
        value={query}
        disabled={disabled}
        placeholder="Issue key or words from its summary…"
        autoComplete="off"
        aria-label="Issue to link"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && issues.matches.length > 0 && (
        <OptionList
          options={issues.matches.map((issue) => ({
            key: issue.key,
            name: issue.key,
            sub: issue.summary,
          }))}
          active={issues.active}
          onHover={issues.setActive}
          onChoose={(i) => choose(issues.matches[i])}
        />
      )}
    </div>
  );
}

/** The links by relationship, each group in the order its first link arrived.
 *  Jira already returns them grouped; this holds that grouping even when it
 *  doesn't. */
export function groupByRelation(links: LinkedItem[]): [string, LinkedItem[]][] {
  const groups = new Map<string, LinkedItem[]>();
  for (const link of links) {
    const group = groups.get(link.relation);
    if (group) group.push(link);
    else groups.set(link.relation, [link]);
  }
  return [...groups];
}
