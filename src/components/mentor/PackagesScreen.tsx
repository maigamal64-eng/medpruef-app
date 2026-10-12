"use client";

/**
 * /mentor/packages: what a learner can buy and what their balance is.
 *
 * Every number on a card (credits, messages, price, period, validity) comes
 * from the server's offer; nothing is hardcoded here. No cancel, refund or
 * rollover promise is written: only what the offer fields say. When buying is
 * off (can_buy false, or no offers) the page says so and makes no promise.
 */

import Link from "next/link";
import { admissionGapText } from "./a38-copy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Brain, Check, CreditCard, Loader2, Coins, Info } from "lucide-react";
import { Alert, EmptyState } from "@/components/ui";
import { mentorT } from "@/lib/i18n-mentor";
import type { MentorPackageOffer, MentorUsageResponse } from "@/lib/mentor/contract";
import { loadMentorApi } from "./client";
import MentorFrame, { useMentorSession } from "./MentorFrame";
import { offerView, sanitizeOffers, usageView, packagePurchaseState, subscriptionText, safeExternalUrl } from "./view-model";
import { errorView } from "./view-model";
import type { MentorClientError } from "./api";
import PurchaseNotice from "./PurchaseNotice";
import { rememberMentorCreditHolder } from "./useMentorAvailability";
import { packageCopy } from "./package-copy";
import { formatDate } from "./view-model";
import { trackMentor, trackMentorOnce } from "./telemetry";
import ComingSoonPackages from "./ComingSoonPackages";
import { cheapestWay } from "./r4-package-state";
import { r4PackageCopy } from "./r4-package-copy";
import RestingPackagesNotice from "./RestingPackagesNotice";
import { r3PackageCopy } from "./r3-package-copy";
import { CHECKOUT_RECOVERY_MS, perCreditSaving, subscribeCheckoutRestore } from "./r3-package-state";

type Load<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "disabled" } | { status: "error" };

export default function PackagesScreen() {
  const session = useMentorSession();
  const lang = session.uiLang;
  useEffect(() => {
    if (session.userId) trackMentorOnce(session.userId, "mentor_packages_view", "packages", { entry: "packages", lang, from: new URLSearchParams(window.location.search).get("from") ?? "mentor" });
  }, [session.userId, lang]);

  const [usage, setUsage] = useState<Load<MentorUsageResponse>>({ status: "loading" });
  const [offers, setOffers] = useState<Load<MentorPackageOffer[]>>({ status: "loading" });
  const [buying, setBuying] = useState<MentorPackageOffer["package_id"] | null>(null);
  const [selected,setSelected] = useState<string|null>(null);
  useEffect(()=>{const p=new URLSearchParams(window.location.search);if(p.get("from")==="exhausted") setSelected(p.get("select") ?? "mentor_plus");},[]);
  const [checkoutError, setCheckoutError] = useState<MentorClientError | "page_not_opened" | null>(null);
  const checkoutAttempt = useRef(0);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetBuying = useCallback(() => {
    checkoutAttempt.current += 1;
    if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    recoveryTimer.current = null;
    setBuying(null);
  }, []);


  const load = useCallback(async () => {
    const api = await loadMentorApi();
    const [u, p] = await Promise.all([api.usage(), api.packages()]);
    if (u.ok) {
      setUsage({ status: "ready", value: u.usage });
      if (session.userId && (["resting", "exhausted"].includes(u.usage.state) || u.usage.sources.some(source => source !== "none"))) rememberMentorCreditHolder(session.userId);
    }
    else setUsage(u.error === "mentor_disabled" ? { status: "disabled" } : { status: "error" });
    if (p.ok) setOffers({ status: "ready", value: sanitizeOffers(p.packages) });
    else setOffers(p.error === "mentor_disabled" ? { status: "disabled" } : { status: "error" });
  }, [session.userId]);

  useEffect(() => {
    const unsubscribe = subscribeCheckoutRestore(window, () => { resetBuying(); setCheckoutError(null); void load(); });
    return () => { unsubscribe(); if (recoveryTimer.current) clearTimeout(recoveryTimer.current); };
  }, [resetBuying, load]);

  useEffect(() => {
    if (!session.resolved || !session.userId) return;
    void load();
    const interval = setInterval(() => void load(), 60_000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [session.resolved, session.userId, load]);

  const buy = async (id: MentorPackageOffer["package_id"], retryPending = false) => {
    const state = packagePurchaseState(usage.status === "ready" ? usage.value : undefined, id);
    if (buying || recoveryTimer.current !== null || (retryPending ? !state.mayRetry : state.disabled)) return;
    trackMentor("mentor_pkg_click", { entry: "packages", lang, package_id: id });
    setBuying(id);
    setCheckoutError(null);
    const attempt = ++checkoutAttempt.current;
    const idempotencyKey = crypto.randomUUID();
    recoveryTimer.current = setTimeout(() => {
      if (attempt !== checkoutAttempt.current) return;
      resetBuying();
      setCheckoutError("page_not_opened");
    }, CHECKOUT_RECOVERY_MS);
    try {
      const api = await loadMentorApi();
      const r = await api.checkout({ package_id: id, idempotency_key: idempotencyKey, ...(retryPending ? { retry_pending: true } : {}) });
      if (attempt !== checkoutAttempt.current) return;
      if (r.ok) {
        window.location.assign(r.purchaseUrl);
        return;
      }
      resetBuying();
      setCheckoutError(r.error);
      void load();
    } catch {
      if (attempt !== checkoutAttempt.current) return;
      resetBuying();
      setCheckoutError("network");
    }
  };

  const uView = useMemo(() => (usage.status === "ready" ? usageView(usage.value, lang) : null), [usage, lang]);
  const canBuy = usage.status === "ready" && usage.value.can_buy && usage.value.state !== "resting";
  const list = offers.status === "ready" ? offers.value : [];
  const buyable = canBuy && list.length > 0;
  const cheapest = cheapestWay(usage.status === "ready" ? usage.value : undefined, list);
  const warningState = usage.status === "ready" && (usage.value.state === "low" || usage.value.state === "exhausted") ? usage.value.state : null;
  const resting = usage.status === "ready" && usage.value.state === "resting";
  const included = usage.status === "ready" ? usage.value.included_allowance : undefined;
  const subscriptions = list.filter(o => o.kind === "subscription");
  const plusSaving = perCreditSaving(subscriptions.find(o => o.package_id === "mentor_basis"), subscriptions.find(o => o.package_id === "mentor_plus"));
  const candidateTopup = list.find(o => o.kind === "topup");
  const topup = usage.status === "ready" && (usage.value.subscriptions.length > 0 || !usage.value.sources.includes("pro_included") || ["low", "exhausted"].includes(usage.value.state)) ? candidateTopup : undefined;

  const topupPurchase = topup ? packagePurchaseState(usage.status === "ready" ? usage.value : undefined, topup.package_id) : null;

  const disabled = !resting && (usage.status === "disabled" || offers.status === "disabled");
  const loading = usage.status === "loading" || offers.status === "loading";
  const failed = !disabled && !loading && (usage.status === "error" || offers.status === "error");

  return (
    <MentorFrame session={session}>
      <main data-mentor-packages className="main-content safe-area-top min-h-dvh bg-[var(--mp-bg)] pb-8">
        <div className="mx-auto w-full max-w-3xl px-4 pt-4 lg:px-8">
          <Link href="/mentor" onClick={() => trackMentor("mentor_entry_click", { entry: "packages", lang })} className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
            {mentorT("btn_back_to_mentor", lang)}
          </Link>

          <h1 className="mp-h2 mt-1 flex items-center gap-2 text-[var(--mp-fg)]">
            <Coins className="h-6 w-6 text-[var(--mp-viridian)]" aria-hidden />
            {mentorT("pkg_title", lang)}
          </h1>
          <p className="mt-1 text-[14px] text-[var(--mp-fg-muted)]">{mentorT("pkg_subtitle", lang)}</p>

          {disabled ? (
            <div className="mt-6">
              <EmptyState
                icon={<Brain className="h-10 w-10" aria-hidden />}
                title={mentorT("err_disabled_title", lang)}
                body={mentorT("err_disabled_body", lang)}
                action={
                  <Link href="/" className="mp-btn mp-btn--primary mt-2">
                    {mentorT("btn_keep_learning", lang)}
                  </Link>
                }
              />
            </div>
          ) : (
            <>
              {/* Compact balance strip keeps the actual offers near the top. */}
              <section data-mentor-package-balance aria-label={mentorT("pkg_your_balance", lang)} className={`mt-3 flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border px-3 py-2 ${warningState ? "border-[var(--mp-status-warning)] bg-[var(--mp-warning-bg)] text-[var(--mp-warning-text)]" : uView?.tone === "trial" ? "border-[var(--mp-info)]/40 bg-[var(--mp-info-bg)] text-[var(--mp-info-text)]" : "border-[var(--mp-border)] bg-[var(--mp-surface-raised)]"}`}>
                <span className="text-[12px] text-[var(--mp-fg-muted)]">{mentorT("pkg_your_balance", lang)}</span>
                {uView ? <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold tabular-nums">{uView.tone === "trial" && <Info className="h-4 w-4" aria-hidden />}{uView.creditsText}</span> : <span className="h-5 w-24 animate-pulse rounded bg-[var(--mp-surface-sunken)]" role="status" aria-label={mentorT("credits_loading", lang)} />}
                {warningState && <p className="w-full text-[13px] text-[var(--mp-warning-text)]">{(warningState === "exhausted" && usage.status === "ready" ? admissionGapText(usage.value.credits_left, usage.value.admit_min_credits, lang) : null) ?? r4PackageCopy(warningState, lang)}</p>}
                {usage.status === "ready" && usage.value.credits_left > 0 && usage.value.next_expiry && <p className="w-full text-[12px]">{r4PackageCopy("expiry", lang, { date: formatDate(usage.value.next_expiry, lang) })}</p>}
                {warningState && cheapest && <Link href={cheapest.package_id === "mentor_topup" ? "#topup" : `#package-${cheapest.package_id}`} className="inline-flex min-h-11 w-full items-center text-[13px] font-semibold underline">{r4PackageCopy("cheapest", lang, { package: mentorT(offerView(cheapest, lang).nameKey, lang), price: offerView(cheapest, lang).priceText })}</Link>}
                {uView?.trialNoticeText && <p className="w-full text-[12px]">{uView.trialNoticeText}</p>}
              </section>

              <div className="mt-3"><PurchaseNotice usage={usage.status === "ready" ? usage.value : undefined} lang={lang} /></div>
              {resting && <RestingPackagesNotice lang={lang} />}


              {failed && (
                <Alert variant="error" className="mt-4">
                  <p className="text-[13.5px]">{mentorT("err_load_failed", lang)}</p>
                  <button
                    type="button"
                    className="mp-btn mp-btn--secondary mp-btn--sm mt-2 min-h-10"
                    onClick={() => {
                      setUsage({ status: "loading" });
                      setOffers({ status: "loading" });
                      void load();
                    }}
                  >
                    {mentorT("btn_retry", lang)}
                  </button>
                </Alert>
              )}

              {loading && (
                <div className="mt-5 grid gap-3 sm:grid-cols-2" aria-hidden>
                  {[0, 1].map((i) => (
                    <div key={i} className="h-64 animate-pulse rounded-2xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)]" />
                  ))}
                </div>
              )}

              {!loading && !failed && !buyable && !resting && list.length === 0 && (
                <div className="mt-5">
                  <EmptyState
                    tone="neutral"
                    icon={<CreditCard className="h-10 w-10" aria-hidden />}
                    title={r4PackageCopy("soon", lang)}
                    body={mentorT("pkg_unavailable_body", lang)}
                    action={<ComingSoonPackages lang={lang} />}
                  />
                </div>
              )}

              {!loading && !failed && list.length > 0 && (
                <>
                  <ul data-mentor-package-offers className="mt-3 grid auto-rows-fr gap-3 sm:grid-cols-2">
                    {subscriptions.map((o) => {
                      const v = offerView(o, lang);
                      const bestValue = o.package_id === "mentor_plus" && plusSaving !== null;
                      const isBuying = buying === o.package_id;
                      const purchase = packagePurchaseState(usage.status === "ready" ? usage.value : undefined, o.package_id);
                      const managementHref = safeExternalUrl(purchase.subscription?.management_url);
                      return (
                        <li id={`package-${o.package_id}`} key={o.package_id} data-selected={selected===o.package_id || undefined} className={`flex flex-col rounded-2xl ${bestValue ? "border-2" : "border"} bg-[var(--mp-surface-raised)] p-4 shadow-[var(--shadow-card)] ${selected===o.package_id ? "border-[var(--mp-viridian)] ring-2 ring-[var(--mp-viridian)]" : bestValue ? "border-[var(--mp-viridian)]" : "border-[var(--mp-border)]"}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div><h2 className="mp-h3 text-[var(--mp-fg)]">{mentorT(v.nameKey, lang)}</h2>{bestValue && <p className="mt-0.5 text-[12px] font-semibold text-[var(--mp-viridian)]">{r3PackageCopy("best", lang)}</p>}</div>
                            <span className="shrink-0 rounded-full bg-[var(--mp-surface-sunken)] px-2.5 py-1 text-[12px] font-bold uppercase tracking-wide text-[var(--mp-fg-muted)]">
                              {mentorT(v.kindKey, lang)}
                            </span>
                          </div>

                          <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
                            <span className="font-display text-[26px] font-extrabold leading-none tabular-nums text-[var(--mp-fg)]">{v.priceText}</span>
                            {v.periodText && <span className="text-[13px] text-[var(--mp-fg-muted)]">{v.periodText}</span>}
                          </p>

                          {bestValue && <p className="mt-1 text-[12px] font-semibold text-[var(--mp-viridian)]">{r3PackageCopy("saving", lang, { percent: plusSaving! })}</p>}
                          <p className="mt-2 text-[12px] leading-snug text-[var(--mp-fg-muted)]">{packageCopy(o.package_id === "mentor_basis" ? "basis" : "plus", lang)}</p>

                          <ul className="mt-2 space-y-1 text-[13px] text-[var(--mp-fg)]">
                            <li className="flex items-start gap-2">
                              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mp-viridian)]" aria-hidden />
                              <span>
                                <strong className="font-semibold tabular-nums">{v.creditsText}</strong>
                                <span className="text-[var(--mp-fg-muted)]">, {v.messagesText}</span>
                              </span>
                            </li>
                            <li className="flex items-start gap-2">
                              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mp-viridian)]" aria-hidden />
                              <span>{v.validText}</span>
                            </li>
                          </ul>

                          {v.renewsNote && <p className="mt-2 text-[12px] leading-snug text-[var(--mp-fg-muted)]">{v.renewsNote}</p>}

                          <div className="flex-1" />
                          {purchase.subscription ? (
                            <div className="mt-4">
                              <p className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--mp-success-bg)] px-3 text-[13px] font-semibold text-[var(--mp-viridian)]"><Check className="h-4 w-4" aria-hidden />{subscriptionText(purchase.subscription, lang)}</p>
                              {managementHref && <a href={managementHref} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 w-full items-center text-[13px] font-semibold text-[var(--mp-cta-blue)] underline">{mentorT("pkg_manage", lang)}</a>}
                            </div>
                          ) : <button
                            type="button"
                            onClick={() => buy(o.package_id)}
                            disabled={buying !== null || purchase.disabled}
                            aria-disabled={buying !== null || purchase.disabled}
                            aria-describedby={purchase.reasonKey ? `purchase-reason-${o.package_id}` : undefined}
                            className="mp-btn mp-btn--primary mt-4 min-h-12 w-full min-w-0 justify-between whitespace-normal text-start disabled:cursor-not-allowed disabled:opacity-60"
                            aria-busy={isBuying}
                          >
                            <span className="min-w-0 break-words">{isBuying ? mentorT("pkg_buying", lang) : v.buyText}</span>
                            {isBuying ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />}
                          </button>}
                          {purchase.reasonKey && !purchase.subscription && <p id={`purchase-reason-${o.package_id}`} className="mt-2 text-[13px] leading-relaxed text-[var(--mp-fg-muted)]">{mentorT(purchase.reasonKey, lang)}</p>}
                          {purchase.mayRetry && <button type="button" onClick={() => buy(o.package_id, true)} disabled={buying !== null} className="mp-btn mp-btn--secondary mt-2 min-h-11 whitespace-normal" aria-disabled={buying !== null}>{mentorT("purchase_retry", lang)}</button>}
                        </li>
                      );
                    })}
                  </ul>

                  {topup && (
                    <section id="topup" className="mt-3 flex min-h-11 flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--mp-border)] px-4 py-3">
                      <div className="min-w-0 flex-1 text-[13px] text-[var(--mp-fg-muted)]">
                        <p>{packageCopy("topup", lang, { credits: topup.credits, price: offerView(topup, lang).priceText, days: topup.valid_days })}</p>
                        <p className="mt-1">{packageCopy("topupUse", lang)}</p>
                      </div>
                      <button type="button" onClick={() => buy(topup.package_id)} disabled={!canBuy || buying !== null || !!topupPurchase?.disabled} aria-describedby={topupPurchase?.reasonKey ? "topup-purchase-reason" : undefined} className="mp-btn mp-btn--secondary min-h-11 whitespace-normal" aria-busy={buying === topup.package_id}>
                        {buying === topup.package_id ? mentorT("pkg_buying", lang) : packageCopy("once", lang)}
                      </button>
                      {topupPurchase?.reasonKey && <p id="topup-purchase-reason" className="w-full text-[13px] text-[var(--mp-fg-muted)]">{mentorT(topupPurchase.reasonKey, lang)}</p>}
                      {topupPurchase?.mayRetry && <button type="button" onClick={() => buy(topup.package_id, true)} disabled={!canBuy || buying !== null} className="mp-btn mp-btn--secondary min-h-11 whitespace-normal">{mentorT("purchase_retry", lang)}</button>}
                    </section>
                  )}

                  {checkoutError && (
                    <Alert variant={checkoutError === "rate_limited" || (checkoutError !== "page_not_opened" && errorView(checkoutError).tone === "info") ? "info" : "error"} className="mt-3">
                      <p role="status" className="text-[13.5px]">{["page_not_opened", "rate_limited", "upstream_error"].includes(checkoutError) ? r3PackageCopy(checkoutError as "page_not_opened" | "rate_limited" | "upstream_error", lang) : mentorT(errorView(checkoutError as MentorClientError).messageKey, lang)}</p>
                    </Alert>
                  )}

                  <section aria-label={mentorT("pkg_your_balance", lang)} className="mt-4 text-[13px] text-[var(--mp-fg-muted)]">
                    <p>{mentorT("pkg_credits_explainer", lang)}</p>
                    {uView?.expiryText && uView.tone !== "trial" && <p className="mt-2 text-[12px]">{uView.expiryText}</p>}
                    {included && (
                      <div className="mt-3 text-[13px] text-[var(--mp-fg-muted)]">
                        <p>{packageCopy("included", lang, { credits: included.credits, days: included.period_days })}</p>
                        {included.renews_at && formatDate(included.renews_at, lang) && <p>{packageCopy("refresh", lang, { date: formatDate(included.renews_at, lang)! })}</p>}
                        <div role="meter" aria-label={packageCopy("meter", lang)} aria-valuemin={0} aria-valuemax={included.credits} aria-valuenow={Math.min(included.credits, included.credits_left)} aria-valuetext={mentorT("credits_count", lang, { n: included.credits_left })} className="mt-2 h-2 overflow-hidden rounded bg-[var(--mp-surface-sunken)]">
                          <div className="h-full bg-[var(--mp-viridian)]" style={{ width: `${included.credits > 0 ? Math.min(100, included.credits_left / included.credits * 100) : 0}%` }} />
                        </div>
                        <p className="mt-1">{mentorT("credits_count", lang, { n: included.credits_left })}</p>
                        {included.credits_left === 0 && <p className="mt-1">{packageCopy("wait", lang)}</p>}
                      </div>
                    )}
                    {usage.status === "ready" && usage.value.subscriptions.some((s) => s.package_id !== "mentor_topup") && (
                      <div className="mt-3 border-t border-[var(--mp-border)] pt-2">
                        <p className="text-[13px] font-semibold">{mentorT("pkg_subscription", lang)}</p>
                        {usage.value.subscriptions.filter((s) => s.package_id !== "mentor_topup").map((s) => <p key={s.package_id} className="mt-1 flex items-center gap-1.5 text-[13px] text-[var(--mp-fg-muted)]"><Check className="h-4 w-4 shrink-0" aria-hidden />{mentorT(s.package_id === "mentor_basis" ? "pkg_name_mentor_basis" : "pkg_name_mentor_plus", lang)}: {subscriptionText(s, lang)}</p>)}
                      </div>
                    )}
                  </section>

                  <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--mp-fg-muted)]">
                    <CreditCard className="h-3.5 w-3.5" aria-hidden />
                    <span>{mentorT("pkg_pay_note", lang)}</span>
                    <Link href="/terms" className="font-semibold text-[var(--mp-cta-blue)] hover:underline">
                      {mentorT("pkg_terms", lang)}
                    </Link>
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </MentorFrame>
  );
}
