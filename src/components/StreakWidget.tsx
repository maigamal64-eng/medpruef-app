"use client";

import { useState, useEffect } from "react";
import { t } from "@/lib/i18n";

type Lang = "de" | "en";

function StreakCountdown({ lang }: { lang: Lang }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    function calcTimeLeft() {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      const diff = midnight.getTime() - now.getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    setTimeLeft(calcTimeLeft());
    const interval = setInterval(() => setTimeLeft(calcTimeLeft()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!timeLeft) return null;

  return (
    <p className="text-xs text-[#F4A261] font-mono mt-0.5">
      ⚠ {lang === "de" ? "Setzt zurück in" : "Resets in"} {timeLeft}
    </p>
  );
}

interface StreakWidgetProps {
  streak: number;
  lang: Lang;
}

export default function StreakWidget({ streak, lang }: StreakWidgetProps) {
  // Fill the 7-day strip from the REAL streak only. The previous
  // implementation filled the non-streak days with `Math.random()`
  // which invented data on every render — users with a 3-day streak
  // saw the "other 4 days" flicker active/inactive as the parent
  // re-rendered for unrelated reasons. Fixed 2026-04-15 (Frontend
  // audit P1-6, UX audit).
  //
  // Future: fetch real per-day activity from /api/stats and render
  // it here so the strip actually shows a historical week. For now
  // we just show the current streak as a solid bar of active cells
  // and grey out the rest.
  const last7Days = Array.from({ length: 7 }, (_, i) => i < Math.min(streak, 7));

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
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl animate-fire">🔥</span>
          <div>
            <p className="text-3xl font-black text-[#D64545] font-mono">{streak}</p>
            <p className="text-xs text-[#4A5568]">
              {t("streak", lang)} · {t("days", lang)}
            </p>
            {streak > 0 && <StreakCountdown lang={lang} />}
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
