import { useEffect, useMemo, useRef, useState } from "react";
import { ActionSpec, allActions, filterActions, typedAction } from "../actions";
import { overlayOpen } from "../keys";
import { matchShortcut } from "../shortcuts";

/**
 * Every action in the app, by name.
 *
 * The badges teach the chords for what is on screen; this is for the rest — the
 * verbs with no key of their own, and the ones you have not learned yet. It
 * shows each entry's chord beside it, so using it is also how you stop needing
 * it.
 *
 * Rendered as the app's ordinary modal, which buys two things for nothing: it
 * looks like every other sheet, and `overlayOpen()` suppresses the navigation
 * chords, the shortcut catalogue and the list arrows while it is up — so the
 * palette's own keys are the only ones in play without it having to arrange
 * that.
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  /** Read once per opening: the registry changes as controls mount, and a list
   *  that reshuffled under the cursor while being read would be unusable. */
  const [actions, setActions] = useState<ActionSpec[]>([]);
  /** The action now asking for a term, if one is. While this is set the field
   *  holds an argument rather than a filter. */
  const [asking, setAsking] = useState<ActionSpec | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (matchShortcut(e) !== "palette") return;
      // Not over a modal: one sheet at a time, and the palette cannot offer the
      // controls behind one anyway.
      if (!open && overlayOpen()) return;
      e.preventDefault();
      setOpen((was) => {
        if (!was) {
          setActions(allActions());
          setQuery("");
          setActive(0);
          setAsking(null);
        }
        return !was;
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const matches = useMemo(() => {
    const found = filterActions(actions, query);
    // An issue key leads, because it is the one thing the query *is* rather than
    // something it resembles: having typed PERF-12 in full, opening PERF-12 is
    // not a guess about what was meant.
    const typed = typedAction(query);
    return typed ? [typed, ...found] : found;
  }, [actions, query]);

  // The active row can be past the end after a keystroke narrows the list.
  const at = Math.min(active, Math.max(0, matches.length - 1));
  const activeItem = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeItem.current?.scrollIntoView({ block: "nearest" });
  }, [at]);

  if (!open) return null;

  function close() {
    setOpen(false);
  }

  function run(action: ActionSpec) {
    // An action that needs a term does not run yet — it asks. The field empties
    // so that what was typed to *find* this action is not mistaken for the
    // argument to it.
    if (action.prompt) {
      setAsking(action);
      setQuery("");
      setActive(0);
      return;
    }
    // Closed first: an action that opens a sheet of its own would otherwise find
    // this one still over it.
    setOpen(false);
    action.run?.();
  }

  /** The term, as the asking action reads it — null while it is not usable yet. */
  const argument = asking?.prompt ? asking.prompt.parse(query) : null;

  function submitArgument() {
    if (!asking?.prompt || argument === null) return;
    setOpen(false);
    asking.prompt.submit(argument);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (asking) {
      if (e.key === "Enter") {
        e.preventDefault();
        submitArgument();
      } else if (e.key === "Escape") {
        // Back to the list rather than out of the palette: having picked the
        // wrong one of two searches, the other is one press away.
        e.preventDefault();
        setAsking(null);
        setQuery("");
        setActive(0);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(at + 1 >= matches.length ? 0 : at + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(at - 1 < 0 ? matches.length - 1 : at - 1);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (matches[at]) run(matches[at]);
    } else if (e.key === "Escape") {
      // Claimed, so the navigation layer does not also take it as a way back.
      e.preventDefault();
      close();
    }
  }

  // Headings only where the group changes, so the list reads as sections without
  // anything having to group it first.
  let lastGroup = "";

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal wide command-palette"
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          autoFocus
          autoComplete="off"
          aria-label={asking?.prompt ? asking.prompt.title : "Find a command"}
          placeholder={
            asking?.prompt
              ? asking.prompt.placeholder
              : "What do you want to do?"
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {asking?.prompt ? (
          <p className="command-hint">
            {argument === null
              ? `${asking.prompt.title} — e.g. ${asking.prompt.placeholder}`
              : `Press Enter to search for ${argument}`}
          </p>
        ) : matches.length === 0 ? (
          <p className="muted empty">Nothing matches.</p>
        ) : (
          <ul className="mention-picker command-list" role="listbox">
            {matches.map((action, i) => {
              const heading = action.group !== lastGroup ? action.group : null;
              lastGroup = action.group;
              return (
                <li key={action.id}>
                  {heading && <p className="command-group">{heading}</p>}
                  <button
                    ref={i === at ? activeItem : undefined}
                    role="option"
                    aria-selected={i === at}
                    className={`mention-option${i === at ? " active" : ""}`}
                    onMouseDown={(e) => {
                      // The input would blur first on a plain click, and the
                      // palette would close before the press landed.
                      e.preventDefault();
                      run(action);
                    }}
                    onMouseEnter={() => setActive(i)}
                  >
                    <span className="command-name">{action.name}</span>
                    {action.chord && (
                      <span className="command-chord">{action.chord}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
