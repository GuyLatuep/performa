import { describe, expect, it } from "vitest";
import {
  listSentence,
  offeredTransitions,
  statusOptionLabel,
  statusOptions,
} from "./transitions";
import { FieldMeta, Transition } from "./api";

function meta(over: Partial<FieldMeta> = {}): FieldMeta {
  return {
    id: "resolution",
    name: "Resolution",
    required: true,
    schemaType: "resolution",
    operations: ["set"],
    allowedValues: [{ id: "1", label: "Done" }],
    ...over,
  };
}

function transition(over: Partial<Transition> = {}): Transition {
  return {
    id: "31",
    name: "Start Progress",
    to: "In Arbeit",
    fields: [],
    ...over,
  };
}

describe("offeredTransitions", () => {
  it("runs a move with no screen directly", () => {
    const [offered] = offeredTransitions([transition()]);
    expect(offered.mode).toBe("direct");
    expect(offered.form).toEqual([]);
    expect(offered.title).toBe("Move this issue to In Arbeit");
  });

  it("opens a form for a move whose required fields can be rendered", () => {
    const [offered] = offeredTransitions([
      transition({ name: "Done", fields: [meta()] }),
    ]);
    expect(offered.mode).toBe("screen");
    expect(offered.title).toBe(
      "Move this issue to In Arbeit — asks for Resolution",
    );
  });

  it("blocks a move whose required field has no input in this app", () => {
    const [offered] = offeredTransitions([
      transition({
        fields: [meta({ name: "Approver", schemaType: "user" })],
      }),
    ]);
    expect(offered.mode).toBe("blocked");
    expect(offered.title).toBe(
      "Needs Approver, which this app cannot fill in — finish this move in Jira",
    );
  });

  it("still opens a form when only an optional field is unrenderable", () => {
    // The move can be completed; the odd field is just shown as unavailable.
    const [offered] = offeredTransitions([
      transition({
        fields: [
          meta(),
          meta({ name: "Sprint", schemaType: "any", required: false }),
        ],
      }),
    ]);
    expect(offered.mode).toBe("screen");
  });

  it("names several required fields as a sentence", () => {
    const [offered] = offeredTransitions([
      transition({
        fields: [meta(), meta({ id: "assignee", name: "Assignee" })],
      }),
    ]);
    expect(offered.title).toContain("asks for Resolution and Assignee");
  });

  it("describes a screen of only optional fields without listing them", () => {
    const [offered] = offeredTransitions([
      transition({ fields: [meta({ required: false })] }),
    ]);
    expect(offered.mode).toBe("screen");
    expect(offered.title).toBe("Move this issue to In Arbeit — opens a form");
  });

  it("keeps the workflow's own order rather than floating runnable ones up", () => {
    // The order is a sequence somebody designed; re-sorting it would scramble
    // the story the workflow tells.
    const offered = offeredTransitions([
      transition({ id: "1", fields: [meta({ schemaType: "user" })] }),
      transition({ id: "2" }),
    ]);
    expect(offered.map((t) => t.id)).toEqual(["1", "2"]);
  });

  it("falls back to the transition's name when Jira omits the target", () => {
    const [offered] = offeredTransitions([
      transition({ name: "Escalate", to: undefined }),
    ]);
    expect(offered.title).toBe("Run Escalate");
  });

  it("is empty when the workflow permits nothing", () => {
    expect(offeredTransitions([])).toEqual([]);
  });
});

describe("statusOptions", () => {
  it("labels a choice by where it leads, not how the workflow spells it", () => {
    const [option] = statusOptions(
      offeredTransitions([
        transition({ name: "Start Progress", to: "In Arbeit" }),
      ]),
    );
    expect(statusOptionLabel(option)).toBe("In Arbeit");
  });

  it("offers each destination once", () => {
    // Two ways to reach the same status are one choice to a person.
    const options = statusOptions(
      offeredTransitions([
        transition({ id: "1", name: "Resolve", to: "Done" }),
        transition({ id: "2", name: "Close", to: "done" }),
        transition({ id: "3", name: "Reopen", to: "Open" }),
      ]),
    );
    expect(options.map(statusOptionLabel)).toEqual(["Done", "Open"]);
  });

  it("falls back to the transition name when there is no target", () => {
    const [option] = statusOptions(
      offeredTransitions([transition({ name: "Escalate", to: undefined })]),
    );
    expect(statusOptionLabel(option)).toBe("Escalate");
  });

  it("keeps blocked moves in the list so they can be shown as unavailable", () => {
    const options = statusOptions(
      offeredTransitions([
        transition({
          id: "1",
          to: "Done",
          fields: [meta({ schemaType: "user" })],
        }),
      ]),
    );
    expect(options).toHaveLength(1);
    expect(options[0].mode).toBe("blocked");
  });

  it("is empty when nothing is offered", () => {
    expect(statusOptions([])).toEqual([]);
  });
});

describe("listSentence", () => {
  it("renders one, two and three items", () => {
    expect(listSentence(["A"])).toBe("A");
    expect(listSentence(["A", "B"])).toBe("A and B");
    expect(listSentence(["A", "B", "C"])).toBe("A, B and C");
  });

  it("is empty for nothing", () => {
    expect(listSentence([])).toBe("");
  });
});
