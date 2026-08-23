import { createStore } from "./store";

// One-off awards for things worth noticing. Modelled on ./notices: a set of
// ids, each earned once and never again — which is what separates an
// achievement from a notification. "Drei Tage in Folge" that toasted every
// third day forever would be a nag with a medal on it.

const KEY = "performa-achievements";

/** Every award there is. Ids are never reused: changing one re-awards it. */
export const ACHIEVEMENTS: Record<string, string> = {
  "erste-buchung": "Erste Buchung",
  "erster-kommentar": "Erster Kommentar",
  "erster-statuswechsel": "Erster Statuswechsel",
  "drei-tage": "Drei Tage in Folge",
  "fuenf-tage": "Fünf Tage in Folge",
  "woche-voll": "Woche voll",
  fruehaufsteher: "Frühaufsteher",
  nachtschicht: "Nachtschicht",
  "posteingang-leer": "Posteingang leer",
  "nichts-vergessen": "Nichts vergessen",
};

/** Before this hour, you were up early. */
const EARLY_BEFORE = 8;
/** From this hour, you were working late. */
const LATE_FROM = 18;

/** What is remembered between sessions. */
export interface AchievementState {
  earned: string[];
  /** yyyy-MM-dd of the last worklog filed, for the streak. */
  lastLoggedDate: string;
  /** Consecutive days with a worklog, counting the last one. */
  streak: number;
  /** Worklogs filed ever — what the every-tenth fanfare counts. */
  loggedCount: number;
}

export const EMPTY_STATE: AchievementState = {
  earned: [],
  lastLoggedDate: "",
  streak: 0,
  loggedCount: 0,
};

/** Something that might be worth an award. */
export type AchievementEvent =
  | {
      kind: "logged";
      /** The worklog's own date and time — when the work happened, which is
       *  not always when it was typed in. */
      date: string;
      time: string;
    }
  | { kind: "weekTargetReached" }
  | { kind: "commented" }
  | { kind: "transitioned" }
  | { kind: "mentionsEmpty" }
  | { kind: "missingEmpty" };

/**
 * The streak after a worklog on `date`.
 *
 * Yesterday continues it, the same day repeats it without extending it, and
 * anything older starts again at one. Dates are compared as days rather than
 * by subtracting timestamps, so an hour of daylight saving cannot cost
 * somebody their streak.
 */
export function nextStreak(
  lastLoggedDate: string,
  streak: number,
  date: string,
): number {
  if (!date) return streak;
  if (lastLoggedDate === date) return Math.max(1, streak);
  const days = dayGap(lastLoggedDate, date);
  return days === 1 ? Math.max(1, streak) + 1 : 1;
}

/** Whole days from one yyyy-MM-dd to another, or null if either is unusable. */
function dayGap(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * The state after an event, and whatever it newly earned.
 *
 * Pure: the caller persists and shows. Already-earned ids never come back, so
 * a caller can toast everything returned without checking.
 */
export function award(
  state: AchievementState,
  event: AchievementEvent,
): { state: AchievementState; earned: string[] } {
  const next: AchievementState = { ...state, earned: [...state.earned] };
  const won: string[] = [];
  const give = (id: string) => {
    if (!next.earned.includes(id) && id in ACHIEVEMENTS) {
      next.earned.push(id);
      won.push(id);
    }
  };

  switch (event.kind) {
    case "logged": {
      next.loggedCount += 1;
      next.streak = nextStreak(state.lastLoggedDate, state.streak, event.date);
      if (event.date) next.lastLoggedDate = event.date;

      give("erste-buchung");
      if (next.streak >= 3) give("drei-tage");
      if (next.streak >= 5) give("fuenf-tage");

      const hour = Number(event.time.slice(0, 2));
      if (Number.isFinite(hour)) {
        if (hour < EARLY_BEFORE) give("fruehaufsteher");
        if (hour >= LATE_FROM) give("nachtschicht");
      }
      break;
    }
    case "weekTargetReached":
      give("woche-voll");
      break;
    case "commented":
      give("erster-kommentar");
      break;
    case "transitioned":
      give("erster-statuswechsel");
      break;
    case "mentionsEmpty":
      give("posteingang-leer");
      break;
    case "missingEmpty":
      give("nichts-vergessen");
      break;
  }

  return { state: next, earned: won };
}

/** Whether this worklog is one of the rare ones. */
export function isMilestoneLog(loggedCount: number): boolean {
  return loggedCount > 0 && loggedCount % 10 === 0;
}

// ----- Persistence -----

function read(): AchievementState {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return EMPTY_STATE;
    const c = raw as Partial<AchievementState>;
    return {
      earned: Array.isArray(c.earned)
        ? c.earned.filter((id): id is string => typeof id === "string")
        : [],
      lastLoggedDate:
        typeof c.lastLoggedDate === "string" ? c.lastLoggedDate : "",
      streak: typeof c.streak === "number" ? c.streak : 0,
      loggedCount: typeof c.loggedCount === "number" ? c.loggedCount : 0,
    };
  } catch {
    return EMPTY_STATE;
  }
}

const store = createStore<AchievementState>(read());

export function getAchievementState(): AchievementState {
  return store.get();
}

/**
 * Record an event, returning the titles it earned.
 *
 * Titles rather than ids, because the caller only ever wants to show them.
 */
export function recordEvent(event: AchievementEvent): string[] {
  const { state, earned } = award(store.get(), event);
  localStorage.setItem(KEY, JSON.stringify(state));
  store.set(state);
  return earned.map((id) => ACHIEVEMENTS[id]);
}
