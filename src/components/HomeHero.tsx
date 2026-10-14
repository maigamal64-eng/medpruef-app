"use client";
import { t, type Lang } from "@/lib/i18n";

/**
 * HomeHero: the one hero on Home (UX-HOME-18 B, UX-HOME-20, UX-HOME-37, UX-HOME-08).
 *
 * [name]'s pick-ux-home-18 B (12 Oct): the banded practice readiness is the
 * headline (neutral words, no pass probability, no percentage, no gauge); the
 * bank coverage ("gesehen") moves to a secondary line with its denominator.
 * HOME-57 A: this is the only hero; GamificationHero is retired.
 *
 * States:
 *  - phase "new" (no answer yet): a welcome card with one action, no bar.
 *  - readiness loading: a reserved skeleton line, never a number.
 *  - readiness failed or unavailable: the coverage sentence becomes the
 *    headline, so nothing fabricated appears.
 *  - coverage loading/failed: a dash and an inline retry, never a false 0 %.
 *
 * The headline is the page's only h1. Exactly one filled primary; when a
 * stalled checkout owns the filled primary on Home the hero button is outline
 * (UX-HOME-44). Gradient surface kept from the v3 design.
 */

import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Play, CalendarDays } from "lucide-react";
import { formatCount, formatNumber, formatNumberText, formatPercentText } from "@/lib/master-locale/format";
import { renderedLanguage } from "@/lib/master-locale/render";
import type { ReadinessBand, Trend, FactorKey } from "@/lib/readiness";
import type { StudyPhase } from "@/lib/home-study-core";

export type HeroReadiness =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "ready"; band: ReadinessBand; trend: Trend; lowestFactor: FactorKey };

export interface HeroAction {
  href: string;
  label: string;
  /** Short reason under the button (UX-HOME-15), optional. */
  why?: string | null;
}

export interface HomeHeroProps {
  greeting: string;
  userName: string;
  examLabel: string;
  answered: number | null;
  total: number | null;
  trackingAvailable?: boolean;
  progressLoading?: boolean;
  progressError?: boolean;
  onProgressRetry?: () => void;
  readiness: HeroReadiness;
  /** a-fo-08: time of the saved copy shown because a fresh read failed ("14:05"); null when live. */
  asOf?: string | null;
  phase: StudyPhase | null;
  daysSinceStudy?: number | null;
  primary: HeroAction;
  /** Second action (Lernplan); hidden for new learners. */
  secondary?: HeroAction | null;
  /** UX-HOME-44: a stalled checkout owns the filled primary; the hero becomes outline. */
  primaryOutline?: boolean;
  /** New-learner card extras. */
  freeAllowance?: string | null;
  formatHref?: string | null;
  lang: Lang;
  /** Days until the learner's exam (users.exam_date). Omit / <=0 to hide the chip. */
  daysLeft?: number | null;
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
}

const BAND_KEY: Record<ReadinessBand, "a22_band_just_started" | "a22_band_building" | "a22_band_on_track" | "a22_band_strong"> = {
  just_started: "a22_band_just_started",
  building: "a22_band_building",
  on_track: "a22_band_on_track",
  exam_ready_looking: "a22_band_strong",
};
const TREND_KEY: Record<Trend, "a22_trend_up" | "a22_trend_flat" | "a22_trend_down"> = {
  up: "a22_trend_up", flat: "a22_trend_flat", down: "a22_trend_down",
};
const LEVER_KEY: Record<FactorKey, "a22_lever_coverage" | "a22_lever_accuracy" | "a22_lever_consistency" | "a22_lever_pace"> = {
  coverage: "a22_lever_coverage", accuracy: "a22_lever_accuracy", consistency: "a22_lever_consistency", pace: "a22_lever_pace",
};

export function readinessHeadline(r: HeroReadiness, lang: Lang): { title: string; detail: string | null } | null {
  if (r.state !== "ready") return null;
  const title = t("a22_readiness_title", lang).replace("{band}", t(BAND_KEY[r.band], lang));
  if (r.band === "just_started") return { title, detail: t("a22_readiness_just_started_detail", lang) };
  const detail = t("a22_readiness_detail", lang)
    .replace("{trend}", t(TREND_KEY[r.trend], lang))
    .replace("{lever}", t(LEVER_KEY[r.lowestFactor], lang));
  return { title, detail };
}

const WHITE_BUTTON = { background: "#fff", color: "var(--mp-oxford-blue)" } as const;
const GHOST_BUTTON = { background: "rgba(255,255,255,0.13)", color: "#fff", border: "1px solid rgba(255,255,255,0.35)" } as const;

export default function HomeHero({
  greeting, userName, examLabel, answered, total, trackingAvailable = true, progressLoading = false,
  progressError = false, onProgressRetry, readiness, asOf = null, phase, daysSinceStudy, primary, secondary,
  primaryOutline = false, freeAllowance, formatHref, lang, daysLeft, onPrimaryClick, onSecondaryClick,
}: HomeHeroProps) {
  const fmtLang = renderedLanguage(lang).lang;
  const known = trackingAvailable && answered !== null && total !== null;
  const pct = known && total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : known ? 0 : undefined;
  const fillWidth = known && total > 0 ? Math.min(100, Math.max(0, (answered / total) * 100)) : 0;
  const progressText = progressLoading ? t("home_progress_loading", lang)
    : progressError ? t("home_progress_error", lang) : t("home_progress_unknown", lang);
  // The percentage is its own LTR run so it reads correctly in any direction (UX-HOME-02).
  const coverageSentence = known ? (() => {
    const [before, after = ""] = t("a22_coverage_line", lang).split("{pct}");
    return <>{before}<bdi dir="ltr">{formatPercentText(pct ?? 0, fmtLang)}</bdi>{after}</>;
  })() : null;
  const headline = readinessHeadline(readiness, lang);
  const isNew = phase === "new";

  let recency: string | null = null;
  if (!isNew && typeof daysSinceStudy === "number" && daysSinceStudy >= 1) {
    const when = daysSinceStudy === 1 ? t("a22_recency_yesterday", lang)
      : t("a22_recency_days", lang).replace("{n}", formatNumberText(daysSinceStudy, fmtLang));
    recency = phase === "lapsed" ? `${t("a22_welcome_back", lang)} ${when}` : when;
  }

  return (
    <section
      className="relative overflow-hidden"
      style={{
        background: "linear-gradient(118deg, var(--mp-oxford-blue), var(--mp-cta-blue))",
        borderRadius: "var(--mp-r-card)",
        boxShadow: "var(--mp-shadow-hover)",
        padding: "22px 22px 24px",
      }}
      aria-labelledby="home-hero-title"
      data-testid="home-hero"
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(140px 140px at 88% 12%, var(--mp-spark-glow), transparent 70%), radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "auto, 24px 24px",
        }}
      />

      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-medium min-w-0 truncate" style={{ color: "rgba(255,255,255,0.78)" }}>
            {greeting}, {userName}
          </p>
          {typeof daysLeft === "number" && daysLeft > 0 && (
            <span
              className="inline-flex items-center gap-1.5 flex-shrink-0 font-mono"
              style={{
                fontSize: 13, fontWeight: 700, color: "#fff", background: "rgba(255,255,255,0.13)",
                border: "1px solid rgba(255,255,255,0.2)", borderRadius: 9999, padding: "3px 10px",
              }}
              aria-label={t("home_days_until", lang).replace("{days}", formatCount(daysLeft, "day", fmtLang))}
            >
              <span className="inline-block" style={{ width: 6, height: 6, borderRadius: 9999, background: "var(--mp-spark)" }} aria-hidden />
              {t("home_days_short", lang).replace("{days}", formatCount(daysLeft, "day", fmtLang))}
            </span>
          )}
        </div>

        <h1
          id="home-hero-title"
          className="mt-1.5 font-display font-extrabold leading-tight"
          style={{ fontSize: 22, color: "#fff", letterSpacing: "-0.01em", minHeight: "1.3em" }}
        >
          {isNew ? t("a22_new_title", lang)
            : !trackingAvailable ? t("home_start_exploring_this_question_bank", lang)
            : headline ? headline.title
            : readiness.state === "loading" ? (
              <span className="inline-flex items-center gap-2" aria-busy="true">
                <span className="sr-only">{t("a22_readiness_loading", lang)}</span>
                <span aria-hidden className="inline-block h-[0.9em] w-56 max-w-full rounded-md motion-safe:animate-pulse" style={{ background: "rgba(255,255,255,0.18)" }} />
              </span>
            )
            : coverageSentence ?? <><span aria-hidden="true">- </span>{progressText}</>}
        </h1>
        {!isNew && headline?.detail && (
          <p className="mt-1 text-[14px] leading-snug" style={{ color: "rgba(255,255,255,0.86)" }} data-testid="home-readiness-detail">
            {headline.detail}
          </p>
        )}
        {isNew && (
          <p className="mt-1 text-[14px] leading-snug" style={{ color: "rgba(255,255,255,0.86)" }}>
            {t("a22_new_body", lang)}
          </p>
        )}
        {recency && <p className="mt-1 text-[13px]" style={{ color: "rgba(255,255,255,0.78)" }}>{recency}</p>}

        {/* Coverage ("gesehen") is the secondary line under the readiness headline. */}
        {!isNew && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-1 mb-1.5" style={{ fontSize: 13, color: "rgba(255,255,255,0.78)", fontWeight: 500 }}>
              <span className="min-w-0 truncate pr-2">
                {headline || readiness.state === "loading" ? (coverageSentence ?? examLabel) : examLabel}
              </span>
              <span className="font-mono flex-shrink-0" style={{ color: "#fff", fontWeight: 700 }}>
                {known ? <span dir="ltr"><bdi dir="ltr">{formatNumber(answered, fmtLang)}</bdi> / <bdi dir="ltr">{formatNumber(total, fmtLang)}</bdi></span>
                  : !trackingAvailable ? t("home_sign_in_to_track_progress", lang) : <span aria-hidden="true">- / -</span>}
              </span>
            </div>
            <div
              className="relative overflow-hidden"
              style={{ height: 9, borderRadius: 9999, background: "rgba(255,255,255,0.14)" }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("a22_coverage_bar_name", lang).replace("{exam}", examLabel)}
              aria-valuenow={known && !progressLoading && !progressError ? pct : undefined}
              aria-valuetext={known && !progressLoading && !progressError
                ? t("a22_coverage_valuetext", lang).replace("{n}", formatNumberText(answered, fmtLang)).replace("{total}", formatNumberText(total, fmtLang))
                : progressText}
              aria-busy={progressLoading || undefined}
            >
              <div
                className={!known && progressLoading ? "motion-safe:animate-pulse" : undefined}
                style={{
                  height: "100%", width: known ? `${fillWidth}%` : "100%", opacity: known ? 1 : 0.3, borderRadius: 9999,
                  background: "linear-gradient(90deg, var(--mp-viridian), var(--mp-spark))",
                  boxShadow: "0 0 12px var(--mp-spark-glow)", transition: "width 0.6s var(--mp-ease-out)",
                }}
              />
            </div>
          </div>
        )}

        {!isNew && asOf && !progressError && (
          <p className="mt-2 text-[12px] leading-snug" style={{ color: "rgba(255,255,255,0.78)" }} data-testid="home-as-of" role="status">
            {t("afo08_home_as_of", lang).replace("{time}", asOf)}
            {onProgressRetry && <>{" "}<button type="button" onClick={onProgressRetry} className="inline-flex items-center min-h-11 px-1 underline font-semibold mp-focusable" style={{ color: "#fff" }}>{t("request_retry", lang)}</button></>}
          </p>
        )}

        {!isNew && progressError && <Alert variant="info" title={t("home_progress_error", lang)} className="mt-3">
          {known && <p>{t("home_progress_stale", lang)}</p>}
          {onProgressRetry && <Button variant="secondary" className="mt-2 min-h-11" onClick={onProgressRetry}>{t("request_retry", lang)}</Button>}
        </Alert>}

        <div className="flex flex-wrap gap-2.5 mt-[18px]">
          <Link
            href={primary.href}
            onClick={onPrimaryClick}
            className="flex-1 sm:flex-none sm:min-w-[200px] sm:max-w-[280px] inline-flex items-center justify-center gap-2 font-bold mp-focusable px-4 text-center"
            style={{ minHeight: 44, borderRadius: "var(--mp-r-button)", fontSize: 14, ...(primaryOutline ? GHOST_BUTTON : WHITE_BUTTON) }}
            data-testid="home-primary"
          >
            <Play className="w-[17px] h-[17px] flex-shrink-0" aria-hidden />
            {primary.label}
          </Link>
          {secondary && !isNew && (
            <Link
              href={secondary.href}
              onClick={onSecondaryClick}
              className="flex-1 sm:flex-none sm:min-w-[160px] sm:max-w-[280px] inline-flex items-center justify-center gap-2 font-bold mp-focusable px-4"
              style={{ minHeight: 44, borderRadius: "var(--mp-r-button)", fontSize: 14, ...GHOST_BUTTON }}
            >
              <CalendarDays className="w-[17px] h-[17px] flex-shrink-0" aria-hidden />
              {secondary.label}
            </Link>
          )}
        </div>
        {primary.why && <p className="mt-2 text-[13px]" style={{ color: "rgba(255,255,255,0.78)" }}>{primary.why}</p>}
        {isNew && freeAllowance && <p className="mt-3 text-[13px]" style={{ color: "rgba(255,255,255,0.86)" }}>{freeAllowance}</p>}
        {isNew && formatHref && (
          <p className="mt-2 text-[13px]">
            <Link href={formatHref} className="underline underline-offset-2 mp-focusable" style={{ color: "#fff" }}>
              {t("a22_format_link", lang)}
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
