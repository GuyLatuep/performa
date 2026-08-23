import { useEffect, useState } from "react";
import { api, IssueDetail } from "../api";
import {
  FormField,
  FormValues,
  initialValues,
  missingRequired,
  toFormFields,
  toJiraFields,
} from "../issueFields";
import { logInfo } from "../log";
import FieldForm from "./FieldForm";

/** The standard fields, plus whichever of the site's configured ones this
 *  issue actually carries. One of them — the configured editable field — grows
 *  a change affordance; the rest are read-only. */
export default function IssueFacts({
  detail,
  teamField,
  issueKey,
  onChanged,
}: {
  detail: IssueDetail;
  teamField: string;
  issueKey: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const facts: [string, string | undefined][] = [
    ["Status", detail.status],
    ["Priority", detail.priority],
    ["Type", detail.issueType],
    ["Reporter", detail.reporter],
    ["Assignee", detail.assignee],
    ["Due", detail.dueDate],
    ...detail.details.map(
      (f) => [f.label, f.value] as [string, string | undefined],
    ),
  ];
  const editable = (label: string) =>
    teamField !== "" && label.toLowerCase() === teamField.toLowerCase();
  // The editable field is worth showing even when the issue has no value for
  // it — that is exactly when somebody wants to set it.
  const shown = facts.filter(([label, value]) => value || editable(label));
  const listed = new Set(shown.map(([l]) => l.toLowerCase()));
  if (teamField && !listed.has(teamField.toLowerCase()))
    shown.push([teamField, undefined]);

  return (
    <>
      <dl className="issue-facts">
        {shown.map(([label, value]) => (
          <div key={label} className="issue-fact">
            <dt>
              {label}
              {editable(label) && (
                <button
                  className="link fact-edit"
                  title={`Change ${label}`}
                  onClick={() => setEditing((e) => !e)}
                >
                  {editing ? "cancel" : "change"}
                </button>
              )}
            </dt>
            <dd>{value ?? <span className="muted">—</span>}</dd>
          </div>
        ))}
      </dl>
      {editing && (
        <FieldEditor
          issueKey={issueKey}
          fieldName={teamField}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </>
  );
}

/** Change one configured field, using the same renderer a transition screen
 *  uses — `/editmeta` hands back the same metadata shape, so the values Jira
 *  will accept come from Jira rather than from a list kept here. */
function FieldEditor({
  issueKey,
  fieldName,
  onDone,
  onCancel,
}: {
  issueKey: string;
  fieldName: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [field, setField] = useState<FormField | null>(null);
  const [values, setValues] = useState<FormValues>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.issueEditFields(issueKey).then(
      (metas) => {
        if (cancelled) return;
        const match = toFormFields(metas).find(
          (f) => f.name.toLowerCase() === fieldName.toLowerCase(),
        );
        setField(match ?? null);
        setValues(match ? initialValues([match]) : {});
        setLoading(false);
      },
      (err) => {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [issueKey, fieldName]);

  async function save() {
    if (!field) return;
    // Marked required whatever the field itself says: a change nobody typed a
    // value for is a no-op worth refusing, and this reuses the same check the
    // transition screens make — including that the value can actually be
    // shaped for Jira.
    const gaps = missingRequired([{ ...field, required: true }], values);
    if (gaps.length > 0) {
      setError(`${fieldName} needs a value.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateIssueFields(issueKey, toJiraFields([field], values));
      logInfo(`changed ${fieldName} on ${issueKey}`);
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field-editor">
      {loading && <p className="muted">Loading…</p>}
      {/* Not an error: a field can be editable on one issue type and absent on
          another, and the honest thing is to say which. */}
      {!loading && !field && !error && (
        <p className="hint">
          {fieldName} cannot be changed on this issue — its edit form does not
          offer it.
        </p>
      )}
      {field && (
        <FieldForm
          fields={[field]}
          values={values}
          onChange={(id, value) => setValues((v) => ({ ...v, [id]: value }))}
          disabled={busy}
        />
      )}
      {error && <p className="error">{error}</p>}
      <div className="panel-actions">
        {/* Not for a field with no input: Save would answer "needs a value"
            about a box the user has no way to fill in. */}
        {field && field.kind !== "unsupported" && (
          <button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        )}
        <button className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
