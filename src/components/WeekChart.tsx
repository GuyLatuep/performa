import { WorklogEntry } from "../api";
import { formatDuration, today } from "../time";
import { useEffect } from "react";
import { useFunMode, useShowWeekends } from "../settings";
import { dayInfo, useWorkCalendar } from "../workdays";
import { rankFor } from "../rank";
import { recordEvent } from "../achievements";
import { weekBars } from "../weekBars";

/** Per-day bars, each against its own Daily target, plus a weekly progress
 *  ring against the week's. */
export default function WeekChart({
  start,
  entries,
}: {
  start: string;
  entries: WorklogEntry[];
}) {
  const calendar = useWorkCalendar();
  const showWeekends = useShowWeekends();
  const funMode = useFunMode();

  const { days, scaleMax, weekTarget, total, pct } = weekBars(start, entries, {
    dayOf: (date) => dayInfo(date, calendar),
    showWeekends,
  });
  // The label rides on the last day with a target: the week's usual figure,
  // where the eye reads a reference line from.
  const labelled = [...days].reverse().find((d) => d.info.target > 0)?.date;

  // A full week is worth an award, awarded once like the rest.
  const reachedTarget = weekTarget > 0 && total >= weekTarget;
  useEffect(() => {
    if (funMode && reachedTarget) recordEvent({ kind: "weekTargetReached" });
  }, [funMode, reachedTarget]);

  const R = 48;
  const CIRC = 2 * Math.PI * R;
  const filled = Math.min(pct, 1) * CIRC;

  return (
    <div className="week-charts">
      {funMode && (
        <p className="week-rank" title="Diese Woche">
          {rankFor(total, weekTarget)}
        </p>
      )}
      <div className="day-bars">
        <div className="day-bars-plot">
          {days.map((d) => (
            <div
              key={d.date}
              className={`day-col${d.info.kind === "holiday" || (d.info.kind === "absence" && d.info.target === 0) ? " day-off" : ""}`}
              title={
                `${d.label} · ${formatDuration(d.seconds)}` +
                (d.info.target > 0
                  ? ` of ${formatDuration(d.info.target)}`
                  : "") +
                (d.info.label ? ` · ${d.info.label}` : "")
              }
            >
              {/* Each day's own target: a short Friday, a half day off and
                  a holiday all read at their own height, or not at all. */}
              {d.info.target > 0 && (
                <div
                  className="day-target"
                  style={{ bottom: `${(d.info.target / scaleMax) * 100}%` }}
                >
                  {d.date === labelled && (
                    <span>{formatDuration(d.info.target)}</span>
                  )}
                </div>
              )}
              {d.seconds > 0 && (
                <div
                  className="day-bar"
                  style={{
                    height: `${(d.seconds / scaleMax) * 100}%`,
                    minHeight: 6,
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="day-labels">
          {days.map((d) => (
            <span key={d.date} className={d.date === today() ? "today" : ""}>
              {d.label}
            </span>
          ))}
        </div>
      </div>

      <div
        className="week-gauge"
        title={`${formatDuration(total)} of ${formatDuration(weekTarget)}`}
      >
        <svg viewBox="0 0 120 120" role="img" aria-label="Week progress">
          <circle className="gauge-track" cx={60} cy={60} r={R} />
          <circle
            className="gauge-fill"
            cx={60}
            cy={60}
            r={R}
            strokeDasharray={`${filled} ${CIRC - filled}`}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div className="gauge-center">
          <strong>{Math.round(pct * 100)}%</strong>
          <span>of {formatDuration(weekTarget)}</span>
        </div>
      </div>
    </div>
  );
}
