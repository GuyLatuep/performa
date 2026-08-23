import React, { useEffect, useRef, useState } from "react";
import { api, JiraUser } from "../api";
import { CommentAction } from "../comments";
import {
  activeMentionQuery,
  applyMention,
  deleteMentionBefore,
  PickedMention,
  usedMentions,
} from "../mentionInput";
import CommentMirror from "./CommentMirror";
import MentionPicker from "./MentionPicker";
import { logInfo } from "../log";
import { recordEvent } from "../achievements";
import { useDismissOnOutside } from "../dismiss";

/** Write one comment, of the kind the row selected. Which kinds exist at all
 *  is a property of the issue — see `commentActions`. */
export default function CommentPanel({
  issueKey,
  action,
  serviceDesk,
  onPosted,
}: {
  issueKey: string;
  action: CommentAction;
  serviceDesk: boolean;
  onPosted: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Everyone picked so far. Whether each is really mentioned is decided at
   *  submit from the text as it then stands — see `usedMentions`. */
  const [picked, setPicked] = useState<PickedMention[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [matches, setMatches] = useState<JiraUser[]>([]);
  /** Which result the keyboard is on. Mouse hover moves it too, so the two
   *  never disagree about what Enter would pick. */
  const [active, setActive] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const compose = useRef<HTMLDivElement>(null);

  useDismissOnOutside(compose, () => setQuery(null), query !== null);

  // Debounced: the picker follows keystrokes, and one request per character
  // would be a request per character.
  useEffect(() => {
    if (query === null) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.searchUsers(query).then(
        (users) => {
          if (cancelled) return;
          setMatches(users);
          // A new result set starts at the top; keeping the old index would
          // leave the highlight on whoever happens to sit at that position.
          setActive(0);
        },
        // A failed lookup must not cost the writer their comment; the picker
        // just stays empty.
        () => !cancelled && setMatches([]),
      );
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  function edit(value: string, caret: number) {
    setText(value);
    setQuery(activeMentionQuery(value, caret, picked));
  }

  /** Drives the picker while it is open, and otherwise lets Backspace remove
   *  a whole mention. */
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const open = query !== null && matches.length > 0;

    if (query !== null && e.key === "Escape") {
      e.preventDefault();
      setQuery(null);
      return;
    }

    if (open) {
      // These keys belong to the list while it is up: Enter must choose a name
      // rather than break the line, and the arrows must not move the caret out
      // from under the query being typed.
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        choose(matches[active] ?? matches[0]);
        return;
      }
    }

    if (e.key !== "Backspace") return;
    const el = e.currentTarget;
    // Only for a plain caret: a selection means the user has said exactly what
    // to delete.
    if (el.selectionStart !== el.selectionEnd) return;
    const removed = deleteMentionBefore(text, el.selectionStart, picked);
    if (!removed) return;
    e.preventDefault();
    setText(removed.text);
    setQuery(activeMentionQuery(removed.text, removed.caret, picked));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(removed.caret, removed.caret);
    });
  }

  function choose(user: JiraUser) {
    // Only ever replaces the fragment being typed. Without this a stray click
    // once the picker has closed would rewrite whichever mention happens to
    // sit before the caret.
    if (query === null) return;
    const caret = box.current?.selectionStart ?? text.length;
    const next = applyMention(text, caret, user);
    setText(next.text);
    setPicked((p) => [
      ...p,
      { accountId: user.accountId, name: user.displayName },
    ]);
    setQuery(null);
    // Put the caret back where the writer was, after React has the new value.
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  async function post() {
    setBusy(true);
    setError(null);
    try {
      const mentions = usedMentions(text, picked);
      await api.addComment(issueKey, text, action.public, mentions);
      recordEvent({ kind: "commented" });
      logInfo(
        `posted ${action.label.toLowerCase()} on ${issueKey}` +
          `${mentions.length > 0 ? ` mentioning ${mentions.length}` : ""}`,
      );
      setText("");
      setPicked([]);
      onPosted();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="action-panel">
      <div className="comment-compose" ref={compose}>
        <CommentMirror ref={mirror} text={text} picked={picked} />
        <textarea
          ref={box}
          className="comment-box"
          rows={4}
          value={text}
          autoFocus
          placeholder={action.title}
          onChange={(e) => edit(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          // The caret can move without the text changing, and the picker
          // follows the caret.
          onKeyUp={(e) =>
            edit(e.currentTarget.value, e.currentTarget.selectionStart)
          }
          onClick={(e) =>
            edit(e.currentTarget.value, e.currentTarget.selectionStart)
          }
          onScroll={(e) => {
            if (mirror.current)
              mirror.current.scrollTop = e.currentTarget.scrollTop;
          }}
        />
        {query !== null && matches.length > 0 && (
          <MentionPicker
            matches={matches}
            active={active}
            onHover={setActive}
            onChoose={choose}
          />
        )}
      </div>

      <p className="hint">
        Type <code>@</code> to mention somebody. Only names picked from the list
        notify anyone — typed ones stay plain text.
      </p>

      {error && <p className="error">{error}</p>}
      <div className="panel-actions">
        <button onClick={post} disabled={busy || text.trim() === ""}>
          {busy ? "Posting…" : action.label}
        </button>
        {serviceDesk && <span className="hint">{action.title}.</span>}
      </div>
    </div>
  );
}
