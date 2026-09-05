import { WorklogEntry } from "../api";
import { formatDuration, today } from "../time";
import { useEffect } from "react";
import {
  useDailyHours,
  useFunMode,
  useShowWeekends,
  WORKDAYS_PER_WEEK,
} from "../settings";
import { rankFor } from "../rank";
import { recordEvent } from "../achievements";
import { weekBars } from "../weekBars";

/** Per-day bars against the daily target, plus a weekly progress ring. */
export default function WeekChart({
  start,
  entries,
}: {
  start: string;
  entries: WorklogEntry[];
}) {
  const dailyHours = useDailyHours();
  const showWeekends = useShowWeekends();
  const funMode = useFunMode();
  const dayTarget = dailyHours * 3600;
  const weekTarget = dayTarget * WORKDAYS_PER_WEEK;

  const { days, scaleMax, total, pct } = weekBars(start, entries, {
    dayTarget,
    showWeekends,
  });

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
          <div
            className="day-target"
            style={{ bottom: `${(dayTarget / scaleMax) * 100}%` }}
          >
            <span>{formatDuration(dayTarget)}</span>
          </div>
          {days.map((d) => (
            <div
              key={d.date}
              className="day-col"
              title={`${d.label} · ${formatDuration(d.seconds)}`}
            >
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
            className="gauge-edge"
            cx={60}
            cy={60}
            r={R}
            strokeDasharray={`${filled} ${CIRC - filled}`}
            transform="rotate(-90 60 60)"
          />
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
