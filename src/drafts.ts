import { notify } from "./notify";
import { logInfo } from "./log";
import { persisted } from "./persist";
import { createStore } from "./store";
import { atMidnight, formatDuration, today } from "./time";

/**
 * Draft worklogs: time owed to Jira that is not booked yet.
 *
 * Not a Missing worklog. Those are *found*, by scanning Jira for activity
 * nothing covers; a draft is *made*, by the user, because the time exists
 * before there is anywhere to put it — the ticket does not exist yet, or there
 * was no moment to fill in a form. Both wait on the Missing tab, as two lists.
 *
 * Kept on this machine only, like every other setting, and never removed
 * except by booking it up or by an explicit discard: losing parked time
 * silently is the one thing this list exists to prevent.
 */
export interface Draft {
  id: string;
  /** How much time is still unbooked. Whole minutes, in seconds. */
  seconds: number;
  /** When the work happened: yyyy-MM-dd and HH:mm. */
  date: string;
  time: string;
  /** What it was — free text, the only context a draft without an issue has. */
  note: string;
  /** The issue it belongs on, once known. */
  issueKey: string | null;
  issueSummary: string;
  billable: boolean;
}

export type DraftInput = Omit<Draft, "id">;

const STORAGE_KEY = "performa-drafts";

/** A draft this many days old has been waiting long enough to say so. */
export const STALE_DAYS = 7;

const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v: unknown): v is string =>
  typeof v === "string" && /^\d{2}:\d{2}$/.test(v);

function parseDraft(raw: unknown): Draft | null {
  const d = (raw ?? {}) as Record<string, unknown>;
  if (typeof d.id !== "string" || typeof d.seconds !== "number") return null;
  if (!Number.isFinite(d.seconds) || d.seconds <= 0) return null;
  if (!isDate(d.date) || !isTime(d.time)) return null;
  return {
    id: d.id,
    seconds: d.seconds,
    date: d.date,
    time: d.time,
    note: typeof d.note === "string" ? d.note : "",
    issueKey: typeof d.issueKey === "string" ? d.issueKey : null,
    issueSummary: typeof d.issueSummary === "string" ? d.issueSummary : "",
    billable: d.billable !== false,
  };
}

// One unreadable entry costs that entry, not the list: everything else in it
// is time somebody still owes.
const store = persisted<Draft[]>(STORAGE_KEY, (stored) =>
  Array.isArray(stored)
    ? stored.map(parseDraft).filter((d): d is Draft => d !== null)
    : [],
);

/** Why this would not make a usable draft, or null when it would. */
export function draftProblem(
  input: Pick<Draft, "seconds" | "note" | "issueKey">,
): string | null {
  if (!(input.seconds >= 60)) return "Enter a duration of at least a minute";
  if (!input.issueKey && input.note.trim() === "")
    return "Say what it was, or pick the issue it belongs on";
  return null;
}

let counter = 0;
function newId(): string {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${counter}-${random}`;
}

/** Whole minutes: a draft never holds a stray second the form cannot show. */
function wholeMinutes(seconds: number): number {
  return Math.max(60, Math.round(seconds / 60) * 60);
}

export function getDrafts(): Draft[] {
  return store.get();
}

export function useDrafts(): Draft[] {
  return store.use();
}

/** Park some time. Returns the new draft, or null when it was not usable. */
export function addDraft(input: DraftInput): Draft | null {
  if (draftProblem(input)) return null;
  const draft: Draft = {
    ...input,
    id: newId(),
    note: input.note.trim(),
    seconds: wholeMinutes(input.seconds),
  };
  store.save([...store.get(), draft]);
  logInfo(
    `parked ${formatDuration(draft.seconds)}` +
      (draft.issueKey ? ` on ${draft.issueKey}` : " without an issue"),
  );
  return draft;
}

/** Change a draft in place. False, and nothing changed, when the result would
 *  not be usable. */
export function updateDraft(id: string, patch: Partial<DraftInput>): boolean {
  const current = store.get().find((d) => d.id === id);
  if (!current) return false;
  const next = { ...current, ...patch };
  if (draftProblem(next)) return false;
  next.note = next.note.trim();
  next.seconds = wholeMinutes(next.seconds);
  store.save(store.get().map((d) => (d.id === id ? next : d)));
  return true;
}

export function discardDraft(id: string): void {
  store.save(store.get().filter((d) => d.id !== id));
}

/** Move an HH:mm time on by `seconds`, stopping at the end of the day. */
function later(time: string, seconds: number): string {
  const [h, m] = time.split(":").map(Number);
  const minutes = Math.min(23 * 60 + 59, h * 60 + m + Math.round(seconds / 60));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * `seconds` of a draft have been booked to Jira.
 *
 * What is left stays a draft — that is how one stretch is split across several
 * issues: book part of it, then book the rest — and it starts where the booked
 * part ended. Booked up, the draft is gone.
 */
export function bookDraft(id: string, seconds: number): void {
  const current = store.get().find((d) => d.id === id);
  if (!current) return;
  const left = current.seconds - seconds;
  if (left < 60) {
    discardDraft(id);
    return;
  }
  store.save(
    store
      .get()
      .map((d) =>
        d.id === id
          ? { ...d, seconds: wholeMinutes(left), time: later(d.time, seconds) }
          : d,
      ),
  );
}

/** Whole days between the work and `now`'s date. */
export function draftAgeDays(draft: Draft, now: string = today()): number {
  const ms = atMidnight(now).getTime() - atMidnight(draft.date).getTime();
  return Math.round(ms / 86_400_000);
}

export function isStale(draft: Draft, now: string = today()): boolean {
  return draftAgeDays(draft, now) >= STALE_DAYS;
}

/** At sign-in: one notification for whatever is still parked. Pushy on
 *  purpose — parked time nobody is reminded of is time that gets lost. */
export function remindAboutDrafts(): void {
  const drafts = store.get();
  if (drafts.length === 0) return;
  const total = drafts.reduce((sum, d) => sum + d.seconds, 0);
  void notify(
    "Parked time is waiting",
    drafts.length === 1
      ? `${formatDuration(total)} still needs booking.`
      : `${drafts.length} drafts, ${formatDuration(total)} in all, still need booking.`,
  );
}

// ----- The park form ---------------------------------------------------------

/** What the park form opens with: a new draft's starting values, or an
 *  existing draft to edit (then `id` is set). */
export type ParkRequest = Partial<Draft>;

/**
 * Open the park form. Module-level for the reason the other requests are: the
 * palette and the issue picker sit in different corners of the tree, and the
 * form is one modal the app shell owns.
 */
const parkRequest = createStore<ParkRequest | null>(null);

export function requestPark(initial: ParkRequest = {}): void {
  parkRequest.set({ ...initial });
}

export function useParkRequest(): ParkRequest | null {
  return parkRequest.use();
}

export function closeParkRequest(): void {
  parkRequest.set(null);
}
