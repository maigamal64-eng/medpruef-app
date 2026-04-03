"use client";

import { getLevelFromXP } from "@/lib/xp";
import { t } from "@/lib/i18n";

type Lang = "de" | "en";

interface XPBarProps {
  totalXp: number;
  lang: Lang;
  compact?: boolean;
}

const rankIcons: Record<string, string> = {
  "Praktikant": "🎓",
  "Famulant": "📚",
  "PJ-Student": "🩺",
  "Assistenzarzt": "⚕️",
  "Facharzt": "🏥",
  "Oberarzt": "🔬",
  "Chefarzt": "👨‍⚕️",
  "Professor": "🏆",
};

export default function XPBar({ totalXp, lang, compact = false }: XPBarProps) {
  const xpInfo = getLevelFromXP(totalXp);
  const icon = rankIcons[xpInfo.rank] || "🎓";

  if (compact) {
    return (
      <div className="animate-fade-in">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <span className="text-lg">{icon}</span>
            <span className="text-sm font-semibold text-[#1A2B3C]">{xpInfo.rank}</span>
            <span className="text-xs text-[#4A5568] font-mono">Lv.{xpInfo.level}</span>
          </div>
          <span className="text-xs text-[#F4A261] font-medium font-mono">{totalXp} XP</span>
        </div>
        <div className="h-1.5 bg-[#F7F9FC] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#007B5F] rounded-full animate-progress"
            style={{ width: `${xpInfo.progress}%` }}
          />
        </div>
        <p className="text-[10px] text-[#A0AEC0] mt-1 text-right font-mono">
          {Math.round(xpInfo.progress)}% {t("to_next_level", lang)}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#FFFFFF] border border-[#E4E9F0] rounded p-4 animate-fade-in">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-11 h-11 rounded bg-[#F4A261]/10 border border-[#F4A261]/20 flex items-center justify-center text-xl">
          {icon}
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-base font-bold text-[#1A2B3C]">{xpInfo.rank}</p>
              <p className="text-xs text-[#4A5568] font-mono">
                {t("level", lang)} {xpInfo.level}
              </p>
            </div>
            <div className="text-right">
              <p className="text-base font-bold text-[#F4A261] font-mono">{totalXp}</p>
              <p className="text-xs text-[#A0AEC0]">XP</p>
            </div>
          </div>
        </div>
      </div>
      <div className="h-2 bg-[#F7F9FC] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#F4A261] rounded-full animate-progress"
          style={{ width: `${xpInfo.progress}%` }}
        />
      </div>
      <p className="text-xs text-[#A0AEC0] mt-1.5 text-right font-mono">
        {Math.round(xpInfo.progress)}% {t("to_next_level", lang)}
      </p>
    </div>
  );
}
