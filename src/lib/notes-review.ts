/**
 * TR-08: review status of a public flash-note, derived from notes.metadata
 * (no DDL). A reviewer records `reviewed_by_role` and `reviewed_on`
 * (YYYY-MM-DD) in metadata with a jsonb merge after a content audit.
 *
 *   ai_draft   source_type ai_explanation and no reviewed_on
 *   reviewed   a valid reviewed_on date (role optional)
 *   none       anything else (manual notes without a review record)
 *
 * The raw metadata never leaves the server; routes add this projection.
 */

export type NoteReviewStatus = "ai_draft" | "reviewed" | "none";

export interface NoteReview {
  status: NoteReviewStatus;
  role: string | null;
  on: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function noteReviewFromMetadata(metadata: Record<string, unknown> | null | undefined, sourceType: unknown): NoteReview {
  const reviewedOn = typeof metadata?.reviewed_on === "string" && ISO_DATE.test(metadata.reviewed_on) && Number.isFinite(Date.parse(metadata.reviewed_on))
    ? metadata.reviewed_on
    : null;
  const rawRole = typeof metadata?.reviewed_by_role === "string" ? metadata.reviewed_by_role.replace(/\s+/g, " ").trim().slice(0, 40) : "";
  if (reviewedOn) return { status: "reviewed", role: rawRole || null, on: reviewedOn };
  if (sourceType === "ai_explanation") return { status: "ai_draft", role: null, on: null };
  return { status: "none", role: null, on: null };
}

export const NOTE_REVIEW_COPY = {
  de: {
    aiDraft: "KI-Entwurf, ungeprüft",
    aiDraftHint: "Automatisch aus der Erklärung zur Frage erstellt und noch nicht von einer Fachperson geprüft.",
    reviewed: "Geprüft von {role} am {date}",
    reviewedNoRole: "Geprüft am {date}",
    locale: "de-AT",
  },
  en: {
    aiDraft: "AI draft, not reviewed",
    aiDraftHint: "Generated automatically from the question's explanation and not yet checked by a specialist.",
    reviewed: "Reviewed by {role} on {date}",
    reviewedNoRole: "Reviewed on {date}",
    locale: "en-GB",
  },
} as const;

export function noteReviewLabel(review: NoteReview | null | undefined, lang: "de" | "en"): { text: string; hint: string | null } | null {
  if (!review || review.status === "none") return null;
  const c = NOTE_REVIEW_COPY[lang];
  if (review.status === "ai_draft") return { text: c.aiDraft, hint: c.aiDraftHint };
  const date = review.on ? new Date(`${review.on}T12:00:00Z`).toLocaleDateString(c.locale, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" }) : "";
  return { text: (review.role ? c.reviewed.replace("{role}", review.role) : c.reviewedNoRole).replace("{date}", date), hint: null };
}

/** UI language → review-label language (German or the English fallback). */
export function reviewLang(lang: string): "de" | "en" {
  return lang.startsWith("de") ? "de" : "en";
}

/**
 * Metadata keys that grant trust labels. Only server-side review tooling
 * (service role SQL) may write them; learner input drops them (a15 review).
 */
export const RESERVED_NOTE_METADATA_KEYS = ["reviewed_on", "reviewed_by_role", "curated", "guide"] as const;

export function stripReservedNoteMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const out = { ...(metadata as Record<string, unknown>) };
  for (const key of RESERVED_NOTE_METADATA_KEYS) delete out[key];
  return out;
}
