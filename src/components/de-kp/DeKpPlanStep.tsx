"use client";
/**
 * Germany plan step (a-dekp-walkfix-1120): the Monatsabo and the 3-day card
 * trial, nothing else. The general price page shows the Austrian exam picker and
 * sittings before checkout, so every Germany plan link lands here instead. It reuses the
 * existing paths: POST /api/whop/checkout {tier: flex_month} behind the same
 * confirm sheet, and TrialActivation (POST /api/whop/trial). No new price,
 * plan or route for money: the amounts are read from the owners by the page.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getStoredSession } from "@/lib/auth";
import { authFetch as fetch } from "@/lib/authFetch";
import { buildAuthHref, persistAuthEntry } from "@/lib/auth-entry";
import { createActionGate } from "@/lib/account-request";
import { detectCheckoutContext, openCheckout } from "@/lib/checkout-context-client";
import { useTrialAvailable } from "@/components/PublicStudyLink";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { longDate } from "@/app/pricing/_parts/plans";
import TrialActivation from "@/components/TrialActivation";
import CheckoutConfirmSheet, { CHECKOUT_CONFIRM_ENABLED } from "@/app/pricing/_parts/CheckoutConfirmSheet";
import CheckoutProblem, { type CheckoutProblemState } from "@/app/pricing/_parts/CheckoutProblem";
import { deKpCopy, fillCopy, type DeKpLang } from "@/lib/de-kp/copy";
import { CASES_PATH, planStepHref, type DeKpPlanFocus } from "@/lib/de-kp/plans";
import { trackCheckoutStarted } from "@/lib/de-kp/events";
import { useSignedIn } from "./DeKpCtas";
import { extendsFromFor, parseSubInfo, trialWorkingChange, type PlanSubInfo } from "./plan-access";

const BTN_PRIMARY = "mp-btn mp-btn--primary min-h-12 inline-flex items-center justify-center px-5";
const BTN_SECONDARY = "mp-btn mp-btn--secondary min-h-12 inline-flex items-center justify-center px-5";

export function checkoutProblemState(status: number, code: unknown): CheckoutProblemState {
  return code === "CHECKOUT_PENDING" ? "pending"
    : code === "ALREADY_RENEWING" ? "renewing"
    : code === "ALREADY_PRO" ? "already"
    : code === "EXTENSION_UNAVAILABLE" ? "extension"
    : code === "PLAN_UNVERIFIED" ? "unverified"
    : code === "PLAN_NOT_READY" ? "not_ready"
    : status === 401 ? "signin"
    : "failed";
}

export default function DeKpPlanStep({ lang, focus, monthLabel, monthTerms, todayLine, trialInBuild }: {
  lang: DeKpLang; focus: DeKpPlanFocus | null; monthLabel: string; monthTerms: string; todayLine: string; trialInBuild: boolean;
}) {
  const c = deKpCopy(lang).plan;
  const signedIn = useSignedIn();
  const trialAvailable = useTrialAvailable();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CheckoutProblemState | null>(null);
  const [opened, setOpened] = useState(false);
  const [trialBusy, setTrialBusy] = useState(false);
  const { isPaid: paidOrTrial, isAdmin, tierExpiresAt, reverseTrialEndsAt, seedSeatEndsAt } = useUserTier();
  const isPaid = paidOrTrial && !reverseTrialEndsAt && !seedSeatEndsAt;
  const [subInfo, setSubInfo] = useState<PlanSubInfo>(null);
  const inflight = useRef(false);
  const gate = useRef(createActionGate());
  const monthBtn = useRef<HTMLButtonElement>(null);
  const casesHref = lang === "en" ? `${CASES_PATH}?lang=en` : CASES_PATH;
  const signIn = (plan: DeKpPlanFocus) => { window.location.href = buildAuthHref({ next: planStepHref(lang, plan) }); };

  useEffect(() => {
    if (focus === "month") monthBtn.current?.scrollIntoView({ block: "center" });
  }, [focus]);

  // Back from Whop (bfcache or a tab coming back) must never leave a dead button: same reset as the price page.
  useEffect(() => {
    const reset = () => { gate.current.leave(); setBusy(false); setOpened(false); };
    const visible = () => { if (document.visibilityState === "visible" && !inflight.current) reset(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) reset(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", restored);
    return () => { document.removeEventListener("visibilitychange", visible); window.removeEventListener("pageshow", restored); };
  }, []);

  // Same read as the price page: a learner with current access sees when the new period starts.
  useEffect(() => {
    if (!signedIn || !isPaid) { setSubInfo(null); return; }
    let active = true;
    fetch("/api/user/subscription", { timeoutMs: 8_000, skipAuthRedirect: true })
      .then((r) => { if (!r.ok) throw new Error("subscription unavailable"); return r.json(); })
      .then((d) => { if (active) setSubInfo(parseSubInfo(d)); })
      .catch(() => { if (active) setSubInfo("error"); });
    return () => { active = false; };
  }, [signedIn, isPaid]);
  const extendsFrom = extendsFromFor(isPaid, tierExpiresAt, subInfo);
  const accessEnd = tierExpiresAt ? longDate(tierExpiresAt, lang) : null;

  const start = async () => {
    if (trialBusy || !gate.current.enter()) return;
    trackCheckoutStarted("flex_month");
    // The payment return page reads this: a paid learner continues in the cases, never on the Austrian-first pages.
    persistAuthEntry({ next: casesHref });
    inflight.current = true;
    setBusy(true); setFailure(null); setOpened(false);
    try {
      const r = await fetch("/api/whop/checkout", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: "flex_month", context: detectCheckoutContext() }), timeoutMs: 15_000, skipAuthRedirect: true,
      });
      const data = (await r.json().catch(() => ({}))) as { purchaseUrl?: string; code?: string };
      if (r.ok && data?.purchaseUrl) {
        inflight.current = false;
        if (openCheckout(data.purchaseUrl) === "opened_external") { setOpened(true); gate.current.leave(); setBusy(false); }
        return;
      }
      setFailure(checkoutProblemState(r.status, data?.code));
    } catch {
      setFailure(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "failed");
    }
    inflight.current = false;
    gate.current.leave(); setBusy(false);
  };
  const choose = () => {
    if (!signedIn) { signIn("month"); return; }
    if (busy || trialBusy) return;
    if (CHECKOUT_CONFIRM_ENABLED) setConfirm(true); else void start();
  };

  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => { setEmail(getStoredSession()?.user?.email ?? null); }, []);
  const showTrial = trialInBuild && (signedIn || trialAvailable);
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-bold">{c.title}</h1>
        <p className="text-sm text-[var(--mp-fg-muted)]">{c.intro}</p>
        {signedIn && isPaid && !isAdmin && (
          <p role="status" className="text-sm" data-testid="de-kp-already-pro">
            {accessEnd ? fillCopy(c.alreadyPro, { date: accessEnd }) : c.alreadyProNoDate}{" "}
            <Link href={casesHref} className="underline min-h-11 inline-flex items-center">{c.casesCta}</Link>
          </p>
        )}
      </header>

      <section aria-labelledby="plan-month" className={`mp-card p-4 space-y-3 ${focus === "month" ? "ring-2 ring-[var(--mp-viridian)]" : ""}`}>
        <h2 id="plan-month" className="font-display text-lg font-bold">{monthLabel}</h2>
        <p className="text-sm">{monthTerms}</p>
        <p className="text-sm font-semibold tabular-nums">{todayLine}</p>
        <button ref={monthBtn} type="button" className={BTN_PRIMARY} aria-disabled={busy} onClick={choose} data-testid="de-kp-month-start">{c.monthStart}</button>
        {!signedIn && <p className="text-xs text-[var(--mp-fg-muted)]">{c.signInNote}</p>}
        <p className="text-xs text-[var(--mp-fg-muted)]">{c.whop}</p>
        {busy && <p role="status" className="text-sm">{c.opening}</p>}
        {opened && <p role="status" className="text-sm">{c.openedElsewhere}</p>}
        {failure && <CheckoutProblem state={failure} lang={lang} onRetry={() => void start()} onCheck={() => { window.location.href = "/checkout/success?tier=flex_month"; }} onSignIn={() => signIn("month")} />}
      </section>

      {showTrial && (
        <section aria-label={c.trialLabel} className="space-y-3">
          {signedIn
            ? <TrialActivation lang={lang} resume={focus === "trial"} surface="landing_cta" checkoutBusy={busy} onWorkingChange={(working) => trialWorkingChange(working, casesHref, setTrialBusy)} links={{ continue: casesHref }} />
            : <button type="button" className={BTN_SECONDARY} onClick={() => signIn("trial")}>{c.trialSignIn}</button>}
        </section>
      )}

      <p><Link href={casesHref} className="text-sm underline min-h-11 inline-flex items-center">{c.back}</Link></p>

      <CheckoutConfirmSheet
        tier={confirm ? "flex_month" : null}
        lang={lang}
        extendsFrom={extendsFrom}
        email={email}
        onConfirm={() => { setConfirm(false); void start(); }}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
}
