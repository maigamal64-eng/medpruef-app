/**
 * Germany Kenntnisprüfung landing (3e). Own surface, never linked from an
 * Austrian page. Order: exam name and its legal basis first, then the free
 * case, then the plans last (Monatsabo and the 3-day card trial only, amounts
 * from price-facts). notFound() while DE_KP_ENABLED is off. DE default, EN via ?lang=en.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { DE_KP_EXAM_KEY, deKpEnabled } from "@/lib/de-kp";
import { DE_KP_LAW_URL, deKpCopy, deKpLang } from "@/lib/de-kp/copy";
import { paidCaseCount } from "@/lib/de-kp/plans";
import { readLandingCases } from "@/lib/de-kp/landing-read";
import { monthTerms } from "@/lib/de-kp/plans";
import { cardTrialCopyEnabled } from "@/lib/card-trial";
import { FreeCaseCta, LandingViewTracker, PlanCtas } from "@/components/de-kp/DeKpCtas";

export const dynamic = "force-dynamic";

export default async function DeKpLanding({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  if (!deKpEnabled()) notFound();
  const lang = deKpLang((await searchParams).lang);
  const copy = deKpCopy(lang);
  const c = copy.landing;
  const { freeSlug, total } = await readLandingCases();

  return (
    <main id="main" className="min-h-screen bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)]" lang={lang} data-exam={DE_KP_EXAM_KEY}>
      <LandingViewTracker lang={lang} />
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        <header className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-[var(--mp-fg-muted)]">{copy.brandLine}</p>
            <Link href={c.switchHref} className="text-sm underline min-h-11 inline-flex items-center" hrefLang={c.switchLang}>{c.switchTo}</Link>
          </div>
          <h1 className="font-display text-3xl font-bold leading-tight">{c.h1}</h1>
          <p className="text-base text-[var(--mp-fg-muted)]">{c.lead}</p>
        </header>

        <section aria-labelledby="law" className="mp-card p-4 space-y-2">
          <h2 id="law" className="font-display text-lg font-bold">{c.lawHeading}</h2>
          <p className="text-sm">{c.lawBody}</p>
          <p className="text-sm text-[var(--mp-fg-muted)]">{c.lawTiming}</p>
          <a href={DE_KP_LAW_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 underline min-h-11">
            <ExternalLink className="w-4 h-4" aria-hidden />{c.lawLink}
          </a>
          <p className="text-xs text-[var(--mp-fg-muted)]">{c.lawRead}</p>
          <p className="text-sm text-[var(--mp-fg-muted)]">{c.landNote}</p>
        </section>

        <section aria-labelledby="what" className="space-y-2">
          <h2 id="what" className="font-display text-lg font-bold">{c.whatHeading}</h2>
          <ul className="list-disc ps-5 space-y-1 text-sm">{c.whatItems.map((i) => <li key={i}>{i}</li>)}</ul>
        </section>

        <section aria-labelledby="limits" className="space-y-2">
          <h2 id="limits" className="font-display text-lg font-bold">{c.limitsHeading}</h2>
          <p className="text-sm">{copy.honesty}</p>
        </section>

        <section aria-labelledby="free" className="mp-card p-4 space-y-3">
          <h2 id="free" className="font-display text-lg font-bold">{c.freeHeading}</h2>
          <p className="text-sm">{c.freeBody}</p>
          <FreeCaseCta lang={lang} slug={freeSlug} label={freeSlug ? c.freeCta : c.freeCtaNoCase} />
          <p className="text-xs text-[var(--mp-fg-muted)]">{copy.practiceLabel}</p>
        </section>

        <section aria-labelledby="plans" className="space-y-3">
          <h2 id="plans" className="font-display text-lg font-bold">{c.plansHeading}</h2>
          <p className="text-sm">{c.plansIntro}{paidCaseCount(total, freeSlug) > 0 ? ` ${c.plansCount.replace("{n}", String(paidCaseCount(total, freeSlug)))}` : ""}</p>
          <div className="mp-card p-4 space-y-3">
            <p className="font-semibold">{c.monthLabel}</p>
            <p className="text-sm">{monthTerms(lang)}</p>
            <PlanCtas lang={lang} monthCta={c.monthCta} trialLabel={c.trialLabel} trialInBuild={cardTrialCopyEnabled()} />
          </div>
        </section>
      </div>
    </main>
  );
}
