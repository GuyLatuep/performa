import { ACCENT_PRESETS, setAccent, useAccent } from "../accent";

export default function AccentPicker() {
  const accent = useAccent();
  const isPreset = ACCENT_PRESETS.some((preset) => preset.value === accent);

  return (
    <div className="accent-picker" role="group" aria-label="Accent color">
      {ACCENT_PRESETS.map((preset) => (
        <button
          key={preset.value}
          type="button"
          className={`accent-swatch${accent === preset.value ? " active" : ""}`}
          style={{ background: preset.value }}
          title={preset.label}
          aria-label={preset.label}
          aria-pressed={accent === preset.value}
          onClick={() => setAccent(preset.value)}
        />
      ))}
      <input
        type="color"
        className={`accent-swatch accent-custom${isPreset ? "" : " active"}`}
        value={accent}
        title="Custom color"
        aria-label="Custom accent color"
        onChange={(e) => setAccent(e.target.value)}
      />
    </div>
  );
}
