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
    <div className="bg-[#FFFFFF] border border-[#E4E9F0] rounded p-4 animate-fade-in">
      <div className="flex items-center gap-4">
        <div className="relative w-24 h-24 flex-shrink-0">
          <svg width="96" height="96" viewBox="0 0 96 96">
            {/* Track */}
            <circle cx="48" cy="48" r={radius} fill="none" stroke="#F7F9FC" strokeWidth="5" />
            {/* Progress */}
            <circle
              cx="48" cy="48" r={radius}
              fill="none"
              stroke={progress >= 1 ? "#00A896" : "#007B5F"}
              strokeWidth="5"
              strokeLinecap="butt"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="progress-ring-circle"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold text-[#1A2B3C] font-mono">{current}</span>
            <span className="text-[10px] text-[#A0AEC0] font-mono">/ {goal}</span>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-[#1A2B3C] mb-1">{t("daily_progress", lang)}</p>
          <p className="text-xs text-[#4A5568]">{t("questions_today", lang)}</p>
          {progress >= 1 && (
            <span className="inline-block mt-2 text-xs font-medium text-[#00A896] bg-[#00A896]/10 px-2 py-0.5 rounded border border-[#00A896]/20">
              ✅ {t("correct", lang)}!
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
