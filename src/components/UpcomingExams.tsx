"use client";

/**
 * UpcomingExams: self-aging OFFICIAL exam calendar.
 *
 * Since W1-CAL (2026-10-10) the cards come from the C7 export
 * (`OFFICIAL_SITTINGS` in `@/lib/exam-dates`, confirmed official rows only),
 * one card per exam family: the next SIP4a/SIP5a window (MedUni Wien), the
 * next Rezeptierkunde/Gerichtsmedizin exam week (closes Tuesday 12:00), and
 * the next Stichprobentest sitting with BOTH published deadlines, each
 * labelled by its publisher. Deadlines are compared in Vienna time, so a
 * closed window drops out by itself. No postgraduate ÖÄK date is shown.
 * New strings live in `@/lib/i18n-dates`.
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
import { CalendarDays, Clock, ArrowRight } from "lucide-react";
import {
  OFFICIAL_KEYS_BY_BANK,
  getNextOfficialDeadlineGroup,
  getUpcomingOfficialFor,
  viennaToday,
  type OfficialSitting,
  type PuypExamType,
} from "@/lib/exam-dates";
import {
  deadlineLabel,
  formatClose,
  formatOfficialDate,
  formatSittingWhen,
  formatWindow,
  joinList,
  shortExamName,
  td,
} from "@/lib/i18n-dates";

type Lang = "de" | "en";

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
  daysLeft: { de: "Tage", en: "days" },
  dayLeft: { de: "Tag", en: "day" },
  source: { de: "Offizielle Quelle", en: "Official source" },
} as const;

/** One card: one exam family's next official sitting(s) and deadline(s). */
interface OfficialCardData {
  key: string;
  title: string;
  rows: OfficialSitting[];
}

/** Build the three family cards from the C7 export at `now`. */
function buildCards(lang: Lang, now: Date): OfficialCardData[] {
  const cards: OfficialCardData[] = [];
  const families: PuypExamType[] = ["kenntnispruefung", "pharma", "kmp_innsbruck"];
  for (const bank of families) {
    const exams = OFFICIAL_KEYS_BY_BANK[bank];
    const g = getNextOfficialDeadlineGroup({ exams, now });
    if (!g) continue;
    let rows = g.rows;
    if (bank === "kmp_innsbruck") {
      // Every publisher's deadline for that one sitting.
      rows = getUpcomingOfficialFor({ exams, now }).filter((r) => r.date === g.rows[0].date);
    }
    const title =
      bank === "kmp_innsbruck"
        ? lang === "de"
          ? rows[0].learner_label.de
          : rows[0].learner_label.en
        : `${joinList(rows.map((r) => shortExamName(r, lang)), lang)} ${td("meduni_wien_suffix", lang)}`;
    cards.push({ key: `${bank}-${rows[0].date}`, title, rows });
  }
  return cards;
}

function OfficialCard({
  card,
  lang,
  now,
  mounted,
}: {
  card: OfficialCardData;
  lang: Lang;
  now: Date;
  mounted: boolean;
}) {
  const first = card.rows[0];
  const days = mounted ? daysUntil(first.date) : null;
  const dayWord = days === 1 ? T.dayLeft[lang] : T.daysLeft[lang];
  const isStp = first.exam_key === "stichprobentest";
  // One line per distinct sitting date (SIP5a 17 Nov, SIP4a 18 Nov).
  const whenLines = [...new Map(card.rows.map((r) => [`${r.date}|${r.date_end ?? ""}`, r])).values()];
  // One deadline line per distinct (close, publisher); SIP4a/SIP5a share one.
  const deadlineRows = [
    ...new Map(
      card.rows.map((r) => [`${r.registration_closes}|${r.closes_at_time ?? ""}|${r.publisher}|${r.deadline_type}`, r])
    ).values(),
  ].sort((a, b) => (a.registration_closes ?? "").localeCompare(b.registration_closes ?? ""));
  const sources = [...new Map(card.rows.map((r) => [r.source_url, r])).values()];
  const todayIso = viennaToday(now);

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
            className="font-display font-bold text-[var(--mp-fg)]"
            style={{ fontSize: "16px" }}
          >
            {card.title}
          </h3>
        </div>
        {days !== null && (
          <span
            className="text-xs font-semibold tabular-nums whitespace-nowrap rounded-full px-2.5 py-1 flex-shrink-0"
            style={{
              background: "var(--mp-cta-blue)",
              color: "var(--mp-fg-on-cta-blue, white)",
            }}
          >
            {`${days} ${dayWord}`}
          </span>
        )}
      </div>

      <div className="mb-3 space-y-0.5">
        {whenLines.map((r) => (
          <p
            key={`${r.exam_key}-${r.date}`}
            className="font-display font-extrabold text-[var(--mp-fg)]"
            style={{ fontSize: whenLines.length > 1 ? "18px" : "clamp(20px, 2.4vw, 26px)", letterSpacing: "-0.01em" }}
          >
            {whenLines.length > 1 && !isStp ? `${shortExamName(r, lang)}: ` : ""}
            {formatSittingWhen(r, lang)}
          </p>
        ))}
      </div>

      <dl className="space-y-1.5 text-sm text-[var(--mp-fg-muted)] mb-4">
        {deadlineRows.map((r) => (
          <div key={`${r.publisher}-${r.registration_closes}`} className="flex items-start gap-2">
            <Clock className="w-4 h-4 flex-shrink-0 opacity-70 mt-0.5" aria-hidden="true" />
            <dd>
              {!isStp && r.registration_opens && r.registration_opens > todayIso ? (
                formatWindow(r, lang)
              ) : (
                <>
                  <span>{deadlineLabel(r, lang)}: </span>
                  <strong className="text-[var(--mp-fg)]">{formatClose(r, lang)}</strong>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-xs leading-relaxed mb-4 mt-auto text-[var(--mp-fg-muted)]">
        {isStp ? td("stp_where", lang) : first.exam_key === "rezeptierkunde" || first.exam_key === "gerichtsmedizin" ? td("calendar_rig_note", lang) : td("binding", lang)}
      </p>

      <div className="flex flex-col gap-1 mt-auto">
        {sources.map((r) => (
          <a
            key={r.source_url}
            href={r.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-[var(--mp-viridian)] hover:underline underline-offset-2 inline-flex items-center gap-1"
          >
            {td("source_read", lang, {
              publisher: r.publisher,
              read: formatOfficialDate(r.read_on, lang),
            })}
            <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </a>
        ))}
      </div>
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

  // Official sittings only (C7). The Vienna bank is SIP4a/SIP5a practice,
  // so no postgraduate ÖÄK date appears here. `now` is read at render: the
  // server render and the client agree except across a deadline minute.
  const now = new Date();
  const cards = buildCards(lang, now);

  const viennaNote = (
    <p className="mt-4 text-sm text-[var(--mp-fg-muted)]">
      {td("calendar_vienna_note", lang)}{" "}
      <a href="https://www.meduniwien.ac.at/web/studium-weiterbildung/nostrifizierung/pruefungen/" target="_blank" rel="noopener noreferrer" className="text-[var(--mp-viridian)] hover:underline">
        {lang === "de" ? "Universitäre Prüfungsinformationen" : "University exam information"}
      </a>
    </p>
  );

  const grid = (
    <div
      className={`grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 ${
        cards.length >= 3 ? "lg:grid-cols-3" : ""
      }`}
    >
      {cards.map((c) => (
        <OfficialCard key={c.key} card={c} lang={lang} now={now} mounted={mounted} />
      ))}
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
          <a
            href="https://www.meduniwien.ac.at/web/en/studium-weiterbildung/nostrifizierung/pruefungen/"
            target="_blank" rel="noopener noreferrer"
            className="text-xs font-medium text-[var(--mp-viridian)] hover:underline underline-offset-2"
          >
            {lang === "de" ? "Universitäre Prüfungsinformationen" : "University exam information"}
          </a>
        </div>
        {grid}
        {viennaNote}
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
        {grid}
        {viennaNote}
      </div>
    </section>
  );
}
