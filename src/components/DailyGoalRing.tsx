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

  const pctText = Math.round(progress * 100);

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center gap-4">
        <div className="relative w-24 h-24 flex-shrink-0">
          <svg width="96" height="96" viewBox="0 0 96 96">
            {/* Track */}
            <circle cx="48" cy="48" r={radius} fill="none" stroke="#F7F9FC" strokeWidth="7" />
            {/* Progress */}
            <circle
              cx="48" cy="48" r={radius}
              fill="none"
              stroke={progress >= 1 ? "#00A896" : "#007B5F"}
              strokeWidth="7"
              strokeLinecap="butt"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="progress-ring-circle"
              style={progress >= 1 ? { filter: "drop-shadow(0 0 6px rgba(0, 168, 150, 0.4))" } : undefined}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-black text-[#1A2B3C] font-mono">{current}</span>
            <span className="text-xs text-[#A0AEC0]">{pctText}%</span>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-[#1A2B3C] mb-1">{t("daily_progress", lang)}</p>
          <p className="text-xs text-[#4A5568]">{t("questions_today", lang)}</p>
          {progress >= 1 && (
            <span className="inline-block mt-2 text-xs font-medium text-[#00A896] bg-[#00A896]/10 px-2 py-0.5 rounded border border-[#00A896]/20">
              {t("correct", lang)}!
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
