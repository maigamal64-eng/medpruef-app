"use client";

import Link from "next/link";
import { useState } from "react";
import { Coins } from "lucide-react";
import type { MentorPackageOffer } from "@/lib/mentor/contract";
import type { MentorUiLang } from "@/lib/i18n-mentor";
import { r3T } from "./r3-copy";
import { a39T } from "./a39-copy";
import { formatDate, formatEur } from "./view-model";
import { sampleAnswer } from "./sample-answer";
import { SourceChips } from "./AnswerDetails";

/** Cheapest renewing package by price; the first-run line quotes its row, never a typed price. */
export function entryOffer(offers: MentorPackageOffer[]): MentorPackageOffer | null {
  const subs = offers.filter((o) => o.kind === "subscription" && o.period_days);
  return subs.sort((a, b) => a.price_eur_cents - b.price_eur_cents)[0] ?? null;
}

export function firstRunLine(offers: MentorPackageOffer[], lang: MentorUiLang): string {
  const o = entryOffer(offers);
  return o ? a39T("first_run_price", lang, { price: formatEur(o.price_eur_cents, lang), credits: o.credits, days: o.period_days ?? 30 }) : a39T("first_run_soon", lang);
}

/**
 * MUX-19: state "none" is a first-run state. The price comes from the package
 * row, the sample answer is a static asset (no model call, no ledger write)
 * and the full disclaimer is shown once, here.
 */
export default function FirstRunCard({ offers, lang, learnerId, now }: { offers: MentorPackageOffer[]; lang: MentorUiLang; learnerId?: string; now?: Date }) {
  const [open, setOpen] = useState(false);
  const sample = sampleAnswer(lang, now);
  return (
    <section data-mentor-first-run className="w-full max-w-md rounded-2xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-4 text-start">
      <p className="flex items-start gap-2 text-[15px] font-semibold leading-snug text-[var(--mp-fg)]"><Coins className="mt-0.5 h-5 w-5 shrink-0 text-[var(--mp-viridian)]" aria-hidden /><span>{firstRunLine(offers, lang)}</span></p>
      <p className="mt-2 text-[13px] text-[var(--mp-fg-muted)]">{a39T("proof", lang)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/mentor/packages?from=first_run" className="mp-btn mp-btn--primary min-h-11">{a39T("see_packages", lang)}</Link>
        {sample && <button type="button" aria-expanded={open} aria-controls="mentor-sample-answer" className="mp-btn mp-btn--ghost min-h-11" onClick={() => setOpen((v) => !v)}>{a39T(open ? "hide_sample" : "see_sample", lang)}</button>}
      </div>
      {sample && open && (
        <div id="mentor-sample-answer" className="mt-4 space-y-2 border-t border-[var(--mp-border)] pt-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)]">{a39T("sample_label", lang, { date: formatDate(sample.readOn, lang) })}</p>
          <p dir="auto" className="ms-auto w-fit max-w-[90%] rounded-2xl rounded-ee-md bg-[var(--mp-oxford-blue)] px-3 py-2 text-[14px] text-white">{sample.question}</p>
          <div dir="auto" className="rounded-2xl border border-[var(--mp-border)] bg-[var(--mp-surface)] px-3 py-2 text-[14px] leading-relaxed text-[var(--mp-fg)]">
            <p className="font-semibold">{sample.lead}</p>
            <p className="mt-1">{sample.body}</p>
            <SourceChips citations={[sample.citation]} lang={lang} learnerId={learnerId} now={now} />
          </div>
          <p className="text-[12px] text-[var(--mp-fg-muted)]">{a39T("sample_note", lang)}</p>
        </div>
      )}
      <p className="mt-3 text-[12px] leading-snug text-[var(--mp-fg-muted)]">{r3T("disclaimer", lang)}</p>
    </section>
  );
}
