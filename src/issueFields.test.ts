import { describe, expect, it } from "vitest";
import {
  adfDocument,
  buildFacts,
  clearedField,
  fieldKind,
  initialValues,
  isBlank,
  isMultiValue,
  missingRequired,
  screenIsFillable,
  toFormFields,
  toJiraDateTime,
  toJiraFields,
  visibleFacts,
} from "./issueFields";

import type { FieldSize } from "./issueFieldNames";
import type { IssueDetail } from "./api";

/** A minimal issue detail — only the fields a facts test states. */
function issueDetailFor(o: Partial<IssueDetail> = {}): IssueDetail {
  return {
    key: "ABC-1",
    summary: "Replace the pump",
    createdAt: "2026-03-01T08:00:00.000+01:00",
    updatedAt: "2026-03-15T08:00:00.000+01:00",
    description: "",
    details: [],
    serviceDesk: false,
    attachments: [],
    links: [],
    ...o,
  };
}
import { FieldMeta } from "./api";

const CUSTOM = "com.atlassian.jira.plugin.system.customfieldtypes";

function meta(over: Partial<FieldMeta> = {}): FieldMeta {
  return {
    id: "customfield_1",
    name: "Field",
    required: false,
    schemaType: "string",
    operations: ["set"],
    allowedValues: [],
    ...over,
  };
}

describe("fieldKind", () => {
  it("reads the base schema types", () => {
    expect(fieldKind(meta({ schemaType: "string" }))).toBe("text");
    expect(fieldKind(meta({ schemaType: "number" }))).toBe("number");
    expect(fieldKind(meta({ schemaType: "date" }))).toBe("date");
    expect(fieldKind(meta({ schemaType: "datetime" }))).toBe("datetime");
  });

  it("treats every fixed-list type as a select", () => {
    for (const t of ["option", "resolution", "priority", "issuetype"])
      expect(fieldKind(meta({ schemaType: t }))).toBe("select");
  });

  it("lets the custom-field URI override the base type", () => {
    // schema.type is "string" for both a one-line field and a textarea.
    expect(
      fieldKind(
        meta({ schemaType: "string", schemaCustom: `${CUSTOM}:textarea` }),
      ),
    ).toBe("textarea");
    // …and "option" for both a select and a radio group.
    expect(
      fieldKind(
        meta({ schemaType: "option", schemaCustom: `${CUSTOM}:radiobuttons` }),
      ),
    ).toBe("radio");
  });

  it("matches the URI on its last segment only", () => {
    // The prefix has moved between Jira versions; the suffix has not.
    expect(fieldKind(meta({ schemaCustom: "something.else:textarea" }))).toBe(
      "textarea",
    );
  });

  it("reads arrays through their item type", () => {
    expect(
      fieldKind(meta({ schemaType: "array", schemaItems: "option" })),
    ).toBe("multiselect");
    expect(
      fieldKind(meta({ schemaType: "array", schemaItems: "string" })),
    ).toBe("labels");
    expect(
      fieldKind(
        meta({
          schemaType: "array",
          schemaItems: "option",
          schemaCustom: `${CUSTOM}:multicheckboxes`,
        }),
      ),
    ).toBe("checkboxes");
  });

  it("gives a user field its own searching input", () => {
    // Jira sends no allowedValues for these, so they cannot be a select.
    expect(fieldKind(meta({ schemaType: "user" }))).toBe("user");
    expect(fieldKind(meta({ schemaCustom: "…:userpicker" }))).toBe("user");
  });

  it("calls the types it has no input for unsupported", () => {
    // Several users at once, and cascading selects, are still out of scope.
    expect(fieldKind(meta({ schemaType: "array", schemaItems: "user" }))).toBe(
      "unsupported",
    );
    expect(fieldKind(meta({ schemaType: "any" }))).toBe("unsupported");
  });

  it("treats the rich-text system fields as textareas", () => {
    // Their schema type is plain "string" with no custom URI to give them away.
    expect(fieldKind(meta({ schemaSystem: "description" }))).toBe("textarea");
    expect(fieldKind(meta({ schemaSystem: "environment" }))).toBe("textarea");
    // An ordinary system field is still a plain text box.
    expect(fieldKind(meta({ schemaSystem: "summary" }))).toBe("text");
  });

  it("refuses a field Jira will not let us set", () => {
    expect(fieldKind(meta({ operations: ["add"] }))).toBe("unsupported");
    // An absent operations list is not a refusal.
    expect(fieldKind(meta({ operations: [] }))).toBe("text");
  });
});

describe("initialValues", () => {
  it("starts multi-value fields as arrays and the rest as empty strings", () => {
    const fields = toFormFields([
      meta({ id: "a", schemaType: "string" }),
      meta({ id: "b", schemaType: "array", schemaItems: "option" }),
    ]);
    expect(initialValues(fields)).toEqual({ a: "", b: [] });
  });
});

describe("isBlank / isMultiValue", () => {
  it("treats whitespace and empty arrays as blank", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank("   ")).toBe(true);
    expect(isBlank([])).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("x")).toBe(false);
    expect(isBlank(["1"])).toBe(false);
  });

  it("knows which kinds hold several values", () => {
    expect(isMultiValue("multiselect")).toBe(true);
    expect(isMultiValue("checkboxes")).toBe(true);
    expect(isMultiValue("labels")).toBe(false);
    expect(isMultiValue("text")).toBe(false);
  });
});

describe("missingRequired", () => {
  it("names the required fields still empty", () => {
    const fields = toFormFields([
      meta({ id: "r", name: "Resolution", required: true }),
      meta({ id: "n", name: "Notes" }),
    ]);
    expect(missingRequired(fields, { r: "", n: "" })).toEqual(["Resolution"]);
    expect(missingRequired(fields, { r: "Done", n: "" })).toEqual([]);
  });

  it("reports a required field this app cannot render", () => {
    // Submitting would fail at Jira; saying so first is the point of checking.
    const fields = toFormFields([
      meta({ id: "u", name: "Approver", required: true, schemaType: "any" }),
    ]);
    expect(missingRequired(fields, { u: "" })).toEqual(["Approver"]);
  });

  it("counts a required number that will not parse as missing", () => {
    // toJiraFields drops it, so letting it through would submit the transition
    // without the field and hit the 400 this check exists to avoid.
    const fields = toFormFields([
      meta({ id: "n", name: "Effort", required: true, schemaType: "number" }),
    ]);
    expect(missingRequired(fields, { n: "1,5" })).toEqual(["Effort"]);
    expect(missingRequired(fields, { n: "1.5" })).toEqual([]);
  });

  it("ignores an empty optional field", () => {
    const fields = toFormFields([meta({ id: "n", name: "Notes" })]);
    expect(missingRequired(fields, { n: "" })).toEqual([]);
  });
});

describe("clearedField", () => {
  it("empties a single-value field with null", () => {
    const [user] = toFormFields([
      meta({ id: "assignee", name: "Assignee", schemaType: "user" }),
    ]);
    expect(clearedField(user)).toEqual({ assignee: null });

    const [date] = toFormFields([
      meta({ id: "duedate", name: "Due date", schemaType: "date" }),
    ]);
    expect(clearedField(date)).toEqual({ duedate: null });
  });

  it("empties a multi-value field with an empty array", () => {
    // Jira refuses null for these — the array is what "none of them" looks
    // like.
    const [labels] = toFormFields([
      meta({
        id: "labels",
        name: "Labels",
        schemaType: "array",
        schemaItems: "string",
      }),
    ]);
    expect(clearedField(labels)).toEqual({ labels: [] });

    const [multi] = toFormFields([
      meta({
        id: "customfield_2",
        name: "Systems",
        schemaType: "array",
        schemaItems: "option",
        schemaCustom: `${CUSTOM}:multiselect`,
      }),
    ]);
    expect(clearedField(multi)).toEqual({ customfield_2: [] });
  });

  it("says something toJiraFields cannot", () => {
    const [assignee] = toFormFields([
      meta({ id: "assignee", name: "Assignee", schemaType: "user" }),
    ]);
    // A blank box means "left alone" there, which is exactly why clearing
    // needs its own way of being said.
    expect(toJiraFields([assignee], { assignee: "" })).toEqual({});
    expect(clearedField(assignee)).toEqual({ assignee: null });
  });
});

describe("screenIsFillable", () => {
  it("is false only when a *required* field is unrenderable", () => {
    const blocked = toFormFields([meta({ required: true, schemaType: "any" })]);
    const optional = toFormFields([meta({ schemaType: "any" })]);
    expect(screenIsFillable(blocked)).toBe(false);
    expect(screenIsFillable(optional)).toBe(true);
    expect(screenIsFillable([])).toBe(true);
  });
});

describe("toJiraFields", () => {
  it("wraps an option choice as an id reference", () => {
    const fields = toFormFields([
      meta({
        id: "resolution",
        schemaType: "resolution",
        allowedValues: [{ id: "10000", label: "Done" }],
      }),
    ]);
    expect(toJiraFields(fields, { resolution: "10000" })).toEqual({
      resolution: { id: "10000" },
    });
  });

  it("falls back to the option's text when it carries no id", () => {
    const fields = toFormFields([
      meta({
        id: "opt",
        schemaType: "option",
        allowedValues: [{ id: "", label: "VPN" }],
      }),
    ]);
    expect(toJiraFields(fields, { opt: "" })).toEqual({});
    expect(toJiraFields(fields, { opt: "VPN" })).toEqual({
      opt: { value: "VPN" },
    });
  });

  it("sends several options as an array", () => {
    const fields = toFormFields([
      meta({
        id: "multi",
        schemaType: "array",
        schemaItems: "option",
        allowedValues: [
          { id: "1", label: "A" },
          { id: "2", label: "B" },
        ],
      }),
    ]);
    expect(toJiraFields(fields, { multi: ["1", "2"] })).toEqual({
      multi: [{ id: "1" }, { id: "2" }],
    });
  });

  it("splits labels on whitespace or commas", () => {
    const fields = toFormFields([
      meta({ id: "labels", schemaType: "array", schemaItems: "string" }),
    ]);
    expect(toJiraFields(fields, { labels: "one, two  three" })).toEqual({
      labels: ["one", "two", "three"],
    });
  });

  it("sends rich text as a document, not a string", () => {
    // Jira refuses a bare string here: "Operation value must be an Atlassian
    // Document".
    const fields = toFormFields([
      meta({ id: "d", schemaSystem: "description" }),
    ]);
    expect(toJiraFields(fields, { d: "Pump stalled" })).toEqual({
      d: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Pump stalled" }],
          },
        ],
      },
    });
  });

  it("sends a plain text field as a plain string", () => {
    const fields = toFormFields([meta({ id: "s", schemaSystem: "summary" })]);
    expect(toJiraFields(fields, { s: " short " })).toEqual({ s: "short" });
  });

  it("sends a user as an account id", () => {
    // Display names are neither unique nor stable; the account id is.
    const fields = toFormFields([meta({ id: "assignee", schemaType: "user" })]);
    expect(toJiraFields(fields, { assignee: "acc-1" })).toEqual({
      assignee: { accountId: "acc-1" },
    });
  });

  it("sends a number as a number", () => {
    const fields = toFormFields([meta({ id: "n", schemaType: "number" })]);
    expect(toJiraFields(fields, { n: " 42 " })).toEqual({ n: 42 });
    // A box that won't parse is not something Jira should be asked to store.
    expect(toJiraFields(fields, { n: "abc" })).toEqual({});
  });

  it("leaves a blank optional field out rather than clearing it", () => {
    // An explicit null would erase the field; leaving a box alone must not.
    const fields = toFormFields([
      meta({ id: "n", schemaType: "string" }),
      meta({ id: "m", schemaType: "string" }),
    ]);
    expect(toJiraFields(fields, { n: "kept", m: "   " })).toEqual({
      n: "kept",
    });
  });

  it("never sends a field it cannot render", () => {
    const fields = toFormFields([meta({ id: "u", schemaType: "any" })]);
    expect(toJiraFields(fields, { u: "someone" })).toEqual({});
  });

  it("is empty for an untouched screen", () => {
    const fields = toFormFields([meta({ id: "n" })]);
    expect(toJiraFields(fields, initialValues(fields))).toEqual({});
  });
});

describe("adfDocument", () => {
  it("makes one paragraph per line", () => {
    const doc = adfDocument("First\nSecond") as {
      content: { content: { text: string }[] }[];
    };
    expect(doc.content).toHaveLength(2);
    expect(doc.content[0].content[0].text).toBe("First");
    expect(doc.content[1].content[0].text).toBe("Second");
  });

  it("treats blank lines as separators, not content", () => {
    // The same rule the Rust side applies when building a comment body.
    const doc = adfDocument("First\n\n\nSecond") as { content: unknown[] };
    expect(doc.content).toHaveLength(2);
  });

  it("is still a valid document when there is nothing to say", () => {
    const doc = adfDocument("   ") as { type: string; content: unknown[] };
    expect(doc.type).toBe("doc");
    expect(doc.content).toHaveLength(1);
  });
});

describe("toJiraDateTime", () => {
  it("spells out the offset that datetime-local leaves off", () => {
    const out = toJiraDateTime("2024-03-01T10:30");
    // Jira rejects a zone-less stamp; the shape matters more than the offset,
    // which depends on where the test runs.
    expect(out).toMatch(/^2024-03-01T10:30:00\.000[+-]\d{4}$/);
  });

  it("returns nothing for a value that isn't a date", () => {
    expect(toJiraDateTime("not a date")).toBeUndefined();
    expect(toJiraDateTime("")).toBeUndefined();
  });
});

describe("buildFacts", () => {
  const DETAIL = issueDetailFor({
    issueType: "Bug",
    priority: "High",
    reporter: "Anna Leeson",
    assignee: "Malte",
    dueDate: "2026-03-20",
    details: [
      { id: "customfield_1", label: "Plant no.", value: "K12" },
      {
        id: "customfield_2",
        label: "Machine",
        value: "Pump 4",
        assets: [{ name: "Pump 4", objectId: "o1" }],
      },
    ],
  });

  it("shortens the names whose Jira spelling is longer than the column", () => {
    const facts = buildFacts(DETAIL, ["Issue Type", "Due date"]);

    expect(facts.map((f) => f.label)).toEqual(["Type", "Due"]);
    // The Jira name is kept: it is what the edit form is keyed by.
    expect(facts.map((f) => f.jiraName)).toEqual(["Issue Type", "Due date"]);
  });

  it("follows the configured order, not Jira's", () => {
    const facts = buildFacts(DETAIL, ["Plant no.", "Priority", "Assignee"]);

    expect(facts.map((f) => f.value)).toEqual(["K12", "High", "Malte"]);
  });

  it("matches a configured name however it is spelled", () => {
    // Same rule the Rust side uses, so "due date" finds "Due date".
    const facts = buildFacts(DETAIL, ["plant no", "PLANT-NO."]);

    expect(facts.map((f) => f.value)).toEqual(["K12", "K12"]);
  });

  it("prefers the typed value over the one in details", () => {
    // A name that fails to resolve against the site's catalog would otherwise
    // take the standard field with it.
    const detail = issueDetailFor({
      priority: "High",
      details: [{ id: "priority", label: "Priority", value: "stale" }],
    });

    expect(buildFacts(detail, ["Priority"])[0].value).toBe("High");
  });

  it("carries an Assets field's objects through", () => {
    const facts = buildFacts(DETAIL, ["Machine"]);

    expect(facts[0].assets).toEqual([{ name: "Pump 4", objectId: "o1" }]);
  });

  it("keeps a configured field the issue has no value for", () => {
    // It still has a place in the layout; whether it is drawn is decided by
    // `visibleFacts`.
    const facts = buildFacts(DETAIL, ["Nothing Here"]);

    expect(facts).toHaveLength(1);
    expect(facts[0].value).toBeUndefined();
  });

  it("never includes the status, which the header's picker owns", () => {
    // Repeating it a few centimetres below invites the two to disagree.
    const detail = issueDetailFor({ status: "In Progress" });

    expect(buildFacts(detail, ["Status"])[0].value).toBeUndefined();
  });
});

describe("visibleFacts", () => {
  const grid = (value?: string) => ({
    label: "Plant",
    jiraName: "Plant",
    value,
  });
  const sizes = (size: FieldSize) => ({
    arranging: false,
    sizeOf: () => size,
    isEditable: () => false,
  });

  it("shows everything while arranging, values or not", () => {
    // A field with no value still has a place that has to be movable.
    const facts = [grid("K12"), grid(undefined)];

    expect(
      visibleFacts(facts, { ...sizes("normal"), arranging: true }),
    ).toHaveLength(2);
  });

  it("hides an empty grid field that cannot be filled in", () => {
    expect(visibleFacts([grid(undefined)], sizes("normal"))).toHaveLength(0);
  });

  it("keeps an empty grid field that can be", () => {
    // That is exactly when somebody wants it.
    expect(
      visibleFacts([grid(undefined)], {
        ...sizes("normal"),
        isEditable: () => true,
      }),
    ).toHaveLength(1);
  });

  it("hides an empty full-width field even when it is editable", () => {
    // A full-width field is prose, and an empty block of prose is a heading
    // with nothing under it.
    expect(
      visibleFacts([grid(undefined)], {
        ...sizes("full"),
        isEditable: () => true,
      }),
    ).toHaveLength(0);
  });

  it("keeps anything with a value", () => {
    expect(visibleFacts([grid("K12")], sizes("normal"))).toHaveLength(1);
    expect(visibleFacts([grid("K12")], sizes("full"))).toHaveLength(1);
  });
});
