"use client";

/**
 * The first action on /lernplan (a-lernplan-conversion-1019): the visitor taps
 * their exam and lands on the first free-sample question of that bank. Each
 * row is a plain link, so it works before hydration and is one tap from the
 * post. Signed out, the link opens registration with intent "free" and the
 * bank; after the account exists authDestination sends the learner straight
 * to /quiz in that bank. Signed in, the link goes to /quiz directly.
 *
 * Attribution: nothing is appended to the link. AttributionCapture already
 * stored the campaign link (or the organic "lernplan" arrival) on landing,
 * and the register call carries that record to user_registered.
 */
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { getSessionToken, getStoredSession } from "@/lib/auth";
import { buildAuthHref, freeStudyDestination, persistAuthEntry } from "@/lib/auth-entry";
import { trackFunnelEvent } from "@/lib/funnel-events";
import type { PuypExamType } from "@/lib/exam-dates";
import { PRACTICE_ORDER } from "@/lib/study-plan-public";
import { pc, type PublicPlanLang, type PublicPlanCopyKey } from "@/lib/study-plan-public/copy";

const VIEW_KEY = "medpruef_lernplan_view_sent";
/** A short line under the exam name; none for pharma, whose name already says it. */
const HINTS: Partial<Record<PuypExamType, PublicPlanCopyKey>> = {
  kmp_innsbruck: "practice_hint_kmp_innsbruck",
  kenntnispruefung: "practice_hint_kenntnispruefung",
};

export function practiceHref(bank: PuypExamType, signedIn: boolean): string {
  return signedIn ? freeStudyDestination(bank) : buildAuthHref({ intent: "free", exam: bank, next: "/" });
}

export interface PracticeStartProps {
  lang: PublicPlanLang;
  /** The bank the visitor arrived for (?exam= or ?bank=), shown as the lead row. */
  picked: PuypExamType | null;
  labels: Record<PuypExamType, { full: string; short: string }>;
}

export default function PracticeStart({ lang, picked, labels }: PracticeStartProps) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const user = getStoredSession()?.user;
    setSignedIn(!!user && !user.id.startsWith("guest_") && !!getSessionToken());
    // One /lernplan view per browser session (its own key, so an earlier landing_view elsewhere does not hide it).
    try {
      if (sessionStorage.getItem(VIEW_KEY)) return;
      sessionStorage.setItem(VIEW_KEY, "1");
    } catch { /* storage blocked: count this page view */ }
    trackFunnelEvent("landing_view", { source: "lernplan" });
  }, []);

  const order = picked ? [picked, ...PRACTICE_ORDER.filter((b) => b !== picked)] : PRACTICE_ORDER;

  return (
    <section
      className="mp-card relative min-w-0 overflow-hidden p-5 sm:p-6"
      aria-labelledby="practice-title"
      data-testid="lernplan-practice"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-[var(--mp-cta-blue)]" />
      <h2 id="practice-title" className="text-xl font-bold leading-snug sm:text-2xl">{pc("practice_title", lang)}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{pc("practice_body", lang)}</p>
      <ul className="mt-4 space-y-2.5">
        {order.map((bank) => {
          const lead = bank === picked;
          const hint = HINTS[bank];
          return (
            <li key={bank}>
              <a
                href={practiceHref(bank, signedIn)}
                data-testid={`lernplan-practice-${bank}`}
                data-lead={lead ? "true" : undefined}
                onClick={() => {
                  if (!signedIn) persistAuthEntry({ intent: "free", exam: bank, next: "/" });
                  trackFunnelEvent("cta_click", { surface: "lernplan", cta: signedIn ? "practice_signed_in" : "practice", exam: bank, source: "lernplan" });
                }}
                className={`group flex min-h-16 items-center gap-3 rounded-xl border p-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mp-cta-blue)] ${
                  lead
                    ? "border-[var(--mp-action-primary)] bg-[var(--mp-action-primary)] text-[var(--mp-fg-on-cta-blue)] hover:bg-[var(--mp-action-primary-hover)]"
                    : "border-[var(--mp-border)] bg-[var(--mp-surface-raised)] hover:border-[var(--mp-cta-blue)]"
                }`}
              >
                <span
                  aria-hidden
                  className={`grid h-11 min-w-11 shrink-0 place-items-center rounded-lg px-1.5 font-mono text-[11px] font-bold ${
                    lead ? "" : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)]"
                  }`}
                  style={lead ? { backgroundColor: "color-mix(in srgb, var(--mp-fg-on-cta-blue) 14%, transparent)" } : undefined}
                >
                  {labels[bank].short}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold leading-snug">{labels[bank].full}</span>
                  {hint && (
                    <span className={`block text-[13px] leading-snug ${lead ? "opacity-90" : "text-[var(--mp-fg-muted)]"}`}>
                      {pc(hint, lang)}
                    </span>
                  )}
                  <span className={`mt-1 block text-[13px] font-semibold ${lead ? "underline underline-offset-2" : "text-[var(--mp-cta-blue)]"}`}>
                    {pc(signedIn ? "practice_go_signed_in" : "practice_go", lang)}
                  </span>
                </span>
                <ArrowRight aria-hidden className="size-5 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
              </a>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[13px] leading-relaxed text-[var(--mp-fg-muted)]" data-testid="lernplan-practice-note">
        {pc(signedIn ? "practice_note_signed_in" : "practice_note", lang)}
      </p>
    </section>
  );
}
