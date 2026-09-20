import { useIssueTypeIcon } from "../issueTypeIcons";
import { useShowIssueTypeIcons } from "../settings";

/** Jira's own icon for an issue's type.
 *
 *  The cell is drawn whether or not there is an icon in it — while one is being
 *  fetched, when a type carries none, and on a list that didn't ask for the
 *  type at all. An empty box of the same size is what keeps a late-arriving
 *  icon from shifting the row it lands in.
 *
 *  Like `DueBadge`, the name is in the tooltip rather than beside the mark: the
 *  column earns its width by staying narrow. Turned off in Appearance, the cell
 *  goes away entirely rather than sitting there empty.
 *
 *  Shared by every list that shows a type — the issue rows and the month
 *  matrix — so one setting and one cache serve all of them. */
export default function TypeIcon({
  type,
  url,
}: {
  type?: string;
  url?: string;
}) {
  const shown = useShowIssueTypeIcons();
  // Nothing is fetched while the setting is off — the cell isn't drawn, so an
  // icon for it would be a request for something nobody can see.
  const icon = useIssueTypeIcon(shown ? url : undefined);
  if (!shown) return null;
  return (
    <span className="type-icon" title={type ? `Type: ${type}` : undefined}>
      {icon && <img src={icon} alt={type ?? ""} />}
    </span>
  );
}
