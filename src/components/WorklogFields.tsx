import { useCallback, useState } from "react";
import { WorklogInput } from "../api";
import { formatDuration, nowTime, parseDuration, today } from "../time";

// The duration/date/time/comment quartet shared by every place that logs or
// edits work: the log-work form, the timer stop modal, the missing-worklog
// form, and the timesheet edit modal.

export interface WorklogDraft {
  duration: string;
  date: string; // yyyy-MM-dd
  time: string; // HH:mm
  comment: string;
  nonBillable: boolean;
}

export const DURATION_ERROR = "Enter a valid duration, e.g. 1h 30m";

/** One-tap increments offered next to the duration preview, in seconds. */
const QUICK_DURATIONS = [15 * 60, 30 * 60, 60 * 60];

/** The draft as the backend's worklog payload. `seconds` comes from the
 *  parsed duration, which every caller has to validate first anyway — hence
 *  passing it in rather than re-parsing here. Note the inversion: the form
 *  asks for "non-billable", the API takes "billable". */
export function toWorklogInput(
  draft: WorklogDraft,
  seconds: number,
): WorklogInput {
  return {
    timeSpentSeconds: seconds,
    date: draft.date,
    time: draft.time,
    comment: draft.comment,
    billable: !draft.nonBillable,
  };
}

export function useWorklogDraft(initial: Partial<WorklogDraft> = {}) {
  const [draft, setDraft] = useState<WorklogDraft>({
    duration: initial.duration ?? "",
    date: initial.date ?? today(),
    time: initial.time ?? nowTime(),
    comment: initial.comment ?? "",
    nonBillable: initial.nonBillable ?? false,
  });
  const patch = useCallback(
    (p: Partial<WorklogDraft>) => setDraft((d) => ({ ...d, ...p })),
    [],
  );
  return { draft, patch, seconds: parseDuration(draft.duration) };
}

interface Props {
  draft: WorklogDraft;
  patch: (p: Partial<WorklogDraft>) => void;
  seconds: number | null;
  durationLabel?: string;
}

export function WorklogFields({
  draft,
  patch,
  seconds,
  durationLabel = "Time spent",
}: Props) {
  // Quick buttons add to whatever is already there, so "+30m" twice reads 1h.
  // An unparseable draft counts as zero rather than blocking the shortcut.
  const addDuration = (delta: number) =>
    patch({ duration: formatDuration((seconds ?? 0) + delta) });

  return (
    <>
      <div className="duration-field">
        <label>
          {durationLabel}
          <input
            type="text"
            placeholder="1h 30m"
            value={draft.duration}
            onChange={(e) => patch({ duration: e.target.value })}
            autoFocus
          />
        </label>
        <div className="duration-quick">
          {QUICK_DURATIONS.map((delta) => (
            <button
              key={delta}
              type="button"
              className="duration-add"
              onClick={() => addDuration(delta)}
            >
              +{formatDuration(delta)}
            </button>
          ))}
          {seconds !== null && (
            <span className="hint">= {formatDuration(seconds)}</span>
          )}
        </div>
      </div>

      <div className="field-row">
        <label>
          Date
          <input
            type="date"
            value={draft.date}
            max={today()}
            onChange={(e) => patch({ date: e.target.value })}
          />
        </label>
        <label>
          Start time
          <input
            type="time"
            value={draft.time}
            onChange={(e) => patch({ time: e.target.value })}
          />
        </label>
      </div>

      <label>
        Comment (optional)
        <textarea
          rows={3}
          value={draft.comment}
          onChange={(e) => patch({ comment: e.target.value })}
        />
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={draft.nonBillable}
          onChange={(e) => patch({ nonBillable: e.target.checked })}
        />
        Non-billable
      </label>
    </>
  );
}
