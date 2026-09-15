/**
 * Whether some typed text is an issue key, and the key itself if so.
 *
 * Mirrors `jira::is_issue_key` on the Rust side deliberately, rule for rule: a
 * project of two or more characters starting with a letter and carrying on in
 * letters and digits, a hyphen, then digits. That function is what the backend
 * validates against before it will look an issue up at all, so matching it here
 * means this can never offer a key the backend would turn away.
 *
 * Upper-cased on the way out. Jira's own keys are upper case and that is how
 * people expect to see them written, whatever they typed.
 */
export function parseIssueKey(text: string): string | null {
  const trimmed = text.trim();
  const at = trimmed.indexOf("-");
  if (at < 2) return null;
  const project = trimmed.slice(0, at);
  const number = trimmed.slice(at + 1);
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(project)) return null;
  if (!/^[0-9]+$/.test(number)) return null;
  return `${project.toUpperCase()}-${number}`;
}

/** A run of text, and the issue key it is — when it is one. */
export interface KeySegment {
  text: string;
  /** The key as Jira writes it, upper case. Absent on ordinary prose. */
  key?: string;
}

/* Deliberately the same shape `parseIssueKey` accepts, written as a scan: a
   project of two or more characters starting with a letter, a hyphen, digits.
   Boundaries are checked by hand rather than with lookaround — the app runs in
   whatever WebView the desktop ships, and `\b` alone would find "BC-1" inside
   "ABC-12". */
const KEY_PATTERN = /[A-Za-z][A-Za-z0-9]+-[0-9]+/g;

/** A key must not run into the text around it: "ABC-12" holds no "BC-1", and a
 *  trailing hyphen means the number carries on ("ABC-1-2" is no key). */
function isWholeWord(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text[end] : "";
  return !/[A-Za-z0-9-]/.test(before) && !/[A-Za-z0-9-]/.test(after);
}

/**
 * Prose split into the issue keys mentioned in it and the text between them,
 * in reading order.
 *
 * What a comment says about another issue is most of the context a reminder
 * carries, and the key in it is the way to go and read that issue — so the
 * view needs to know which stretches of the sentence are keys. The rule is
 * `parseIssueKey`'s, so nothing is offered here that the backend would refuse
 * to look up.
 *
 * Empty runs are dropped: a key at either end of the text would otherwise
 * bracket it with segments holding nothing.
 */
export function splitIssueKeys(text: string): KeySegment[] {
  const segments: KeySegment[] = [];
  let at = 0;
  for (const match of text.matchAll(KEY_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!isWholeWord(text, start, end)) continue;
    if (start > at) segments.push({ text: text.slice(at, start) });
    segments.push({ text: match[0], key: match[0].toUpperCase() });
    at = end;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}
