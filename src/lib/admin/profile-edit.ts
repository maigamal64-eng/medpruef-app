/**
 * Admin learner-profile edit planning (ADM-06). Pure so it can be unit-tested.
 * Emails are normalized exactly like login (trim + lowercase), so a capital
 * letter typed by an admin can no longer lock a learner out of password login.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_MAX = 100;
const EMAIL_MAX = 254;

export interface ProfileSnapshot {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export type ProfilePlan = { changes: Partial<ProfileSnapshot> } | { error: string };

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function planProfileEdit(current: ProfileSnapshot, updates: Record<string, unknown>): ProfilePlan {
  const changes: Partial<ProfileSnapshot> = {};

  for (const key of ["first_name", "last_name"] as const) {
    if (updates[key] === undefined) continue;
    if (updates[key] !== null && typeof updates[key] !== "string") return { error: `${key} must be text` };
    const next = typeof updates[key] === "string" ? (updates[key] as string).trim() : "";
    if (next.length > NAME_MAX) return { error: `${key} is longer than ${NAME_MAX} characters` };
    const value = next === "" ? null : next;
    if (value !== (current[key] ?? null)) changes[key] = value;
  }

  if (updates.email !== undefined) {
    if (updates.email !== null && typeof updates.email !== "string") return { error: "email must be text" };
    const next = typeof updates.email === "string" ? normalizeEmail(updates.email) : "";
    if (next === "") {
      // A Telegram-only learner has no email; an empty field means "unchanged".
      if (current.email) return { error: "An email cannot be removed here" };
    } else {
      if (next.length > EMAIL_MAX || !EMAIL_RE.test(next)) return { error: "Enter a valid email address" };
      if (next !== current.email) changes.email = next;
    }
  }

  return { changes };
}

/** Escape LIKE metacharacters so ilike performs a case-insensitive equality. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
