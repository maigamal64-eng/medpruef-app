/**
 * Germany plan step (a-dekp-walkfix-1120). Only the Monatsabo and the 3-day
 * card trial; amounts come from price-facts and the plan facts at render,
 * never typed. notFound() while DE_KP_ENABLED is off. Linked from the landing,
 * the paywall and the hub instead of /pricing, which shows the Austrian exams.
 */
import { notFound } from "next/navigation";
import { deKpEnabled } from "@/lib/de-kp";
import { deKpCopy, deKpLang } from "@/lib/de-kp/copy";
import { monthTerms } from "@/lib/de-kp/plans";
import { cardTrialCopyEnabled } from "@/lib/card-trial";
import { planFacts } from "@/app/pricing/_parts/plans";
import DeKpPlanStep from "@/components/de-kp/DeKpPlanStep";

export const dynamic = "force-dynamic";

export default async function DeKpPlans({ searchParams }: { searchParams: Promise<{ lang?: string | string[]; plan?: string | string[] }> }) {
  if (!deKpEnabled()) notFound();
  const sp = await searchParams;
  const lang = deKpLang(sp.lang);
  const rawPlan = Array.isArray(sp.plan) ? sp.plan[0] : sp.plan;
  const focus = rawPlan === "month" || rawPlan === "trial" ? rawPlan : null;
  return (
    <main id="main" className="min-h-screen bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)]" lang={lang}>
      <div className="max-w-2xl mx-auto px-4 py-8">
        <DeKpPlanStep
          lang={lang}
          focus={focus}
          monthLabel={deKpCopy(lang).landing.monthLabel}
          monthTerms={monthTerms(lang)}
          todayLine={planFacts("flex_month", lang).today}
          trialInBuild={cardTrialCopyEnabled()}
        />
      </div>
    </main>
  );
}
