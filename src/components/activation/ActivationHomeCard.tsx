"use client";
/**
 * Home card of the first 48 hours (a-activation-48h). One inline
 * announcement-queue surface (first_steps):
 *  - 1 to 9 answers: how many remain to the first 10, and the rest of the
 *    starter set;
 *  - 10 or more: the plan or "When is your exam?", and the reminder offer.
 * With no answer yet the hero's primary already opens the starter set, so
 * this card stays away. "Später" waits a day. The rest of the starter set
 * shows only for the bank Home is on (the quiz drops ids of another bank),
 * and the first-win note only while the learner is near their first 10.
 */
import { useEffect, useRef } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { trackEvent } from "@/lib/tracker";
import { dismissSurface, useAnnouncementSlot } from "@/lib/announcements/queue";
import { at, continueBody, translatedLine } from "@/lib/activation/copy";
import type { ActivationView } from "@/lib/activation/useActivation";
import ActivationNext from "./ActivationNext";

/** Past this many answers the first-win note is old news. */
const WIN_NOTE_MAX_ANSWERS = 30;

export default function ActivationHomeCard({ view, lang, examSource, className = "" }: { view: ActivationView | null; lang: string; examSource: string; className?: string }) {
  const continuing = view?.stage === "continue" && !!view.starter && view.exam === examSource;
  const won = view?.stage === "after_win" && (view.answered ?? 0) < WIN_NOTE_MAX_ANSWERS;
  const slot = useAnnouncementSlot("first_steps", continuing || won);
  const shown = useRef<string | null>(null);
  const exam = view?.segment ?? "unknown";

  useEffect(() => {
    if (!slot || !view) return;
    const step = continuing ? "continue_shown" : null;
    if (!step || shown.current === step) return;
    shown.current = step;
    trackEvent("activation_step", { step, exam, lang });
  }, [slot, view, continuing, exam, lang]);

  if (!slot || !view) return null;
  const remaining = Math.max(1, (view.first_win_size ?? 10) - (view.answered ?? 0));

  return (
    <section
      data-activation="home"
      aria-labelledby="activation-home-title"
      className={`rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--mp-cta-blue)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="activation-home-title" className="text-sm font-semibold text-[var(--mp-fg)]">
            {continuing ? at("continue_title", lang) : at("win_title", lang)}
          </h2>
          {continuing && view.starter && (
            <>
              <p className="mt-0.5 text-sm leading-snug text-[var(--mp-fg-muted)]">{continueBody(remaining, lang)}</p>
              {translatedLine(view.starter.translated ?? 0, view.starter.lang, lang) && (
                <p className="mt-1 text-xs leading-snug text-[var(--mp-fg-muted)]">{translatedLine(view.starter.translated ?? 0, view.starter.lang, lang)}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <Link
                  href={view.starter.href}
                  onClick={() => trackEvent("activation_step", { step: "starter_started", exam, lang })}
                  className="mp-btn mp-btn--secondary min-h-11"
                >
                  {at("continue_button", lang)}
                </Link>
                <button
                  type="button"
                  onClick={() => dismissSurface("first_steps", "later")}
                  className="inline-flex items-center justify-center min-h-11 min-w-11 px-2 text-xs font-medium text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
                >
                  {at("later", lang)}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {won && (
        <div className="mt-2">
          <ActivationNext view={view} lang={lang} source="home" />
          <button
            type="button"
            onClick={() => dismissSurface("first_steps", "later")}
            className="mt-1 inline-flex items-center justify-center min-h-11 min-w-11 px-2 text-xs font-medium text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
          >
            {at("later", lang)}
          </button>
        </div>
      )}
    </section>
  );
}
