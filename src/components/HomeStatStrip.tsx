"use client";
import { t, type Lang } from "@/lib/i18n";

/**
 * HomeStatStrip — the blessed 3-tile stat strip on the home dashboard.
 *
 * Reimplementation v3 (2026-06-26), built to `reviews/reimplementation-2026-06-26/
 * design/01-home.html` (the `.stat-strip`). Sits directly under <HomeHero/> and
 * carries the gamification snapshot the hero no longer shows inline:
 *   • Streak       — warm amber (flame). "N Tage"
 *   • Heute        — viridian (target). daily goal "current/goal"
 *   • Genauigkeit  — teal (trending-up). "N%"
 *
 * CRITICAL (the live cascade bug the redesign fixes): the LABEL is pinned to
 * `--mp-fg-muted`, it must NOT inherit the icon's accent color. The icon-top is
 * the only colored element; the numeral is `--mp-fg`, the label is muted.
 *
 * Restraint is the premium: no confetti/coins/buzzer. Reads the existing
 * `user_gamification` snapshot already loaded by the home page — no new fetch.
 */

import { Flame, Target, TrendingUp } from "lucide-react";



export interface HomeStatStripProps {
  streak: number;
  dailyCurrent: number;
  dailyGoal: number;
  accuracy: number;
  lang: Lang;
}

export function getStreakSuffix(streak: number, lang: Lang): string {
  return t(streak === 1 ? "home_day_singular" : "home_day_plural", lang);
}

function Stat({
  accent,
  icon,
  label,
  value,
  suffix,
}: {
  accent: string;
  icon: React.ReactNode;
  label: string;
  value: string | number;
  suffix?: string;
}) {
  return (
    <div className="mp-card min-w-0" style={{ borderRadius: "var(--mp-r-lg)", padding: "13px 11px" }}>
      <div className="flex items-center gap-1.5 min-w-0" style={{ color: accent }}>
        <span className="flex items-center flex-shrink-0" aria-hidden>
          {icon}
        </span>
        {/* label pinned to muted — NEVER the icon accent (the fixed cascade bug) */}
        <span
          className="uppercase whitespace-normal break-words font-semibold leading-tight"
          style={{ fontSize: 10, letterSpacing: "0.04em", color: "var(--mp-fg-muted)" }}
        >
          {label}
        </span>
      </div>
      <div
        className="font-display font-black mt-1.5"
        style={{ fontSize: 24, lineHeight: 1, color: "var(--mp-fg)", fontVariantNumeric: "tabular-nums" }}
      >
        <bdi dir="ltr">{value}</bdi>
        {suffix && (
          <small style={{ fontSize: 12, color: "var(--mp-fg-subtle)", fontWeight: 600 }}>{suffix}</small>
        )}
      </div>
    </div>
  );
}

export default function HomeStatStrip({
  streak,
  dailyCurrent,
  dailyGoal,
  accuracy,
  lang,
}: HomeStatStripProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Stat
        accent="var(--mp-warning)"
        icon={<Flame className="w-3.5 h-3.5" />}
        label={t("home_streak", lang)}
        value={streak}
        suffix={getStreakSuffix(streak, lang)}
      />
      <Stat
        accent="var(--mp-viridian)"
        icon={<Target className="w-3.5 h-3.5" />}
        label={t("home_answers_today", lang)}
        value={dailyCurrent}
        suffix={`/${dailyGoal}`}
      />
      <Stat
        accent="var(--mp-accent-teal)"
        icon={<TrendingUp className="w-3.5 h-3.5" />}
        label={t("home_accuracy", lang)}
        value={accuracy}
        suffix="%"
      />
    </div>
  );
}
