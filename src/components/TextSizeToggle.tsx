import { useTextScale, TextScale } from "../textScale";

const OPTIONS: { value: TextScale; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
  { value: "larger", label: "Larger" },
];

export default function TextSizeToggle() {
  const [scale, setScale] = useTextScale();
  return (
    <div className="theme-toggle" role="group" aria-label="Text size">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={scale === opt.value ? "active" : ""}
          aria-pressed={scale === opt.value}
          onClick={() => setScale(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
