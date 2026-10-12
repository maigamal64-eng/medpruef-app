"use client";

/**
 * QuestionReportForm: the quiz card's report entry. Since a23 (UX-PRA-35 step
 * 2) it is a thin adapter over ReportQuestionModal, so the quiz, exam review
 * and flashcards share one dialog: only a stored report (2xx) is thanked,
 * failures and offline keep the dialog and the typed text, a 429 has its own
 * line, and a double submit sends once.
 */

import ReportQuestionModal from "@/components/ReportQuestionModal";
import type { ReportReason } from "@/components/question/report-reasons";

type Lang = "de" | "en";

interface Props {
  open: boolean;
  questionId: number;
  lang: Lang;
  /** Pre-filled question stem for the edit flow. */
  initialQuestion: string;
  /** Pre-filled explanation for the edit flow. */
  initialExplanation: string;
  /** Pre-filled topic for the edit flow. Used to detect topic edits. */
  initialTopic: string;
  /** Kept for call-site compatibility; the server reads identity from the session. */
  userId?: string | null;
  /** Kept for call-site compatibility; the server reads identity from the session. */
  guestId?: string | null;
  /** Fired when the dialog should close (user cancel or after the thank-you). */
  onClose: () => void;
  /** Open straight into a flag with this reason (e.g. the image error's "Bild fehlt"). */
  preset?: { reason: ReportReason } | null;
  /** Fired once the report is stored, so the parent can show "Gemeldet". */
  onSubmitted: () => void;
}

export default function QuestionReportForm({
  open,
  questionId,
  lang,
  initialQuestion,
  initialExplanation,
  initialTopic,
  onClose,
  onSubmitted,
  preset,
}: Props) {
  return (
    <ReportQuestionModal
      open={open}
      onClose={onClose}
      lang={lang}
      questionId={questionId}
      questionText={initialQuestion}
      explanation={initialExplanation}
      topic={initialTopic}
      preset={preset ?? null}
      onSubmitted={onSubmitted}
    />
  );
}
