"use client";

import { getLevelFromXP } from "@/lib/xp";
import { t } from "@/lib/i18n";
import { AchievementRank, rankFromName } from "@/components/ui";

type Lang = "de" | "en";

const XP_THRESHOLDS = [0, 100, 300, 600, 1000, 2000, 4000, 8000];
const MAX_LEVEL = 8;

const milestones: Record<number, { de: string; en: string }> = {
  2: { de: "Quiz-Modi freischalten", en: "Unlock quiz modes" },
  3: { de: "Prüfungssimulation", en: "Exam simulation" },
  4: { de: "Erweiterte Statistiken", en: "Advanced analytics" },
  5: { de: "Lernempfehlungen", en: "Study recommendations" },
  6: { de: "Experten-Tools", en: "Expert tools" },
  7: { de: "Experten-Tools", en: "Expert tools" },
  8: { de: "Experten-Tools", en: "Expert tools" },
};

interface XPBarProps {
  totalXp: number;
  lang: Lang;
  compact?: boolean;
}

export default function XPBar({ totalXp, lang, compact = false }: XPBarProps) {
  const xpInfo = getLevelFromXP(totalXp);
  const tier = rankFromName(xpInfo.rank);

  if (compact) {
    return (
      <div className="animate-fade-in">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            {/* Inline variant — currentColor picks up the surrounding text */}
            <span className="inline-flex items-center justify-center text-[var(--mp-viridian)]">
              <AchievementRank tier={tier} size={22} variant="inline" aria-hidden />
            </span>
            <span className="text-sm font-semibold text-[var(--mp-fg)]">{xpInfo.rank}</span>
            <span className="text-xs text-[var(--mp-fg-muted)] font-mono">Lv.{xpInfo.level}</span>
          </div>
          <span className="text-xs text-[var(--mp-status-warning)] font-medium font-mono">{totalXp} XP</span>
        </div>
        <div className="h-1.5 bg-[var(--mp-surface-sunken)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--mp-viridian)] rounded-full animate-progress"
            style={{ width: `${xpInfo.progress}%` }}
          />
        </div>
        <p className="text-[10px] text-[var(--mp-fg-subtle)] mt-1 text-right font-mono">
          {Math.round(xpInfo.progress)}% {t("to_next_level", lang)}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        {/* Badge variant — gradient chip replaces the warning-tinted container
            and the emoji rank icon. Accent color still drives XP numbers below. */}
        <AchievementRank tier={tier} size={44} />
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-bold text-[var(--mp-fg)]">{xpInfo.rank}</p>
              <p className="text-xs text-[var(--mp-fg-muted)] font-mono">
                {t("level", lang)} {xpInfo.level}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black text-[var(--mp-status-warning)] font-mono font-display">{totalXp}</p>
              <p className="text-xs text-[var(--mp-fg-subtle)]">XP</p>
            </div>
          </div>
        </div>
      </div>
      <div className="h-2.5 bg-[var(--mp-surface-sunken)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--mp-status-warning)] rounded-full animate-progress"
          style={{ width: `${xpInfo.progress}%` }}
        />
      </div>
      <p className="text-xs text-[var(--mp-fg-subtle)] mt-1.5 text-right font-mono">
        {Math.round(xpInfo.progress)}% {t("to_next_level", lang)}
      </p>
      {/* Milestone preview */}
      {xpInfo.level >= MAX_LEVEL ? (
        <p className="text-[11px] text-[var(--mp-fg-subtle)] mt-1.5">
          {lang === "de" ? "Maximalstufe erreicht" : "Max level reached"}
        </p>
      ) : (
        (() => {
          const nextLevel = xpInfo.level + 1;
          const nextThreshold = XP_THRESHOLDS[nextLevel - 1] || XP_THRESHOLDS[XP_THRESHOLDS.length - 1] * 2;
          const xpToNext = Math.max(0, nextThreshold - totalXp);
          const milestone = milestones[nextLevel];
          return (
            <>
              <p className="text-[11px] text-[var(--mp-fg-subtle)] mt-1.5">
                {lang === "de"
                  ? `+${xpToNext} XP bis Level ${nextLevel}`
                  : `+${xpToNext} XP to Level ${nextLevel}`}
              </p>
              {milestone && (
                <p className="text-[10px] text-[var(--mp-fg-subtle)]/70 mt-0.5">
                  {lang === "de"
                    ? `Level ${nextLevel}: ${milestone.de}`
                    : `Unlock "${milestone.en}" at Level ${nextLevel}`}
                </p>
              )}
            </>
          );
        })()
      )}
    </div>
  );
}
