"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { viennaToday } from "@/lib/exam-dates";

type Lang = "de" | "en";
type Bank = "kenntnispruefung" | "kmp_innsbruck" | "pharma";

interface CoverageRow { bank: Bank; latest_sitting_month: string | null; last_content_update: string | null }
interface ReviewRow { bank: Bank; reviewed_on: string | null; review_due_on: string | null; description: Record<Lang, string> }
interface Payload { banks: CoverageRow[]; reviews: ReviewRow[]; checked_at: string }

const LOCALE: Record<Lang, string> = { de: "de-AT", en: "en-GB" };
const COPY = {
  de: {
    title: "Stand dieser Fragenbank",
    sittings: "Zugeordnete Prüfungstermine bis",
    noSittings: "Keine Fragen einem Prüfungstermin zugeordnet",
    update: "Letzte erfasste Korrektur",
    noUpdate: "Noch keine Korrektur erfasst",
    reviewed: "Herkunft zuletzt geprüft",
    overdue: "Prüfung überfällig",
    basis: "Berechnet aus den aktiven Fragen, abgerufen",
    loading: "Stand wird geladen",
    failed: "Der Stand der Fragenbank ist gerade nicht abrufbar.",
    corrections: "Korrekturen ansehen",
    scope: "Umfang und Grenzen",
  },
  en: {
    title: "State of this question bank",
    sittings: "Exam sittings tagged up to",
    noSittings: "No questions tagged with an exam sitting",
    update: "Latest recorded correction",
    noUpdate: "No correction recorded yet",
    reviewed: "Sources last reviewed",
    overdue: "review overdue",
    basis: "Computed from the active questions, retrieved",
    loading: "Loading the bank state",
    failed: "The bank state is not available right now.",
    corrections: "See corrections",
    scope: "Scope and limits",
  },
} as const;

function day(iso: string, lang: Lang) {
  return new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
}
function month(iso: string, lang: Lang) {
  return new Intl.DateTimeFormat(LOCALE[lang], { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 7)}-15T12:00:00Z`));
}

/**
 * Dated freshness and provenance stamp for one bank (CNT-01, TR-04). Every
 * value is computed: sitting months and corrections from the active rows
 * (GET /api/bank-coverage), the review date from the reviewed provenance file.
 * A failed read says so instead of showing a guess.
 */
export default function BankFreshnessStamp({ bank, lang }: { bank: Bank; lang: Lang }) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "failed"; data?: Payload }>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    fetch("/api/bank-coverage", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("coverage");
        const data = (await res.json()) as Payload;
        if (!Array.isArray(data.banks) || !Array.isArray(data.reviews)) throw new Error("shape");
        setState({ status: "ready", data });
      })
      .catch(() => setState({ status: "failed" }))
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, []);

  const c = COPY[lang];
  const coverage = state.data?.banks.find((b) => b.bank === bank);
  const review = state.data?.reviews.find((r) => r.bank === bank);
  const overdue = review?.review_due_on ? viennaToday() > review.review_due_on : false;

  return (
    <section aria-labelledby={`bank-stamp-${bank}`} data-bank-stamp={bank} className="mp-card p-4 text-sm text-[var(--mp-fg-muted)]">
      <h2 id={`bank-stamp-${bank}`} className="text-sm font-semibold text-[var(--mp-fg)]">{c.title}</h2>
      {state.status === "loading" && <p className="mt-2" role="status">{c.loading}</p>}
      {(state.status === "failed" || (state.status === "ready" && (!coverage || !review))) && <p className="mt-2" role="status">{c.failed}</p>}
      {state.status === "ready" && coverage && review && (
        <>
          {review.description[lang] && <p className="mt-2 text-[var(--mp-fg)]">{review.description[lang]}.</p>}
          <ul className="mt-2 space-y-1">
            <li>{coverage.latest_sitting_month ? <>{c.sittings} <time dateTime={coverage.latest_sitting_month}>{month(coverage.latest_sitting_month, lang)}</time></> : c.noSittings}</li>
            <li>{coverage.last_content_update ? <>{c.update}: <time dateTime={coverage.last_content_update}>{coverage.last_content_update.length === 10 ? day(coverage.last_content_update, lang) : month(coverage.last_content_update, lang)}</time></> : c.noUpdate}</li>
            {review.reviewed_on && <li>{c.reviewed}: <time dateTime={review.reviewed_on}>{day(review.reviewed_on, lang)}</time>{overdue && <strong className="ml-1 text-[var(--mp-warning-text)]">({c.overdue})</strong>}</li>}
            <li className="text-xs">{c.basis} <time dateTime={state.data!.checked_at}>{day(state.data!.checked_at, lang)}</time></li>
          </ul>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <Link href={`/korrekturen?lang=${lang}`} className="inline-flex min-h-11 items-center underline underline-offset-4 text-[var(--mp-fg)]">{c.corrections}</Link>
            <Link href={`/umfang?lang=${lang}`} className="inline-flex min-h-11 items-center underline underline-offset-4 text-[var(--mp-fg)]">{c.scope}</Link>
          </p>
        </>
      )}
    </section>
  );
}
