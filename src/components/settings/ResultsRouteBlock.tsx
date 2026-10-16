"use client";

/**
 * Results-day route (a-results-route) inside the Settings exam report card:
 * one outcome question after an official Stichprobentest or SIP sitting, then
 * the route that fits the answer. The Stichprobentest question asks which
 * exams follow, never whether the learner passed. Retake rules come only from
 * the official page the server names. Data: GET/POST /api/results-route
 * (state is owned by ExamReportCard, which reads it once).
 */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/authFetch";
import { announce } from "@/lib/announce";
import { Select } from "@/components/ui";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { buildQuizHref } from "@/lib/quiz-links";
import { switchActiveExam } from "@/lib/exam-switch";
import { getStoredExamSource } from "@/lib/topics";
import { hasRoute, outcomesFor, type NextBank, type RouteKind, type RouteOutcome, type RoutePlan } from "@/lib/results-route";
import { resultsRouteCopy, splitLink } from "@/lib/results-route-copy";
import { examReportCopy, sittingLine } from "@/lib/rewards-copy";

export interface RouteSittingState {
  key: string;
  exam_key: string;
  kind: RouteKind;
  label: { de: string; en: string };
  date: string;
  ask: boolean;
  answer: { outcome: RouteOutcome; at: string } | null;
  plan: RoutePlan | null;
}
export interface RouteState {
  enabled: boolean;
  official?: { url: string; label: string };
  sittings?: RouteSittingState[];
}

/** Sittings the block shows: still asking, or answered (a route, or a summary that can be changed). */
export function visibleRouteSittings(state: RouteState | null): RouteSittingState[] {
  if (!state?.enabled) return [];
  return (state.sittings ?? []).filter((s) => s.ask || (s.answer !== null && s.plan !== null));
}

function OfficialLine({ line, official }: { line: string; official?: { url: string; label: string } }) {
  const [before, after] = splitLink(line);
  if (!official) return null;
  return (
    <p className="text-[14px] text-[var(--mp-fg)]">
      {before}<a href={official.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2">{official.label}</a>{after}
    </p>
  );
}

export default function ResultsRouteBlock({ lang, state, onChange }: { lang: string; state: RouteState; onChange: (s: RouteState) => void }) {
  const c = resultsRouteCopy(lang);
  const rc = examReportCopy(lang);
  const ids = useId();
  const visible = visibleRouteSittings(state);
  const asking = visible.filter((s) => s.ask);
  const [chosenSitting, setChosenSitting] = useState("");
  const [choice, setChoice] = useState<RouteOutcome | "">("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [switching, setSwitching] = useState<NextBank | null>(null);
  const inFlight = useRef(false);
  // After a saved answer the form unmounts: focus moves to that sitting's result.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const resultRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (!focusKey) return;
    resultRefs.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey]);

  const current = asking.length === 1 ? asking[0] : asking.find((s) => s.key === chosenSitting) ?? null;

  const patch = (key: string, next: Partial<RouteSittingState>) =>
    onChange({ ...state, sittings: (state.sittings ?? []).map((s) => (s.key === key ? { ...s, ...next } : s)) });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    if (!current || !choice) { setMessage({ ok: false, text: c.chooseMissing }); return; }
    inFlight.current = true;
    setBusy(true);
    let next: { ok: boolean; text: string } | null = null;
    try {
      const res = await authFetch("/api/results-route", { method: "POST", skipAuthRedirect: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sitting_key: current.key, outcome: choice }) });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; plan?: RoutePlan; error?: string };
      if (res.ok && body.plan) {
        patch(current.key, { ask: false, answer: { outcome: choice, at: new Date().toISOString() }, plan: body.plan });
        setFocusKey(current.key);
        if (choice === "waiting") next = { ok: true, text: c.waitingSaved };
        else if (choice === "not_sat") next = { ok: true, text: c.notSatSaved };
        setChoice("");
      } else next = { ok: false, text: c.failed };
    } catch { next = { ok: false, text: c.failed }; }
    inFlight.current = false;
    setBusy(false);
    setMessage(next);
    if (next) announce(next.text, next.ok ? "polite" : "assertive");
  }

  async function goTo(bank: NextBank) {
    if (switching) return;
    setSwitching(bank);
    const previous = getStoredExamSource();
    const href = buildQuizHref({ examSource: bank });
    if (previous === bank) { window.location.href = href; return; }
    const r = await switchActiveExam(bank, previous, { reload: () => { window.location.href = href; } });
    if (r === "failed") {
      setSwitching(null);
      setMessage({ ok: false, text: c.switchFailed });
      announce(c.switchFailed, "assertive");
    }
  }

  if (visible.length === 0) return message ? <p role="status" className="text-[13px] text-[var(--mp-fg)]">{message.text}</p> : null;

  const answered = visible.filter((s) => !s.ask && s.plan);
  return (
    <div data-testid="results-route" className="flex flex-col gap-3">
      {answered.map((s) => {
        const plan = s.plan as RoutePlan;
        const o = s.answer?.outcome;
        const refFor = (el: HTMLDivElement | null) => { if (el) resultRefs.current.set(s.key, el); else resultRefs.current.delete(s.key); };
        if (!o || !hasRoute(o)) {
          return (
            <div key={s.key} ref={refFor} tabIndex={-1} data-testid="results-route-summary" className="flex flex-col gap-1 outline-none">
              <p className="text-[14px] text-[var(--mp-fg)]"><span className="text-[var(--mp-fg-muted)]">{sittingLine(s.label, s.date, lang)}: </span>{o ? c.outcome[o] : ""}</p>
              <button type="button" onClick={() => { setMessage(null); patch(s.key, { ask: true }); }} className="text-[13px] underline self-start min-h-11 text-[var(--mp-fg-muted)]">{c.change}</button>
            </div>
          );
        }
        return (
          <div key={s.key} ref={refFor} tabIndex={-1} data-testid="results-route-plan" className="flex flex-col gap-3 outline-none">
            <p className="text-[13px] text-[var(--mp-fg-muted)]">{sittingLine(s.label, s.date, lang)}</p>
            {(o === "rez_gm" || o === "rez_gm_sip") && <p className="text-[14px] text-[var(--mp-fg)]">{c.afterSpt}</p>}
            {o === "passed" && <p className="text-[14px] text-[var(--mp-fg)]">{c.partPassed}</p>}
            {plan.rescue && <OfficialLine line={c.rescue} official={state.official} />}
            {plan.officialNext && <OfficialLine line={c.officialNext} official={state.official} />}
            {(plan.next.length > 0 || plan.rescue || plan.officialNext || plan.gm) && (
              <div className="flex flex-wrap gap-2">
                {plan.next.map((bank) => (
                  <button key={bank} type="button" onClick={() => void goTo(bank)} disabled={switching !== null} aria-busy={switching === bank}
                    className="mp-btn mp-btn--primary min-h-11">{c.continueWith.replace("{exam}", getExamLabel(bank, "full", lang))}</button>
                ))}
                {plan.gm && <Link href="/gm-practice" className="mp-btn mp-btn--secondary min-h-11">{c.practiseGm}</Link>}
                {(plan.rescue || plan.officialNext) && <Link href="/study-plan" className={`mp-btn ${plan.rescue ? "mp-btn--primary" : "mp-btn--secondary"} min-h-11`}>{c.studyPlan}</Link>}
              </div>
            )}
            {plan.testimonial && (
              <div className="flex flex-col gap-2">
                <p className="text-[14px] text-[var(--mp-fg)]">{c.experience}</p>
                <a href="#erfahrung" className="mp-btn mp-btn--secondary min-h-11 self-start">{c.shareExperience}</a>
              </div>
            )}
            {plan.referral && (
              <div className="flex flex-col gap-2">
                <p className="text-[14px] text-[var(--mp-fg)]">{c.referral}</p>
                <Link href="/referrals" className="mp-btn mp-btn--secondary min-h-11 self-start">{c.invite}</Link>
              </div>
            )}
            <button type="button" onClick={() => { setMessage(null); patch(s.key, { ask: true }); }} className="text-[13px] underline self-start min-h-11 text-[var(--mp-fg-muted)]">{c.change}</button>
          </div>
        );
      })}
      {asking.length > 0 && (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3" data-testid="results-route-form">
          {asking.length > 1 && (
            <Select label={rc.sittingLabel} value={chosenSitting} onChange={(e) => { setChosenSitting(e.target.value); setChoice(""); }} required
              options={[{ value: "", label: rc.sittingPlaceholder }, ...asking.map((s) => ({ value: s.key, label: sittingLine(s.label, s.date, lang) }))]} />
          )}
          {asking.length === 1 && <p className="text-[14px] text-[var(--mp-fg)]"><span className="text-[var(--mp-fg-muted)]">{rc.sittingLabel}: </span>{sittingLine(asking[0].label, asking[0].date, lang)}</p>}
          {current && (
            <fieldset className="flex flex-col gap-2" aria-describedby={current.kind === "spt" ? `${ids}-spt-help` : undefined}>
              <legend className="text-[14px] font-semibold text-[var(--mp-fg)] pb-1">{current.kind === "spt" ? c.sptQuestion : c.sipQuestion}</legend>
              {current.kind === "spt" && <p id={`${ids}-spt-help`} className="text-[13px] text-[var(--mp-fg-muted)]">{c.sptHelper}</p>}
              {outcomesFor(current.kind).map((o) => (
                <label key={o} className="flex min-h-11 items-center gap-3 text-[14px] text-[var(--mp-fg)]">
                  <input type="radio" name={`${ids}-outcome`} value={o} checked={choice === o} onChange={() => { setChoice(o); setMessage(null); }} className="h-5 w-5 shrink-0" />
                  <span>{c.outcome[o]}</span>
                </label>
              ))}
            </fieldset>
          )}
          <button type="submit" disabled={busy} aria-busy={busy} className="mp-btn mp-btn--primary min-h-11 self-start">{busy ? c.sending : c.submit}</button>
        </form>
      )}
      {message && <p role={message.ok ? "status" : "alert"} className={`text-[13px] ${message.ok ? "text-[var(--mp-fg)]" : "text-[var(--mp-error-text)]"}`}>{message.text}</p>}
    </div>
  );
}
