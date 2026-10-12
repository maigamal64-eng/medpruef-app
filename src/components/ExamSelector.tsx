"use client";
import { t, type Lang } from "@/lib/i18n";

import { EXAM_SOURCES, setStoredExamSource, type ExamSourceId } from "@/lib/topics";

interface Props {
  lang: Lang;
  onSelect: (id: ExamSourceId) => void;
}

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
              <span className="text-2xl">{exam.badge}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[var(--mp-fg)] text-sm">{exam.fullName}</span>
                  <span className="text-[10px] font-mono bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] px-1.5 py-0.5 rounded border border-[var(--mp-viridian)]/20">
                    {exam.id}
                  </span>
                </div>
                <div className="text-xs text-[var(--mp-fg-subtle)] font-mono mt-0.5">
                  {exam.questions.toLocaleString("de-DE")}{" "}
                  {t("home_questions_66", lang)}
                </div>
              </div>
              <span className="text-[var(--mp-viridian)] opacity-0 group-hover:opacity-100 transition-opacity text-lg">
                →
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 p-3 rounded border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] text-center">
          <p className="text-xs text-[var(--mp-fg-subtle)]">
            {t("home_more_exams_coming_soon", lang)}
          </p>
        </div>

        <p className="text-center text-[10px] text-[var(--mp-fg-subtle)]/60 mt-4">
          {t("home_you_can_change_this_anytime_in_your_profile", lang)}
        </p>
      </div>
    </div>
  );
}
