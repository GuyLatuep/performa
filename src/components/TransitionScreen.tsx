import { useState } from "react";
import { listSentence, OfferedTransition } from "../transitions";
import {
  FieldValue,
  FormValues,
  initialValues,
  missingRequired,
  toJiraFields,
} from "../issueFields";
import FieldForm from "./FieldForm";

/** One transition's screen, filled in here rather than in the browser. */
export default function TransitionScreen({
  entry,
  busy,
  failure,
  onCancel,
  onSubmit,
}: {
  entry: OfferedTransition;
  busy: boolean;
  failure: string | null;
  onCancel: () => void;
  onSubmit: (fields: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<FormValues>(() =>
    initialValues(entry.form),
  );
  const [missing, setMissing] = useState<string[]>([]);

  function change(id: string, value: FieldValue) {
    setValues((v) => ({ ...v, [id]: value }));
  }

  function submit() {
    // Checked here so an incomplete screen never becomes a request: Jira's
    // refusal would arrive as a 400 with the fields named in a raw error.
    const gaps = missingRequired(entry.form, values);
    setMissing(gaps);
    if (gaps.length === 0) onSubmit(toJiraFields(entry.form, values));
  }

  return (
    <div className="transition-screen">
      <div className="back-row">
        <button className="link" onClick={onCancel} disabled={busy}>
          ← Cancel this move
        </button>
      </div>
      <p className="hint">
        {entry.to ? `Moving to ${entry.to}.` : `Running ${entry.name}.`} Fields
        marked * are required by the workflow.
      </p>

      <FieldForm
        fields={entry.form}
        values={values}
        onChange={change}
        disabled={busy}
      />

      {missing.length > 0 && (
        <p className="error">
          {listSentence(missing)}{" "}
          {missing.length === 1 ? "is required" : "are required"}.
        </p>
      )}
      {failure && <p className="error">{failure}</p>}

      <button onClick={submit} disabled={busy}>
        {busy ? "Moving…" : entry.name}
      </button>
    </div>
  );
}
