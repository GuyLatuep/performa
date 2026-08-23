import { JiraUser } from "./api";

/**
 * Somebody the writer picked, and the characters standing in for them.
 *
 * The comment box holds plain text, so a pick is remembered alongside it
 * rather than inside it: `name` is what to look for in the text, `accountId`
 * is what the mention actually points at. The two are reunited in Rust when
 * the comment is built — see `adf_inline`.
 */
export interface PickedMention {
  accountId: string;
  name: string;
}

/** How far after an "@" we keep looking for a name being typed. Long enough
 *  for a full name, short enough that an "@" left earlier in a paragraph stops
 *  querying once the writing has moved on. */
const MAX_QUERY_CHARS = 40;

/**
 * The name being typed at the caret, or null when the writer isn't in a
 * mention.
 *
 * Spaces are allowed inside the fragment because display names contain them —
 * "@Malte P" has to keep searching. What ends it is a newline, another "@", or
 * simply getting too long to be a name.
 *
 * A name already chosen ends it too. Without that, the text left behind by a
 * pick ("@Simon Tams ") reads as somebody still being typed, so the picker
 * reopens over a finished mention — and choosing again from it replaces the
 * person who was already there, since both start from the same "@".
 */
export function activeMentionQuery(
  text: string,
  caret: number,
  picked: PickedMention[] = [],
): string | null {
  if (deleteMentionBefore(text, caret, picked)) return null;

  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;

  // "@" only starts a mention at a word boundary — otherwise every email
  // address opens the picker halfway through being typed.
  const preceding = at > 0 ? before[at - 1] : " ";
  if (!/\s/.test(preceding)) return null;

  const fragment = before.slice(at + 1);
  if (fragment.length > MAX_QUERY_CHARS) return null;
  if (fragment.includes("\n")) return null;
  return fragment;
}

/**
 * Replace the fragment being typed with the chosen name.
 *
 * A trailing space is added so the next word doesn't run into the name and
 * quietly change what gets matched later.
 */
export function applyMention(
  text: string,
  caret: number,
  user: JiraUser,
): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return { text, caret };
  const inserted = `@${user.displayName} `;
  const next = text.slice(0, at) + inserted + text.slice(caret);
  return { text: next, caret: at + inserted.length };
}

/**
 * The picks whose names are still in the text, deduplicated by account.
 *
 * A writer who deletes "@Anna Leeson" after picking her should not silently
 * notify her, and picking the same person twice is one mention as far as the
 * substitution is concerned.
 */
export function usedMentions(
  text: string,
  picked: PickedMention[],
): PickedMention[] {
  const seen = new Set<string>();
  return picked.filter((m) => {
    if (seen.has(m.accountId)) return false;
    if (!text.includes(`@${m.name}`)) return false;
    seen.add(m.accountId);
    return true;
  });
}

/** Picks longest name first — the same order `adf_inline` applies in Rust, so
 *  what the box highlights is exactly what becomes a mention. */
function byLength(picked: PickedMention[]): PickedMention[] {
  return [...picked]
    .filter((m) => m.name !== "")
    .sort((a, b) => b.name.length - a.name.length);
}

/** A run of comment text, marked when it is a mention. */
export interface TextSegment {
  text: string;
  /** The account this run mentions. Absent on ordinary text. */
  accountId?: string;
}

/**
 * The comment split into plain runs and mention runs, for display.
 *
 * Deliberately the same walk as the Rust side's `adf_inline`: the box must
 * mark precisely what will be sent as a mention, or it promises something the
 * comment does not deliver.
 */
export function highlightSegments(
  text: string,
  picked: PickedMention[],
): TextSegment[] {
  const candidates = byLength(picked);
  const segments: TextSegment[] = [];
  let pending = "";
  let idx = 0;

  while (idx < text.length) {
    const at = text.indexOf("@", idx);
    if (at === -1) break;
    const after = text.slice(at + 1);
    const match = candidates.find((m) => after.startsWith(m.name));
    if (match) {
      pending += text.slice(idx, at);
      if (pending) segments.push({ text: pending });
      pending = "";
      segments.push({ text: `@${match.name}`, accountId: match.accountId });
      idx = at + 1 + match.name.length;
    } else {
      pending += text.slice(idx, at + 1);
      idx = at + 1;
    }
  }

  pending += text.slice(idx);
  if (pending) segments.push({ text: pending });
  return segments;
}

/**
 * Backspace over a whole mention rather than a letter of one.
 *
 * A name is one thing to the writer — chipping "@Malte Polzin" down a
 * character at a time also leaves a half-name that quietly stops being a
 * mention while still looking like one. Returns null when the caret is not
 * just after a mention, and normal backspace should happen instead.
 */
export function deleteMentionBefore(
  text: string,
  caret: number,
  picked: PickedMention[],
): { text: string; caret: number } | null {
  const before = text.slice(0, caret);
  for (const m of byLength(picked)) {
    // The space `applyMention` adds belongs to the mention: it was not typed,
    // so it should not be left behind.
    for (const token of [`@${m.name} `, `@${m.name}`]) {
      if (before.endsWith(token)) {
        const start = caret - token.length;
        return { text: text.slice(0, start) + text.slice(caret), caret: start };
      }
    }
  }
  return null;
}

/** How to tell two people with the same display name apart in the picker. */
export function userSubtitle(user: JiraUser): string {
  return user.email ?? user.accountId;
}
