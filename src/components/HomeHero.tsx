"use client";
import { t, type Lang } from "@/lib/i18n";

/**
 * HomeHero — the blessed home/dashboard hero progress banner.
 *
 * Reimplementation v3 (2026-06-26), built to `reviews/reimplementation-2026-06-26/
 * design/01-home.html`. This is the ONE sanctioned gradient on the home surface:
 * Oxford Blue → CTA Blue, with the teal SPARK glow on the progress fill (the spark
 * = active/progress only, per the spark discipline).
 *
 * It replaces the dense rank/XP `GamificationHero` *as the hero*. The XP / rank /
 * streak / accuracy / daily-goal data does NOT disappear — it relocates into the
 * 3-tile stat strip (<HomeStatStrip/>) directly below, exactly as the mockup shows.
 *
 * Data contract (read-only — no new fetches):
 *  - greeting: time-of-day (computed by the caller, passed in)
 *  - userName: users.first_name
 *  - examLabel: human label for the active exam
 *  - answered / total: distinct questions seen in the selected exam bank
 *  - studyHref / planHref: the two CTAs (resume-or-random quiz, and /study-plan)
 *
 * Copy: Austrian register, Sie/du = du (the live home voice), dot-thousands via
 * de-DE locale, 🇦🇹-only emoji, ZERO em dashes. DE + EN.
 */

import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Play, CalendarDays } from "lucide-react";
import { formatCount, formatNumber, formatPercent } from "@/lib/master-locale/format";
import { renderedLanguage } from "@/lib/master-locale/render";



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
  studyHref: string;
  planHref: string;
  lang: Lang;
  /** Days until the user's exam (from users.exam_date). Omit / <=0 to hide the countdown chip. */
  daysLeft?: number | null;
}

export default function HomeHero({
  greeting,
  userName,
  examLabel,
  answered,
  total,
  trackingAvailable = true,
  progressLoading = false,
  progressError = false,
  onProgressRetry,
  studyHref,
  planHref,
  lang,
  daysLeft,
}: HomeHeroProps) {
  // UX-GLOBAL-03: one formatter bound to the rendered language.
  const fmtLang = renderedLanguage(lang).lang;
  const known = trackingAvailable && answered !== null && total !== null;
  const pct = known && total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : known ? 0 : undefined;
  const fillWidth = known && total > 0 ? Math.min(100, Math.max(0, (answered / total) * 100)) : 0;
  const progressText = progressLoading ? t("home_progress_loading", lang)
    : progressError ? t("home_progress_error", lang) : t("home_progress_unknown", lang);

  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: "linear-gradient(118deg, var(--mp-oxford-blue), var(--mp-cta-blue))",
        borderRadius: "var(--mp-r-card)",
        boxShadow: "var(--mp-shadow-hover)",
        padding: "22px 22px 24px",
      }}
      role="group"
      aria-label={t("home_your_exam_progress", lang)}
    >
      {/* decorative: teal corner glow + faint dot grid (purely cosmetic) */}
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
          <p className="text-[13px] font-medium min-w-0 truncate" style={{ color: "rgba(255,255,255,0.72)" }}>
            {greeting}, {userName}
          </p>
          {typeof daysLeft === "number" && daysLeft > 0 && (
            <span
              className="inline-flex items-center gap-1.5 flex-shrink-0 font-mono"
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#fff",
                background: "rgba(255,255,255,0.13)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 9999,
                padding: "3px 10px",
              }}
              aria-label={t("home_days_until", lang).replace("{days}", formatCount(daysLeft, "day", fmtLang))}
            >
              <span
                className="inline-block"
                style={{ width: 6, height: 6, borderRadius: 9999, background: "var(--mp-spark)" }}
                aria-hidden
              />
              {t("home_days_short", lang).replace("{days}", formatCount(daysLeft, "day", fmtLang))}
            </span>
          )}
        </div>
        <h2
          className="mt-1.5 font-display font-extrabold leading-tight"
          style={{ fontSize: 22, color: "#fff", letterSpacing: "-0.01em", minHeight: "2.5em" }}
        >
          {!trackingAvailable ? t("home_start_exploring_this_question_bank", lang) : known ? (
            <>{t("home_seen_before", lang)} <bdi dir="ltr" style={{ color: "var(--mp-spark)" }}>{formatPercent(pct, fmtLang)}</bdi> {t("home_seen_after", lang)}</>
          ) : <><span aria-hidden="true">- </span>{progressText}</>}

        </h2>

        {/* progress: exam label + answered/total + spark-glow fill */}
        <div className="mt-4">
          <div
            className="flex flex-wrap items-center justify-between gap-1 mb-1.5"
            style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}
          >
            <span className="truncate pr-2">{examLabel}</span>
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
            aria-label={t("home_your_exam_progress", lang)}
            aria-valuenow={pct}
            aria-valuetext={!known || progressLoading || progressError ? progressText : undefined}
            aria-busy={progressLoading || undefined}
          >
            <div
              className={!known && progressLoading ? "motion-safe:animate-pulse" : undefined}
              style={{
                height: "100%",
                width: known ? `${fillWidth}%` : "100%",
                opacity: known ? 1 : 0.3,
                borderRadius: 9999,
                background: "linear-gradient(90deg, var(--mp-viridian), var(--mp-spark))",
                boxShadow: "0 0 12px var(--mp-spark-glow)",
                transition: "width 0.6s var(--mp-ease-out)",
              }}
            />
          </div>
        </div>

        {progressError && <Alert variant="info" title={t("home_progress_error", lang)} className="mt-3">
          {known && <p>{t("home_progress_stale", lang)}</p>}
          {onProgressRetry && <Button variant="secondary" className="mt-2 min-h-11" onClick={onProgressRetry}>{t("request_retry", lang)}</Button>}
        </Alert>}

        {/* CTAs: primary "Jetzt lernen" (white), ghost "Lernplan" */}
        <div className="flex gap-2.5 mt-[18px]">
          <Link
            href={studyHref}
            className="flex-1 inline-flex items-center justify-center gap-2 font-bold mp-focusable"
            style={{
              height: 44,
              borderRadius: "var(--mp-r-button)",
              fontSize: 14,
              background: "#fff",
              color: "var(--mp-oxford-blue)",
            }}
            aria-label={t("home_study_now", lang)}
          >
            <Play className="w-[17px] h-[17px]" aria-hidden />
            {t("home_study_now", lang)}
          </Link>
          <Link
            href={planHref}
            className="flex-1 inline-flex items-center justify-center gap-2 font-bold mp-focusable"
            style={{
              height: 44,
              borderRadius: "var(--mp-r-button)",
              fontSize: 14,
              background: "rgba(255,255,255,0.13)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.2)",
            }}
            aria-label={t("home_open_study_plan", lang)}
          >
            <CalendarDays className="w-[17px] h-[17px]" aria-hidden />
            {t("home_study_plan", lang)}
          </Link>
        </div>
      </div>
    </div>
  );
}
