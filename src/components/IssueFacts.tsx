import React, { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AssetLink, api, IssueDetail } from "../api";
import {
  FormField,
  FormValues,
  initialValues,
  missingRequired,
  toFormFields,
  toJiraFields,
} from "../issueFields";
import { logInfo } from "../log";
import { isWideField, useIssueFieldConfig } from "../issueFieldNames";
import FieldForm from "./FieldForm";
import { useDismissOnOutside } from "../dismiss";

/** One row of the facts grid. */
interface Fact {
  /** What the grid shows. Short on purpose — "Type", not "Issue Type". */
  label: string;
  /** Set when the value is one or more Assets objects, which are places in
   *  Jira rather than text, and so are rendered as links. */
  assets?: AssetLink[];
  /** The field's name on the Jira site, which is what the edit form is keyed
   *  by. Not always the label: Jira calls them "Issue Type" and "Due date". */
  jiraName: string;
  value?: string;
}

/** Shorter names for the fields whose Jira spelling is longer than the column
 *  deserves. Keyed by the normalised Jira name. */
const SHORT_LABELS: Record<string, string> = {
  issuetype: "Type",
  duedate: "Due",
};

/** Compared without case, spaces or punctuation — the same rule the Rust side
 *  matches configured field names by, so "Due date" finds "Due Date". */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The issue's fields, each editable when Jira says it can be.
 *
 * What can be changed is a question only the issue's own edit form can answer —
 * it varies by issue type, by project permission, and by workflow state — so it
 * is read from `/editmeta` rather than configured anywhere. A field Jira will
 * not accept a value for simply has no "change" beside it.
 */
export default function IssueFacts({
  detail,
  issueKey,
  site,
  onChanged,
}: {
  detail: IssueDetail;
  issueKey: string;
  site: string;
  onChanged: () => void;
}) {
  /** The label of the fact being edited, if any. */
  const [editing, setEditing] = useState<string | null>(null);
  const fieldConfig = useIssueFieldConfig();
  const [editable, setEditable] = useState<Map<string, FormField>>(new Map());

  // Which fields accept a value, keyed by name. Failing is not worth surfacing:
  // the fields still read fine, they just cannot be changed here.
  useEffect(() => {
    let cancelled = false;
    setEditing(null);
    api.issueEditFields(issueKey).then(
      (metas) => {
        if (cancelled) return;
        setEditable(
          new Map(
            toFormFields(metas)
              // A field with no input this app can render is not offered:
              // "change" that opens a box saying it cannot be changed is worse
              // than no "change" at all.
              .filter((f) => f.kind !== "unsupported")
              .map((f) => [normalize(f.name), f]),
          ),
        );
      },
      () => !cancelled && setEditable(new Map()),
    );
    return () => {
      cancelled = true;
    };
  }, [issueKey]);

  // No Status here: the picker in the header shows it, and repeating it a few
  // centimetres below invites the two to disagree — the picker is live and
  // these facts come from a cached read.
  //
  // Everything else comes from the configured order, standard fields included.
  // Their values arrive typed on the detail as well as through `details`, and
  // the typed one is preferred: it is already rendered, and a name that fails
  // to resolve against the site's catalog would otherwise take the field with
  // it.
  const standard: Record<string, string | undefined> = {
    issuetype: detail.issueType,
    priority: detail.priority,
    reporter: detail.reporter,
    assignee: detail.assignee,
    duedate: detail.dueDate,
  };
  const byName = new Map(
    detail.details.map((f) => [normalize(f.label), f] as const),
  );

  const facts: Fact[] = fieldConfig.detail.map((name) => {
    const key = normalize(name);
    const configured = byName.get(key);
    return {
      label: SHORT_LABELS[key] ?? name,
      jiraName: name,
      value: standard[key] ?? configured?.value,
      assets: configured?.assets,
    };
  });

  const fieldFor = (fact: Fact) => editable.get(normalize(fact.jiraName));
  const isWide = (fact: Fact) => isWideField(fieldConfig, fact.jiraName);

  // A narrow field is worth a row when it can be filled in — that is exactly
  // when somebody wants it. A full-width one holds prose, and an empty block of
  // prose is only a heading with nothing under it, so it waits until it has
  // something to say.
  const visible = facts.filter((f) =>
    isWide(f) ? f.value : f.value || fieldFor(f),
  );

  const editor = (fact: Fact, field: FormField) => (
    <FieldEditor
      // Per field: the editor holds a draft, and switching fields must not
      // carry the previous one's value across.
      key={fact.label}
      issueKey={issueKey}
      label={fact.label}
      field={field}
      onDone={() => {
        setEditing(null);
        onChanged();
      }}
      onCancel={() => setEditing(null)}
    />
  );

  /** One full-width field: prose under its own heading, like the description. */
  const wideBlock = (fact: Fact) => {
    const field = fieldFor(fact);
    return (
      <section key={fact.label} className="issue-section issue-fact">
        <h3>{fact.label}</h3>
        <p
          className={`issue-description${field ? " editable" : ""}`}
          title={field ? `Double-click to change ${fact.label}` : undefined}
          onDoubleClick={() => field && setEditing(fact.label)}
        >
          <FactValue fact={fact} site={site} />
        </p>
        {editing === fact.label && field && editor(fact, field)}
      </section>
    );
  };

  /** A run of narrow fields, as one grid. */
  const gridBlock = (run: Fact[], key: number) => (
    <dl className="issue-facts" key={`grid-${key}`}>
      {run.map((fact) => {
        const field = fieldFor(fact);
        return (
          <div key={fact.label} className="issue-fact">
            <dt>{fact.label}</dt>
            <dd
              className={field ? "editable" : undefined}
              title={field ? `Double-click to change ${fact.label}` : undefined}
              // Double-click rather than a link beside every value: the link
              // repeated down the grid was most of what the eye had to wade
              // through, and reading an issue is the common case.
              onDoubleClick={() => field && setEditing(fact.label)}
            >
              <FactValue fact={fact} site={site} />
            </dd>
            {editing === fact.label && field && editor(fact, field)}
          </div>
        );
      })}
    </dl>
  );

  // Walked in configured order so a full-width field lands where it was put:
  // first, last, or between two runs of narrow ones. Grouping the narrow fields
  // into runs is what lets them share a grid without the wide ones jumping to
  // one end.
  const blocks: React.ReactNode[] = [];
  let run: Fact[] = [];
  const flush = () => {
    if (run.length > 0) blocks.push(gridBlock(run, blocks.length));
    run = [];
  };
  for (const fact of visible) {
    if (isWide(fact)) {
      flush();
      blocks.push(wideBlock(fact));
    } else {
      run.push(fact);
    }
  }
  flush();

  return <>{blocks}</>;
}

/** A fact's value: plain text, or links when it names Assets objects.
 *
 *  An asset is a thing in Jira with a page of its own — a machine, a site, a
 *  contract — so its name is an address, not a word. */
function FactValue({ fact, site }: { fact: Fact; site: string }) {
  if (!fact.assets?.length)
    return fact.value ? <>{fact.value}</> : <span className="muted">—</span>;
  return (
    <>
      {fact.assets.map((asset, i) => (
        <span key={asset.objectId}>
          {i > 0 && ", "}
          <button
            className="link asset-link"
            title={`Open ${asset.name} in Jira Assets`}
            onClick={(e) => {
              // The row opens an editor on double-click; following a link is
              // not that.
              e.stopPropagation();
              openUrl(`${site}/jira/assets/object/${asset.objectId}`);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {asset.name}
          </button>
        </span>
      ))}
    </>
  );
}

/** Change one field, using the same renderer a transition screen uses —
 *  `/editmeta` hands back the same metadata shape, so the values Jira will
 *  accept come from Jira rather than from a list kept here. */
function FieldEditor({
  issueKey,
  label,
  field,
  onDone,
  onCancel,
}: {
  issueKey: string;
  label: string;
  field: FormField;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<FormValues>(() =>
    initialValues([field]),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    // Marked required whatever the field itself says: a change nobody typed a
    // value for is a no-op worth refusing, and this reuses the same check the
    // transition screens make — including that the value can actually be
    // shaped for Jira.
    const gaps = missingRequired([{ ...field, required: true }], values);
    if (gaps.length > 0) {
      setError(`${label} needs a value.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateIssueFields(issueKey, toJiraFields([field], values));
      logInfo(`changed ${label} on ${issueKey}`);
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const popover = useRef<HTMLDivElement>(null);
  useDismissOnOutside(popover, onCancel);

  // Escape closes, which is what anything overlaying the page owes the reader.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="field-editor"
      role="dialog"
      aria-label={`Change ${label}`}
      ref={popover}
    >
      <FieldForm
        fields={[field]}
        values={values}
        onChange={(id, value) => setValues((v) => ({ ...v, [id]: value }))}
        disabled={busy}
      />
      {error && <p className="error">{error}</p>}
      <div className="panel-actions">
        <button onClick={save} disabled={busy}>
          {busy ? "Saving…" : `Save ${label.toLowerCase()}`}
        </button>
        <button className="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
