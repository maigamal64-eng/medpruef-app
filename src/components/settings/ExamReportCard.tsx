"use client";

/**
 * Settings "How was your exam?" (a-rewards-program): a first-party report on
 * an official sitting that just took place, with a separate public-use
 * consent tick. The thank-you credits are granted by an admin after a spam
 * check, whatever the report says and whatever the result. Reads GET
 * /api/exam-report; renders nothing while the reward is off, no sitting is
 * open, the learner is below the bar or the state is unreadable. Sent
 * through POST /api/feedback.
 *
 * a-results-route: the card also carries the results-day outcome question
 * (ResultsRouteBlock, GET /api/results-route, RESULTS_ROUTE_ENABLED). Either
 * part renders on its own; the card shows while at least one has something.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ClipboardList } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { announce } from "@/lib/announce";
import { Select, Textarea } from "@/components/ui";
import { EXAM_REPORT_MAX_CHARS, EXAM_REPORT_MIN_CHARS, examReportCopy, sittingLine } from "@/lib/rewards-copy";
import { resultsRouteCopy } from "@/lib/results-route-copy";
import ResultsRouteBlock, { visibleRouteSittings, type RouteState } from "./ResultsRouteBlock";

interface Sitting { key: string; label: { de: string; en: string }; sent: boolean; rewarded: boolean }
interface State { enabled: boolean; eligible?: boolean; credits?: number; expiry_days?: number; sittings?: Sitting[] }

const dateOf = (key: string) => key.slice(key.indexOf(":") + 1);

export default function ExamReportCard({ lang }: { lang: string }) {
  const c = examReportCopy(lang);
  const ids = useId();
  const [state, setState] = useState<State | null>(null);
  const [route, setRoute] = useState<RouteState | null>(null);
  // The outcome question keeps its block mounted after an answer so its thank-you line stays visible.
  const [routeSeen, setRouteSeen] = useState(false);
  const [sitting, setSitting] = useState("");
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await authFetch("/api/exam-report", { skipAuthRedirect: true });
        const body = res.ok ? ((await res.json()) as State) : null;
        if (alive) setState(body);
      } catch { /* unreadable: render nothing */ }
    })();
    (async () => {
      try {
        const res = await authFetch("/api/results-route", { skipAuthRedirect: true });
        const body = res.ok ? ((await res.json()) as RouteState) : null;
        if (alive) setRoute(body);
      } catch { /* unreadable: no outcome question */ }
    })();
    return () => { alive = false; };
  }, []);

  const routeShown = routeSeen || visibleRouteSittings(route).length > 0;
  useEffect(() => { if (routeShown) setRouteSeen(true); }, [routeShown]);

  const sittings = state?.sittings ?? [];
  const openSittings = sittings.filter((s) => !s.sent && !s.rewarded);
  const chosen = openSittings.length === 1 ? openSittings[0].key : sitting;

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    if (!chosen) { setMessage({ ok: false, text: c.sittingMissing }); return; }
    if (text.trim().length < EXAM_REPORT_MIN_CHARS) { setMessage({ ok: false, text: c.tooShort }); return; }
    inFlight.current = true;
    setBusy(true);
    let next: { ok: boolean; text: string };
    try {
      const res = await authFetch("/api/feedback", { method: "POST", skipAuthRedirect: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text.trim(), context: { kind: "exam_report", sitting_key: chosen, consent_public: consent, lang, url: "/settings" } }) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok || body.error === "already_sent") {
        next = { ok: res.ok, text: res.ok ? c.sent : c.alreadySent };
        setState((s) => (s ? { ...s, sittings: (s.sittings ?? []).map((x) => (x.key === chosen ? { ...x, sent: true } : x)) } : s));
        if (res.ok) { setText(""); setSitting(""); setConsent(false); }
      } else next = { ok: false, text: body.error === "sitting_closed" ? c.closed : c.failed };
    } catch { next = { ok: false, text: c.failed }; }
    inFlight.current = false;
    setBusy(false);
    setMessage(next);
    announce(next.text, next.ok ? "polite" : "assertive");
  }, [chosen, text, consent, c, lang]);

  const done = sittings.filter((s) => s.sent || s.rewarded);
  // Shown only to learners the reward can reach (L5 bar), or to show what they already sent.
  const reportShown = !!state?.enabled && (!!state.eligible || done.length > 0) && sittings.length > 0;
  if (!reportShown && !routeShown) return null;
  const rr = resultsRouteCopy(lang);
  return (
    <section id="pruefungsbericht" data-testid="settings-exam-report" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`} className="text-[11px] font-bold tracking-[0.06em] uppercase text-[var(--mp-fg-subtle)] px-1 pb-2">{routeShown ? rr.title : c.title}</h2>
      <div className="rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 flex flex-col gap-3">
        {routeShown && route && <ResultsRouteBlock lang={lang} state={route} onChange={setRoute} />}
        {routeShown && reportShown && <hr className="border-[var(--mp-border)]" />}
        {reportShown && state && <>
        <p className="flex items-start gap-2 text-[14px] text-[var(--mp-fg-muted)]"><ClipboardList aria-hidden size={16} className="mt-0.5 shrink-0 text-[var(--mp-viridian)]" /><span>{c.lead(state.credits ?? 0, state.expiry_days ?? 60)}</span></p>
        {done.length > 0 && (
          <ul className="flex flex-col gap-1 text-[14px] text-[var(--mp-fg)]">
            {done.map((s) => <li key={s.key}>{(s.rewarded ? c.rewardedFor : c.sentFor)(sittingLine(s.label, dateOf(s.key), lang))}</li>)}
          </ul>
        )}
        {state.eligible && openSittings.length > 0 && (
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            {openSittings.length > 1 && (
              <Select label={c.sittingLabel} value={sitting} onChange={(e) => setSitting(e.target.value)} required
                options={[{ value: "", label: c.sittingPlaceholder }, ...openSittings.map((s) => ({ value: s.key, label: sittingLine(s.label, dateOf(s.key), lang) }))]} />
            )}
            {openSittings.length === 1 && <p className="text-[14px] text-[var(--mp-fg)]"><span className="text-[var(--mp-fg-muted)]">{c.sittingLabel}: </span>{sittingLine(openSittings[0].label, dateOf(openSittings[0].key), lang)}</p>}
            <Textarea label={c.textLabel} helper={c.textHelper} value={text} onChange={(e) => setText(e.target.value)} maxLength={EXAM_REPORT_MAX_CHARS} rows={5} />
            <label className="flex min-h-11 items-start gap-3 text-[14px]">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-describedby={`${ids}-consent-help`} />
              <span>{c.consent}</span>
            </label>
            <p id={`${ids}-consent-help`} className="text-[13px] text-[var(--mp-fg-muted)]">{c.consentHelper}</p>
            <button type="submit" disabled={busy} aria-busy={busy} className="mp-btn mp-btn--primary min-h-11 self-start">{busy ? c.sending : c.submit}</button>
          </form>
        )}
        {message && <p role={message.ok ? "status" : "alert"} className={`text-[13px] ${message.ok ? "text-[var(--mp-fg)]" : "text-[var(--mp-error-text)]"}`}>{message.text}</p>}
        </>}
      </div>
    </section>
  );
}
