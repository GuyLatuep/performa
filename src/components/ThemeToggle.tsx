import { Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme, Theme } from "../theme";

const OPTIONS: { value: Theme; label: string; Icon: LucideIcon }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
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
          <opt.Icon size={16} strokeWidth={1.75} aria-hidden />
          {opt.label}
        </button>
      ))}
    </div>
  );
}
