"use client";

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
 *  - answered / total: progress toward the active exam (answered = gamification
 *    total_questions_answered; total = sum of topic counts for the active exam)
 *  - studyHref / planHref: the two CTAs (resume-or-random quiz, and /study-plan)
 *
 * Copy: Austrian register, Sie/du = du (the live home voice), dot-thousands via
 * de-DE locale, 🇦🇹-only emoji, ZERO em dashes. DE + EN.
 */

import Link from "next/link";
import { Play, CalendarDays } from "lucide-react";

type Lang = "de" | "en";

export interface HomeHeroProps {
  greeting: string;
  userName: string;
  examLabel: string;
  answered: number;
  total: number;
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
  studyHref,
  planHref,
  lang,
  daysLeft,
}: HomeHeroProps) {
  const locale = lang === "de" ? "de-DE" : "en-US";
  const pct = total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;
  // The fill never reads as a literal 0-width sliver for brand-new users —
  // it shows a hairline so the track looks alive, but the % label stays honest.
  const fillWidth = total > 0 ? Math.max(2, (answered / total) * 100) : 2;

  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: "linear-gradient(118deg, #001B3D, #003A8C)",
        borderRadius: "var(--mp-r-card)",
        boxShadow: "var(--mp-shadow-hover)",
        padding: "22px 22px 24px",
      }}
      role="group"
      aria-label={lang === "de" ? "Dein Prüfungsfortschritt" : "Your exam progress"}
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
                fontSize: 11,
                fontWeight: 700,
                color: "#fff",
                background: "rgba(255,255,255,0.13)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 9999,
                padding: "3px 10px",
              }}
              aria-label={lang === "de" ? `Noch ${daysLeft} Tage bis zur Prüfung` : `${daysLeft} days until the exam`}
            >
              <span
                className="inline-block"
                style={{ width: 6, height: 6, borderRadius: 9999, background: "var(--mp-spark)" }}
                aria-hidden
              />
              {lang === "de" ? `noch ${daysLeft} T` : `${daysLeft} d left`}
            </span>
          )}
        </div>
        <h2
          className="mt-1.5 font-display font-extrabold leading-tight"
          style={{ fontSize: 22, color: "#fff", letterSpacing: "-0.01em" }}
        >
          {lang === "de" ? (
            <>
              Du bist <span style={{ color: "var(--mp-spark)" }}>{pct}%</span> näher am Bestehen
              {" "}🇦🇹
            </>
          ) : (
            <>
              You are <span style={{ color: "var(--mp-spark)" }}>{pct}%</span> closer to passing
              {" "}🇦🇹
            </>
          )}
        </h2>

        {/* progress: exam label + answered/total + spark-glow fill */}
        <div className="mt-4">
          <div
            className="flex items-center justify-between mb-1.5"
            style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}
          >
            <span className="truncate pr-2">{examLabel}</span>
            <span className="font-mono flex-shrink-0" style={{ color: "#fff", fontWeight: 700 }}>
              {answered.toLocaleString(locale)} / {total.toLocaleString(locale)}
            </span>
          </div>
          <div
            className="relative overflow-hidden"
            style={{ height: 9, borderRadius: 9999, background: "rgba(255,255,255,0.14)" }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              style={{
                height: "100%",
                width: `${fillWidth}%`,
                borderRadius: 9999,
                background: "linear-gradient(90deg, var(--mp-viridian), var(--mp-spark))",
                boxShadow: "0 0 12px var(--mp-spark-glow)",
                transition: "width 0.6s var(--mp-ease-out)",
              }}
            />
          </div>
        </div>

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
              color: "#001B3D",
            }}
            aria-label={lang === "de" ? "Jetzt lernen" : "Study now"}
          >
            <Play className="w-[17px] h-[17px]" aria-hidden />
            {lang === "de" ? "Jetzt lernen" : "Study now"}
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
            aria-label={lang === "de" ? "Lernplan öffnen" : "Open study plan"}
          >
            <CalendarDays className="w-[17px] h-[17px]" aria-hidden />
            {lang === "de" ? "Lernplan" : "Study Plan"}
          </Link>
        </div>
      </div>
    </div>
  );
}
