import { createStore } from "./store";

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

function readTemplates(): WorklogTemplate[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (t): t is WorklogTemplate =>
        !!t &&
        typeof t.id === "string" &&
        typeof t.issueKey === "string" &&
        typeof t.duration === "string",
    );
  } catch {
    return [];
  }
}

const store = createStore<WorklogTemplate[]>(readTemplates());

function save(list: WorklogTemplate[]): void {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list));
  store.set(list);
}

export function useTemplates(): WorklogTemplate[] {
  return store.use();
}

export function addTemplate(template: Omit<WorklogTemplate, "id">): void {
  const id =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : String(Date.now());
  save([...store.get(), { ...template, id }]);
}

export function removeTemplate(id: string): void {
  save(store.get().filter((t) => t.id !== id));
}
