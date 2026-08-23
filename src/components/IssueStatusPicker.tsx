import { Transition } from "../api";
import {
  offeredTransitions,
  OfferedTransition,
  statusOptionLabel,
  statusOptions,
} from "../transitions";

/** The issue's status, and the statuses it can move to.
 *
 *  A picker rather than a row of buttons: the current status is the thing a
 *  reader wants first, and the moves are a choice *from* it — which is what a
 *  select says and a row of buttons does not. Moves needing a screen are
 *  offered and open one; moves this app cannot complete stay in the list,
 *  disabled, because knowing a status exists but is out of reach here is worth
 *  more than a shorter list. */
export default function IssueStatusPicker({
  current,
  transitions,
  error,
  busy,
  onPick,
}: {
  current?: string;
  transitions: Transition[] | null;
  error: string | null;
  busy: boolean;
  onPick: (entry: OfferedTransition) => void;
}) {
  const label = current ?? "—";

  if (error)
    return (
      <div className="status-picker-box">
        <span className="status-current" title={error}>
          {label}
        </span>
        <span className="hint">workflow unavailable</span>
      </div>
    );

  const options = transitions
    ? statusOptions(offeredTransitions(transitions))
    : [];

  return (
    <div className="status-picker-box">
      <label htmlFor="status-picker">Status</label>
      <select
        id="status-picker"
        // Always parked on the current status: the select shows where the
        // issue *is*, and picking is what changes it. Leaving a chosen value
        // selected afterwards would claim the move had already happened.
        value=""
        disabled={busy || transitions === null || options.length === 0}
        onChange={(e) => {
          const picked = options.find((t) => t.id === e.target.value);
          if (picked) onPick(picked);
        }}
      >
        <option value="">{busy ? "Moving…" : label}</option>
        {options.map((entry) => (
          <option
            key={entry.id}
            value={entry.id}
            disabled={entry.mode === "blocked"}
            title={entry.title}
          >
            {statusOptionLabel(entry)}
            {entry.mode === "screen" ? " …" : ""}
            {entry.mode === "blocked" ? " (needs Jira)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
