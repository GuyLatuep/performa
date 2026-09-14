import { persisted } from "./persist";

// Saved worklog templates for recurring entries (standup, support duty, …).
// Stored locally; shown as one-click chips on the start tab.

export interface WorklogTemplate {
  id: string;
  issueKey: string;
  issueSummary: string;
  /** Duration as entered, e.g. "1h 30m". */
  duration: string;
  comment: string;
  nonBillable: boolean;
}

const TEMPLATES_KEY = "performa-worklog-templates";

const store = persisted<WorklogTemplate[]>(TEMPLATES_KEY, (stored) =>
  Array.isArray(stored)
    ? stored.filter(
        (t): t is WorklogTemplate =>
          !!t &&
          typeof t.id === "string" &&
          typeof t.issueKey === "string" &&
          typeof t.duration === "string",
      )
    : [],
);

export function useTemplates(): WorklogTemplate[] {
  return store.use();
}

export function addTemplate(template: Omit<WorklogTemplate, "id">): void {
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : String(Date.now());
  store.save([...store.get(), { ...template, id }]);
}

export function removeTemplate(id: string): void {
  store.save(store.get().filter((t) => t.id !== id));
}
