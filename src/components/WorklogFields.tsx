import { useCallback, useState } from "react";
import { formatDuration, nowTime, parseDuration, today } from "../time";

// The duration/date/time/comment quartet shared by every place that logs or
// edits work: the log-work form, the timer stop modal, the missing-worklog
// form, and the timesheet edit modal.

export interface WorklogDraft {
  duration: string;
  date: string; // yyyy-MM-dd
  time: string; // HH:mm
  comment: string;
}

export const DURATION_ERROR = "Enter a valid duration, e.g. 1h 30m";

export function useWorklogDraft(initial: Partial<WorklogDraft> = {}) {
  const [draft, setDraft] = useState<WorklogDraft>({
    duration: initial.duration ?? "",
    date: initial.date ?? today(),
    time: initial.time ?? nowTime(),
    comment: initial.comment ?? "",
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
  return (
    <>
      <label>
        {durationLabel}
        <input
          type="text"
          placeholder="1h 30m"
          value={draft.duration}
          onChange={(e) => patch({ duration: e.target.value })}
          autoFocus
        />
        {seconds !== null && (
          <span className="hint">= {formatDuration(seconds)}</span>
        )}
      </label>

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
    </>
  );
}
