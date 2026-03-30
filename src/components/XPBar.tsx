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
            <span className="text-sm font-semibold">{xpInfo.rank}</span>
            <span className="text-xs text-[#94A3B8]">Lv.{xpInfo.level}</span>
          </div>
          <span className="text-xs text-[#F59E0B] font-medium">{totalXp} XP</span>
        </div>
        <div className="h-2 bg-[#334155] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#0891B2] to-[#22D3EE] rounded-full animate-progress"
            style={{ width: `${xpInfo.progress}%` }}
          />
        </div>
        <p className="text-[10px] text-[#64748B] mt-1 text-right">
          {Math.round(xpInfo.progress)}% {t("to_next_level", lang)}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#1E293B]/60 border border-[#334155]/50 rounded-xl p-4 animate-fade-in">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#F59E0B]/20 to-[#F59E0B]/5 border border-[#F59E0B]/20 flex items-center justify-center text-2xl">
          {icon}
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-bold">{xpInfo.rank}</p>
              <p className="text-xs text-[#94A3B8]">{t("level", lang)} {xpInfo.level}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-[#F59E0B]">{totalXp}</p>
              <p className="text-xs text-[#94A3B8]">XP</p>
            </div>
          </div>
        </div>
      </div>
      <div className="h-2.5 bg-[#334155] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[#F59E0B] to-[#FBBF24] rounded-full animate-progress"
          style={{ width: `${xpInfo.progress}%` }}
        />
      </div>
      <p className="text-xs text-[#64748B] mt-1.5 text-right">
        {Math.round(xpInfo.progress)}% {t("to_next_level", lang)}
      </p>
    </div>
  );
}
