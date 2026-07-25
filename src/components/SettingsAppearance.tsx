import ThemeToggle from "./ThemeToggle";
import AccentPicker from "./AccentPicker";

/** Theme and accent colour. Both apply to the document the moment they are
 *  picked (live preview); the settings shell restores them on Cancel. */
export default function SettingsAppearance() {
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
    </>
  );
}
