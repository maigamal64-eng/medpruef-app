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
    <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 animate-fade-in">
      <div className="flex items-center gap-4">
        <div className="relative w-24 h-24 flex-shrink-0">
          <svg width="96" height="96" viewBox="0 0 96 96">
            {/* Track */}
            <circle cx="48" cy="48" r={radius} fill="none" stroke="#23293C" strokeWidth="5" />
            {/* Progress */}
            <circle
              cx="48" cy="48" r={radius}
              fill="none"
              stroke={progress >= 1 ? "#4EDEA3" : "#6BD8CB"}
              strokeWidth="5"
              strokeLinecap="butt"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="progress-ring-circle"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold text-[#DCE1FB] font-mono">{current}</span>
            <span className="text-[10px] text-[#879391] font-mono">/ {goal}</span>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-[#DCE1FB] mb-1">{t("daily_progress", lang)}</p>
          <p className="text-xs text-[#BCC9C6]">{t("questions_today", lang)}</p>
          {progress >= 1 && (
            <span className="inline-block mt-2 text-xs font-medium text-[#4EDEA3] bg-[#4EDEA3]/10 px-2 py-0.5 rounded border border-[#4EDEA3]/20">
              ✅ {t("correct", lang)}!
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
