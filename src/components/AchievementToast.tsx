import { useEffect, useState } from "react";

/** How long one stays up before making way for the next. */
const SHOW_MS = 4200;

/**
 * The queue of earned achievements, shown one at a time.
 *
 * A queue rather than a stack of boxes: one worklog can earn two at once — a
 * streak and a time of day — and two celebrations arriving together read as a
 * glitch rather than as twice the news.
 */
export default function AchievementToast({ queue }: { queue: string[] }) {
  const [shown, setShown] = useState<string[]>([]);

  // Appended rather than replaced: whatever is already up keeps its turn.
  useEffect(() => {
    if (queue.length > 0) setShown((s) => [...s, ...queue]);
  }, [queue]);

  useEffect(() => {
    if (shown.length === 0) return;
    const timer = window.setTimeout(() => setShown((s) => s.slice(1)), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);

  if (shown.length === 0) return null;
  return (
    <button
      className="achievement-toast"
      title="Wegklicken"
      onClick={() => setShown((s) => s.slice(1))}
    >
      <span className="achievement-mark">★</span>
      <span className="achievement-title">{shown[0]}</span>
      {shown.length > 1 && (
        <span className="achievement-more">+{shown.length - 1}</span>
      )}
    </button>
  );
}
