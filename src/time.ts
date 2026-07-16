/** Parse a Jira-style duration ("1h 30m", "45m", "2h", "1.5h") into seconds.
 *  Decimal commas ("0,25h") are accepted as well.
 *  Returns null if nothing parseable is found. */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/,/g, ".");
  if (!text) return null;

  let seconds = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)\s*([wdhm])/g;
  const unit: Record<string, number> = {
    w: 5 * 8 * 3600, // Jira default working week
    d: 8 * 3600, // Jira default working day
    h: 3600,
    m: 60,
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matched = true;
    seconds += parseFloat(m[1]) * unit[m[2]];
  }

  // Bare number ⇒ interpret as hours.
  if (!matched) {
    const n = parseFloat(text);
    if (!Number.isNaN(n)) {
      seconds = n * 3600;
      matched = true;
    }
  }

  if (!matched || seconds <= 0) return null;
  return Math.round(seconds);
}

/** Format seconds as a compact "1h 30m" string. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(" ") || "0m";
}

/** Local date as yyyy-MM-dd. */
export function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export function today(): string {
  return toDateInput(new Date());
}

/** Local time-of-day as HH:mm. */
export function toTimeInput(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function nowTime(): string {
  return toTimeInput(new Date());
}

/** yyyy-MM-dd for the Monday of the week containing `d`. */
export function startOfWeek(d: Date): string {
  const copy = new Date(d);
  const day = (copy.getDay() + 6) % 7; // Monday = 0
  copy.setDate(copy.getDate() - day);
  return toDateInput(copy);
}
