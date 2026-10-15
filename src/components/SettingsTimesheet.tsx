import { X } from "lucide-react";
import { useState } from "react";
import { setShowWeekends, useShowWeekends } from "../settings";
import { formatDayLabel, toDateInput, today } from "../time";
import {
  ABSENCE_KINDS,
  AbsenceKind,
  addAbsences,
  GERMAN_STATES,
  GermanState,
  getWorkCalendar,
  removeAbsence,
  setHolidayState,
  setWeekdayHours,
  useAbsences,
  useHolidayState,
  useWeekdayHours,
  WEEKDAY_NAMES,
  workdaysBetween,
} from "../workdays";

/** What the timesheet measures against — the Daily target per weekday, the
 *  Holidays of a state, the user's own Absences — plus which days it shows. */
export default function SettingsTimesheet() {
  const showWeekends = useShowWeekends();

  return (
    <>
      <WeekdayHours />

      <div className="field-block">
        <span className="field-label">Timesheet days</span>
        <div className="theme-toggle">
          <button
            type="button"
            className={showWeekends ? "" : "active"}
            onClick={() => setShowWeekends(false)}
          >
            Mon–Fri
          </button>
          <button
            type="button"
            className={showWeekends ? "active" : ""}
            onClick={() => setShowWeekends(true)}
          >
            Full week
          </button>
        </div>
      </div>

      <HolidayState />
      <Absences />
    </>
  );
}

/** Seven boxes, Monday first. Kept as raw text while typing so a half-typed
 *  "7." is not rewritten under the cursor; each box snaps back to the stored
 *  value when left. */
function WeekdayHours() {
  const stored = useWeekdayHours();
  const [text, setText] = useState(() => stored.map(String));

  function change(index: number, value: string) {
    setText((t) => t.map((v, i) => (i === index ? value : v)));
    const n = parseFloat(value);
    if (!Number.isFinite(n) || n < 0 || n > 24) return;
    setWeekdayHours(stored.map((h, i) => (i === index ? n : h)));
  }

  return (
    <div className="field-block">
      <span className="field-label">Work hours per day</span>
      <div className="weekday-hours">
        {WEEKDAY_NAMES.map((name, i) => (
          <label key={name}>
            <span>{name}</span>
            <input
              type="number"
              aria-label={`${name} hours`}
              min={0}
              max={24}
              step={0.5}
              value={text[i]}
              onChange={(e) => change(i, e.target.value)}
              onBlur={() =>
                setText((t) =>
                  t.map((v, j) => (j === i ? String(stored[i]) : v)),
                )
              }
            />
          </label>
        ))}
      </div>
      <span className="hint">
        h each day · the timesheet measures every day against its own
      </span>
    </div>
  );
}

function HolidayState() {
  const state = useHolidayState();
  return (
    <div className="field-block">
      <span className="field-label">Public holidays</span>
      <div className="hours-field">
        <select
          aria-label="Public holidays"
          value={state ?? ""}
          onChange={(e) =>
            setHolidayState((e.target.value || null) as GermanState | null)
          }
        >
          <option value="">None</option>
          {GERMAN_STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="hint">statewide legal holidays count as days off</span>
      </div>
    </div>
  );
}

/** Days off of the user's own: one date, or a stretch of them, whole or half.
 *  Not part of Cancel's rollback — like searches, they are records, not a
 *  preview. */
function Absences() {
  const absences = useAbsences();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState("");
  const [portion, setPortion] = useState<1 | 0.5>(1);
  const [kind, setKind] = useState<AbsenceKind>("vacation");
  const [note, setNote] = useState<string | null>(null);

  function add() {
    const dates =
      to && to !== from ? workdaysBetween(from, to, getWorkCalendar()) : [from];
    if (dates.length === 0) {
      setNote("No working days in that stretch.");
      return;
    }
    addAbsences(dates.map((date) => ({ date, portion, kind })));
    setNote(null);
    setTo("");
  }

  // The recent past and everything ahead; older entries still count, they
  // just do not need to fill the screen.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 62);
  const since = toDateInput(cutoff);
  const shown = absences.filter((a) => a.date >= since);

  return (
    <div className="field-block">
      <span className="field-label">Days off</span>
      <div className="absence-form">
        <input
          type="date"
          aria-label="Day off from"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          aria-label="Day off until"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
        <select
          aria-label="How much of the day"
          value={String(portion)}
          onChange={(e) => setPortion(e.target.value === "0.5" ? 0.5 : 1)}
        >
          <option value="1">Whole day</option>
          <option value="0.5">Half day</option>
        </select>
        <select
          aria-label="Kind of day off"
          value={kind}
          onChange={(e) => setKind(e.target.value as AbsenceKind)}
        >
          {ABSENCE_KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <button type="button" className="secondary" onClick={add}>
          Add
        </button>
      </div>
      {note && <p className="hint">{note}</p>}
      <span className="hint">
        a day off lowers that day's target — half a day, by half · a stretch
        skips weekends and holidays
      </span>
      {shown.length > 0 && (
        <ul className="absence-list" aria-label="Days off">
          {shown.map((a) => (
            <li key={a.date}>
              <span>
                {formatDayLabel(a.date, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              <span className="hint">
                {ABSENCE_KINDS.find((k) => k.kind === a.kind)?.label}
                {a.portion === 0.5 ? ", half day" : ""}
              </span>
              <button
                type="button"
                className="icon"
                title={`Remove ${a.date}`}
                aria-label={`Remove ${a.date}`}
                onClick={() => removeAbsence(a.date)}
              >
                <X size={14} strokeWidth={2} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
