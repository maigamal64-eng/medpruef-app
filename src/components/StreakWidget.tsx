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

  // Compute intensity levels for active days
  const getIntensity = (active: boolean, dayIndex: number) => {
    if (!active) return "inactive";
    const today = new Date().getDay();
    // Convert JS Sunday=0 to Monday=0 format
    const todayMon = today === 0 ? 6 : today - 1;
    const daysAgo = (todayMon - dayIndex + 7) % 7;
    if (daysAgo === 0) return "today";
    if (daysAgo <= 2) return "recent";
    return "older";
  };

  const intensityStyles = {
    today: "bg-[#007B5F] text-white border-[#007B5F]",
    recent: "bg-[#007B5F]/70 text-white border-[#007B5F]/50",
    older: "bg-[#007B5F]/40 text-white border-[#007B5F]/30",
    inactive: "bg-[#F7F9FC] text-[#A0AEC0] border-[#E4E9F0]",
  };

  return (
    <div className="card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl animate-fire">🔥</span>
          <div>
            <p className="text-3xl font-black text-[#D64545] font-mono">{streak}</p>
            <p className="text-xs text-[#4A5568]">
              {t("streak", lang)} · {t("days", lang)}
            </p>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-1">
        {last7Days.map((active, i) => {
          const intensity = getIntensity(active, i);
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-medium transition-colors border ${intensityStyles[intensity]}`}
              >
                {active ? "✓" : "·"}
              </div>
              <span className="text-[9px] text-[#A0AEC0]">{dayLabels[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
