"use client";

import { t } from "@/lib/i18n";

type Lang = "de" | "en";

interface DailyGoalRingProps {
  current: number;
  goal: number;
  lang: Lang;
}

export default function DailyGoalRing({ current, goal, lang }: DailyGoalRingProps) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(current / goal, 1);
  const offset = circumference - progress * circumference;

  return (
    <div className="bg-[#1E293B]/60 border border-[#334155]/50 rounded-xl p-4 animate-fade-in">
      <div className="flex items-center gap-4">
        <div className="relative w-24 h-24 flex-shrink-0">
          <svg width="96" height="96" viewBox="0 0 96 96">
            {/* Background circle */}
            <circle
              cx="48" cy="48" r={radius}
              fill="none"
              stroke="#334155"
              strokeWidth="6"
            />
            {/* Progress circle */}
            <circle
              cx="48" cy="48" r={radius}
              fill="none"
              stroke={progress >= 1 ? "#10B981" : "#0891B2"}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="progress-ring-circle"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold text-white">{current}</span>
            <span className="text-[10px] text-[#64748B]">/ {goal}</span>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-[#F1F5F9] mb-1">{t("daily_progress", lang)}</p>
          <p className="text-xs text-[#94A3B8]">{t("questions_today", lang)}</p>
          {progress >= 1 && (
            <span className="inline-block mt-2 text-xs font-medium text-[#10B981] bg-[#10B981]/10 px-2 py-0.5 rounded-full">
              ✅ {t("correct", lang)}!
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
