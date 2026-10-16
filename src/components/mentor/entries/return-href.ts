/**
 * a-mentor-question-entry-v2 (spec D): keep the learner's question through a
 * packages checkout in the same tab. Pure helpers; the caller owns storage.
 * The stored value is only ever a /mentor link that this module rebuilt from
 * its own parse, so the success screen can never be steered to another path,
 * a protocol-relative URL or a script URL.
 */
import { parseMentorEntry, type MentorEntryContext } from "../entry";
import { mentorEntryHref, type MentorEntryHrefInput } from "./href";

/** Return links older than this fall back to plain /mentor. */
export const MENTOR_RETURN_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function mentorReturnKey(userId: string): string {
  return `medpruef_mentor_${userId}_return`;
}

/** Input for mentorEntryHref from a parsed context; null unless it is an explain context with a question. */
export function mentorReturnInput(ctx: MentorEntryContext): MentorEntryHrefInput | null {
  if (ctx.mode !== "explain" || ctx.questionId === undefined || ctx.entry === "telegram") return null;
  return {
    mode: "explain",
    from: ctx.entry,
    questionId: ctx.questionId,
    answered: ctx.answered,
    ...(ctx.selectedOptionText ? { selectedOptionText: ctx.selectedOptionText } : {}),
    ...(ctx.draft ? { draft: ctx.draft } : {}),
  };
}

/** The canonical form of a /mentor link, or null when it does not survive a parse and rebuild unchanged. */
export function canonicalMentorReturn(href: unknown): string | null {
  if (typeof href !== "string" || !href.startsWith("/mentor?")) return null;
  const input = mentorReturnInput(parseMentorEntry(href.slice("/mentor".length)));
  if (!input) return null;
  const rebuilt = mentorEntryHref(input);
  return rebuilt === href ? rebuilt : null;
}

/** Serialised storage value, or null when the context has no question to keep. */
export function buildMentorReturn(input: MentorEntryHrefInput, now: number): string | null {
  const href = canonicalMentorReturn(mentorEntryHref(input));
  return href ? JSON.stringify({ href, at: now }) : null;
}

/** The stored link when fresh and canonical; otherwise null (caller falls back to /mentor). */
export function readMentorReturn(raw: string | null | undefined, now: number): string | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object") return null;
  const { href, at } = value as { href?: unknown; at?: unknown };
  if (typeof at !== "number" || !Number.isFinite(at) || at > now || now - at > MENTOR_RETURN_MAX_AGE_MS) return null;
  return canonicalMentorReturn(href);
}
