"use client";

/**
 * MUX-89: "Mit dem Mentor besprechen" on an answered practice card.
 * Never in exam simulation (examMode renders nothing; /exam never mounts it).
 * Prominent after a wrong answer, quieter after a correct one. No upsell.
 *
 * a-mentor-question-entry-v2 (NEXT_PUBLIC_MENTOR_QUESTION_ENTRY_V2, default
 * off): exactly one entry per answered card, placed by outcome, with the
 * learner's question drafted in the composer (never auto-sent) and no
 * "counts as one message" note on the card entry. Wrong or partial: under the feedback strip,
 * prominent. Correct or open answer: end of the Erklärung pane, quiet; under
 * the strip instead when the card has no Erklärung pane. The KI-Erklärung pane
 * entry keeps today's label. Flag off: today's output byte for byte.
 */
import { MentorEntryLink } from "./MentorEntryLink";
import { entryLang, entryT } from "./entry-copy";
import { a39T } from "../a39-copy";
import { mentorQuestionEntryV2 } from "@/lib/mentor/question-entry-flag";

export interface MentorQuestionEntryProps {
  questionId: number;
  /** The chosen option text(s), joined; omitted for open answers. */
  selectedOptionText?: string;
  /** null when ungraded (open answer). */
  wasCorrect: boolean | null;
  answered: boolean;
  examMode?: boolean;
  /**
   * "answer": under the feedback strip. "explanation": bottom of the KI-Erklärung tab.
   * "erklaerung" (v2 only): end of the Erklärung pane.
   */
  placement: "answer" | "explanation" | "erklaerung";
  /** v2: false when the card renders no Erklärung pane (hideExplanation), so the strip carries the entry. */
  explanationPane?: boolean;
  lang: string;
  className?: string;
  /** Test seam; production reads the build flag. */
  v2?: boolean;
}

type Shape = { label: string; draft?: string; tone: "prominent" | "quiet"; note?: string } | null;

/** Pure placement rule; exported for tests. */
export function questionEntryShape(p: Pick<MentorQuestionEntryProps, "wasCorrect" | "placement" | "explanationPane" | "lang">, v2: boolean): Shape {
  const wrong = p.wasCorrect === false;
  if (!v2) {
    if (p.placement === "erklaerung") return null;
    return { label: entryT("question_cta", p.lang), note: entryT("counts_one", p.lang), tone: wrong && p.placement === "answer" ? "prominent" : "quiet" };
  }
  const draftLang = entryLang(p.lang);
  // The KI-Erklärung pane entry stays as is (spec B), note included.
  if (p.placement === "explanation") return { label: entryT("question_cta", p.lang), note: entryT("counts_one", p.lang), tone: "quiet" };
  if (wrong) {
    return p.placement === "answer" ? { label: entryT("question_cta_wrong", p.lang), draft: a39T("starter_wrong", draftLang), tone: "prominent" } : null;
  }
  const paneShown = p.explanationPane !== false;
  const here = p.placement === "erklaerung" ? paneShown : !paneShown;
  return here ? { label: entryT("question_cta_right", p.lang), draft: a39T("starter_steps", draftLang), tone: "quiet" } : null;
}

export function MentorQuestionEntry({ questionId, selectedOptionText, wasCorrect, answered, examMode = false, placement, explanationPane, lang, className, v2 }: MentorQuestionEntryProps) {
  if (examMode || !answered) return null;
  const on = v2 ?? mentorQuestionEntryV2();
  const shape = questionEntryShape({ wasCorrect, placement, explanationPane, lang }, on);
  if (!shape) return null;
  const from = placement === "answer" ? "question" : "explanation";
  return (
    <MentorEntryLink
      surface={from}
      dedupKey={`${placement}:${questionId}`}
      from={from}
      mode="explain"
      questionId={questionId}
      answered
      selectedOptionText={selectedOptionText}
      label={shape.label}
      {...(shape.note ? { note: shape.note } : {})}
      {...(shape.draft ? { draft: shape.draft } : {})}
      tone={shape.tone}
      className={className}
    />
  );
}

export default MentorQuestionEntry;
