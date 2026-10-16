"use client";
/**
 * Home line while the no-card reverse trial runs (a-pricing-v2): the end
 * date, what follows it, and one link to /pricing with "When is your exam?".
 * This is the trial's conversion hook (the retired no-card trial had none).
 * Renders nothing outside a trial. Formal Sie, no em dashes.
 */
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { trackEvent } from "@/lib/tracker";
import { at } from "@/lib/activation/copy";
import TrialEndCard from "@/components/trial-end/TrialEndCard";
import { useTrialEnd } from "@/components/trial-end/useTrialEnd";
import { LAST_DAY_MS } from "@/lib/trial-end/rules";

export default function ReverseTrialBanner({ className = "" }: { className?: string }) {
  const lang = useLang();
  const de = lang === "de";
  const { reverseTrialEndsAt, activation, trialEndCard } = useUserTier();
  const end = reverseTrialEndsAt ? Date.parse(reverseTrialEndsAt) : NaN;
  const running = Number.isFinite(end) && end > Date.now();
  // a-trial-end-decision (TRIAL_END_CARD_ENABLED): in the trial's last 24 hours the
  // line becomes the "your plan to your sitting" card; until it loads, the line stays.
  const lastDay = running && trialEndCard && end - Date.now() <= LAST_DAY_MS;
  const trialEnd = useTrialEnd("banner", lastDay);
  if (!running) return null;
  if (trialEnd && trialEnd.view.state === "last_day") {
    return <TrialEndCard surface="banner" data={trialEnd} lang={lang} className={className} />;
  }
  const when = new Intl.DateTimeFormat(de ? "de-AT" : "en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" }).format(new Date(end));
  return (
    <div className={`mp-card p-4 text-sm ${className}`} role="status" data-reverse-trial-banner>
      <p className="m-0 font-semibold text-[var(--mp-fg)]">{de ? `Ihr Testzugang läuft bis ${when}.` : `Your trial runs until ${when}.`}</p>
      <p className="m-0 mt-1 text-[var(--mp-fg-muted)]">
        {/* copy-audit F20 (a-pricing-v2-fit), byte-exact. */}
        {de ? "Danach üben Sie mit der kostenlosen Probe weiter. Den Tarif, der zu Ihrem Termin passt, finden Sie hier:" : "Afterwards you keep practising with the free sample. Find the plan that fits your exam here:"}
      </p>
      {activation && (
        // a-activation-48h: what the trial opens beyond the free sample, with two ways to use it now.
        <div data-trial-value className="mt-2">
          <p className="m-0 text-[var(--mp-fg-muted)]">{at("trial_value", lang)}</p>
          <div className="mt-1 flex flex-wrap gap-x-4">
            <Link href="/exam" onClick={() => trackEvent("activation_step", { step: "trial_mock", lang })} className="inline-flex min-h-11 items-center font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2">{at("trial_mock", lang)}</Link>
            <Link href="/mistakes" onClick={() => trackEvent("activation_step", { step: "trial_mistakes", lang })} className="inline-flex min-h-11 items-center font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2">{at("trial_mistakes", lang)}</Link>
          </div>
        </div>
      )}
      <Link href="/pricing#exam-timing" className="mt-2 inline-flex min-h-11 items-center font-semibold underline">{de ? "Passenden Tarif finden" : "Find the right plan"}</Link>
    </div>
  );
}
