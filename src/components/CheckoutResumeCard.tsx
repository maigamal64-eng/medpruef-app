"use client";

/**
 * CheckoutResumeCard (a-checkout-resume): a Home card for a signed-in learner
 * who opened a paid checkout in the last 14 days and never paid. It names the
 * plan they opened, shows what that plan costs until their saved sitting (and
 * a cheaper plan that covers the same time, when there is one), offers one tap
 * back to checkout and a plain line to support.
 *
 * Renders nothing until GET /api/checkout-resume says `eligible` (server
 * decision, default off behind CHECKOUT_RESUME_ENABLED) and the announcement
 * queue grants the slot. "Später ausblenden" snoozes it for 3 days through the
 * queue. Both buttons go to /pricing with the plan's resume action, which runs
 * the normal per-plan checks (pending payment, active Pro) before checkout.
 */
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/IconButton";
import { authFetch } from "@/lib/authFetch";
import { dismissSurface, useAnnouncementSlot } from "@/lib/announcements/queue";
import { useLang } from "@/lib/i18n";
import { trackEvent } from "@/lib/tracker";
import { resumeCopy, resumeLang } from "@/lib/checkout-resume-copy";
import { ACTION_FOR } from "@/app/pricing/_parts/plans";
import type { ResumeFit } from "@/lib/checkout-resume";
import type { CoverPlan } from "@/lib/plan-cover";

interface Eligibility { eligible: boolean; tier?: CoverPlan; fit?: ResumeFit | null }

export default function CheckoutResumeCard({ onVisibleChange }: { onVisibleChange?: (visible: boolean) => void } = {}) {
  const lang = useLang();
  const [state, setState] = useState<Eligibility | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const shown = useRef(false);
  const granted = useAnnouncementSlot("checkout_resume", Boolean(state?.eligible && state.tier) && !dismissed);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch("/api/checkout-resume", { skipAuthRedirect: true, timeoutMs: 8_000 });
        if (!r.ok) return;
        const data = (await r.json()) as Eligibility;
        if (!data?.eligible || cancelled) return;
        // A checkout that is still settling is the pending strip's job.
        const status = await authFetch("/api/whop/checkout/status", { skipAuthRedirect: true, timeoutMs: 8_000 });
        const payment = status.ok ? await status.json() : null;
        if (!cancelled && payment?.pending === null) setState(data);
      } catch {
        /* non-critical: the card stays hidden */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { onVisibleChange?.(granted); }, [granted, onVisibleChange]);
  useEffect(() => {
    if (granted && state?.tier && !shown.current) {
      shown.current = true;
      trackEvent("checkout_resume_shown", { tier: state.tier, fit: state.fit ? (state.fit.cheaperTier ? "cheaper" : "same") : "none" });
    }
  }, [granted, state]);

  if (!granted || !state?.tier) return null;
  const tier = state.tier;
  const copy = resumeCopy(tier, state.fit ?? null, resumeLang(lang));
  const cheaperTier = state.fit?.cheaperTier ?? null;
  const go = (target: "opened" | "cheaper" | "support", plan: CoverPlan) => trackEvent("checkout_resume_click", { tier: plan, target });

  return (
    <section className="mp-card rounded-2xl p-4 mb-6 relative" aria-label={copy.title} data-testid="checkout-resume">
      <IconButton
        label={copy.dismiss}
        onClick={() => { dismissSurface("checkout_resume", "later"); setDismissed(true); }}
        className="absolute top-2 end-2"
      />
      <div className="pe-10">
        <p className="text-sm font-semibold text-[var(--mp-fg)] mb-1">{copy.title}</p>
        <p className="text-sm text-[var(--mp-fg-muted)] mb-2 leading-relaxed">{copy.body}</p>
        {copy.fit.map((line) => (
          <p key={line} className="text-sm text-[var(--mp-fg-muted)] mb-2 leading-relaxed">{line}</p>
        ))}
        <div className="flex flex-wrap gap-2 mt-3">
          <a
            href={`/pricing?action=${ACTION_FOR[tier]}`}
            onClick={() => go("opened", tier)}
            className="mp-btn mp-btn--primary min-h-11"
          >
            {copy.primary}
          </a>
          {copy.cheaper && cheaperTier && (
            <a
              href={`/pricing?action=${ACTION_FOR[cheaperTier]}`}
              onClick={() => go("cheaper", cheaperTier)}
              className="mp-btn mp-btn--secondary min-h-11"
            >
              {copy.cheaper}
            </a>
          )}
        </div>
        <p className="text-sm text-[var(--mp-fg-muted)] mt-3 mb-0">
          {copy.help}{" "}
          <a className="underline inline-flex min-h-11 items-center" href={copy.helpMailto} onClick={() => go("support", tier)}>{copy.helpLink}</a>
        </p>
      </div>
    </section>
  );
}
