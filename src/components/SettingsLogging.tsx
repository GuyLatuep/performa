import { useState } from "react";
import { api } from "../api";
import { LOG_LEVELS, LogLevel } from "../log";
import { setLogLevel, useLogLevel } from "../settings";

/** Debug-log verbosity and a way to reach the log files. The level change is
 *  mirrored to the Rust side by the settings store. */
export default function SettingsLogging() {
  const logLevel = useLogLevel();
  const [error, setError] = useState<string | null>(null);

  async function openLogFolder() {
    setError(null);
    try {
      await api.openLogFolder();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="field-block">
      <span className="field-label">Logging</span>
      <div className="hours-field">
        <select
          value={logLevel}
          onChange={(e) => setLogLevel(e.target.value as LogLevel)}
        >
          {LOG_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </option>
          ))}
        </select>
        <button type="button" className="secondary" onClick={openLogFolder}>
          Open log folder
        </button>
      </div>
      <span className="hint">
        Debug log level · files are written to a temp folder, newest 3 kept
      </span>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
