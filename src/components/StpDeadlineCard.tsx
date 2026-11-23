"use client";

/**
 * Home card of the two published Stichprobentest deadlines (a-c1-stp-card-1119,
 * C1, STP_DEADLINE_CARD_ENABLED, default OFF). For a learner whose own sitting
 * is a Stichprobentest it shows both published deadline rows with their
 * publishers (each a link to the source), asks the learner to confirm with the
 * filing university and, for a free learner, offers the plan that covers the
 * sitting (price last, fit.ts decides). With no sitting set (from 28 Nov) it
 * asks for the sitting. One marketing surface at a time through the
 * announcement queue ("stp_deadline_card"); "Ausblenden" quiets it for 7 days.
 * Show rules: src/lib/stp-deadline-card/index.ts; copy: copy.ts (Lektor
 * APPROVE, byte-exact).
 */
import { useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { dismissSurface, isSurfaceDismissed, useAnnouncementSlot } from "@/lib/announcements/queue";
import { tc } from "@/lib/i18n-cram";
import { trackEvent } from "@/lib/tracker";
import { C1_ASK_CLICK, C1_PAYWALL_CLICK } from "@/lib/stp-deadline-card";
import { useStpDeadlineCard } from "@/lib/stp-deadline-card/useStpDeadlineCard";

export default function StpDeadlineCard({ userId, lang, className = "" }: { userId: string; lang: string; className?: string }) {
  const isGuest = !userId || userId.startsWith("guest_");
  const card = useStpDeadlineCard(!isGuest, lang);
  const [hidden, setHidden] = useState(false);
  const wants = card.state !== "none" && !hidden && !isSurfaceDismissed("stp_deadline_card");
  const granted = useAnnouncementSlot("stp_deadline_card", wants);
  if (!granted || card.state === "none" || hidden) return null;

  const dismiss = (
    <button
      type="button"
      onClick={() => { setHidden(true); dismissSurface("stp_deadline_card", "later"); }}
      className="inline-flex items-center min-h-11 text-xs font-medium text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
    >
      {tc("rezgm_dismiss", lang)}
    </button>
  );

  if (card.state === "ask") {
    return (
      <section data-testid="stp-deadline-card" data-variant="ask" aria-labelledby="stp-deadline-card-body" className={`rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 ${className}`}>
        <div className="flex items-start gap-2.5">
          <CalendarClock className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--mp-cta-blue)]" aria-hidden />
          <div className="min-w-0 flex-1">
            <p id="stp-deadline-card-body" className="text-sm leading-snug text-[var(--mp-fg)]">{card.body}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link
                href={card.cta.href}
                onClick={() => trackEvent("cta_click", { ...C1_ASK_CLICK })}
                className="mp-btn mp-btn--secondary min-h-11"
              >
                {card.cta.label}
              </Link>
              {dismiss}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="stp-deadline-card" data-variant="sitting" aria-labelledby="stp-deadline-card-title" className={`rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 ${className}`}>
      <div className="flex items-start gap-2.5">
        <CalendarClock className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--mp-cta-blue)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="stp-deadline-card-title" className="text-sm font-semibold leading-snug text-[var(--mp-fg)]">{card.title}</h2>
          <p className="mt-0.5 text-sm leading-snug text-[var(--mp-fg)]" data-testid="stp-deadline-rows">
            {card.before}{" "}
            {card.rows.map((row, i) => (
              <span key={row.href} className="block">
                <a href={row.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--mp-viridian)] underline underline-offset-2">{row.publisher}</a>
                {row.rest}
                {i === card.rows.length - 1 ? card.after : ""}
              </span>
            ))}
          </p>
          {card.planLine && <p className="mt-1 text-sm leading-snug text-[var(--mp-fg)]" data-testid="stp-deadline-plan">{card.planLine}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {card.cta && (
              <Link
                href={card.cta.href}
                onClick={() => trackEvent("paywall_click", { ...C1_PAYWALL_CLICK })}
                className="mp-btn mp-btn--secondary min-h-11"
              >
                {card.cta.label}
              </Link>
            )}
            {dismiss}
          </div>
        </div>
      </div>
    </section>
  );
}
