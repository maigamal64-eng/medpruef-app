"use client";
import { t, type Lang } from "@/lib/i18n";

/**
 * HomeStatStrip: the 3-tile study strip under the hero (UX-HOME-09, UX-HOME-30, LX-10).
 *
 *   • Serie        informational: streak in Vienna days plus "X von 7 Tagen aktiv".
 *                  A paused streak reads "Pause", never a broken flame or a loss line.
 *   • Heute        link to today's next action: "answers today / daily goal".
 *   • Trefferquote link to /progress: correct answers over all answers on the active exam.
 *
 * Every value comes from the server snapshot (/api/auth/me?include=study). `null`
 * means unknown: the tile shows a dash, never a false 0. Numerals use tabular
 * figures so a silent refresh does not jitter, and nothing is announced on refresh.
 * Card radius is the declared `--mp-r-card` token; the numeral row is pinned to the
 * bottom so the three tiles share one baseline.
 */

import Link from "next/link";
import { ChevronRight, Flame, Target, TrendingUp } from "lucide-react";
import { formatNumber, formatNumberText } from "@/lib/master-locale/format";
import { renderedLanguage } from "@/lib/master-locale/render";

export interface HomeStatStripProps {
  /** Streak in days as confirmed by the server; null = unknown. */
  streak: number | null;
  /** Distinct active days in the last 7 (today included); null = unknown. */
  activeDays7: number | null;
  /** Answers today (attempts, repeats included); null = unknown. */
  answersToday: number | null;
  dailyGoal: number;
  /** Trefferquote on the active exam in percent; null = no answers yet or unknown. */
  hitRate: number | null;
  todayHref: string;
  accuracyHref?: string;
  lang: Lang;
  /** Analytics hook for the two link tiles. */
  onTileClick?: (tile: "today" | "accuracy") => void;
}

export function getStreakSuffix(streak: number, lang: Lang): string {
  return t(streak === 1 ? "home_day_singular" : "home_day_plural", lang);
}

const DASH = "–";

function TileShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`mp-card min-w-0 h-full flex flex-col justify-between gap-2 ${className}`}
      style={{ borderRadius: "var(--mp-r-card)", padding: "12px 12px 13px" }}
    >
      {children}
    </div>
  );
}

function Label({ icon, accent, children }: { icon: React.ReactNode; accent: string; children: React.ReactNode }) {
  return (
    <span className="flex items-start gap-1.5 min-w-0 min-h-[2.1em]">
      <span className="flex items-center flex-shrink-0 mt-[1px]" style={{ color: accent }} aria-hidden>{icon}</span>
      <span className="text-[12px] font-semibold leading-tight text-[var(--mp-fg-muted)] break-words">{children}</span>
    </span>
  );
}

function Numeral({ children, suffix }: { children: React.ReactNode; suffix?: string }) {
  return (
    <span
      className="block font-display font-black"
      style={{ fontSize: 24, lineHeight: 1, color: "var(--mp-fg)", fontVariantNumeric: "tabular-nums" }}
    >
      <bdi dir="ltr">{children}</bdi>
      {suffix && <small style={{ fontSize: 12, color: "var(--mp-fg-subtle)", fontWeight: 600 }}>{suffix}</small>}
    </span>
  );
}

export default function HomeStatStrip({
  streak, activeDays7, answersToday, dailyGoal, hitRate, todayHref, accuracyHref = "/progress", lang, onTileClick,
}: HomeStatStripProps) {
  const fmt = renderedLanguage(lang).lang;
  const n = (v: number) => formatNumberText(v, fmt);
  const paused = streak === 0;
  const weekLine = activeDays7 == null ? null : t("a22_stat_week_active", lang).replace("{n}", n(activeDays7));

  const todayName = answersToday == null
    ? t("a22_stat_today_name_unknown", lang)
    : t("a22_stat_today_name", lang).replace("{n}", n(answersToday)).replace("{goal}", n(dailyGoal));
  const accuracyName = hitRate == null
    ? t("a22_stat_accuracy_name_unknown", lang)
    : t("a22_stat_accuracy_name", lang).replace("{n}", n(hitRate));

  const linkTile = "group block h-full rounded-[var(--mp-r-card)] mp-focusable min-h-11";
  return (
    <div className="grid grid-cols-3 gap-2 items-stretch" data-testid="home-stat-strip">
      <TileShell>
        <Label accent="var(--mp-warning)" icon={paused ? <span className="block w-3.5 h-3.5" /> : <Flame className="w-3.5 h-3.5" />}>
          {t("home_streak", lang)}
        </Label>
        <span>
          {streak == null ? <Numeral>{DASH}</Numeral>
            : paused ? <span className="block font-display font-bold text-[18px] leading-none text-[var(--mp-fg)]">{t("a22_stat_streak_pause", lang)}</span>
            : <Numeral suffix={getStreakSuffix(streak, lang)}>{n(streak)}</Numeral>}
          {weekLine && <span className="block mt-1 text-[12px] leading-tight text-[var(--mp-fg-muted)]">{weekLine}</span>}
        </span>
      </TileShell>

      <Link href={todayHref} className={linkTile} aria-label={todayName} onClick={() => onTileClick?.("today")}>
        <TileShell className="group-hover:border-[var(--mp-viridian)]/40 transition-colors">
          <span className="flex items-start justify-between gap-1">
            <Label accent="var(--mp-viridian)" icon={<Target className="w-3.5 h-3.5" />}>{t("home_answers_today", lang)}</Label>
            <ChevronRight className="w-4 h-4 flex-shrink-0 text-[var(--mp-fg-subtle)] rtl:rotate-180" aria-hidden />
          </span>
          <Numeral suffix={`/${n(dailyGoal)}`}>{answersToday == null ? DASH : n(answersToday)}</Numeral>
        </TileShell>
      </Link>

      <Link href={accuracyHref} className={linkTile} aria-label={accuracyName} onClick={() => onTileClick?.("accuracy")}>
        <TileShell className="group-hover:border-[var(--mp-viridian)]/40 transition-colors">
          <span className="flex items-start justify-between gap-1">
            <Label accent="var(--mp-accent-teal)" icon={<TrendingUp className="w-3.5 h-3.5" />}>{t("a22_stat_hit_rate", lang)}</Label>
            <ChevronRight className="w-4 h-4 flex-shrink-0 text-[var(--mp-fg-subtle)] rtl:rotate-180" aria-hidden />
          </span>
          <Numeral suffix={hitRate == null ? undefined : "%"}>{hitRate == null ? DASH : n(hitRate)}</Numeral>
        </TileShell>
      </Link>
    </div>
  );
}
