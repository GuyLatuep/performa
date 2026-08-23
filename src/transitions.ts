import { Transition } from "./api";
import { FormField, screenIsFillable, toFormFields } from "./issueFields";

/**
 * How a transition can be made from here.
 *
 * - `direct` — the move has no screen; pressing the button runs it.
 * - `screen` — it asks for fields, and every required one can be rendered.
 * - `blocked` — a required field is of a type this app has no input for, so
 *   the move can only be completed in Jira.
 */
export type TransitionMode = "direct" | "screen" | "blocked";

/** A transition as the view offers it. */
export interface OfferedTransition extends Transition {
  mode: TransitionMode;
  /** The move's screen, ready to render. Empty for a direct move. */
  form: FormField[];
  /** The button's tooltip: where the move leads, or why it can't be made
   *  here. */
  title: string;
}

/**
 * Every move the workflow permits, in the order Jira listed them.
 *
 * The order is the workflow's own and carries meaning, so it is left alone —
 * sorting runnable moves to the top would scramble a sequence somebody
 * designed. Blocked ones stay in place and say why.
 */
export function offeredTransitions(
  transitions: Transition[],
): OfferedTransition[] {
  return transitions.map((t) => {
    const form = toFormFields(t.fields);
    const mode: TransitionMode =
      form.length === 0
        ? "direct"
        : screenIsFillable(form)
          ? "screen"
          : "blocked";
    return { ...t, form, mode, title: titleFor(t, form, mode) };
  });
}

function titleFor(
  t: Transition,
  form: FormField[],
  mode: TransitionMode,
): string {
  const target = t.to ? `Move this issue to ${t.to}` : `Run ${t.name}`;
  if (mode === "direct") return target;
  if (mode === "screen") {
    const required = form.filter((f) => f.required).map((f) => f.name);
    return required.length === 0
      ? `${target} — opens a form`
      : `${target} — asks for ${listSentence(required)}`;
  }
  const stuck = form
    .filter((f) => f.required && f.kind === "unsupported")
    .map((f) => f.name);
  return `Needs ${listSentence(stuck)}, which this app cannot fill in — finish this move in Jira`;
}

/**
 * "Resolution", "Assignee and Resolution", "Assignee, Resolution and Sprint".
 *
 * A tooltip is a sentence, not a data dump: the fields are the reason the
 * button behaves as it does, so they read as prose.
 */
export function listSentence(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The choices a status picker offers: one entry per status reachable from
 * here.
 *
 * A picker is a list of *destinations*, not of transition names — "In Arbeit"
 * is what somebody means to pick, and "Start Progress" is only how the
 * workflow spells getting there. Transitions with no target of their own
 * (Jira occasionally omits it) fall back to their name, since something has to
 * be shown.
 *
 * Two transitions can lead to the same status; the first wins. Offering the
 * same destination twice would ask the user to choose between two things they
 * cannot tell apart.
 */
export function statusOptions(
  offered: OfferedTransition[],
): OfferedTransition[] {
  const seen = new Set<string>();
  return offered.filter((t) => {
    const label = statusOptionLabel(t).toLowerCase();
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}

/** What the picker shows for one move. */
export function statusOptionLabel(t: OfferedTransition): string {
  return t.to ?? t.name;
}
