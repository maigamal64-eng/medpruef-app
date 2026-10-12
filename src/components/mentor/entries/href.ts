import type { MentorEntry, MentorMode } from "@/lib/mentor/contract";

/** Web entries only: the Telegram channel never comes from a page link. */
export type MentorWebEntry = Exclude<MentorEntry, "telegram">;

export interface MentorEntryHrefInput {
  mode: MentorMode;
  from: MentorWebEntry;
  questionId?: number;
  answered?: boolean;
  /** The learner's chosen option TEXT (never an index). Dropped above 300 characters. */
  selectedOptionText?: string;
  /** Composer draft, never auto-sent. Cut to 200 characters. */
  draft?: string;
}

export const MENTOR_SELECTED_OPTION_MAX = 300;
export const MENTOR_DRAFT_MAX = 200;

/**
 * Builds a /mentor link that `parseMentorEntry` (src/components/mentor/entry.ts)
 * reads back unchanged. Pure: no window, no storage.
 */
export function mentorEntryHref(input: MentorEntryHrefInput): string {
  const p = new URLSearchParams();
  const id = input.questionId;
  const validId = typeof id === "number" && Number.isInteger(id) && id > 0 && id <= 2_147_483_647;
  // The parser downgrades explain without a question to facts; mirror it here.
  const mode: MentorMode = input.mode === "explain" && !validId ? "facts" : input.mode;
  p.set("mode", mode);
  if (mode === "explain" && validId) {
    p.set("question_id", String(id));
    if (input.answered !== undefined) p.set("answered", input.answered ? "1" : "0");
    const sel = input.selectedOptionText?.trim();
    if (sel && sel.length <= MENTOR_SELECTED_OPTION_MAX) p.set("selected_option", sel);
  }
  const draft = input.draft ? [...input.draft].slice(0, MENTOR_DRAFT_MAX).join("") : "";
  if (draft) p.set("q", draft);
  p.set("from", input.from);
  return `/mentor?${p.toString()}`;
}
