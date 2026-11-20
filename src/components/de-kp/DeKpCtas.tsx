"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTrialAvailable } from "@/components/PublicStudyLink";
import { getSessionToken, getStoredSession } from "@/lib/auth";
import { buildAuthHref } from "@/lib/auth-entry";
import { cardTrialCopyEnabled } from "@/lib/card-trial";
import { trackCardTrialClick, trackCardTrialView } from "@/lib/card-trial-events";
import { trackCta, trackLandingView } from "@/lib/de-kp/events";
import { planStepHref, trialButton, trialTerms } from "@/lib/de-kp/plans";
import type { DeKpLang } from "@/lib/de-kp/copy";

const BTN_PRIMARY = "mp-btn mp-btn--primary min-h-11 inline-flex items-center justify-center px-5";
const BTN_SECONDARY = "mp-btn mp-btn--secondary min-h-11 inline-flex items-center justify-center px-5";

export function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const u = getStoredSession()?.user;
    setSignedIn(!!u && !u.id.startsWith("guest_") && !!getSessionToken());
  }, []);
  return signedIn;
}

/** Landing view, once per session, with the utm keys the visit arrived with. */
export function LandingViewTracker({ lang }: { lang: DeKpLang }) {
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    trackLandingView(lang, q.get("utm_source")?.slice(0, 60) ?? null, q.get("utm_campaign")?.slice(0, 60) ?? null);
  }, [lang]);
  return null;
}

/** First CTA: the free case. Signed out goes to registration and back to the case, tagged for the launch read. */
export function FreeCaseCta({ lang, slug, label }: { lang: DeKpLang; slug: string | null; label: string }) {
  const signedIn = useSignedIn();
  const next = slug ? `/kenntnispruefung-deutschland/fall/${slug}?lang=${lang}&src=landing` : `/kenntnispruefung-deutschland/faelle?lang=${lang}`;
  const href = signedIn ? next : `${buildAuthHref({ intent: "free", next })}&utm_source=de_kp_landing&utm_medium=site&utm_campaign=free_case`;
  return (
    <Link href={href} className={BTN_PRIMARY} onClick={() => trackCta("free_case", signedIn ? "free_case" : "signup")}>
      {label}
    </Link>
  );
}

export function PlanCtas({ lang, monthCta, trialLabel, trialInBuild }: { lang: DeKpLang; monthCta: string; trialLabel: string; trialInBuild: boolean }) {
  const available = useTrialAvailable();
  const trialOn = trialInBuild && available;
  useEffect(() => { if (trialOn) trackCardTrialView("landing_cta"); }, [trialOn]);
  const terms = trialTerms(lang);
  return (
    <div className="space-y-3">
      <Link href={planStepHref(lang, "month")} className={BTN_SECONDARY} onClick={() => trackCta("plan_month", "plans")}>
        {monthCta}
      </Link>
      {trialOn && <div>
        <Link
          href={planStepHref(lang, "trial")}
          className={BTN_SECONDARY}
          onClick={() => { trackCta("plan_trial", "plans"); trackCardTrialClick("landing_cta"); }}
        >
          {trialButton(lang) || trialLabel}
        </Link>
        {terms && <p className="text-xs text-[var(--mp-fg-muted)] mt-2">{terms}</p>}
      </div>}
    </div>
  );
}

/** Plan links for the paywall state inside the runner and the hub. Same two plans, same checkout path. */
export function PaywallPlanLinks({ lang, surface, label, trialLabel }: { lang: DeKpLang; surface: string; label: string; trialLabel: string }) {
  const trialOn = useTrialAvailable();
  return (
    <div className="flex flex-wrap gap-3">
      <Link href={planStepHref(lang, "month")} className={BTN_PRIMARY} data-surface={surface}>{label}</Link>
      {cardTrialCopyEnabled() && trialOn && (
        <Link href={planStepHref(lang, "trial")} className={BTN_SECONDARY} onClick={() => trackCardTrialClick("landing_cta")}>
          {trialButton(lang) || trialLabel}
        </Link>
      )}
    </div>
  );
}
