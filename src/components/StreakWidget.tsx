"use client";

import { t } from "@/lib/i18n";

type Lang = "de" | "en";

interface StreakWidgetProps {
  streak: number;
  lang: Lang;
}

export default function StreakWidget({ streak, lang }: StreakWidgetProps) {
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    if (i < streak && i < 7) return true;
    return Math.random() > 0.5;
  });

  const dayLabels =
    lang === "de"
      ? ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl animate-fire">🔥</span>
          <div>
            <p className="text-2xl font-bold text-[#D64545] font-mono">{streak}</p>
            <p className="text-xs text-[#4A5568]">
              {t("streak", lang)} · {t("days", lang)}
            </p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-1">
        {last7Days.map((active, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-colors border ${
                active
                  ? "bg-[#00A896]/15 text-[#00A896] border-[#00A896]/30"
                  : "bg-[#F7F9FC] text-[#A0AEC0] border-[#E4E9F0]"
              }`}
            >
              {active ? "✓" : "·"}
            </div>
            <span className="text-[9px] text-[#A0AEC0]">{dayLabels[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
