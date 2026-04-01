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
    <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl animate-fire">🔥</span>
          <div>
            <p className="text-2xl font-bold text-[#FFB4AB] font-mono">{streak}</p>
            <p className="text-xs text-[#BCC9C6]">
              {t("streak", lang)} · {t("days", lang)}
            </p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-1">
        {last7Days.map((active, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div
              className={`w-7 h-7 rounded flex items-center justify-center text-xs font-medium transition-colors border ${
                active
                  ? "bg-[#4EDEA3]/15 text-[#4EDEA3] border-[#4EDEA3]/30"
                  : "bg-[#23293C] text-[#879391] border-[#3D4947]"
              }`}
            >
              {active ? "✓" : "·"}
            </div>
            <span className="text-[9px] text-[#879391]">{dayLabels[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
