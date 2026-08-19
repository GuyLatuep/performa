import {
  dismissNotice,
  TODO_FILTER_NOTICE,
  useNoticePending,
} from "../notices";

interface Props {
  /** Open the settings screen on the Todo tab, so the user can set the filter
   *  up while the explanation is still on screen. */
  onOpenSettings: () => void;
}

/** Explains the todo tab's new filtering, once. Shown to everyone who hasn't
 *  seen it — an existing user on their first launch after the update, and a
 *  new user right after they connect — because the tab now starts out hiding
 *  nothing and that is only obvious if somebody says so. */
export default function WhatsNew({ onOpenSettings }: Props) {
  const pending = useNoticePending(TODO_FILTER_NOTICE);
  if (!pending) return null;

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
