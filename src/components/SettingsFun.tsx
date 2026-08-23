import { setFunMode, useFunMode } from "../settings";

export default function SettingsFun() {
  const funMode = useFunMode();
  return (
    <div className="field-block">
      <label className="checkbox">
        <input
          type="checkbox"
          checked={funMode}
          onChange={(e) => setFunMode(e.target.checked)}
        />
        Fun mode
      </label>
    </div>
  );
}
