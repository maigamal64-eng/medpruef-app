"use client";

import { t } from "@/lib/i18n";

type Lang = "de" | "en";

interface StreakWidgetProps {
  streak: number;
  lang: Lang;
}

export default function StreakWidget({ streak, lang }: StreakWidgetProps) {
  // Simulate last 7 days activity (in real app, would come from API)
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    if (i < streak && i < 7) return true;
    return Math.random() > 0.5;
  });

  const dayLabels = lang === "de"
    ? ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="bg-[#1E293B]/60 border border-[#334155]/50 rounded-xl p-4 animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl animate-fire">🔥</span>
          <div>
            <p className="text-2xl font-bold text-[#EF4444]">{streak}</p>
            <p className="text-xs text-[#94A3B8]">{t("streak", lang)} · {t("days", lang)}</p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-1">
        {last7Days.map((active, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-medium transition-colors ${
                active
                  ? "bg-[#10B981]/20 text-[#10B981] border border-[#10B981]/30"
                  : "bg-[#334155]/30 text-[#64748B] border border-[#334155]/30"
              }`}
            >
              {active ? "✓" : "·"}
            </div>
            <span className="text-[9px] text-[#64748B]">{dayLabels[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
