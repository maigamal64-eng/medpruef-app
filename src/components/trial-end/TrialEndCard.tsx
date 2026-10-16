"use client";
/**
 * "Your plan to your sitting" (a-trial-end-decision): one card for the
 * reverse trial's last 24 hours (banner), the first Home visit after it ends
 * and the paywall. It shows what stays saved (answered questions, weakest
 * fields, translations), the learner's sitting or "When is your exam?", and
 * the cheapest plan that covers that sitting (fit.ts, the plans on sale)
 * with one tap into /pricing's checkout resume (account checks, the confirm
 * sheet when on, then Whop). The free sample continues and progress stays
 * saved. The only time named is the real trial end; no other countdown, no
 * price-change urgency, no break-even. Copy: src/lib/trial-end/copy.ts;
 * plan lines from the approved pricing copy (planFacts, fitLines).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";
import { OFFICIAL_KEYS_BY_BANK, getUpcomingOfficialFor, groupOfficialByDate, type PuypExamType } from "@/lib/exam-dates";
import { formatSittingWhen, joinList, shortExamName } from "@/lib/i18n-dates";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { planFacts } from "@/app/pricing/_parts/plans";
import { fitLines } from "@/app/pricing/_parts/fit-copy";
import { planName } from "@/lib/pricing-v2/price-facts";
import { billingLangOf, progressItems, tec, trialEndText } from "@/lib/trial-end/copy";
import { cardPlan, checkoutHref, shouldSaveSitting, weakestFields, type CardTiming, type TrialEndSurface, type TrialEndTarget } from "@/lib/trial-end/rules";
import { postTrialEndEvent, shownOnce, type TrialEndData } from "./useTrialEnd";
import { cpt, cramExamName, sip4aRuleHref } from "@/lib/cram-part-plan/copy";
import { te } from "@/lib/i18n-exam";
import { studyDate } from "@/lib/i18n-study";

const BANKS: PuypExamType[] = ["kenntnispruefung", "kmp_innsbruck", "pharma"];
const MAX_SITTINGS = 3;

function sittingGroups(bank: PuypExamType) {
  return groupOfficialByDate(getUpcomingOfficialFor({ exams: OFFICIAL_KEYS_BY_BANK[bank] })).slice(0, MAX_SITTINGS);
}

function sittingLabel(bank: PuypExamType, date: string, lang: string): string | null {
  const g = groupOfficialByDate(getUpcomingOfficialFor({ exams: OFFICIAL_KEYS_BY_BANK[bank] })).find((x) => x.date === date);
  if (!g) return null;
  return `${joinList(g.rows.map((r) => shortExamName(r, lang)), lang)}, ${formatSittingWhen(g, lang)}`;
}

export default function TrialEndCard({ surface, data, lang, onLater, className = "" }: {
  surface: TrialEndSurface;
  data: TrialEndData;
  lang: string;
  /** Home only: "Später". */
  onLater?: () => void;
  className?: string;
}) {
  const { view } = data;
  const money = billingLangOf(lang);
  const uid = typeof window === "undefined" ? null : getStoredSession()?.user.id ?? null;
  const [timing, setTiming] = useState<CardTiming | null>(view.sitting ? { kind: "sitting", ...view.sitting } : null);
  const [picking, setPicking] = useState(!view.sitting);
  const [bank, setBank] = useState<PuypExamType>(view.sitting?.bank ?? view.exam);
  const groups = useMemo(() => sittingGroups(bank), [bank]);
  const weak = useMemo(() => weakestFields(data.topics), [data.topics]);
  const plan = timing && view.v2 ? cardPlan(timing, new Date(), { guard: view.guard, ready: view.ready }) : null;
  const shownSent = useRef(false);

  useEffect(() => {
    if (shownSent.current) return;
    shownSent.current = true;
    // Home: the server keeps the one-time marker; banner and paywall: once per browser session.
    if (surface === "home" || shownOnce(surface, uid)) {
      postTrialEndEvent("shown", { surface, plan: plan?.tier ?? "none", exam: view.exam, trial: view.trial });
    }
  }, [surface, uid, plan?.tier, view.exam, view.trial]);

  const click = (target: TrialEndTarget) => postTrialEndEvent("click", { surface, plan: plan?.tier ?? "none", exam: view.exam, trial: view.trial, target });

  const choose = (next: CardTiming) => {
    setTiming(next);
    if (shouldSaveSitting(next, view.exam) && next.kind === "sitting") {
      // The learner's own answer to "When is your exam?": saved like Settings does, best effort.
      void fetch("/api/user/exam-preference", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ examDate: next.date }),
        timeoutMs: 8_000,
        skipAuthRedirect: true,
      }).catch(() => {});
    }
  };

  const items = progressItems({ answered: data.answered, translations: view.translations, weak }, lang, (xs) => joinList(xs, lang));
  const named = timing?.kind === "sitting" ? sittingLabel(timing.bank, timing.date, lang) : null;
  const facts = plan ? planFacts(plan.tier, money) : null;
  const planLines: string[] = [];
  if (plan && facts) {
    const name = planName(plan.tier, money);
    if (timing?.kind === "sitting" && plan.fit) planLines.push(tec("plan_fits", lang, { plan: name }), ...fitLines(plan.fit, money));
    else if (timing?.kind === "long_route" && plan.tier === "guarantee_ticket") planLines.push(tec("plan_long_route", lang, { plan: name }), facts.price);
    else if (timing?.kind === "unsure") planLines.push(tec("plan_unsure", lang, { plan: name }), facts.renewal);
    // Several exams while the Ticket is not on sale: the plan's own approved lines, no lead.
    else planLines.push(name, facts.renewal);
  }
  const radioName = `trial-end-timing-${surface}`;
  const row = "flex items-start gap-3 min-h-11 px-3 py-2 rounded-lg border cursor-pointer";
  const tone = (on: boolean) => (on ? "border-[var(--mp-viridian)] bg-[var(--mp-surface-sunken)]" : "border-[var(--mp-border-subtle)]");
  // Inside the paywall the dialog owns the h2.
  const Heading = surface === "paywall" ? "h3" : "h2";

  return (
    <section
      className={`relative rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-4 text-sm ${className}`}
      aria-label={tec("region", lang)}
      data-trial-end-card={surface}
      data-trial-end-state={view.state}
    >
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-[var(--mp-viridian)]/15 flex items-center justify-center text-[var(--mp-viridian)] flex-shrink-0" aria-hidden="true">
          <CalendarCheck className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <Heading className="m-0 font-display font-bold text-base text-[var(--mp-fg)]">
            {view.state === "last_day" ? tec("last_day_title", lang, { when: trialEndText(view.endsAt, lang) }) : tec("ended_title", lang)}
          </Heading>
          <p className="m-0 mt-1 text-[var(--mp-fg-muted)]">
            {tec(view.capped === true
              ? (view.state === "last_day" ? "last_day_free_capped" : "ended_free_capped")
              : (view.state === "last_day" ? "last_day_free" : "ended_free"), lang)}
          </p>
          <p className="m-0 mt-2 font-semibold text-[var(--mp-fg)]">{tec("saved", lang)}</p>
          {items.length > 0 && (
            <ul className="m-0 mt-1 ps-5 list-disc text-[var(--mp-fg-muted)] space-y-0.5" data-trial-end-progress>
              {items.map((x) => <li key={x}>{x}</li>)}
            </ul>
          )}
          {view.partRun && (
            <div className="mt-2 text-[var(--mp-fg-muted)] space-y-1" data-trial-end-part-run>
              <p className="m-0 text-[var(--mp-fg)]">
                {cpt("latest_blocks", lang, {
                  exam: cramExamName(view.partRun.examKey),
                  date: studyDate(view.partRun.day, lang, { day: "numeric", month: "long" }),
                  list: joinList(view.partRun.weak, lang),
                })}{" "}{cpt("no_forecast", lang)}
              </p>
              {view.partRun.examKey === "sip4a" && (
                <p className="m-0">
                  {te("result_blocks_rule", lang)}{" "}
                  <Link href={sip4aRuleHref(lang)} className="inline-flex items-center min-h-11 underline underline-offset-2 text-[var(--mp-cta-blue)]">{te("result_rule_source", lang)}</Link>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {view.v2 && (
        <div className="mt-3 space-y-2">
          {!picking && named ? (
            <div data-trial-end-sitting>
              <p className="m-0 font-semibold text-[var(--mp-fg)]">{tec("sitting_title", lang)}</p>
              <p className="m-0 text-[var(--mp-fg-muted)] tabular-nums">{named}</p>
              <button type="button" onClick={() => setPicking(true)} className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2 text-[var(--mp-cta-blue)]">
                {tec("sitting_change", lang)}
              </button>
            </div>
          ) : (
            <fieldset className="m-0 p-0 border-0 space-y-2" data-trial-end-picker>
              <legend className="m-0 font-semibold text-[var(--mp-fg)]">{tec("ask_title", lang)}</legend>
              <p className="m-0 text-[var(--mp-fg-muted)]">{tec("ask_hint", lang)}</p>
              <label className="block">
                <span className="text-[var(--mp-fg-muted)]">{tec("exam_label", lang)}</span>
                <select className="mp-field mt-1 block w-full min-h-11" value={bank} onChange={(e) => setBank(e.target.value as PuypExamType)}>
                  {BANKS.map((b) => <option key={b} value={b}>{getExamLabel(b, "full", lang)}</option>)}
                </select>
              </label>
              {groups.length === 0 && <p className="m-0 text-[var(--mp-fg-muted)]">{tec("no_sittings", lang)}</p>}
              {groups.map((g) => {
                const choice: CardTiming = { kind: "sitting", bank, date: g.date, lastDay: g.date_end ?? g.date };
                const on = timing?.kind === "sitting" && timing.bank === bank && timing.date === g.date;
                return (
                  <label key={g.date} className={`${row} ${tone(on)}`}>
                    <input type="radio" name={radioName} className="mt-1 size-4 shrink-0" checked={on} onChange={() => choose(choice)} />
                    <span className="min-w-0">
                      <span className="block font-semibold text-[var(--mp-fg)] tabular-nums">{formatSittingWhen(g, lang)}</span>
                      <span className="block text-[var(--mp-fg-muted)]">{joinList(g.rows.map((r) => shortExamName(r, lang)), lang)}</span>
                    </span>
                  </label>
                );
              })}
              {(["long_route", "unsure"] as const).map((kind) => (
                <label key={kind} className={`${row} ${tone(timing?.kind === kind)}`}>
                  <input type="radio" name={radioName} className="mt-1 size-4 shrink-0" checked={timing?.kind === kind} onChange={() => choose({ kind })} />
                  <span className="min-w-0 font-semibold text-[var(--mp-fg)]">{tec(kind, lang)}</span>
                </label>
              ))}
            </fieldset>
          )}

          {/* Always rendered, so the plan that appears after a pick is announced. */}
          <div aria-live="polite">
          {plan && facts && (
            <div className="rounded-lg border border-[var(--mp-border-subtle)] p-3" data-trial-end-plan={plan.tier}>
              <p className="m-0 font-semibold text-[var(--mp-fg)]">{tec("plan_title", lang)}</p>
              {planLines.map((line) => <p key={line} className="m-0 mt-1 text-[var(--mp-fg-muted)]">{line}</p>)}
              <Link
                href={checkoutHref(plan.tier, timing)}
                onClick={() => click("checkout")}
                className="mp-btn mp-btn--primary mt-3 w-full justify-center min-h-11"
                data-trial-end-cta
              >
                {facts.cta}
              </Link>
            </div>
          )}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4">
        <Link href={view.v2 ? "/pricing#exam-timing" : "/pricing#plans"} onClick={() => click("pricing")} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
          {tec("all_plans", lang)}
        </Link>
        {onLater && (
          <button type="button" onClick={() => { click("later"); onLater(); }} className="mp-btn mp-btn--ghost mp-btn--sm min-h-11">
            {tec("later", lang)}
          </button>
        )}
      </div>
    </section>
  );
}
