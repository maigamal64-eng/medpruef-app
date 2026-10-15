"use client";

import PublicStudyLink from "@/components/PublicStudyLink";
import { freeStudyDestination } from "@/lib/auth-entry";
import type { ExamSourceId } from "@/lib/topics";

/** Free-sample entry for one bank (client: auth-entry reads browser storage). */
export default function AnswerSampleLink({ bank, label }: { bank: ExamSourceId; label: string }) {
  return <PublicStudyLink href={freeStudyDestination(bank)} data-answer-sample
    className="mp-btn mp-btn--primary mt-3 inline-flex min-h-11 items-center justify-center !no-underline !text-[var(--mp-fg-on-cta-blue)]">
    {label}
  </PublicStudyLink>;
}
