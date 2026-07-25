import { describe, expect, it, vi } from "vitest";
import { WorklogTemplate } from "./templates";

const KEY = "performa-worklog-templates";

const template = (issueKey: string): Omit<WorklogTemplate, "id"> => ({
  issueKey,
  issueSummary: `${issueKey} summary`,
  duration: "30m",
  comment: "standup",
  nonBillable: false,
});

async function freshTemplates(seed?: unknown) {
  localStorage.clear();
  if (seed !== undefined) localStorage.setItem(KEY, JSON.stringify(seed));
  vi.resetModules();
  return import("./templates");
}

const persisted = (): WorklogTemplate[] =>
  JSON.parse(localStorage.getItem(KEY) ?? "[]");

describe("worklog templates", () => {
  it("adds a template with a generated id", async () => {
    const { addTemplate } = await freshTemplates();

    addTemplate(template("ABC-1"));

    const [saved] = persisted();
    expect(saved.issueKey).toBe("ABC-1");
    expect(saved.duration).toBe("30m");
    expect(saved.id).toBeTruthy();
  });

  it("gives each template its own id", async () => {
    const { addTemplate } = await freshTemplates();

    addTemplate(template("ABC-1"));
    addTemplate(template("ABC-1"));

    const ids = persisted().map((t) => t.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("removes only the named template", async () => {
    const { addTemplate, removeTemplate } = await freshTemplates();

    addTemplate(template("ABC-1"));
    addTemplate(template("ABC-2"));
    const [first, second] = persisted();

    removeTemplate(first.id);

    expect(persisted()).toHaveLength(1);
    expect(persisted()[0].id).toBe(second.id);
  });

  it("ignores a removal of something that isn't there", async () => {
    const { addTemplate, removeTemplate } = await freshTemplates();

    addTemplate(template("ABC-1"));
    removeTemplate("no-such-id");

    expect(persisted()).toHaveLength(1);
  });

  it("survives malformed storage", async () => {
    for (const junk of ["not json", '"a string"', "42"]) {
      localStorage.clear();
      localStorage.setItem(KEY, junk);
      vi.resetModules();
      const { addTemplate } = await import("./templates");

      addTemplate(template("ABC-1"));
      expect(persisted()).toHaveLength(1);
    }
  });

  it("drops stored entries that are missing required fields", async () => {
    const { addTemplate } = await freshTemplates([
      { id: "1", issueKey: "ABC-1", duration: "1h" },
      { id: "2", issueKey: "ABC-2" }, // no duration — nothing to log
      { issueKey: "ABC-3", duration: "1h" }, // no id — cannot be removed
    ]);

    addTemplate(template("ABC-4"));

    expect(persisted().map((t) => t.issueKey)).toEqual(["ABC-1", "ABC-4"]);
  });
});
