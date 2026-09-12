import { useState } from "react";
import { commentActions } from "../comments";
import { useShortcut } from "../shortcuts";
import CommentPanel from "./CommentPanel";
import LogPanel from "./LogPanel";

/** What can be done to the issue from here, as one row.
 *
 *  The fields appear *after* a choice rather than before it: a textarea and a
 *  duration box stacked permanently are most of this view's height, and on any
 *  given visit at most one of them is wanted. Picking again closes the panel,
 *  so the row doubles as a way back to a short page. */
export default function IssueActions({
  issueKey,
  serviceDesk,
  onPosted,
  onLogged,
}: {
  issueKey: string;
  serviceDesk: boolean;
  onPosted: () => void;
  onLogged: () => void;
}) {
  /** The label of the open panel — the comment action's own name, or "Log
   *  work". Null when the row is just a row. */
  const [open, setOpen] = useState<string | null>(null);
  const actions = commentActions(serviceDesk);
  const chosen = actions.find((a) => a.label === open);

  /** Open that panel, or close it if it is the one already open — the same
   *  toggle the button does, so the key and the click cannot disagree. */
  const toggle = (label: string) =>
    setOpen((o) => (o === label ? null : label));

  // `actions` is one entry off a service desk and two on one, and a hook cannot
  // be called from a loop — so the two are bound by position. The first is
  // always the plain Comment or the Internal note; the second, where there is
  // one, is the customer reply.
  const commentKeys = useShortcut(
    "comment",
    () => toggle(actions[0].label),
    actions.length > 0,
  );
  const replyKeys = useShortcut(
    "replyToCustomer",
    () => toggle(actions[1]?.label ?? ""),
    actions.length > 1,
  );
  const logKeys = useShortcut("logWork", () => toggle(LOG_WORK));

  return (
    <>
      <div className="issue-actions">
        {actions.map((action, i) => (
          <button
            key={action.label}
            {...(i === 0 ? commentKeys : i === 1 ? replyKeys : {})}
            className={open === action.label ? undefined : "secondary"}
            title={action.title}
            onClick={() => toggle(action.label)}
          >
            {action.label}
          </button>
        ))}
        <button
          {...logKeys}
          className={open === LOG_WORK ? undefined : "secondary"}
          title="Record time against this issue"
          onClick={() => toggle(LOG_WORK)}
        >
          {LOG_WORK}
        </button>
      </div>

      {chosen && (
        <CommentPanel
          issueKey={issueKey}
          action={chosen}
          serviceDesk={serviceDesk}
          onPosted={() => {
            setOpen(null);
            onPosted();
          }}
        />
      )}
      {open === LOG_WORK && (
        <LogPanel
          issueKey={issueKey}
          onLogged={() => {
            setOpen(null);
            onLogged();
          }}
        />
      )}
    </>
  );
}

const LOG_WORK = "Log work";
