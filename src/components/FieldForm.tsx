import { FieldValue, FormField, FormValues } from "../issueFields";
import UserSelect from "./UserSelect";

/**
 * Renders a screen of Jira fields.
 *
 * The same metadata shape describes a transition screen and an issue's edit
 * form, so this one component serves both. It knows nothing about which it is
 * rendering, and nothing about where the values go.
 */
export default function FieldForm({
  fields,
  values,
  onChange,
  disabled = false,
}: {
  fields: FormField[];
  values: FormValues;
  onChange: (id: string, value: FieldValue) => void;
  disabled?: boolean;
}) {
  return (
    <div className="field-form">
      {fields.map((field) => (
        <div key={field.id} className="form-field">
          <label htmlFor={`field-${field.id}`}>
            {field.name}
            {field.required && (
              <span className="field-required" title="Required">
                {" "}
                *
              </span>
            )}
          </label>
          <FieldInput
            field={field}
            value={values[field.id]}
            onChange={onChange}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormField;
  value: FieldValue | undefined;
  onChange: (id: string, value: FieldValue) => void;
  disabled: boolean;
}) {
  const id = `field-${field.id}`;
  const single = typeof value === "string" ? value : "";
  const many = Array.isArray(value) ? value : [];
  const set = (v: FieldValue) => onChange(field.id, v);

  switch (field.kind) {
    case "textarea":
      return (
        <textarea
          id={id}
          rows={3}
          value={single}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "number":
    case "date":
    case "datetime":
    case "text":
      return (
        <input
          id={id}
          type={
            field.kind === "number"
              ? "number"
              : field.kind === "date"
                ? "date"
                : field.kind === "datetime"
                  ? "datetime-local"
                  : "text"
          }
          value={single}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "labels":
      return (
        <>
          <input
            id={id}
            type="text"
            value={single}
            disabled={disabled}
            onChange={(e) => set(e.target.value)}
          />
          <span className="hint">Separated by spaces or commas.</span>
        </>
      );

    case "user":
      return (
        <UserSelect id={id} value={single} disabled={disabled} onChange={set} />
      );

    case "select":
      return (
        <select
          id={id}
          value={single}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
        >
          {/* Present even on a required field: a select that starts on a real
              value would have the user submit a choice they never made. */}
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o.id || o.label} value={o.id || o.label}>
              {o.label}
            </option>
          ))}
        </select>
      );

    case "radio":
      return (
        <div className="field-choices">
          {field.options.map((o) => (
            <label key={o.id || o.label} className="field-choice">
              <input
                type="radio"
                name={id}
                checked={single === (o.id || o.label)}
                disabled={disabled}
                onChange={() => set(o.id || o.label)}
              />
              {o.label}
            </label>
          ))}
        </div>
      );

    case "checkboxes":
    case "multiselect":
      return (
        <div className="field-choices">
          {field.options.map((o) => {
            const key = o.id || o.label;
            return (
              <label key={key} className="field-choice">
                <input
                  type="checkbox"
                  checked={many.includes(key)}
                  disabled={disabled}
                  onChange={(e) =>
                    set(
                      e.target.checked
                        ? [...many, key]
                        : many.filter((v) => v !== key),
                    )
                  }
                />
                {o.label}
              </label>
            );
          })}
        </div>
      );

    case "unsupported":
      // Shown rather than hidden: a field missing from the form reads as a
      // field the screen doesn't have. Saying what it is, and that it has to
      // be filled in elsewhere, is the honest version.
      return (
        <p className="field-unsupported">
          This app has no input for this kind of field yet — set it in Jira.
        </p>
      );
  }
}
