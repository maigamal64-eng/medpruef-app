"use client";

/**
 * KP-DE case runner (3d, spec 4.2). One case: vignette and Anamnese, findings,
 * differential diagnoses, Bericht, oral follow-ups, result. Self-marked against
 * a key the server releases part by part after each submit. The run lives in
 * localStorage (own keys) and an outbox that replays the steps in order; a new
 * attempt starts at the first step. No Austrian chrome (focus layout).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { authFetch as fetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";
import { useSignedInRoute } from "@/lib/hooks/useSignedInRoute";
import { AppLayout, Dialog } from "@/components/ui";
import { deKpCopy, fillCopy, type DeKpLang } from "@/lib/de-kp/copy";
import {
  DE_KP_BERICHT_PRACTICE_S, DE_KP_LINE_MAX_CHARS, DE_KP_MAX_ANAMNESE_LINES, DE_KP_MAX_OTHERS, BERICHT_SECTIONS,
  autoHistoryMarks, berichtRemainingSeconds, cleanLines, cleanTyped, criticalMissed, differentialHints, nextScreen, scoreRun, screenStep, stepHasAnswers,
  type ChecklistPoint, type DeKpDifferentials, type DeKpScreen, type DeKpSession, type RubricPoint,
} from "@/lib/de-kp/case-run";
import { syncRun, type Poster } from "@/lib/de-kp/sync";
import { acknowledgePending, clearSession, loadPending, loadSession, savePending, saveSession } from "@/lib/de-kp/storage";
import { trackCaseComplete, trackCaseStart, trackPaywall, trackStepDone } from "@/lib/de-kp/events";
import { PaywallPlanLinks } from "./DeKpCtas";

interface CaseOpen { slug: string; subject: string; title_de: string; title_en: string; is_free: boolean; vignette_de: string; domains: string[] }
interface Followup { id: number; position: number; scope: string; stem_de: string; required: number; accepted?: string[][]; model_answer_de?: string; key_points?: string[] }
interface Keys {
  history_checklist?: (ChecklistPoint)[];
  differentials?: DeKpDifferentials;
  bericht_rubric?: RubricPoint[];
  model_bericht_de?: string;
  followups?: Followup[];
  sources?: { kind: string; ref: string; url?: string }[];
}
type LoadState = "loading" | "ready" | "pro" | "notfound" | "unavailable" | "error";
type ReviewState = "idle" | "loading" | "ready" | "error";

const FIELD = "mp-field w-full min-h-11 px-3 py-2 rounded-md border border-[var(--mp-border-control)] bg-[var(--mp-surface-raised)] text-[var(--mp-fg)]";
const BTN_P = "mp-btn mp-btn--primary min-h-11";
const BTN_S = "mp-btn mp-btn--secondary min-h-11";

const GROUP: Record<DeKpScreen, number> = { anamnese_input: 1, anamnese_mark: 1, diff_input: 2, diff_mark: 2, bericht_input: 3, bericht_mark: 3, oral_input: 4, oral_mark: 4, result: 5 };
const EMPTY_MARKS: DeKpSession["marks"] = { history: {}, differentials: { others: {} }, bericht: {}, oral: {} };
const EMPTY_ANSWERS: DeKpSession["answers"] = { anamnese: [], differentials: { leading: "", others: [] }, bericht: { anamnese: "", diagnose: "", prognose: "", behandlungsplan: "", epikrise: "" }, oral: {} };

const poster: Poster = async (b) => {
  try {
    const r = await fetch("/api/de-kp/attempt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b), skipAuthRedirect: true });
    let step: unknown;
    try { step = ((await r.json()) as { attempt?: { step?: unknown } })?.attempt?.step; } catch { /* no body */ }
    return { status: r.status, step };
  } catch {
    return { status: 0 };
  }
};

async function postJson<T>(url: string, body: unknown): Promise<{ status: number; data: T | null }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), skipAuthRedirect: true });
    return { status: r.status, data: r.ok ? ((await r.json()) as T) : null };
  } catch {
    return { status: 0, data: null };
  }
}

function newSession(slug: string, source: DeKpSession["source"]): DeKpSession {
  return {
    v: 1, attemptId: crypto.randomUUID(), slug, startedAt: Date.now(), step: "anamnese", source, answers: EMPTY_ANSWERS, marks: EMPTY_MARKS,
    berichtClockStartedAt: null, savedAt: Date.now(), screen: "anamnese_input", serverStep: null, finalAcked: false,
  };
}

export default function DeKpRunner({ slug, lang, source }: { slug: string; lang: DeKpLang; source: DeKpSession["source"] }) {
  const signedIn = useSignedInRoute();
  const all = deKpCopy(lang);
  const c = all.runner;
  const [userId, setUserId] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [kase, setCase] = useState<CaseOpen | null>(null);
  const [session, setSessionState] = useState<DeKpSession | null>(null);
  const sessionRef = useRef<DeKpSession | null>(null);
  const [resumable, setResumable] = useState<DeKpSession | null>(null);
  const [keys, setKeys] = useState<Keys>({});
  const [review, setReview] = useState<ReviewState>("idle");
  const [revealed, setRevealed] = useState<{ id: string; domain: string | null; answer: string }[]>([]);
  const [findings, setFindings] = useState<{ id: string; kind: string; text_de: string }[]>([]);
  const [stems, setStems] = useState<Followup[]>([]);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "offline" | "rejected">("idle");
  const [online, setOnline] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [needAnswer, setNeedAnswer] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const syncing = useRef(false);
  const started = useRef(false);
  const completed = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const setSession = useCallback((next: DeKpSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
    if (next && userId) saveSession(userId, next);
  }, [userId]);

  const patch = useCallback((fn: (s: DeKpSession) => DeKpSession) => {
    const cur = sessionRef.current;
    if (cur) setSession(fn(cur));
  }, [setSession]);

  useEffect(() => {
    if (!signedIn) return;
    const id = getStoredSession()?.user?.id;
    if (id) setUserId(id);
  }, [signedIn]);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);

  // Load the case (no key), then the local state.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void (async () => {
      const r = await fetch(`/api/de-kp/case/${encodeURIComponent(slug)}`, { skipAuthRedirect: true }).catch(() => null);
      if (!alive) return;
      if (!r) { setLoadState("error"); return; }
      if (r.status === 403) { setLoadState("pro"); trackPaywall("runner"); return; }
      if (r.status === 404) { setLoadState("notfound"); return; }
      if (r.status === 503) { setLoadState("unavailable"); return; }
      if (!r.ok) { setLoadState("error"); return; }
      const data = (await r.json()) as CaseOpen;
      if (!alive) return;
      setCase(data);
      setLoadState("ready");
      const saved = loadSession(userId);
      if (saved && saved.slug === slug && saved.screen !== "result") setResumable(saved);
      else beginNew(data);
    })();
    return () => { alive = false; };
    // beginNew is stable for the lifetime of this load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, slug]);

  function beginNew(data: CaseOpen) {
    const s = newSession(slug, source);
    setResumable(null);
    setKeys({}); setRevealed([]); setFindings([]); setStems([]); setReview("idle");
    completed.current = false;
    setSession(s);
    if (!started.current) { started.current = true; trackCaseStart(slug, data.is_free, source); }
  }

  const runSync = useCallback(async () => {
    const cur = sessionRef.current;
    if (!cur || syncing.current) return;
    syncing.current = true;
    setSyncState("syncing");
    try {
      const res = await syncRun(cur, poster);
      const latest = sessionRef.current;
      if (latest && latest.attemptId === cur.attemptId) setSession({ ...latest, serverStep: res.session.serverStep ?? latest.serverStep, finalAcked: res.session.finalAcked === true || latest.finalAcked === true });
      setSyncState(res.state === "synced" ? "idle" : res.state);
      if (res.state === "synced" && cur.screen === "result" && res.session.finalAcked && userId) acknowledgePending(userId, cur.attemptId);
    } finally {
      syncing.current = false;
    }
    // The learner moved on while the posts were in flight: catch up again.
    if (sessionRef.current && sessionRef.current.attemptId === cur.attemptId && sessionRef.current.screen !== cur.screen) void runSync();
  }, [setSession, userId]);

  // Sync whenever the screen moves, and retry while something is pending.
  const screen = session?.screen;
  const serverStep = session?.serverStep ?? null;
  useEffect(() => { if (session && loadState === "ready" && !resumable) void runSync(); }, [screen, session?.attemptId, loadState, resumable, runSync]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (syncState !== "offline") return;
    const retry = () => void runSync();
    const t = setInterval(retry, 15_000);
    window.addEventListener("online", retry);
    return () => { clearInterval(t); window.removeEventListener("online", retry); };
  }, [syncState, runSync]);

  // Finished runs of earlier visits wait in the outbox until the server has them.
  useEffect(() => {
    if (!userId || loadState !== "ready") return;
    for (const p of loadPending(userId)) {
      if (p.attemptId === sessionRef.current?.attemptId) continue;
      void syncRun(p, poster).then((r) => { if (r.state === "synced") acknowledgePending(userId, p.attemptId); });
    }
  }, [userId, loadState]);

  // Release data for the screen once the server holds the step it needs.
  const needStep = screen ? screenStep(screen) : null;
  const caughtUp = needStep !== null && serverStep !== null && ["anamnese", "differentials", "bericht", "oral", "done"].indexOf(serverStep) >= ["anamnese", "differentials", "bericht", "oral", "done"].indexOf(needStep);
  const loadReview = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    setReview("loading");
    const attemptId = s.attemptId;
    let ok = true;
    if (s.screen === "oral_input") {
      const r = await postJson<{ followups: Followup[] }>(`/api/de-kp/case/${slug}/reveal`, { stage: "oral", attemptId });
      if (r.data) setStems(r.data.followups); else ok = false;
    } else if (s.screen !== "anamnese_input" && s.screen !== "diff_input" && s.screen !== "bericht_input") {
      const k = await postJson<Keys>(`/api/de-kp/case/${slug}/key`, { attemptId });
      if (k.data) setKeys((prev) => ({ ...prev, ...k.data })); else ok = false;
      if (ok && s.screen === "anamnese_mark") {
        const [rv, fd] = await Promise.all([
          postJson<{ revealed: { id: string; domain: string | null; answer: string }[] }>(`/api/de-kp/case/${slug}/reveal`, { stage: "anamnese", lines: cleanLines(s.answers.anamnese) }),
          postJson<{ findings: { id: string; kind: string; text_de: string }[] }>(`/api/de-kp/case/${slug}/reveal`, { stage: "findings", attemptId }),
        ]);
        if (rv.data) setRevealed(rv.data.revealed); else ok = false;
        if (fd.data) setFindings(fd.data.findings); else ok = false;
      }
    }
    setReview(ok ? "ready" : "error");
  }, [slug]);
  useEffect(() => {
    if (!screen || !caughtUp) return;
    const needs = screen === "anamnese_mark" || screen === "diff_mark" || screen === "bericht_mark" || screen === "oral_input" || screen === "oral_mark" || screen === "result";
    if (needs) void loadReview(); else setReview("idle");
  }, [screen, caughtUp, loadReview]);

  // Pre-tick the checklist once, from the lines the learner typed.
  useEffect(() => {
    const s = sessionRef.current;
    if (screen !== "anamnese_mark" || review !== "ready" || !s || !keys.history_checklist) return;
    if (Object.keys(s.marks.history).length === 0) patch((x) => ({ ...x, marks: { ...x.marks, history: autoHistoryMarks(keys.history_checklist!, x.answers.anamnese) } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, review, keys.history_checklist]);

  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); setNeedAnswer(false); }, [screen]);
  useEffect(() => {
    if (session?.berichtClockStartedAt == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session?.berichtClockStartedAt]);

  // Scores, computed locally with the same functions the server uses at "done".
  const result = useMemo(() => {
    if (!session || !keys.history_checklist || !keys.bericht_rubric || !keys.differentials || !keys.followups) return null;
    return scoreRun({
      checklist: keys.history_checklist, rubric: keys.bericht_rubric, differentials: keys.differentials,
      followups: keys.followups.map((f) => ({ id: f.id, required: f.required })), answers: session.answers, marks: session.marks,
    });
  }, [session, keys]);
  const missed = useMemo(() => (session && keys.bericht_rubric ? criticalMissed(keys.bericht_rubric, session.answers.bericht, session.marks.bericht) : []), [session, keys.bericht_rubric]);

  useEffect(() => {
    if (screen === "result" && result && userId && session && !completed.current && kase) {
      completed.current = true;
      trackCaseComplete(slug, kase.is_free, result.criticalMissed);
      savePending(userId, session);
    }
  }, [screen, result, userId, session, kase, slug]);

  // ── actions ──
  function submit(step: "anamnese" | "differentials" | "bericht" | "oral") {
    const s = sessionRef.current;
    if (!s) return;
    if (!stepHasAnswers(step, s.answers)) { setNeedAnswer(true); return; }
    trackStepDone(slug, step);
    const to = nextScreen(s.screen ?? "anamnese_input");
    patch((x) => ({ ...x, screen: to, step: screenStep(to) }));
  }
  function proceed() {
    const s = sessionRef.current;
    if (!s) return;
    const to = nextScreen(s.screen ?? "anamnese_input");
    patch((x) => ({ ...x, screen: to, step: screenStep(to) }));
  }
  const setMark = (group: "history" | "bericht" | "oral", id: string, value: boolean) => patch((x) => ({ ...x, marks: { ...x.marks, [group]: { ...x.marks[group], [id]: value } } }));
  const setDiffMark = (key: "leading" | string, value: boolean) => patch((x) => ({
    ...x, marks: { ...x.marks, differentials: key === "leading" ? { ...x.marks.differentials, leading: value } : { ...x.marks.differentials, others: { ...x.marks.differentials.others, [key]: value } } },
  }));

  function leave() {
    if (userId && sessionRef.current?.screen === "result") clearSession(userId, sessionRef.current.attemptId);
    window.location.assign(`/kenntnispruefung-deutschland/faelle?lang=${lang}`);
  }

  // ── render ──
  const title = kase ? (lang === "en" ? kase.title_en : kase.title_de) : "";
  const shell = (children: React.ReactNode, footer?: React.ReactNode) => (
    <AppLayout variant="focus">
      <main id="main" className="mp-focus-main safe-area-top bg-[var(--mp-surface-sunken)]" lang={lang}>
        <header className="px-3 py-2 border-b border-[var(--mp-border)] flex-shrink-0 bg-[var(--mp-surface-raised)]">
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="mp-btn mp-btn--ghost min-h-11 px-1 text-sm" onClick={() => (session && session.screen !== "result" ? setConfirmLeave(true) : leave())}>{c.leave}</button>
            <span className="text-xs font-mono text-[var(--mp-fg-muted)]">{all.chip} · {all.practiceLabel}</span>
          </div>
          {session && <p className="text-xs text-[var(--mp-fg-muted)]">{fillCopy(c.stepOf, { i: GROUP[session.screen ?? "anamnese_input"], n: 5 })}</p>}
          {!online && <p className="text-xs text-[var(--mp-fg-muted)]" role="status">{c.offline}</p>}
          {syncState === "offline" && online && <p className="text-xs text-[var(--mp-fg-muted)]" role="status">{c.syncFailed}</p>}
        </header>
        <div className="mp-exam-pane flex-1 px-4 py-4 lg:px-10"><div className="max-w-2xl mx-auto space-y-4">{children}</div></div>
        {footer && <footer className="flex-shrink-0 border-t border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 py-2 safe-area-bottom"><div className="max-w-2xl mx-auto flex flex-wrap items-center justify-between gap-2">{footer}</div></footer>}
      </main>
      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave} title={c.leaveTitle} description={c.leaveBody} kind="confirm"
        footer={<><button type="button" data-dialog-safe className={BTN_P} onClick={() => setConfirmLeave(false)}>{c.stay}</button><button type="button" className={BTN_S} onClick={leave}>{c.leave}</button></>} />
    </AppLayout>
  );
  const h = (text: string) => <h1 ref={headingRef} tabIndex={-1} className="font-display text-xl font-bold outline-none">{text}</h1>;
  const message = (text: string, retry = false) => shell(<div className="mp-card p-4 space-y-3" role="status"><p className="text-sm">{text}</p>{retry && <button type="button" className={BTN_S} onClick={() => window.location.reload()}>{c.retry}</button>}</div>);

  if (!signedIn || loadState === "loading") return shell(<p role="status" className="text-sm">{c.loading}</p>);
  if (loadState === "notfound") return message(all.errors.notFound);
  if (loadState === "unavailable") return message(all.errors.unavailable, true);
  if (loadState === "error") return message(all.errors.generic, true);
  if (loadState === "pro") {
    return shell(
      <div className="mp-card p-4 space-y-3">
        {h(c.paywallTitle)}
        <p className="text-sm">{c.paywallBody}</p>
        <PaywallPlanLinks lang={lang} surface="runner" label={c.paywallCta} trialLabel={c.trialOr} />
        <Link href={`/kenntnispruefung-deutschland/faelle?lang=${lang}`} className="underline text-sm inline-flex min-h-11 items-center">{c.toHub}</Link>
      </div>,
    );
  }
  if (resumable) {
    return shell(
      <div className="mp-card p-4 space-y-3">
        {h(c.resumeTitle)}
        <p className="text-sm">{c.resumeBody}</p>
        <div className="flex gap-2">
          <button type="button" className={BTN_P} onClick={() => { setSession(resumable); setResumable(null); started.current = true; }}>{c.resumeYes}</button>
          <button type="button" className={BTN_S} onClick={() => { if (kase) beginNew(kase); }}>{c.resumeNo}</button>
        </div>
      </div>,
    );
  }
  if (!session || !kase) return shell(<p role="status" className="text-sm">{c.loading}</p>);

  const sc = session.screen ?? "anamnese_input";
  const reviewBlock = (children: React.ReactNode) => {
    if (!caughtUp || review === "loading" || review === "idle") return <p role="status" className="text-sm">{!online || syncState === "offline" ? c.offline : c.reviewLoading}</p>;
    if (review === "error") return <div className="mp-card p-4 space-y-3" role="alert"><p className="text-sm">{c.reviewError}</p><button type="button" className={BTN_S} onClick={() => void loadReview()}>{c.retry}</button></div>;
    return children;
  };
  const textInput = (id: string, value: string, onChange: (v: string) => void, label: string) => (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <input id={id} type="text" lang="de" dir="ltr" className={FIELD} style={{ fontSize: 16 }} value={value} maxLength={DE_KP_LINE_MAX_CHARS} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
  const markButtons = (name: string, value: boolean | undefined, onSet: (v: boolean) => void) => (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      <button type="button" role="radio" aria-checked={value === true} className={`mp-btn min-h-11 ${value === true ? "mp-btn--primary" : "mp-btn--secondary"}`} onClick={() => onSet(true)}>{all.marking.right}</button>
      <button type="button" role="radio" aria-checked={value === false} className={`mp-btn min-h-11 ${value === false ? "mp-btn--primary" : "mp-btn--secondary"}`} onClick={() => onSet(false)}>{all.marking.notRight}</button>
    </div>
  );
  const hint = (s: "matches" | "compare" | "empty") => <p className="text-xs text-[var(--mp-fg-muted)]">{s === "matches" ? all.marking.hint.matches : s === "empty" ? all.marking.hint.empty : all.marking.hint.compare}</p>;
  const continueBtn = (onClick: () => void, disabled = false) => <button type="button" className={BTN_P} aria-disabled={disabled} onClick={() => { if (!disabled) onClick(); }}>{c.continue}</button>;
  const submitBtn = (step: "anamnese" | "differentials" | "bericht" | "oral") => <button type="button" className={BTN_P} onClick={() => submit(step)}>{c.submit}</button>;
  const need = needAnswer && <p className="text-sm text-[var(--mp-error-text)]" role="alert">{all.errors.badRequest}</p>;

  // Anamnese input
  if (sc === "anamnese_input") {
    const lines = session.answers.anamnese;
    const slots = Math.min(DE_KP_MAX_ANAMNESE_LINES, Math.max(5, lines.length + 1));
    const setLine = (i: number, v: string) => patch((x) => { const next = [...x.answers.anamnese]; while (next.length <= i) next.push(""); next[i] = v; return { ...x, answers: { ...x.answers, anamnese: next } }; });
    return shell(
      <>
        {h(title)}
        <div className="mp-card p-4"><h2 className="font-display font-bold mb-2">{c.vignetteHeading}</h2><p className="text-sm whitespace-pre-line" lang="de" dir="ltr">{kase.vignette_de}</p></div>
        <p className="text-sm">{c.anamneseHint}</p>
        {Array.from({ length: slots }, (_, i) => <div key={i}>{textInput(`dekp-line-${i}`, lines[i] ?? "", (v) => setLine(i, v), fillCopy(c.anamneseLine, { i: i + 1 }))}</div>)}
        <AskPatient slug={slug} lines={lines} copy={c} />
        {need}
      </>,
      <>{<span className="text-xs text-[var(--mp-fg-muted)]">{all.honesty}</span>}{submitBtn("anamnese")}</>,
    );
  }

  if (sc === "anamnese_mark") {
    const list = keys.history_checklist ?? [];
    const answerFor = (id: string) => revealed.find((r) => r.id === id)?.answer;
    return shell(
      <>
        {h(c.checklistHeading)}
        {reviewBlock(
          <>
            <p className="text-sm">{c.checklistHint}</p>
            <ul className="space-y-2">
              {list.map((p) => (
                <li key={p.id} className="mp-card p-3 space-y-1">
                  <label className="flex items-start gap-3 min-h-11 cursor-pointer">
                    <input type="checkbox" className="mt-1 w-5 h-5" checked={session.marks.history[p.id] === true} onChange={(e) => setMark("history", p.id, e.target.checked)} />
                    <span className="text-sm" lang="de" dir="ltr">{p.point_de}</span>
                  </label>
                  {answerFor(p.id) && <p className="text-sm text-[var(--mp-fg-muted)] ps-8" lang="de" dir="ltr">{answerFor(p.id)}</p>}
                </li>
              ))}
            </ul>
            <h2 className="font-display text-lg font-bold">{c.findingsHeading}</h2>
            <ul className="space-y-2" lang="de" dir="ltr">{findings.map((f) => <li key={f.id} className="mp-card p-3 text-sm"><span className="text-xs uppercase text-[var(--mp-fg-subtle)]">{f.kind}</span><br />{f.text_de}</li>)}</ul>
          </>,
        )}
      </>,
      continueBtn(proceed, review !== "ready"),
    );
  }

  if (sc === "diff_input") {
    const d = session.answers.differentials;
    const setLead = (v: string) => patch((x) => ({ ...x, answers: { ...x.answers, differentials: { ...x.answers.differentials, leading: v } } }));
    const setOther = (i: number, v: string) => patch((x) => { const o = [...x.answers.differentials.others]; while (o.length <= i) o.push(""); o[i] = v; return { ...x, answers: { ...x.answers, differentials: { ...x.answers.differentials, others: o } } }; });
    return shell(
      <>
        {h(all.stepLabels.differentials)}
        <p className="text-sm">{c.diffHint}</p>
        {textInput("dekp-lead", d.leading, setLead, c.diffLeading)}
        {Array.from({ length: DE_KP_MAX_OTHERS }, (_, i) => <div key={i}>{textInput(`dekp-other-${i}`, d.others[i] ?? "", (v) => setOther(i, v), fillCopy(c.diffOther, { i: i + 1 }))}</div>)}
        {need}
      </>,
      <><span />{submitBtn("differentials")}</>,
    );
  }

  if (sc === "diff_mark") {
    const typed = session.answers.differentials;
    const typedOthers = typed.others.filter((o) => o.trim() !== "");
    const hints = keys.differentials ? differentialHints(typed, keys.differentials) : null;
    return shell(
      <>
        {h(all.stepLabels.differentials)}
        {reviewBlock(
          <>
            <div className="mp-card p-4 space-y-2">
              <p className="text-xs font-semibold text-[var(--mp-fg-muted)]">{c.diffLeading}</p>
              <p className="text-sm" lang="de" dir="ltr">{typed.leading || "-"}</p>
              {hints && hint(hints.leading)}
              <p className="text-xs font-semibold text-[var(--mp-fg-muted)]">{c.leadingKey}</p>
              <ul className="text-sm list-disc ps-5" lang="de" dir="ltr">{(keys.differentials?.leading ?? []).flat().map((w) => <li key={w}>{w}</li>)}</ul>
              {typed.leading && markButtons(c.diffLeading, session.marks.differentials.leading, (v) => setDiffMark("leading", v))}
            </div>
            {typedOthers.map((o, i) => (
              <div key={i} className="mp-card p-4 space-y-2">
                <p className="text-xs font-semibold text-[var(--mp-fg-muted)]">{fillCopy(c.diffOther, { i: i + 1 })}</p>
                <p className="text-sm" lang="de" dir="ltr">{o}</p>
                {hints && hint(hints.others[i] ?? "compare")}
                {markButtons(fillCopy(c.diffOther, { i: i + 1 }), session.marks.differentials.others[String(i)], (v) => setDiffMark(String(i), v))}
              </div>
            ))}
            <div className="mp-card p-4 space-y-1">
              <p className="text-xs font-semibold text-[var(--mp-fg-muted)]">{c.othersKey}</p>
              <ul className="text-sm list-disc ps-5" lang="de" dir="ltr">{(keys.differentials?.others ?? []).map((g) => <li key={g.join("|")}>{g.join(" / ")}</li>)}</ul>
            </div>
          </>,
        )}
      </>,
      continueBtn(proceed, review !== "ready"),
    );
  }

  if (sc === "bericht_input") {
    const b = session.answers.bericht;
    const left = berichtRemainingSeconds(session, now);
    const setSec = (sec: (typeof BERICHT_SECTIONS)[number], v: string) => patch((x) => ({ ...x, answers: { ...x.answers, bericht: { ...x.answers.bericht, [sec]: v } } }));
    return shell(
      <>
        {h(all.stepLabels.bericht)}
        <p className="text-sm">{c.berichtHint}</p>
        <label className="flex items-center gap-3 min-h-11 text-sm cursor-pointer">
          <input type="checkbox" className="w-5 h-5" checked={session.berichtClockStartedAt != null} onChange={(e) => patch((x) => ({ ...x, berichtClockStartedAt: e.target.checked ? Date.now() : null }))} />
          {c.clockToggle}
        </label>
        {left != null && (
          <p className="text-sm font-mono" role="timer" aria-label={all.clockLabel}>
            {all.clockLabel} {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} / {Math.floor(DE_KP_BERICHT_PRACTICE_S / 60)}:00 {left === 0 ? `· ${c.clockEnded}` : ""}
          </p>
        )}
        <p className="text-xs text-[var(--mp-fg-muted)]">{c.clockNote}</p>
        {BERICHT_SECTIONS.map((sec) => (
          <div key={sec} className="space-y-1">
            <label htmlFor={`dekp-b-${sec}`} className="text-sm font-semibold">{all.sectionLabels[sec]}</label>
            <textarea id={`dekp-b-${sec}`} lang="de" dir="ltr" rows={5} className={FIELD} style={{ fontSize: 16 }} value={b[sec]} maxLength={4000} spellCheck={false} onChange={(e) => setSec(sec, e.target.value)} />
          </div>
        ))}
        {need}
      </>,
      <><span />{submitBtn("bericht")}</>,
    );
  }

  if (sc === "bericht_mark") {
    const rubric = keys.bericht_rubric ?? [];
    const b = session.answers.bericht;
    return shell(
      <>
        {h(c.rubricHeading)}
        {reviewBlock(
          <>
            <p className="text-sm">{c.rubricHint}</p>
            {BERICHT_SECTIONS.map((sec) => (
              <section key={sec} className="mp-card p-4 space-y-2">
                <h2 className="font-display font-bold">{all.sectionLabels[sec]}</h2>
                <p className="text-xs font-semibold text-[var(--mp-fg-muted)]">{c.yourReport}</p>
                <p className="text-sm whitespace-pre-line" lang="de" dir="ltr">{b[sec] || "-"}</p>
                <ul className="space-y-1">
                  {rubric.filter((p) => p.section === sec).map((p) => (
                    <li key={p.id}>
                      <label className="flex items-start gap-3 min-h-11 cursor-pointer">
                        <input type="checkbox" className="mt-1 w-5 h-5" checked={session.marks.bericht[p.id] === true} onChange={(e) => setMark("bericht", p.id, e.target.checked)} />
                        <span className="text-sm" lang="de" dir="ltr">{p.point_de}{p.critical && <strong className="ms-2 text-xs text-[var(--mp-error-text)]">{c.criticalMark}</strong>}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <section className="mp-card p-4 space-y-2"><h2 className="font-display font-bold">{c.modelHeading}</h2><p className="text-sm whitespace-pre-line" lang="de" dir="ltr">{keys.model_bericht_de}</p></section>
          </>,
        )}
      </>,
      continueBtn(proceed, review !== "ready"),
    );
  }

  if (sc === "oral_input") {
    const setOral = (id: number, slot: number, v: string) => patch((x) => { const cur = [...(x.answers.oral[String(id)] ?? [])]; while (cur.length <= slot) cur.push(""); cur[slot] = v; return { ...x, answers: { ...x.answers, oral: { ...x.answers.oral, [String(id)]: cur } } }; });
    return shell(
      <>
        {h(all.stepLabels.oral)}
        {reviewBlock(
          <>
            <p className="text-sm">{c.oralHint}</p>
            {stems.map((f) => (
              <section key={f.id} className="mp-card p-4 space-y-2">
                <p className="text-xs text-[var(--mp-fg-subtle)]">{f.scope === "cross" ? c.scopeCross : c.scopeCase}</p>
                <p className="text-sm font-semibold whitespace-pre-line" lang="de" dir="ltr">{f.stem_de}</p>
                {Array.from({ length: f.required }, (_, i) => <div key={i}>{textInput(`dekp-o-${f.id}-${i}`, session.answers.oral[String(f.id)]?.[i] ?? "", (v) => setOral(f.id, i, v), fillCopy(c.oralAnswer, { i: i + 1 }))}</div>)}
              </section>
            ))}
          </>,
        )}
      </>,
      <><span />{review === "ready" ? submitBtn("oral") : <span />}</>,
    );
  }

  if (sc === "oral_mark") {
    const items = keys.followups ?? [];
    const answered = items.filter((f) => cleanTyped(session.answers.oral[String(f.id)], f.required).length > 0);
    const allDecided = answered.every((f) => typeof session.marks.oral[String(f.id)] === "boolean");
    return shell(
      <>
        {h(all.stepLabels.oral)}
        {reviewBlock(
          <>
            <p className="text-sm">{c.markAll}</p>
            {items.map((f) => {
              const typed = cleanTyped(session.answers.oral[String(f.id)], f.required);
              const sug = typed.length === 0 ? "empty" : f.accepted && f.accepted.length ? (f.accepted.flat().some((a) => typed.some((t) => t.trim().toLowerCase() === a.trim().toLowerCase())) ? "matches" : "compare") : "compare";
              return (
                <section key={f.id} className="mp-card p-4 space-y-2">
                  <p className="text-sm font-semibold whitespace-pre-line" lang="de" dir="ltr">{f.stem_de}</p>
                  <p className="text-xs font-semibold text-[var(--mp-fg-muted)]">{c.oralModel}</p>
                  <p className="text-sm" lang="de" dir="ltr">{f.model_answer_de}</p>
                  {(f.key_points ?? []).length > 0 && <ul className="text-sm list-disc ps-5" lang="de" dir="ltr">{(f.key_points ?? []).map((k) => <li key={k}>{k}</li>)}</ul>}
                  <p className="text-xs font-semibold text-[var(--mp-fg-muted)]">{all.stepLabels.oral}: {all.marking.right}?</p>
                  {typed.length > 0 ? <p className="text-sm" lang="de" dir="ltr">{typed.join(" / ")}</p> : null}
                  {hint(sug as "matches" | "compare" | "empty")}
                  {typed.length > 0 && markButtons(f.stem_de.slice(0, 40), session.marks.oral[String(f.id)], (v) => setMark("oral", String(f.id), v))}
                </section>
              );
            })}
          </>,
        )}
      </>,
      continueBtn(proceed, review !== "ready" || !allDecided),
    );
  }

  // result
  const pct = (n: number) => fillCopy(c.scoreOf, { p: Math.round(n * 100) });
  return shell(
    <>
      {h(c.resultHeading)}
      <p className="text-sm text-[var(--mp-fg-muted)]">{c.resultNote}</p>
      {reviewBlock(
        result && (
          <>
            <ul className="grid grid-cols-2 gap-3">
              {(["history", "differential", "bericht", "followup"] as const).map((k) => (
                <li key={k} className="mp-card p-3"><p className="text-xs text-[var(--mp-fg-muted)]">{all.scoreLabels[k]}</p><p className="font-display text-xl font-bold">{pct(result[k])}</p></li>
              ))}
            </ul>
            <section className="mp-card p-4 space-y-2">
              <h2 className="font-display font-bold">{all.criticalHeading}</h2>
              {missed.length === 0 ? <p className="text-sm">{c.noCritical}</p> : <ul className="list-disc ps-5 text-sm" lang="de" dir="ltr">{missed.map((m) => <li key={m.id}>{m.point_de}</li>)}</ul>}
            </section>
            <section className="mp-card p-4 space-y-2"><h2 className="font-display font-bold">{c.modelHeading}</h2><p className="text-sm whitespace-pre-line" lang="de" dir="ltr">{keys.model_bericht_de}</p></section>
            {(keys.sources ?? []).filter((s) => s.kind !== "exam_protocol" && !!s.url).length > 0 && (
              <section className="space-y-1"><h2 className="font-display font-bold">{c.sourcesHeading}</h2>
                <ul className="text-sm list-disc ps-5">{(keys.sources ?? []).filter((s) => s.kind !== "exam_protocol" && !!s.url).map((s) => <li key={s.url}><a className="underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.ref}</a></li>)}</ul>
              </section>
            )}
            <p className="text-xs text-[var(--mp-fg-muted)]" role="status">{session.finalAcked ? c.savedRun : c.pending}</p>
            <div className="flex flex-wrap gap-3 pb-6">
              <Link href={`/kenntnispruefung-deutschland/faelle?lang=${lang}`} className={BTN_P} onClick={() => { if (userId && session.finalAcked) clearSession(userId, session.attemptId); }}>{c.toHub}</Link>
              {kase.is_free && <PaywallPlanLinks lang={lang} surface="result" label={c.toPlans} trialLabel={c.trialOr} />}
            </div>
          </>
        ),
      )}
    </>,
  );
}

function AskPatient({ slug, lines, copy }: { slug: string; lines: string[]; copy: ReturnType<typeof deKpCopy>["runner"] }) {
  const [answers, setAnswers] = useState<{ id: string; domain: string | null; answer: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  async function ask() {
    setBusy(true);
    const r = await postJson<{ revealed: { id: string; domain: string | null; answer: string }[] }>(`/api/de-kp/case/${slug}/reveal`, { stage: "anamnese", lines: cleanLines(lines) });
    setAnswers(r.data?.revealed ?? []);
    setBusy(false);
  }
  return (
    <div className="space-y-2">
      <button type="button" className={BTN_S} aria-busy={busy} onClick={() => void ask()}>{copy.askPatient}</button>
      {answers && (
        <div className="mp-card p-3 space-y-1" role="status">
          <p className="text-xs font-semibold text-[var(--mp-fg-muted)]">{copy.patientAnswers}</p>
          {answers.length === 0 ? <p className="text-sm">{copy.noPatientAnswers}</p> : <ul className="text-sm space-y-1" lang="de" dir="ltr">{answers.map((a) => <li key={a.id}>{a.answer}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
