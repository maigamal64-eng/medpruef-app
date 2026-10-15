"use client";

/**
 * Lead capture for the public plan (M8). Saving needs a free account: the CTA
 * opens registration with the bank and the plan carried to /study-plan, and
 * the first-touch tags utm_source=study-plan (captured on /login only when no
 * earlier first-touch tag exists). A signed-in visitor goes straight to
 * /study-plan, which asks before replacing an own date.
 */
import { useEffect, useState } from "react";
import { getSessionToken, getStoredSession } from "@/lib/auth";
import { buildAuthHref, persistAuthEntry } from "@/lib/auth-entry";
import { trackFunnelEvent } from "@/lib/funnel-events";
import { PENDING_PLAN_KEY, PUBLIC_PLAN_UTM, pendingPlanRecord, studyPlanCarryHref, type CarriedPlan } from "@/lib/study-plan-public";
import { safeStorage } from "@/lib/safe-storage";
import { pc, type PublicPlanLang } from "@/lib/study-plan-public/copy";

const BUILT_KEY = "medpruef_public_plan_built:";

export function registerHref(plan: CarriedPlan): string {
  const href = buildAuthHref({ intent: "free", exam: plan.exam, next: studyPlanCarryHref(plan) });
  return `${href}&${new URLSearchParams(PUBLIC_PLAN_UTM)}`;
}

export default function SavePlanCta({ lang, plan, hours }: { lang: PublicPlanLang; plan: CarriedPlan; hours: number }) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const user = getStoredSession()?.user;
    setSignedIn(!!user && !user.id.startsWith("guest_") && !!getSessionToken());
    // "Plans generated" (M8 metric): once per combination and browser session.
    const key = `${BUILT_KEY}${plan.exam}|${plan.examDate}|${hours}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* storage blocked: still count once per page view */ }
    trackFunnelEvent("study_plan_built", { exam: plan.exam, value: hours, source: "study-plan" });
  }, [plan.exam, plan.examDate, hours]);

  const carryHref = studyPlanCarryHref(plan);
  const href = signedIn ? carryHref : registerHref(plan);

  return (
    <section className="mp-card min-w-0 p-5 sm:p-6 space-y-3 border-[var(--mp-viridian)]" aria-labelledby="plan-save-title" data-testid="public-plan-save">
      <h2 id="plan-save-title" className="text-lg font-bold">{pc("save_title", lang)}</h2>
      <p className="text-sm leading-relaxed text-[var(--mp-fg-muted)]">{pc("save_body", lang)}</p>
      <p className="text-[13px] leading-relaxed text-[var(--mp-fg-muted)]" data-testid="public-plan-save-scope">{pc("save_scope", lang)}</p>
      <a
        href={href}
        className="mp-btn mp-btn--primary w-full sm:w-auto min-h-11"
        data-testid="public-plan-save-cta"
        onClick={() => {
          // The marker lets /study-plan apply this plan without asking (a crafted link gets the confirm card).
          safeStorage.setItem(PENDING_PLAN_KEY, pendingPlanRecord(plan, Date.now()));
          if (!signedIn) persistAuthEntry({ intent: "free", exam: plan.exam, next: carryHref });
          trackFunnelEvent("cta_click", { surface: "study_plan", cta: signedIn ? "use_plan" : "save", exam: plan.exam, source: "study-plan" });
        }}
      >
        {pc(signedIn ? "save_cta_signed_in" : "save_cta", lang)}
      </a>
      {signedIn && <p className="text-[13px] text-[var(--mp-fg-muted)]">{pc("save_signed_in_note", lang)}</p>}
    </section>
  );
}
