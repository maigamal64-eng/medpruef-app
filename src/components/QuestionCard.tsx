"use client";

import { getTopicConfig } from "@/lib/topics";
import { t } from "@/lib/i18n";

type Lang = "de" | "en";

interface Question {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  difficulty: number;
  exam_dates: string[];
}

interface QuestionCardProps {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  lang: Lang;
}

export default function QuestionCard({ question, questionNumber, totalQuestions, lang }: QuestionCardProps) {
  const config = getTopicConfig(question.topic);

  return (
    <div className="bg-[#1E293B]/60 border border-[#334155]/50 rounded-2xl p-5 md:p-6 animate-slide-up">
      {/* Top row: topic badge + question counter */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
            style={{ backgroundColor: `${config.color}15`, color: config.color }}
          >
            <span>{config.icon}</span>
            <span className="max-w-[140px] truncate">{question.topic}</span>
          </span>
        </div>
        <span className="text-xs text-[#64748B] font-medium">
          {t("q", lang)}{questionNumber} {t("of", lang)} {totalQuestions}
        </span>
      </div>

      {/* Difficulty dots */}
      <div className="flex items-center gap-1.5 mb-4">
        {[1, 2, 3, 4, 5].map((d) => (
          <div
            key={d}
            className={`w-2 h-2 rounded-full transition-colors ${
              d <= question.difficulty ? "bg-[#F59E0B]" : "bg-[#334155]"
            }`}
          />
        ))}
        <span className="text-[10px] text-[#64748B] ml-1">
          {t("difficulty", lang)} {question.difficulty}/5
        </span>
      </div>

      {/* Question text */}
      <p className="text-base md:text-lg leading-relaxed font-medium text-[#F1F5F9]">
        {question.question}
      </p>

      {/* Exam date pills */}
      {question.exam_dates && question.exam_dates.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {question.exam_dates.slice(0, 5).map((d) => (
            <span
              key={d}
              className="text-[10px] bg-[#334155]/50 text-[#94A3B8] px-2 py-0.5 rounded-full border border-[#334155]/30"
            >
              {d}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
