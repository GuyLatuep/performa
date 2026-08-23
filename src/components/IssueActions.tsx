import { useState } from "react";
import { commentActions } from "../comments";
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

  return (
    <>
      <div className="issue-actions">
        {actions.map((action) => (
          <button
            key={action.label}
            className={open === action.label ? undefined : "secondary"}
            title={action.title}
            onClick={() =>
              setOpen((o) => (o === action.label ? null : action.label))
            }
          >
            {action.label}
          </button>
        ))}
        <button
          className={open === LOG_WORK ? undefined : "secondary"}
          title="Record time against this issue"
          onClick={() => setOpen((o) => (o === LOG_WORK ? null : LOG_WORK))}
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
