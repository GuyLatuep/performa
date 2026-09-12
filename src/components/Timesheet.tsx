import { setTimesheetView, useTimesheetView } from "../settings";
import { useShortcut } from "../shortcuts";
import TimesheetMonth from "./TimesheetMonth";
import TimesheetWeek from "./TimesheetWeek";

interface Props {
  site: string;
  refreshKey: number;
}

/**
 * The booked time, in one of two shapes.
 *
 * The week is a ledger — what happened, in order — which is the right thing
 * for checking a day. The month is a matrix of issues against days, which is
 * the right thing for filling the gaps in: it shows at a glance which days are
 * thin, and the cells are typed into directly.
 *
 * Each view keeps its own position, because a week offset and a month offset
 * are not the same unit and pretending otherwise would land the user somewhere
 * they didn't ask for. Switching starts at the current period.
 */
export default function Timesheet({ site, refreshKey }: Props) {
  const view = useTimesheetView();

  // One key for the pair, landing on whichever view is not showing — a toggle,
  // the way the timer's is, because two keys for two halves of one switch is one
  // key more than the reader has to remember.
  const viewKeys = useShortcut("timesheetView", () =>
    setTimesheetView(view === "week" ? "month" : "week"),
  );

  return (
    /* A named wrapper, not a fragment: the month grid fills the height it is
       given, and that needs a box in the chain to hand it one. */
    <div className={`timesheet timesheet-${view}`}>
      <div className="theme-toggle timesheet-view">
        {/* The badge rides on the half that is *not* active, which is where the
            key would take you. */}
        <button
          type="button"
          {...(view === "week" ? {} : viewKeys)}
          className={view === "week" ? "active" : ""}
          onClick={() => setTimesheetView("week")}
        >
          Week
        </button>
        <button
          type="button"
          {...(view === "month" ? {} : viewKeys)}
          className={view === "month" ? "active" : ""}
          onClick={() => setTimesheetView("month")}
        >
          Month
        </button>
      </div>
      {view === "week" ? (
        <TimesheetWeek site={site} refreshKey={refreshKey} />
      ) : (
        <TimesheetMonth site={site} refreshKey={refreshKey} />
      )}
    </div>
  );
}
