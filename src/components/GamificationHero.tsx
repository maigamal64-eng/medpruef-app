"use client";

/**
 * GamificationHero — MPDS v2 merged hero card (Gamification-B).
 *
 * Replaces the separate StreakWidget + XPBar + DailyGoalRing trio on the
 * home page with a single proud hero card. Matches the picked alt from
 * `design-system/preview/alt-gamification.html` (variant B).
 *
 * Preserves all data surfaces:
 * - Streak count (right-side amber pill, 🔥)
 * - Rank name + tier title (top-left with badge)
 * - XP total + progress to next rank (bottom-right with bar)
 * - Daily goal progress (big ring on bottom-left)
 *
 * The separate StreakWidget / XPBar / DailyGoalRing components remain
 * in use on other pages (stats, progress, sidebar, etc.), so we do NOT
 * delete them — this is purely the home-page hero replacement.
 *
 * Visual: Oxford Blue → CTA Blue gradient. Teal radial glow on top-right.
 * Brand statement: the gradient stays the same regardless of theme; text
 * inside is always white. The card uses MPDS tokens for radius + shadow.
 *
 * Rank glyph: uses <AchievementRank variant="inline" /> inside a hand-rolled
 * translucent-white chip (so the chip's frosted look matches the hero's
 * glass aesthetic — not the solid Oxford/CTA gradient of the stock badge).
 */

import { useMemo } from "react";
import { getLevelFromXP } from "@/lib/xp";
import { t } from "@/lib/i18n";
import { AchievementRank, rankFromName } from "@/components/ui";

type Lang = "de" | "en";

interface GamificationHeroProps {
  streak: number;
  totalXp: number;
  dailyCurrent: number;
  dailyGoal: number;
  lang: Lang;
  /**
   * Overall accuracy 0-100. Rendered alongside XP as a second
   * self-worth metric. Pass undefined to skip (pre-auth / zero-data).
   */
  accuracy?: number;
  /**
   * Total questions answered — shown as an optional tertiary stat
   * below XP. Useful context so the hero doesn't feel sparse for new
   * users with low XP.
   */
  totalAnswered?: number;
}

// XP thresholds mirror src/lib/xp.ts (kept in sync — if xp.ts thresholds
// change, update here too). The hero needs the NEXT threshold to compute
// "X XP to next rank" and the bar-percent of the current segment.
const XP_THRESHOLDS = [0, 100, 300, 600, 1000, 2000, 4000, 8000];
const RANK_NAMES = [
  "Praktikant",
  "Famulant",
  "PJ-Student",
  "Assistenzarzt",
  "Facharzt",
  "Oberarzt",
  "Chefarzt",
  "Professor",
] as const;

export default function GamificationHero({
  streak,
  totalXp,
  dailyCurrent,
  dailyGoal,
  lang,
  accuracy,
  totalAnswered,
}: GamificationHeroProps) {
  const xpInfo = getLevelFromXP(totalXp);
  const tier = rankFromName(xpInfo.rank);

  // Compute next-rank info
  const { nextRankName, xpToNext, currentThreshold, nextThreshold } = useMemo(() => {
    const idx = Math.max(0, RANK_NAMES.indexOf(xpInfo.rank as (typeof RANK_NAMES)[number]));
    const curr = XP_THRESHOLDS[idx] ?? 0;
    const next = XP_THRESHOLDS[idx + 1] ?? curr * 2;
    const nextName = RANK_NAMES[idx + 1];
    return {
      nextRankName: nextName,
      xpToNext: Math.max(0, next - totalXp),
      currentThreshold: curr,
      nextThreshold: next,
    };
  }, [xpInfo.rank, totalXp]);

  const xpPct = Math.max(
    0,
    Math.min(100, ((totalXp - currentThreshold) / Math.max(1, nextThreshold - currentThreshold)) * 100)
  );

  // Daily goal ring — 92px outer, r=45, stroke=8 (matches alt-B)
  const R = 45;
  const C = 2 * Math.PI * R;
  const goalFrac = Math.min(1, Math.max(0, dailyGoal > 0 ? dailyCurrent / dailyGoal : 0));
  const arcLen = C * goalFrac;

  // Locale-aware number formatting (1 420 style thousand spaces match the alt mockup).
  const locale = lang === "de" ? "de-DE" : "en-US";

  // Accuracy mini-stat — only rendered if the user has ≥1 question answered.
  // Colored using the gamification accuracy token (viridian family) so it
  // sits alongside XP without competing with the streak-orange pill.
  const hasAccuracy = typeof accuracy === "number" && accuracy > 0;

  return (
    <div
      className="relative overflow-hidden p-6 sm:p-8 text-white"
      style={{
        background:
          "radial-gradient(circle at 100% 0%, rgba(0,168,150,0.28) 0%, transparent 55%), linear-gradient(135deg, #001B3D 0%, #003A8C 100%)",
        borderRadius: "var(--mp-r-card)",
        boxShadow: "var(--mp-shadow-elev)",
      }}
      role="group"
      aria-label={lang === "de" ? "Dein Fortschritt heute" : "Your progress today"}
    >
      {/* Subtle grid texture for depth — purely decorative */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Top row: rank + streak pill (streak-orange, warm) */}
      <div className="relative z-10 flex items-center justify-between mb-6 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl text-white"
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.2)",
            }}
            aria-hidden
          >
            <AchievementRank tier={tier} size={24} variant="inline" aria-hidden />
          </div>
          <div className="min-w-0">
            <div
              className="text-[10px] uppercase font-bold leading-tight"
              style={{ color: "rgba(255,255,255,0.55)", letterSpacing: "0.1em" }}
            >
              {t("level", lang)} {xpInfo.level}
            </div>
            <div className="font-display font-bold text-[17px] text-white leading-tight truncate">
              {xpInfo.rank}
            </div>
          </div>
        </div>

        {/* Streak pill — warm gamification orange (var(--mp-gamif-streak)). */}
        <span
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-mono font-bold text-xs flex-shrink-0"
          style={{
            background: "rgba(244,162,97,0.22)",
            border: "1px solid rgba(244,162,97,0.4)",
            color: "var(--mp-gamif-xp)",
          }}
          aria-label={`${streak} ${lang === "de" ? "Tage Streak" : "day streak"}`}
        >
          <span aria-hidden className="text-sm leading-none">🔥</span>
          {streak} {lang === "de" ? "Tage" : streak === 1 ? "day" : "days"}
        </span>
      </div>

      {/* Middle row: big viridian goal ring + XP + accuracy */}
      <div className="relative z-10 flex items-start gap-5 sm:gap-6 flex-wrap sm:flex-nowrap">
        {/* 96px daily-goal ring — viridian-cool */}
        <div className="relative flex-shrink-0" style={{ width: 96, height: 96 }}>
          <svg
            width="96"
            height="96"
            viewBox="0 0 100 100"
            style={{ transform: "rotate(-90deg)" }}
            aria-hidden
          >
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="8"
            />
            <circle
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke="#00A896"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${arcLen} ${C}`}
              style={{ transition: "stroke-dasharray 0.6s var(--mp-ease-out)" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className="font-display font-black leading-none"
              style={{ fontSize: 22, fontVariantNumeric: "tabular-nums" }}
            >
              {dailyCurrent}/{dailyGoal}
            </span>
            <span
              className="text-[9px] uppercase font-bold mt-1"
              style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "0.12em" }}
            >
              {lang === "de" ? "heute" : "today"}
            </span>
          </div>
        </div>

        {/* XP meta + optional accuracy row */}
        <div className="flex-1 min-w-[200px]">
          <div
            className="text-[10px] uppercase font-bold mb-1"
            style={{ color: "rgba(255,255,255,0.55)", letterSpacing: "0.1em" }}
          >
            {lang === "de" ? "Erfahrung" : "Experience"}
          </div>
          <div className="flex items-baseline gap-2 font-display">
            <span
              className="font-black text-[26px] text-white"
              style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}
            >
              {totalXp.toLocaleString(locale)}
            </span>
            <span
              className="text-[11px] font-semibold"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              / {nextThreshold.toLocaleString(locale)} XP
            </span>
          </div>

          {/* Inline accuracy + answered — a second self-worth metric */}
          {(hasAccuracy || totalAnswered !== undefined) && (
            <div
              className="flex items-center gap-3 mt-2 text-[11px] font-mono"
              style={{ color: "rgba(255,255,255,0.78)", fontVariantNumeric: "tabular-nums" }}
            >
              {hasAccuracy && (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ background: "var(--mp-viridian)" }}
                    aria-hidden
                  />
                  <span className="font-bold text-white">{Math.round(accuracy!)}%</span>
                  <span className="opacity-70">{t("accuracy", lang)}</span>
                </span>
              )}
              {typeof totalAnswered === "number" && totalAnswered > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-bold text-white">{totalAnswered.toLocaleString(locale)}</span>
                  <span className="opacity-70">
                    {lang === "de" ? "beantwortet" : "answered"}
                  </span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: rank-progress bar with next rank name */}
      <div className="relative z-10 mt-6">
        <div
          className="flex items-center justify-between text-[10px] uppercase font-bold mb-1.5"
          style={{ color: "rgba(255,255,255,0.55)", letterSpacing: "0.1em" }}
        >
          <span>{t("progress_to_next_rank", lang)}</span>
          {nextRankName && (
            <span className="font-mono normal-case tracking-normal" style={{ letterSpacing: 0 }}>
              {xpToNext.toLocaleString(locale)} XP
            </span>
          )}
        </div>
        <div
          className="h-[6px] rounded-full overflow-hidden"
          style={{ background: "rgba(255,255,255,0.12)" }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(xpPct)}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${xpPct}%`,
              background: "linear-gradient(90deg, #00A896, #1BB680)",
              transition: "width 0.6s var(--mp-ease-out)",
            }}
          />
        </div>
        <div
          className="mt-1.5 text-[11px] font-mono flex items-center justify-between"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          <span>{xpInfo.rank}</span>
          <span className="text-white font-semibold">
            {nextRankName
              ? nextRankName
              : lang === "de"
              ? "Maximalstufe erreicht"
              : "Max rank reached"}
          </span>
        </div>
      </div>
    </div>
  );
}
