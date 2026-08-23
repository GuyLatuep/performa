import {
  dismissNotice,
  ISSUE_VIEW_NOTICE,
  TODO_FILTER_NOTICE,
  useNoticePending,
} from "../notices";

interface Props {
  /** Open the settings screen on the Todo tab, so the user can set the filter
   *  up while the explanation is still on screen. */
  onOpenSettings: () => void;
}

/** One-off announcements, oldest first and one at a time.
 *
 *  Shown to everyone who hasn't seen them — an existing user on their first
 *  launch after an update, and a new user right after they connect. Two modals
 *  at once would be a pile; dismissing the first brings the second. */
export default function WhatsNew({ onOpenSettings }: Props) {
  const todoFilterPending = useNoticePending(TODO_FILTER_NOTICE);
  const issueViewPending = useNoticePending(ISSUE_VIEW_NOTICE);

  if (todoFilterPending)
    return <TodoFilterNotice onOpenSettings={onOpenSettings} />;
  if (issueViewPending) return <IssueViewNotice />;
  return null;
}

/** The issue view, and that its fields are the user's to arrange. */
function IssueViewNotice() {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>Issues now open in the app</h3>
        <p className="modal-sub">
          Clicking an issue on the Todo tab used to jump straight to the
          log-work form. It now opens the issue itself: description, comments,
          attachments and its history, with the status picker in the corner. You
          can comment, move it through its workflow and log time without
          leaving.
        </p>
        <p className="modal-sub">
          Which fields it shows is yours to decide. Open any issue and use{" "}
          <strong>Arrange fields</strong> above them — drag them into the order
          you want, resize them, remove the ones you never read, and add any
          other field your Jira has.
        </p>
        <div className="row">
          <button onClick={() => dismissNotice(ISSUE_VIEW_NOTICE)}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function TodoFilterNotice({ onOpenSettings }: Props) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>The Todo tab now filters itself</h3>
        <p className="modal-sub">
          It used to hide a fixed list of status names baked into the app, which
          only ever matched one team's workflow. Now it hides everything Jira
          itself counts as done — whatever your workflow calls those statuses.
        </p>
        <p className="modal-sub">
          Anything else that shouldn&apos;t be on your list — a review queue,
          &quot;waiting for customer&quot; — is yours to choose under{" "}
          <strong>Settings → Todo</strong>, per project. Nothing is hidden until
          you do, so expect a longer list until then. Set one project up and
          copy it to the others.
        </p>
        <div className="row">
          <button
            className="secondary"
            onClick={() => dismissNotice(TODO_FILTER_NOTICE)}
          >
            Later
          </button>
          <button
            onClick={() => {
              dismissNotice(TODO_FILTER_NOTICE);
              onOpenSettings();
            }}
          >
            Set it up
          </button>
        </div>
      </div>
    </div>
  );
}
