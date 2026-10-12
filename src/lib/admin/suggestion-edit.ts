/**
 * Learner question reports and edit suggestions (ADM-05). Pure helpers so the
 * rules are unit-tested: what a learner may submit, and what an admin "Apply
 * edit" may write. Answer keys and choices are never applied from a learner
 * suggestion; those changes go through Browse by hand.
 */
export const EDITABLE_FIELDS = ["question", "explanation", "topic"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export type EditValues = Partial<Record<EditableField, string>>;

const FIELD_MAX: Record<EditableField, number> = { question: 5000, explanation: 10000, topic: 120 };
const DETAILS_MAX = 2000;
const REASON_MAX = 200;

export interface SuggestionSubmission {
  questionId: number;
  type: "flag" | "edit";
  reason: string | null;
  details: string | null;
  suggestedChanges: EditValues | null;
}

export function parseSubmission(body: Record<string, unknown> | null): SuggestionSubmission | { error: string } {
  if (!body) return { error: "Invalid JSON" };
  const questionId = Number(body.questionId);
  if (!Number.isSafeInteger(questionId) || questionId < 1 || questionId > 2_147_483_647) return { error: "questionId and type required" };
  if (body.type !== "flag" && body.type !== "edit") return { error: "type must be 'flag' or 'edit'" };
  const text = (value: unknown, max: number, label: string): string | null | { error: string } => {
    if (value == null || value === "") return null;
    if (typeof value !== "string") return { error: `${label} must be text` };
    if (value.length > max) return { error: `${label} is longer than ${max} characters` };
    return value;
  };
  const reason = text(body.reason, REASON_MAX, "reason");
  if (reason && typeof reason === "object") return reason;
  const details = text(body.details, DETAILS_MAX, "details");
  if (details && typeof details === "object") return details;

  let suggestedChanges: EditValues | null = null;
  if (body.suggestedChanges != null) {
    if (typeof body.suggestedChanges !== "object" || Array.isArray(body.suggestedChanges)) return { error: "suggestedChanges must be an object" };
    const raw = body.suggestedChanges as Record<string, unknown>;
    const accepted: EditValues = {};
    for (const field of EDITABLE_FIELDS) {
      if (raw[field] === undefined) continue;
      if (typeof raw[field] !== "string") return { error: `${field} must be text` };
      if ((raw[field] as string).length > FIELD_MAX[field]) return { error: `${field} is longer than ${FIELD_MAX[field]} characters` };
      accepted[field] = raw[field] as string;
    }
    // Answer keys and choices are dropped at the door, never stored for apply.
    suggestedChanges = Object.keys(accepted).length ? accepted : null;
  }
  return {
    questionId,
    type: body.type,
    reason: reason as string | null,
    details: details as string | null,
    suggestedChanges,
  };
}

/** Fields a stored suggestion may change, ignoring legacy answer/choices keys. */
export function proposedEdit(stored: unknown): EditValues {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const raw = stored as Record<string, unknown>;
  const out: EditValues = {};
  for (const field of EDITABLE_FIELDS) {
    const value = raw[field];
    if (typeof value !== "string" || value.length > FIELD_MAX[field]) continue;
    if ((field === "question" || field === "topic") && value.trim() === "") continue;
    out[field] = value;
  }
  return out;
}

/** True when a stored suggestion asked for answer or choice changes. */
export function asksForKeyChange(stored: unknown): boolean {
  if (!stored || typeof stored !== "object") return false;
  const raw = stored as Record<string, unknown>;
  return raw.answer !== undefined || raw.choices !== undefined;
}

export type StoredValues = Partial<Record<EditableField, string | null>>;

export interface EditPlan {
  /** Live values before the edit; null keeps an empty column empty on revert. */
  before: StoredValues;
  after: EditValues;
}

/** Only the fields that actually differ from the live question. */
export function planEdit(current: Record<string, unknown>, proposal: EditValues): EditPlan {
  const before: StoredValues = {};
  const after: EditValues = {};
  for (const field of EDITABLE_FIELDS) {
    const next = proposal[field];
    if (next === undefined) continue;
    const old = typeof current[field] === "string" ? (current[field] as string) : "";
    if (old === next) continue;
    before[field] = typeof current[field] === "string" ? (current[field] as string) : null;
    after[field] = next;
  }
  return { before, after };
}

/** The live question still shows exactly these values. */
export function matches(current: Record<string, unknown>, values: StoredValues): boolean {
  return Object.entries(values).every(([field, value]) => {
    const live = typeof current[field] === "string" ? (current[field] as string) : null;
    return (live ?? "") === (value ?? "");
  });
}
