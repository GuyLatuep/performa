import { useState } from "react";
import {
  getDailyHours,
  setDailyHours,
  setShowWeekends,
  useShowWeekends,
} from "../settings";

/** Daily target hours and which days the timesheet shows — the two inputs
 *  behind the week chart's targets. */
export default function SettingsTimesheet() {
  // Kept as raw text while typing so intermediate states ("0.", "") don't get
  // rewritten under the cursor; the store only takes valid numbers, and the
  // field snaps back to the stored value on blur.
  const [hours, setHours] = useState(String(getDailyHours()));
  const showWeekends = useShowWeekends();

  return (
    <>
      <div className="field-block">
        <span className="field-label">Daily work hours</span>
        <div className="hours-field">
          <input
            type="number"
            min={0.5}
            max={24}
            step={0.5}
            value={hours}
            onChange={(e) => {
              setHours(e.target.value);
              setDailyHours(parseFloat(e.target.value));
            }}
            onBlur={() => setHours(String(getDailyHours()))}
          />
          <span className="hint">h per day · sets the timesheet targets</span>
        </div>
      </div>

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
    </>
  );
}
