import { setShowIssueTypeIcons, useShowIssueTypeIcons } from "../settings";
import ThemeToggle from "./ThemeToggle";
import AccentPicker from "./AccentPicker";
import TextSizeToggle from "./TextSizeToggle";

/** Theme, accent colour, text size and what a list row shows. All apply to the
 *  app the moment they are picked (live preview); the settings shell restores
 *  them on Cancel. */
export default function SettingsAppearance() {
  const typeIcons = useShowIssueTypeIcons();
  return (
    <>
      <div className="field-block">
        <span className="field-label">Theme</span>
        <ThemeToggle />
      </div>

      <div className="field-block">
        <span className="field-label">Accent color</span>
        <AccentPicker />
      </div>

      <div className="field-block">
        <span className="field-label">Text size</span>
        <TextSizeToggle />
      </div>

      <div className="field-block">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={typeIcons}
            onChange={(e) => setShowIssueTypeIcons(e.target.checked)}
          />
          Show issue type icons in lists
        </label>
        <span className="hint">
          Jira's own icon for the issue type, in front of the key on every issue
          row.
        </span>
      </div>
    </>
  );
}
