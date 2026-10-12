"use client";

/**
 * MUX-89: "Mit dem Mentor besprechen" on an answered practice card.
 * Never in exam simulation (examMode renders nothing; /exam never mounts it).
 * Prominent after a wrong answer, quieter after a correct one. No upsell.
 */
import { MentorEntryLink } from "./MentorEntryLink";
import { entryT } from "./entry-copy";

export interface MentorQuestionEntryProps {
  questionId: number;
  /** The chosen option text(s), joined; omitted for open answers. */
  selectedOptionText?: string;
  /** null when ungraded (open answer). */
  wasCorrect: boolean | null;
  answered: boolean;
  examMode?: boolean;
  /** "answer": under the feedback strip. "explanation": bottom of the KI-Erklärung tab. */
  placement: "answer" | "explanation";
  lang: string;
  className?: string;
}

export function MentorQuestionEntry({ questionId, selectedOptionText, wasCorrect, answered, examMode = false, placement, lang, className }: MentorQuestionEntryProps) {
  if (examMode || !answered) return null;
  const from = placement === "explanation" ? "explanation" : "question";
  return (
    <MentorEntryLink
      surface={from}
      from={from}
      mode="explain"
      questionId={questionId}
      answered
      selectedOptionText={selectedOptionText}
      label={entryT("question_cta", lang)}
      note={entryT("counts_one", lang)}
      tone={wasCorrect === false && placement === "answer" ? "prominent" : "quiet"}
      className={className}
    />
  );
}

export default MentorQuestionEntry;
