import { openExternal } from "../external";
import { splitIssueKeys } from "../issueKey";

/**
 * An issue key written as a link to the issue itself.
 *
 * The browser rather than the issue view on purpose: these sit inside forms
 * the reader is part-way through filling in, and opening an issue in the app
 * replaces the tab — the half-written worklog with it. A second window is what
 * "let me go and look at that issue" actually means here, and it is the idiom
 * the worklog rows and the timesheet already use for a key.
 */
export function IssueKeyLink({
  issueKey,
  site,
}: {
  issueKey: string;
  site: string;
}) {
  return (
    <button
      className="key-link key"
      title={`Open ${issueKey} in browser`}
      onClick={() => openExternal(`${site}/browse/${issueKey}`)}
    >
      {issueKey}
    </button>
  );
}

/**
 * Prose with every issue key in it turned into a link.
 *
 * A reminder's comment is often a sentence about some *other* issue — "handled
 * under DEV-12124" — and the key in it is the only thread back to the work
 * being described. Without this the reader has to retype it into the palette
 * to find out whether the comment is about what they think it is.
 *
 * The text arrives rendered to plain display text by the backend, so there is
 * no markup here to preserve: the keys are found in the words themselves.
 */
export function IssueKeyText({ text, site }: { text: string; site: string }) {
  return (
    <>
      {splitIssueKeys(text).map((segment, i) =>
        segment.key ? (
          <IssueKeyLink key={i} issueKey={segment.key} site={site} />
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}
