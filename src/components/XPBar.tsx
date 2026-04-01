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
            <span className="text-sm font-semibold text-[#DCE1FB]">{xpInfo.rank}</span>
            <span className="text-xs text-[#BCC9C6] font-mono">Lv.{xpInfo.level}</span>
          </div>
          <span className="text-xs text-[#FFB95F] font-medium font-mono">{totalXp} XP</span>
        </div>
        <div className="h-1.5 bg-[#23293C] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#6BD8CB] rounded-full animate-progress"
            style={{ width: `${xpInfo.progress}%` }}
          />
        </div>
        <p className="text-[10px] text-[#879391] mt-1 text-right font-mono">
          {Math.round(xpInfo.progress)}% {t("to_next_level", lang)}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 animate-fade-in">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-11 h-11 rounded bg-[#FFB95F]/10 border border-[#FFB95F]/20 flex items-center justify-center text-xl">
          {icon}
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-base font-bold text-[#DCE1FB]">{xpInfo.rank}</p>
              <p className="text-xs text-[#BCC9C6] font-mono">
                {t("level", lang)} {xpInfo.level}
              </p>
            </div>
            <div className="text-right">
              <p className="text-base font-bold text-[#FFB95F] font-mono">{totalXp}</p>
              <p className="text-xs text-[#879391]">XP</p>
            </div>
          </div>
        </div>
      </div>
      <div className="h-2 bg-[#23293C] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#FFB95F] rounded-full animate-progress"
          style={{ width: `${xpInfo.progress}%` }}
        />
      </div>
      <p className="text-xs text-[#879391] mt-1.5 text-right font-mono">
        {Math.round(xpInfo.progress)}% {t("to_next_level", lang)}
      </p>
    </div>
  );
}
