"use client";
import { t, type Lang } from "@/lib/i18n";

import { EXAM_SOURCES, setStoredExamSource, type ExamSourceId } from "@/lib/topics";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { ChevronRight } from "lucide-react";

interface Props {
  lang: Lang;
  onSelect: (id: ExamSourceId) => void;
}

// UX-GLOBAL-07: the picker shows exam names only; no raw database keys,
// hand-typed question counts or "more exams coming soon" promise.
export default function ExamSelector({ lang, onSelect }: Props) {
  const handle = (id: ExamSourceId) => {
    setStoredExamSource(id);
    onSelect(id);
  };

  return (
    <div className="fixed inset-0 bg-[var(--mp-surface-sunken)] z-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md animate-scale-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/10 flex items-center justify-center mx-auto mb-4">
            <img src="/brand/logomark.svg" alt="MedPrüf" className="w-12 h-12" />
          </div>
          <img src="/brand/wordmark-twotone.png" alt="MedPrüf" className="h-10 mx-auto" />
          <p className="text-[var(--mp-fg-subtle)] text-sm">
            {t("home_which_exam_are_you_preparing_for", lang)}
          </p>
        </div>

        {/* Options */}
        <div className="space-y-2.5">
          {EXAM_SOURCES.map((exam) => (
            <button
              key={exam.id}
              onClick={() => handle(exam.id)}
              className="w-full flex items-center gap-4 bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--mp-viridian)]/50 hover:bg-[var(--mp-surface-sunken)] rounded-xl p-4 text-left transition-all active:scale-[0.98] group"
            >
              <div className="flex-1 min-w-0">
                <span className="block font-semibold text-[var(--mp-fg)] text-sm">{getExamLabel(exam.id, "full", lang)}</span>
                <span className="block text-xs text-[var(--mp-fg-muted)]">{getExamLabel(exam.id, "bridge", lang)}</span>
              </div>
              <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-[var(--mp-viridian)] opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180" />
            </button>
          ))}
        </div>

        <p className="text-center text-[10px] text-[var(--mp-fg-subtle)]/60 mt-4">
          {t("home_you_can_change_this_anytime_in_your_profile", lang)}
        </p>
      </div>
    </div>
  );
}
