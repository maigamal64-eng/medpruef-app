import { MENTOR_ENTRIES, MENTOR_MODES, type MentorEntry, type MentorMode } from "@/lib/mentor/contract";

export interface MentorEntryContext {
  mode: MentorMode;
  entry: MentorEntry;
  questionId?: number;
  answered: boolean;
  selectedOptionText?: string;
  draft: string;
}
/** URL data is untrusted draft context. This function never sends a turn. */
export function parseMentorEntry(search: string): MentorEntryContext {
  const p = new URLSearchParams(search);
  const one = (key: string) => p.getAll(key).length === 1 ? p.get(key) : null;
  const from = one("from");
  const entry: MentorEntry = from && from !== "telegram" && (MENTOR_ENTRIES as readonly string[]).includes(from) ? from as MentorEntry : "nav";
  const rawId = one("question_id");
  const n = rawId && /^[1-9]\d{0,9}$/.test(rawId) ? Number(rawId) : undefined;
  const questionId = n && n <= 2_147_483_647 ? n : undefined;
  const rawMode = one("mode");
  const mode = rawMode && (MENTOR_MODES as readonly string[]).includes(rawMode) ? rawMode as MentorMode : questionId ? "explain" : "facts";
  // An exam-mode deep link must never attach a question for mentor explanation.
  const examMode = ["true", "1"].includes(one("exam_mode") ?? "");
  const selected = one("selected_option");
  const safeId = !examMode && mode === "explain" ? questionId : undefined;
  const rawDraft = one("q") ?? "";
  return {
    mode: mode === "explain" && !safeId ? "facts" : mode,
    entry, questionId: safeId, answered: one("answered") !== "0",
    ...(safeId && selected && selected.length <= 300 ? { selectedOptionText: selected } : {}),
    draft: [...rawDraft].slice(0, 200).join(""),
  };
}
