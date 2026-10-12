"use client";
/**
 * One paid plan in the shared anatomy (UX-ACC-12, UX-PUB-21 A): the featured
 * card carries the single DOM-text "Empfohlen"; the others are slim rows of
 * the same shape. Price as charged first, per-month figure labelled and
 * secondary, today line, renewal or one-time line, cancel line, one button.
 */
import { ArrowRight, CreditCard, ExternalLink } from "lucide-react";
import { WHOP_MANAGE_URL, type BillingLang } from "@/lib/billing-copy";
import { BrandedLoader } from "@/components/ui";
import { CADENCE_DAYS, planFacts, type PaidTier } from "./plans";
import PuypDetails from "./PuypDetails";

export type PlanAction =
  | { kind: "buy" }
  | { kind: "extend" }
  | { kind: "signin" }
  | { kind: "none"; note: string };

export default function PlanCard({ tier, lang, featured, action, loading, busy, onCheckout, children }: {
  tier: PaidTier;
  lang: BillingLang;
  featured?: boolean;
  action: PlanAction;
  loading: boolean;
  busy: boolean;
  onCheckout: () => void;
  children?: React.ReactNode;
}) {
  const de = lang === "de";
  const f = planFacts(tier, lang);
  const renewing = CADENCE_DAYS[tier] !== null;
  const titleId = `plan-${tier}`;
  const label = action.kind === "extend" ? f.ctaExtend : action.kind === "signin" ? f.ctaLoggedOut : f.cta;
  return (
    <article
      aria-labelledby={titleId}
      data-plan={tier}
      className={`rounded-[var(--mp-r-card)] p-5 md:p-6 grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-4 md:gap-6 items-start bg-[var(--mp-surface-raised)] ${featured ? "border-2 border-[var(--mp-viridian)] shadow-[var(--mp-shadow-elev)]" : "border border-[var(--mp-border-subtle)]"}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          {featured && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-bold tracking-[0.04em] bg-[var(--mp-viridian)]" style={{ color: "var(--mp-fg-on-viridian)" }}>
              {de ? "Empfohlen" : "Recommended"}
            </span>
          )}
          <h3 id={titleId} className="mp-h3 text-[20px]">{f.name}</h3>
        </div>
        <p className="text-sm text-[var(--mp-fg-muted)]">{f.renewal}</p>
        <p className="text-sm text-[var(--mp-fg-muted)] mt-1">{f.guarantee}</p>
        {children}
      </div>
      <div className="flex flex-col gap-2 md:items-end">
        <p className="m-0 md:text-right flex flex-wrap items-baseline gap-x-1.5 md:justify-end">
          <span className="mp-num font-black text-[var(--mp-fg)] text-[28px] md:text-[32px] leading-none tabular-nums">{f.amount}</span>
          <span className="text-sm text-[var(--mp-fg-muted)]">{f.period}</span>
        </p>
        {f.perMonth && <p className="mp-small text-[var(--mp-fg-muted)] md:text-right m-0">{f.perMonth}</p>}
        <p className="mp-small m-0 md:text-right"><strong className="tabular-nums">{f.today}</strong></p>
        {action.kind === "none" ? (
          <p className="text-sm text-[var(--mp-fg-muted)] md:text-right m-0">{action.note}</p>
        ) : (
          <button
            type="button"
            onClick={onCheckout}
            aria-disabled={busy}
            className={`mp-btn ${featured ? "mp-btn--success" : "mp-btn--secondary"} min-h-12 inline-flex items-center justify-center gap-2 w-full md:w-auto`}
          >
            {loading ? <BrandedLoader size={20} hideLabel /> : <CreditCard className="w-4 h-4" aria-hidden />}
            <span>{loading ? (de ? "Checkout wird geöffnet" : "Opening checkout") : label}</span>
            {!loading && <ArrowRight className="w-4 h-4" aria-hidden />}
          </button>
        )}
        {action.kind === "signin" && (
          <p className="mp-small text-[var(--mp-fg-muted)] md:text-right m-0">{de ? "Sie registrieren sich zuerst, dann geht es zur Kartenzahlung." : "You register first, then continue to card payment."}</p>
        )}
        <p className="mp-small text-[var(--mp-fg-muted)] md:text-right m-0">{f.cancel}</p>
        {renewing && (
          <a href={WHOP_MANAGE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm underline">
            {de ? "Abo verwalten und kündigen" : "Manage and cancel"}
            <ExternalLink className="w-3.5 h-3.5" aria-hidden />
            <span className="sr-only">{de ? "(öffnet Whop in einem neuen Tab, Seite auf Englisch)" : "(opens Whop in a new tab)"}</span>
          </a>
        )}
        {tier === "premium_pass_guaranteed" && <div className="w-full"><PuypDetails lang={lang} compact /></div>}
      </div>
    </article>
  );
}
