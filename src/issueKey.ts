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
