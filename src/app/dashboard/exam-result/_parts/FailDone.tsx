"use client";

import Link from "next/link";
import { ArrowRight, Clock, Save } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { tp } from "@/lib/i18n-puyp";

/**
 * After "Nicht bestanden" is stored (EXM-48): the review state for a proof
 * claim, one calm line and exactly one link, to the Lernplan. No weak-topic
 * picker, no promise that the plan adapts, no frequency claim.
 */
export function FailDone({ lang, withProof }: { lang: Lang; withProof: boolean }) {
  return (
    <section className="mp-card p-6 space-y-4" aria-labelledby="puyp-done-title" role="status">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-lg bg-[var(--mp-viridian)]/10 flex items-center justify-center flex-shrink-0">
          {withProof ? <Clock size={20} className="text-[var(--mp-viridian)]" aria-hidden /> : <Save size={20} className="text-[var(--mp-viridian)]" aria-hidden />}
        </span>
        <h2 id="puyp-done-title" className="mp-h3">
          {withProof ? tp("submittedTitle", lang) : tp("recordedTitle", lang)}
        </h2>
      </div>
      {withProof && <p className="text-sm text-[var(--mp-fg-muted)]">{tp("submittedBody", lang)}</p>}
      <p className="text-sm text-[var(--mp-fg)]">{tp("debrief", lang)}</p>
      <Link href="/study-plan" className="mp-btn mp-btn--primary min-h-[44px] inline-flex">
        {tp("debriefLink", lang)} <ArrowRight size={14} aria-hidden />
      </Link>
    </section>
  );
}
