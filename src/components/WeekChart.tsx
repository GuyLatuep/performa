import { WorklogEntry } from "../api";
import { formatDuration, toDateInput, today } from "../time";
import { useDailyHours, useShowWeekends, WORKDAYS_PER_WEEK } from "../settings";

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
  const dayTarget = dailyHours * 3600;
  const weekTarget = dayTarget * WORKDAYS_PER_WEEK;

  const startDate = new Date(start + "T00:00:00");
  const allDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    return {
      date: toDateInput(d),
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
      seconds: 0,
    };
  });
  for (const e of entries) {
    const day = allDays.find((d) => d.date === e.date);
    if (day) day.seconds += e.timeSpentSeconds;
  }

  // Weekends are hidden by default, but a weekend day with logged time is
  // always shown so no bar silently disappears.
  const days = allDays.filter(
    (d, i) => i < WORKDAYS_PER_WEEK || showWeekends || d.seconds > 0,
  );

  const scaleMax = Math.max(dayTarget, ...days.map((d) => d.seconds), 1);
  const total = allDays.reduce((s, d) => s + d.seconds, 0);
  const pct = weekTarget > 0 ? total / weekTarget : 0;

  const R = 48;
  const CIRC = 2 * Math.PI * R;
  const filled = Math.min(pct, 1) * CIRC;

  return (
    <div className="week-charts">
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
