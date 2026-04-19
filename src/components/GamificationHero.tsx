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

  return (
    <div
      className="relative overflow-hidden p-5 sm:p-6 text-white"
      style={{
        background: "linear-gradient(135deg, #001B3D 0%, #003A8C 100%)",
        borderRadius: "var(--mp-r-card)",
        boxShadow: "var(--mp-shadow-elev)",
      }}
      role="group"
      aria-label={lang === "de" ? "Dein Fortschritt heute" : "Your progress today"}
    >
      {/* Teal radial glow (top-right corner) */}
      <div
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          right: -40,
          top: -40,
          width: 160,
          height: 160,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,168,150,0.35) 0%, transparent 70%)",
        }}
      />

      {/* Top row: rank + streak pill */}
      <div className="relative z-10 flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {/*
            Translucent-white chip matches the hero's frosted aesthetic.
            The glyph itself comes from AchievementRank in "inline" mode so
            it inherits white from the parent instead of painting the solid
            Oxford→CTA gradient (which would clash on this gradient card).
          */}
          <div
            className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-[10px] text-white"
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.18)",
            }}
            aria-hidden
          >
            <AchievementRank tier={tier} size={22} variant="inline" aria-hidden />
          </div>
          <div className="min-w-0">
            <div
              className="text-[11px] uppercase font-bold leading-tight"
              style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em" }}
            >
              {t("level", lang)} {xpInfo.level}
            </div>
            <div className="font-display font-bold text-[15px] text-white leading-tight truncate">
              {xpInfo.rank}
            </div>
          </div>
        </div>

        <span
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-mono font-bold text-[11px] flex-shrink-0"
          style={{
            background: "rgba(244,162,97,0.2)",
            border: "1px solid rgba(244,162,97,0.35)",
            color: "#FBD38D",
          }}
          aria-label={`${streak} ${lang === "de" ? "Tage Streak" : "day streak"}`}
        >
          <span aria-hidden>🔥</span>
          {streak} {lang === "de" ? "Tage" : streak === 1 ? "day" : "days"}
        </span>
      </div>

      {/* Bottom row: big goal ring + XP meta */}
      <div className="relative z-10 flex items-center gap-4 sm:gap-5 flex-wrap sm:flex-nowrap">
        {/* 92px daily-goal ring */}
        <div className="relative flex-shrink-0" style={{ width: 92, height: 92 }}>
          <svg
            width="92"
            height="92"
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
              className="text-[9px] uppercase font-bold mt-0.5"
              style={{ color: "rgba(255,255,255,0.6)", letterSpacing: "0.1em" }}
            >
              {lang === "de" ? "heute" : "today"}
            </span>
          </div>
        </div>

        {/* XP meta */}
        <div className="flex-1 min-w-[180px]">
          <div
            className="text-[11px] uppercase font-bold mb-1"
            style={{ color: "rgba(255,255,255,0.55)", letterSpacing: "0.08em" }}
          >
            {lang === "de" ? "Erfahrung" : "Experience"}
          </div>
          <div className="flex items-baseline gap-1.5 font-display">
            <span
              className="font-black text-[22px] text-white"
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
          <div
            className="mt-1.5 h-[5px] rounded-[3px] overflow-hidden"
            style={{ background: "rgba(255,255,255,0.12)" }}
          >
            <div
              className="h-full rounded-[3px]"
              style={{
                width: `${xpPct}%`,
                background: "linear-gradient(90deg, #00A896, #1BB680)",
                transition: "width 0.6s var(--mp-ease-out)",
              }}
            />
          </div>
          <div
            className="mt-1 text-[10px] font-mono"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            {nextRankName
              ? lang === "de"
                ? `${xpToNext.toLocaleString(locale)} XP bis ${nextRankName}`
                : `${xpToNext.toLocaleString(locale)} XP to ${nextRankName}`
              : lang === "de"
              ? "Maximalstufe erreicht"
              : "Max rank reached"}
          </div>
        </div>
      </div>
    </div>
  );
}
