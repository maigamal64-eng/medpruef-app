"use client";

/**
 * UpcomingExams — self-aging exam calendar.
 *
 * Reads the next future sittings from `@/lib/exam-dates` (the code
 * owner of exam dates) and renders them as on-brand cards. Because the
 * selector returns only FUTURE sittings, this display NEVER needs a
 * manual edit when a date passes — a past sitting drops out and the
 * next one shows automatically. Pharmakologie has no fixed date, so it
 * renders as a separate "rolling / term-based" note rather than a fake
 * countdown.
 *
 * Used on /landing (full section) and /pricing (compact block). Pass
 * `variant="compact"` for the slimmer pricing version. DE + EN via the
 * `lang` prop (the surfaces already manage language state).
 *
 * The "days until" count is computed once on mount (client-only) to
 * avoid an SSR/hydration mismatch on the day-granularity number; the
 * dates themselves render server-side from the static calendar.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, MapPin, Clock, ArrowRight } from "lucide-react";
import {
  getUpcomingSittings,
  EXAM_SITTINGS,
  PHARMA_INFO_URL,
  type ExamSitting,
} from "@/lib/exam-dates";

type Lang = "de" | "en";

const LOCALE: Record<Lang, string> = { de: "de-AT", en: "en-GB" };

function formatLongDate(iso: string, lang: Lang): string {
  // Parse as a local date (no TZ shift on the day label).
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString(LOCALE[lang], {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function daysUntil(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
  const now = Date.now();
  return Math.max(0, Math.ceil((target - now) / (1000 * 60 * 60 * 24)));
}

const T = {
  eyebrow: { de: "Prüfungskalender", en: "Exam calendar" },
  title: {
    de: "Die nächsten Prüfungstermine",
    en: "The next exam dates",
  },
  subtitle: {
    de: "Immer aktuell: vergangene Termine fallen automatisch heraus, sobald sie vorbei sind.",
    en: "Always current: past dates drop off automatically once they pass.",
  },
  registration: { de: "Anmeldeschluss", en: "Registration deadline" },
  daysLeft: { de: "Tage", en: "days" },
  dayLeft: { de: "Tag", en: "day" },
  source: { de: "Offizielle Quelle", en: "Official source" },
  noDate: {
    de: "Nächster Termin noch nicht veröffentlicht.",
    en: "Next date not yet published.",
  },
  pharmaTitle: {
    de: "Pharmakologie / Rezeptierkunde",
    en: "Pharmakologie / Rezeptierkunde",
  },
  pharmaBody: {
    de: "Kein fixer Jahrestermin: die Prüfung folgt den regulären Semester-Prüfungswochen deiner Medizinischen Universität (ca. Ende September bis Jänner) und wird pro Semester angemeldet. Deinen genauen Termin entnimmst du deinem Nostrifikationsbescheid.",
    en: "No fixed annual date: the exam follows your Medical University's regular semester exam weeks (roughly late September to January) and is registered per semester. Check your nostrification decision letter for your exact date.",
  },
  rolling: { de: "Laufend / pro Semester", en: "Rolling / per semester" },
} as const;

function ExamCard({
  sitting,
  lang,
  mounted,
}: {
  sitting: ExamSitting;
  lang: Lang;
  mounted: boolean;
}) {
  const days = mounted ? daysUntil(sitting.date) : null;
  const dayWord = days === 1 ? T.dayLeft[lang] : T.daysLeft[lang];

  return (
    <article className="lp-card p-5 sm:p-6 h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(0, 123, 95, 0.1)" }}
          >
            <CalendarDays
              className="w-4.5 h-4.5 text-[var(--mp-viridian)]"
              aria-hidden="true"
            />
          </span>
          <h3
            className="font-display font-bold text-[var(--mp-fg)] truncate"
            style={{ fontSize: "16px" }}
          >
            {sitting.label[lang]}
          </h3>
        </div>
        {days !== null && (
          <span
            className="text-xs font-semibold tabular-nums whitespace-nowrap rounded-full px-2.5 py-1 flex-shrink-0"
            style={{
              background: "var(--mp-cta-blue)",
              color: "#fff",
            }}
          >
            {`${days} ${dayWord}`}
          </span>
        )}
      </div>

      <p
        className="font-display font-extrabold text-[var(--mp-fg)] mb-3"
        style={{ fontSize: "clamp(20px, 2.4vw, 26px)", letterSpacing: "-0.01em" }}
      >
        {formatLongDate(sitting.date, lang)}
      </p>

      <dl className="space-y-1.5 text-sm text-[var(--mp-fg-muted)] mb-4">
        {sitting.location && (
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 flex-shrink-0 opacity-70" aria-hidden="true" />
            <dd>{sitting.location}</dd>
          </div>
        )}
        {sitting.registrationDeadline && (
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 flex-shrink-0 opacity-70" aria-hidden="true" />
            <dd>
              <span className="opacity-80">{T.registration[lang]}: </span>
              {formatLongDate(sitting.registrationDeadline, lang)}
            </dd>
          </div>
        )}
      </dl>

      {sitting.note && (
        <p
          className="text-xs leading-relaxed mb-4 mt-auto text-[var(--mp-fg-muted)]"
          style={{ opacity: 0.85 }}
        >
          {sitting.note[lang]}
        </p>
      )}

      <a
        href={sitting.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-medium text-[var(--mp-viridian)] hover:underline underline-offset-2 inline-flex items-center gap-1 mt-auto"
      >
        {T.source[lang]}
        <ArrowRight className="w-3 h-3" aria-hidden="true" />
      </a>
    </article>
  );
}

function PharmaCard({ lang }: { lang: Lang }) {
  return (
    <article className="lp-card p-5 sm:p-6 h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(58, 124, 165, 0.12)" }}
          >
            <CalendarDays
              className="w-4.5 h-4.5 text-[var(--mp-info)]"
              aria-hidden="true"
            />
          </span>
          <h3
            className="font-display font-bold text-[var(--mp-fg)] truncate"
            style={{ fontSize: "16px" }}
          >
            {T.pharmaTitle[lang]}
          </h3>
        </div>
        <span
          className="text-xs font-semibold whitespace-nowrap rounded-full px-2.5 py-1 flex-shrink-0"
          style={{
            background: "var(--mp-surface-sunken)",
            color: "var(--mp-fg-muted)",
            border: "1px solid var(--mp-border-subtle)",
          }}
        >
          {T.rolling[lang]}
        </span>
      </div>

      <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed mb-4">
        {T.pharmaBody[lang]}
      </p>

      <a
        href={PHARMA_INFO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-medium text-[var(--mp-viridian)] hover:underline underline-offset-2 inline-flex items-center gap-1 mt-auto"
      >
        {T.source[lang]}
        <ArrowRight className="w-3 h-3" aria-hidden="true" />
      </a>
    </article>
  );
}

export default function UpcomingExams({
  lang,
  variant = "full",
}: {
  lang: Lang;
  variant?: "full" | "compact";
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const sittings = getUpcomingSittings();
  // Show Pharma's rolling note only if its calendar is empty (the
  // honest representation — never a fake countdown).
  const showPharma = EXAM_SITTINGS.pharma.length === 0;

  const cards = (
    <div
      className={`grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 ${
        sittings.length + (showPharma ? 1 : 0) >= 3 ? "lg:grid-cols-3" : ""
      }`}
    >
      {sittings.map((s) => (
        <ExamCard
          key={`${s.examType}-${s.date}`}
          sitting={s}
          lang={lang}
          mounted={mounted}
        />
      ))}
      {showPharma && <PharmaCard lang={lang} />}
    </div>
  );

  if (variant === "compact") {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <h2
            className="font-display font-bold text-[var(--mp-fg)]"
            style={{ fontSize: "18px" }}
          >
            {T.title[lang]}
          </h2>
          <Link
            href="/kenntnispruefung-wien"
            className="text-xs font-medium text-[var(--mp-viridian)] hover:underline underline-offset-2"
          >
            {lang === "de" ? "Mehr zur Prüfung" : "About the exam"}
          </Link>
        </div>
        {cards}
      </div>
    );
  }

  return (
    <section
      id="exam-calendar"
      className="py-16 md:py-20 bg-[var(--mp-surface-raised)]"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="lp-reveal max-w-2xl mb-10">
          <p className="lp-eyebrow mb-3 text-[var(--mp-viridian)]">
            {T.eyebrow[lang]}
          </p>
          <h2
            className="font-display font-extrabold text-[var(--mp-fg)]"
            style={{
              fontSize: "clamp(26px, 3.4vw, 38px)",
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
            }}
          >
            {T.title[lang]}
          </h2>
          <p
            className="mt-3 text-[var(--mp-fg-muted)]"
            style={{ fontSize: "17px", lineHeight: 1.55 }}
          >
            {T.subtitle[lang]}
          </p>
        </div>
        {cards}
      </div>
    </section>
  );
}
