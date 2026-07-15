import { useTheme, Theme } from "../theme";

const OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀" },
  { value: "dark", label: "Dark", icon: "☾" },
];

export default function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Appearance">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={theme === opt.value ? "active" : ""}
          aria-pressed={theme === opt.value}
          onClick={() => setTheme(opt.value)}
        >
          <span aria-hidden="true">{opt.icon}</span> {opt.label}
        </button>
      ))}
    </div>
  );
}
