import { setTimesheetView, useTimesheetView } from "../settings";
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

  return (
    <>
      <div className="theme-toggle timesheet-view">
        <button
          type="button"
          className={view === "week" ? "active" : ""}
          onClick={() => setTimesheetView("week")}
        >
          Week
        </button>
        <button
          type="button"
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
    </>
  );
}
