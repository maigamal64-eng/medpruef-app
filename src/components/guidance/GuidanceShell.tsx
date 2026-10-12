"use client";

import EnglishVersionNotice from "@/components/guidance/EnglishVersionNotice";
import React, { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getLang } from "@/lib/i18n";
import GuidanceDocLayout from "./GuidanceDocLayout";
// The single calendar adapter for the track-B guidance family.
import { OFFICIAL_SITTINGS, getUpcomingOfficialSittings, viennaStamp, daysUntilViennaDate, type OfficialExamKey, type OfficialSitting } from "@/lib/exam-dates";
import data from "@/lib/guidance-data/wien-deadlines.data.json";
import { loadFacts, formatGuidanceDate, type GuidanceLang, type GuidanceFact } from "@/lib/guidance/facts";
import { liveGuidanceRoutes } from "@/lib/guidance/routes";
import { daysLeftText } from "@/lib/i18n-dates";
import { guidanceCopy } from "@/lib/i18n-lb-guidance";
import FactStamp from "./FactStamp";
import StaleBanner from "./StaleBanner";
import ReportFactLink from "./ReportFactLink";

type Sitting = OfficialSitting & { window_unconfirmed?: boolean };
export interface GuidanceWindow {
  sitting: Sitting;
  state: "open" | "upcoming" | "closed" | "unconfirmed";
  daysRemaining: number | null;
}

export function guidanceWindow(sitting: Sitting, now: Date): GuidanceWindow {
  const unconfirmed = sitting.window_unconfirmed || data.unconfirmed_windows.some((entry) => entry.exam_key === sitting.exam_key && entry.date === sitting.date);
  if (unconfirmed || !sitting.registration_closes) return { sitting, state: "unconfirmed", daysRemaining: null };
  const stamp = viennaStamp(now);
  if (stamp >= `${sitting.registration_closes} ${sitting.closes_at_time ?? "24:00"}`) return { sitting, state: "closed", daysRemaining: null };
  const state = sitting.registration_opens && stamp.slice(0, 10) < sitting.registration_opens ? "upcoming" : "open";
  return { sitting, state, daysRemaining: state === "open" ? daysUntilViennaDate(sitting.registration_closes, now) : null };
}

export function getGuidanceWindows(exams: readonly OfficialExamKey[], now: Date, sittings: readonly Sitting[] = OFFICIAL_SITTINGS): { next: GuidanceWindow[]; unconfirmed: GuidanceWindow[]; closed: boolean } {
  // Use Vienna's date even when the shared selector uses UTC-day granularity.
  const localDay = new Date(`${viennaStamp(now).slice(0, 10)}T12:00:00Z`);
  const windows = getUpcomingOfficialSittings({ filingUniversity: "wien", now: localDay }, sittings)
    .filter((s) => exams.includes(s.exam_key))
    .map((s) => guidanceWindow(s, now));
  const candidates = windows.filter((w) => w.state === "open" || w.state === "upcoming");
  candidates.sort((a, b) => (a.sitting.registration_closes ?? "").localeCompare(b.sitting.registration_closes ?? ""));
  const firstClose = candidates[0]?.sitting.registration_closes;
  return {
    next: candidates.filter((w) => w.sitting.registration_closes === firstClose),
    unconfirmed: windows.filter((w) => w.state === "unconfirmed"),
    closed: windows.some((w) => w.state === "closed"),
  };
}

function RegistrationContact({ kind, lang }: { kind: keyof typeof data.contacts; lang: GuidanceLang }) {
  const [visible, setVisible] = useState(false);
  const contact = data.contacts[kind];
  const address = [contact.local, contact.domain].join("@");
  const c = guidanceCopy[lang];
  return <div className="mt-3">
    <button type="button" aria-expanded={visible} className="underline underline-offset-4" onClick={() => setVisible(!visible)}>{c.showContact}</button>
    {visible && <p className="break-all">{c.contact}{": "}<a href={`mailto:${address}`}>{address}</a></p>}
  </div>;
}

export function DeadlinePanel({ exams, lang, now }: { exams: readonly OfficialExamKey[]; lang: GuidanceLang; now: Date }) {
  const c = guidanceCopy[lang];
  const result = getGuidanceWindows(exams, now);
  return <section>
    <h2>{c.dates}</h2>
    {result.closed && <p>{c.closed}</p>}
    {!result.next.length && <p>{c.unpublished}</p>}
    {result.next.map((window) => {
      const s = window.sitting;
      return <div key={`${s.exam_key}-${s.date}`} className="not-prose my-4 rounded-2xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-5" data-window-state={window.state}>
        <p className="text-xs font-semibold uppercase tracking-wider">{c[window.state === "open" ? "open" : "upcoming"]}</p>
        <h3 className="mt-2 font-semibold">{s.learner_label[lang]}</h3>
        <p className="mt-3">{c.window}{": "}{s.registration_opens ? formatGuidanceDate(s.registration_opens, lang) : c.unpublished}{" "}{c.until}{" "}{formatGuidanceDate(s.registration_closes!, lang)}{", "}{s.closes_at_time ?? c.endOfDay}</p>
        <p className="mt-2 text-sm">{c.vienna}</p>
        {window.daysRemaining !== null && <p className="mt-3 font-semibold" data-countdown>{c.remaining}{": "}{daysLeftText(s.registration_closes!, lang, now)}</p>}
        <p className="mt-3 text-sm">{c.sitting}{": "}{formatGuidanceDate(s.date, lang)}{s.date_end ? ` ${c.until} ${formatGuidanceDate(s.date_end, lang)}` : ""}</p>
        <FactStamp lang={lang} fact={{ id: `${s.exam_key}.dates.${s.date}`, statement: { de: "", en: "" }, status: "official", source_url: s.source_url, source_label: s.publisher, ...data.date_sources[s.exam_key.startsWith("sip") ? "sip" : "rez_gm"], applies_to: [] }} />
      </div>;
    })}
    {result.unconfirmed.map(({ sitting }) => <div key={`${sitting.exam_key}-${sitting.date}`} className="my-4 rounded-xl border border-[var(--mp-border)] p-4" data-window-state="unconfirmed">
      <strong>{sitting.learner_label[lang]}{": "}{c.unconfirmed}</strong>
      <p>{c.sitting}{": "}{formatGuidanceDate(sitting.date, lang)}</p>
      <FactStamp lang={lang} fact={{ id: `${sitting.exam_key}.unconfirmed.${sitting.date}`, statement: { de: "", en: "" }, status: "not_confirmed", source_url: sitting.source_url, source_label: sitting.publisher, edition: data.facts.find((f) => f.id === "sip.registration.march-unconfirmed")!.edition, read_on: data.unconfirmed_windows[0].read_on, review_every_days: data.facts[0].review_every_days, applies_to: [] }} />
    </div>)}
  </section>;
}

function Forms({ pageId, lang }: { pageId: string; lang: GuidanceLang }) {
  const c = guidanceCopy[lang];
  const entries = pageId === "sip-anmeldung"
    ? [{ key: "sip4a" as const, label: "SIP4a", contact: "sip" as const }, { key: "sip5a" as const, label: "SIP5a", contact: "sip" as const }]
    : [{ key: "rezeptierkunde" as const, label: "Rezeptierkunde", contact: "rez" as const }, { key: "gerichtsmedizin" as const, label: "Gerichtsmedizin", contact: "gm" as const }];
  return <section>
    <h2>{c.steps}</h2>
    <p>{c.preparation}</p>
    <div className="grid gap-4 sm:grid-cols-2">
      {entries.map((entry) => <div key={entry.key} className="not-prose min-w-0 rounded-xl border border-[var(--mp-border)] p-4 text-sm">
        <h3 className="font-semibold">{entry.label}</h3>
        <a href={data.forms[entry.key]} className="mt-3 block underline underline-offset-4" target="_blank" rel="noreferrer">{c.form}{": "}{entry.label}</a>
        <RegistrationContact kind={entry.contact} lang={lang} />
      </div>)}
    </div>
  </section>;
}

export default function GuidanceShell({ pageId, lang, initialNow, title, lede, facts: providedFacts, children }: { pageId: string; lang: GuidanceLang; initialNow: string; title?: string; lede?: string; facts?: GuidanceFact[]; children?: ReactNode }) {
  const router = useRouter(); const pathname = usePathname(); const search = useSearchParams();
  const [now, setNow] = useState(() => new Date(initialNow));
  useEffect(() => {
    let preferredEnglish = false;
    try { preferredEnglish = getLang() === "en"; } catch { /* Keep the URL language when storage is unavailable. */ }
    if (!search.has("lang") && preferredEnglish) {
      const params = new URLSearchParams(search.toString()); params.set("lang", "en");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, [pathname, router, search]);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(timer); }, []);
  const c = guidanceCopy[lang];
  const facts = providedFacts ?? loadFacts(pageId);
  const heading = title ?? (pageId === "index" ? c.index : pageId === "sip-anmeldung" ? c.sip : pageId === "rez-gm-anmeldung" ? c.rez : c.rules);
  return <GuidanceDocLayout lang={lang} onLangChange={(next) => {
    // LanguagePicker stores an explicit choice itself. This callback also
    // fires on mount with the hydration default, so it only moves the URL and
    // never writes the preference (a29: a ru/uk/tr/ar reader kept losing it).
    if (next === lang) return;
    const params = new URLSearchParams(search.toString()); params.set("lang", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }} title={heading} kicker={c.kicker} lede={lede ?? c.lede} backHref={pageId === "index" ? "/" : `/wien-route?lang=${lang}`}>
    <div lang={lang} className="break-words">
      <EnglishVersionNotice lang={lang} />
      <StaleBanner facts={facts} lang={lang} now={now} />
      {pageId === "index" && <section><h2>{c.routeSteps}</h2><div className="not-prose grid gap-3">
        {liveGuidanceRoutes().filter((route) => route.path !== "/wien-route").map((route) => <Link key={route.path} href={`${route.path}?lang=${lang}`} className="rounded-xl border border-[var(--mp-border)] p-4 font-semibold transition-colors hover:bg-[var(--mp-surface-raised)]">{route.label[lang]}{" →"}</Link>)}
      </div></section>}
      {(pageId === "index" || pageId === "sip-anmeldung") && <DeadlinePanel exams={["sip4a", "sip5a"]} lang={lang} now={now} />}
      {(pageId === "index" || pageId === "rez-gm-anmeldung") && <DeadlinePanel exams={["rezeptierkunde", "gerichtsmedizin"]} lang={lang} now={now} />}
      {(pageId === "sip-anmeldung" || pageId === "rez-gm-anmeldung") && <Forms pageId={pageId} lang={lang} />}
      {!!facts.length && <section><h2>{c.sources}</h2>{facts.map((fact) => <article key={fact.id} className="mb-5 rounded-xl border border-[var(--mp-border)] p-4" data-fact-id={fact.id}>
        <p className="!mt-0">{fact.statement[lang]}</p><FactStamp fact={fact} lang={lang} />
      </article>)}</section>}
      {children}
      <ReportFactLink pageId={pageId} lang={lang} />
    </div>
  </GuidanceDocLayout>;
}
