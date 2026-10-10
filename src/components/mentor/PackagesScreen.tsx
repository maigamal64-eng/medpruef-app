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
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Brain, Check, CreditCard, Loader2, Coins } from "lucide-react";
import { Alert, EmptyState } from "@/components/ui";
import { mentorT } from "@/lib/i18n-mentor";
import type { MentorPackageOffer, MentorUsageResponse } from "@/lib/mentor/contract";
import { loadMentorApi } from "./client";
import MentorFrame, { useMentorSession } from "./MentorFrame";
import { offerView, sanitizeOffers, usageView } from "./view-model";

type Load<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "disabled" } | { status: "error" };

export default function PackagesScreen() {
  const session = useMentorSession();
  const lang = session.uiLang;

  const [usage, setUsage] = useState<Load<MentorUsageResponse>>({ status: "loading" });
  const [offers, setOffers] = useState<Load<MentorPackageOffer[]>>({ status: "loading" });
  const [buying, setBuying] = useState<MentorPackageOffer["package_id"] | null>(null);
  const [checkoutError, setCheckoutError] = useState(false);

  const load = useCallback(async () => {
    const api = await loadMentorApi();
    const [u, p] = await Promise.all([api.usage(), api.packages()]);
    if (u.ok) setUsage({ status: "ready", value: u.usage });
    else setUsage(u.error === "mentor_disabled" ? { status: "disabled" } : { status: "error" });
    if (p.ok) setOffers({ status: "ready", value: sanitizeOffers(p.packages) });
    else setOffers(p.error === "mentor_disabled" ? { status: "disabled" } : { status: "error" });
  }, []);

  useEffect(() => {
    if (!session.resolved || !session.userId) return;
    void load();
  }, [session.resolved, session.userId, load]);

  const buy = async (id: MentorPackageOffer["package_id"]) => {
    if (buying) return;
    setBuying(id);
    setCheckoutError(false);
    const api = await loadMentorApi();
    const r = await api.checkout({ package_id: id });
    if (r.ok) {
      window.location.assign(r.purchaseUrl);
      return; // leave the spinner: the browser is navigating away
    }
    setBuying(null);
    setCheckoutError(true);
  };

  const uView = useMemo(() => (usage.status === "ready" ? usageView(usage.value, lang) : null), [usage, lang]);
  const canBuy = usage.status === "ready" ? usage.value.can_buy : true;
  const list = offers.status === "ready" ? offers.value : [];
  const buyable = canBuy && list.length > 0;
  const included = usage.status === "ready" && usage.value.sources.includes("pro_included");

  const disabled = usage.status === "disabled" || offers.status === "disabled";
  const loading = usage.status === "loading" || offers.status === "loading";
  const failed = !disabled && !loading && (usage.status === "error" || offers.status === "error");

  return (
    <MentorFrame session={session}>
      <main className="main-content safe-area-top min-h-dvh bg-[var(--mp-bg)] pb-8">
        <div className="mx-auto w-full max-w-3xl px-4 pt-4 lg:px-8">
          <Link href="/mentor" className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]">
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
            {mentorT("btn_back_to_mentor", lang)}
          </Link>

          <h1 className="mp-h1 mt-1 flex items-center gap-2 text-[var(--mp-fg)]">
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
              {/* Balance */}
              <section aria-label={mentorT("pkg_your_balance", lang)} className="mt-5 rounded-2xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-4 shadow-[var(--shadow-card)]">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)]">{mentorT("pkg_your_balance", lang)}</p>
                {uView ? (
                  <>
                    <p className="mt-1 font-display text-[28px] font-extrabold leading-none tabular-nums text-[var(--mp-fg)]">{uView.creditsText}</p>
                    <p className="mt-1 text-[13px] text-[var(--mp-fg-muted)]">{uView.messagesText}</p>
                    {uView.expiryText && <p className="mt-1 text-[12px] text-[var(--mp-fg-muted)]">{uView.expiryText}</p>}
                    {included && <p className="mt-2 text-[12.5px] text-[var(--mp-fg-muted)]">{mentorT("pkg_included_note", lang)}</p>}
                  </>
                ) : (
                  <div className="mt-2 h-9 w-40 animate-pulse rounded-lg bg-[var(--mp-surface-sunken)]" role="status" aria-label={mentorT("credits_loading", lang)} />
                )}
              </section>

              <p className="mt-4 text-[13px] leading-relaxed text-[var(--mp-fg-muted)]">{mentorT("pkg_credits_explainer", lang)}</p>

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

              {!loading && !failed && !buyable && (
                <div className="mt-5">
                  <EmptyState
                    tone="neutral"
                    icon={<CreditCard className="h-10 w-10" aria-hidden />}
                    title={mentorT("pkg_unavailable_title", lang)}
                    body={`${mentorT("state_buy_unavailable", lang)} ${mentorT("pkg_unavailable_body", lang)}`}
                  />
                </div>
              )}

              {!loading && !failed && buyable && (
                <>
                  <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                    {list.map((o) => {
                      const v = offerView(o, lang);
                      const isBuying = buying === o.package_id;
                      return (
                        <li key={o.package_id} className="flex flex-col rounded-2xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-4 shadow-[var(--shadow-card)]">
                          <div className="flex items-start justify-between gap-2">
                            <h2 className="mp-h3 text-[var(--mp-fg)]">{mentorT(v.nameKey, lang)}</h2>
                            <span className="shrink-0 rounded-full bg-[var(--mp-surface-sunken)] px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-[var(--mp-fg-muted)]">
                              {mentorT(v.kindKey, lang)}
                            </span>
                          </div>

                          <p className="mt-3 flex flex-wrap items-baseline gap-x-1.5">
                            <span className="font-display text-[30px] font-extrabold leading-none tabular-nums text-[var(--mp-fg)]">{v.priceText}</span>
                            {v.periodText && <span className="text-[13px] text-[var(--mp-fg-muted)]">{v.periodText}</span>}
                          </p>

                          <ul className="mt-3 space-y-1.5 text-[13.5px] text-[var(--mp-fg)]">
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

                          <button
                            type="button"
                            onClick={() => buy(o.package_id)}
                            disabled={buying !== null}
                            className="mp-btn mp-btn--primary mt-4 min-h-12 w-full justify-between disabled:cursor-not-allowed disabled:opacity-60"
                            aria-busy={isBuying}
                          >
                            <span>{isBuying ? mentorT("pkg_buying", lang) : mentorT("pkg_buy", lang)}</span>
                            {isBuying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {checkoutError && (
                    <Alert variant="error" className="mt-3">
                      <p className="text-[13.5px]">{mentorT("pkg_checkout_error", lang)}</p>
                    </Alert>
                  )}

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
