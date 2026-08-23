import { AllowedValue, FieldMeta } from "./api";

/**
 * How a field is rendered and how its value travels back to Jira.
 *
 * "unsupported" is a first-class outcome, not a failure: Jira has field types
 * this app has no sensible input for (user pickers, cascading selects, sprint
 * pickers), and the honest thing is to show the field, say it can't be filled
 * in here, and point at Jira — rather than silently drop it or render a box
 * that produces a value Jira rejects.
 */
export type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "datetime"
  | "select"
  | "radio"
  | "multiselect"
  | "checkboxes"
  | "labels"
  | "user"
  | "unsupported";

/** A field ready to render. */
export interface FormField {
  id: string;
  name: string;
  required: boolean;
  kind: FieldKind;
  options: AllowedValue[];
}

/** Values are held as strings, or arrays of option ids for the two kinds that
 *  take several. Labels are a single string and split on the way out — one
 *  text box is a better input than a tag editor nobody asked for. */
export type FieldValue = string | string[];
export type FormValues = Record<string, FieldValue>;

/** Custom-field type URIs, which is where Jira hides the distinctions the base
 *  schema type doesn't make. Matched on the suffix: the prefix has moved
 *  between Jira versions, the last segment has not. */
const CUSTOM_KINDS: Record<string, FieldKind> = {
  textarea: "textarea",
  textfield: "text",
  url: "text",
  readonlyfield: "text",
  float: "number",
  datepicker: "date",
  datetime: "datetime",
  select: "select",
  radiobuttons: "radio",
  multiselect: "multiselect",
  multicheckboxes: "checkboxes",
  labels: "labels",
  userpicker: "user",
};

/** Built-in fields that hold rich text. Their schema type is plain "string"
 *  with no custom URI to give them away, but the v3 API stores them as
 *  documents all the same. */
const RICH_TEXT_SYSTEM_FIELDS = ["description", "environment"];

/** Base schema types that are a single choice from a fixed list. */
const CHOICE_TYPES = [
  "option",
  "resolution",
  "priority",
  "issuetype",
  "securitylevel",
];

/**
 * What kind of input this field needs.
 *
 * The custom-field URI wins where it says anything, because it is the more
 * specific answer — `schema.type` is "string" for both a one-line text field
 * and a textarea, and "option" for both a select and a radio group.
 */
export function fieldKind(meta: FieldMeta): FieldKind {
  // A field Jira will not let us set is not one we can offer, whatever shape
  // it has. `operations` is occasionally absent; absent is not a refusal.
  if (meta.operations.length > 0 && !meta.operations.includes("set"))
    return "unsupported";

  const custom = meta.schemaCustom?.split(":").pop();
  if (custom && custom in CUSTOM_KINDS) return CUSTOM_KINDS[custom];

  if (meta.schemaSystem && RICH_TEXT_SYSTEM_FIELDS.includes(meta.schemaSystem))
    return "textarea";

  if (meta.schemaType === "string") return "text";
  if (meta.schemaType === "number") return "number";
  if (meta.schemaType === "date") return "date";
  if (meta.schemaType === "datetime") return "datetime";
  // Searched rather than listed: Jira sends no allowedValues for a user field,
  // so the input queries the site instead of rendering a fixed list.
  if (meta.schemaType === "user") return "user";
  if (CHOICE_TYPES.includes(meta.schemaType)) return "select";
  if (meta.schemaType === "array") {
    if (meta.schemaItems && CHOICE_TYPES.includes(meta.schemaItems))
      return "multiselect";
    // An array of plain strings with no options to pick from is a label list
    // in all but name.
    if (meta.schemaItems === "string") return "labels";
  }
  return "unsupported";
}

/** Every field of a screen, in the order the backend sorted them. */
export function toFormFields(metas: FieldMeta[]): FormField[] {
  return metas.map((meta) => ({
    id: meta.id,
    name: meta.name,
    required: meta.required,
    kind: fieldKind(meta),
    options: meta.allowedValues,
  }));
}

/** Whether a kind holds several values at once. */
export function isMultiValue(kind: FieldKind): boolean {
  return kind === "multiselect" || kind === "checkboxes";
}

/** An empty draft for a screen. */
export function initialValues(fields: FormField[]): FormValues {
  const values: FormValues = {};
  for (const field of fields)
    values[field.id] = isMultiValue(field.kind) ? [] : "";
  return values;
}

/** True when the user has put nothing in this field. */
export function isBlank(value: FieldValue | undefined): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) ? value.length === 0 : value.trim() === "";
}

/**
 * The names of the required fields still empty — what stops a submit.
 *
 * A required field this app cannot render is reported too: it is precisely the
 * case where submitting would fail at Jira, and saying so before the request
 * is the whole point of checking here.
 */
export function missingRequired(
  fields: FormField[],
  values: FormValues,
): string[] {
  return fields
    .filter(
      (f) =>
        f.required &&
        (f.kind === "unsupported" ||
          isBlank(values[f.id]) ||
          // A value that cannot be shaped is dropped by `toJiraFields`, so a
          // required field holding one would be submitted absent — producing
          // exactly the raw Jira 400 this check exists to prevent.
          shapeValue(f, values[f.id]) === undefined),
    )
    .map((f) => f.name);
}

/** Whether every required field on this screen is one we can render — i.e.
 *  whether the screen can be completed in the app at all. */
export function screenIsFillable(fields: FormField[]): boolean {
  return !fields.some((f) => f.required && f.kind === "unsupported");
}

/**
 * The screen's answers in Jira's own shape, ready to send.
 *
 * Blank optional fields are left out rather than sent empty: an explicit null
 * would *clear* the field, which is not what leaving a box alone means.
 */
export function toJiraFields(
  fields: FormField[],
  values: FormValues,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.id];
    if (field.kind === "unsupported" || isBlank(value)) continue;
    const shaped = shapeValue(field, value);
    if (shaped !== undefined) out[field.id] = shaped;
  }
  return out;
}

function shapeValue(field: FormField, value: FieldValue): unknown {
  switch (field.kind) {
    case "textarea":
      // Rich text is stored as a document, not a string. Sending the string
      // is refused with "Operation value must be an Atlassian Document".
      return adfDocument(value as string);
    case "text":
    case "date":
      return (value as string).trim();
    case "datetime":
      return toJiraDateTime(value as string);
    case "number": {
      const n = Number((value as string).trim());
      // A box that won't parse is not a number Jira should be asked to store.
      return Number.isFinite(n) ? n : undefined;
    }
    case "select":
    case "radio":
      return optionRef(field, value as string);
    case "user":
      // A user is identified by account id and nothing else — display names
      // are neither unique nor stable.
      return { accountId: value as string };
    case "multiselect":
    case "checkboxes":
      return (value as string[]).map((id) => optionRef(field, id));
    case "labels":
      // Whitespace or commas, whichever the user reached for.
      return (value as string)
        .split(/[\s,]+/)
        .map((l) => l.trim())
        .filter((l) => l !== "");
    case "unsupported":
      return undefined;
  }
}

/** Jira identifies an option by id where it has one, and by its text where it
 *  does not (some allowed-value lists carry no ids). */
function optionRef(field: FormField, id: string): unknown {
  const option = field.options.find((o) => o.id === id);
  if (option && option.id) return { id: option.id };
  return { value: option?.label ?? id };
}

/**
 * Plain text as an Atlassian Document, one paragraph per line.
 *
 * Jira Cloud's v3 API stores every rich-text field this way — a description, an
 * environment, any `textarea` custom field — and refuses a bare string with
 * "Operation value must be an Atlassian Document". Blank lines are paragraph
 * separators in a textarea, and ADF says that with the paragraphs themselves,
 * so they are dropped rather than kept as empty ones.
 *
 * Deliberately the same shape as `adf_doc` in the Rust client, which builds
 * comment bodies. Mentions are not handled here: a field value has no picker
 * behind it, so there is nothing to resolve a name against.
 */
export function adfDocument(text: string): unknown {
  const paragraphs = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    }));
  return {
    type: "doc",
    version: 1,
    // An empty document still needs a body; blank values are dropped before
    // they reach here, so this only guards the unreachable case.
    content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph" }],
  };
}

/**
 * `<input type="datetime-local">` gives "2024-03-01T10:00" with no zone, which
 * Jira rejects. Jira wants the offset spelled out, and the value the user
 * typed is a local wall-clock time — so the local offset is the right one.
 */
export function toJiraDateTime(local: string): string | undefined {
  const parsed = new Date(local);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  // getTimezoneOffset counts minutes *behind* UTC, so its sign is inverted.
  const offset = -parsed.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  return (
    `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}` +
    `T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}` +
    `.000${sign}${pad(offset / 60)}${pad(offset % 60)}`
  );
}
