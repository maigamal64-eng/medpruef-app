"use client";

/**
 * /gm-practice: oral Gerichtsmedizin drill (a44, SIM-07; pick-gm-placement B).
 *
 * Entry (format card, start), running (focus shell, 10-minute wall clock that
 * starts with the first prompt, stem only, optional read-aloud, reveal of the
 * model answer with its source, self-score), summary. Questions come from
 * /api/questions on the pharma bank narrowed to topic Gerichtsmedizin, so the
 * server keeps applying the free allowance and entitlement rules. Self-scores
 * stay on the device (safeStorage, per account) and are never posted.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Clock, Mic, Square, Volume2 } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { useSignedInRoute } from "@/lib/hooks/useSignedInRoute";
import { safeStorage } from "@/lib/safe-storage";
import { AppLayout } from "@/components/ui";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { remainingSeconds } from "@/lib/examSession";
import { wallClockRemaining } from "@/lib/practice-exam-state";
import { GM_BANK, GM_QUIZ_HREF, GM_TOPIC } from "@/lib/gm-practice";
import {
  DRILL_STORAGE_KEY, decodeStored, encodeStored, finish, reveal, score, startSession, summarize, toDrillItems,
  type DrillScore, type DrillSession,
} from "@/lib/gm-practice/drill";
import { fill, gmCopy, gmLang, type GmCopy } from "@/lib/gm-practice/copy";
import { GmFormatCard } from "./_parts/GmFormatCard";

type PoolState = "idle" | "loading" | "pro" | "unavailable" | "error";
const QUESTIONS_URL = `/api/questions?examSource=${GM_BANK}&topic=${encodeURIComponent(GM_TOPIC)}&practiceMode=exam&mcqOnly=1&limit=200`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function GmDrill() {
  const signedIn = useSignedInRoute();
  const lang = useLang();
  const c = gmCopy(lang);
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [session, setSession] = useState<DrillSession | null>(null);
  const [resumable, setResumable] = useState<DrillSession | null>(null);
  const [pool, setPool] = useState<PoolState>("idle");

  useEffect(() => {
    if (!signedIn) return;
    const stored = getStoredSession();
    if (!stored?.user?.id) return;
    setUserId(stored.user.id);
    setUserName(stored.user.first_name ?? "");
    const saved = decodeStored(safeStorage.getItem(DRILL_STORAGE_KEY), stored.user.id, Date.now());
    if (!saved || saved.finishedAt) safeStorage.removeItem(DRILL_STORAGE_KEY);
    else if (remainingSeconds(saved.startedAt, saved.durationS) > 0) setResumable(saved);
    else setSession(finish(saved, Date.now(), true));
  }, [signedIn]);

  // Device-only persistence of the open run (resume after reload); a finished run is cleared.
  useEffect(() => {
    if (!userId || !session) return;
    if (session.finishedAt) safeStorage.removeItem(DRILL_STORAGE_KEY);
    else safeStorage.setItem(DRILL_STORAGE_KEY, encodeStored(userId, session));
  }, [userId, session]);

  const start = useCallback(async () => {
    if (pool === "loading") return;
    setPool("loading");
    try {
      const res = await fetch(QUESTIONS_URL, { signal: AbortSignal.timeout(15_000) });
      if (res.status === 402 || res.status === 403) { setPool("pro"); return; }
      if (!res.ok) throw new Error(`questions ${res.status}`);
      const body: unknown = await res.json();
      if (!Array.isArray(body)) {
        const o = (body ?? {}) as { freeTopicEmpty?: unknown; paywallHit?: unknown };
        setPool(o.freeTopicEmpty === true || o.paywallHit === true ? "pro" : "error");
        return;
      }
      const items = toDrillItems(body);
      if (!items.length) { setPool("unavailable"); return; }
      setResumable(null);
      setSession(startSession(items, Date.now()));
      setPool("idle");
    } catch {
      setPool("error");
    }
  }, [pool]);

  if (!signedIn || !userId) return null;
  if (session && !session.finishedAt) return <DrillRunner copy={c} session={session} onChange={setSession} />;

  return (
    <AppLayout sidebar={<Sidebar lang={lang} userId={userId} userName={userName} />} bottomNav={<BottomNav lang={lang} userId={userId} />}>
      <main id="main" className="main-content flex-1 pb-24 lg:pb-8">
        <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 lg:py-10">
          {session?.finishedAt ? (
            <DrillSummary copy={c} session={session} onAgain={() => { setSession(null); void start(); }} />
          ) : (
            <>
              <header className="space-y-2">
                <h1 className="text-2xl font-bold">{c.title}</h1>
                <p className="leading-relaxed text-[var(--mp-fg-muted)]">{c.intro}</p>
                <p className="text-sm leading-relaxed text-[var(--mp-fg-muted)]">{c.bankNote}</p>
              </header>
              <section className="mp-card space-y-4 p-5" aria-live="polite">
                {resumable && (
                  <div className="space-y-3">
                    <p className="font-semibold">{c.resumeTitle}</p>
                    <button type="button" className="mp-btn mp-btn--primary min-h-11" onClick={() => { setSession(resumable); setResumable(null); }}>{c.resume}</button>
                  </div>
                )}
                {pool === "pro" ? (
                  <div className="space-y-3" data-gm-state="pro">
                    <p className="font-semibold">{c.proTitle}</p>
                    <p className="text-sm text-[var(--mp-fg-muted)]">{c.proBody}</p>
                    <Link href="/pricing?gate=full_bank" className="mp-btn mp-btn--primary min-h-11">{c.proCta}</Link>
                  </div>
                ) : pool === "unavailable" ? (
                  <div className="space-y-2" data-gm-state="unavailable">
                    <p className="font-semibold">{c.unavailableTitle}</p>
                    <p className="text-sm text-[var(--mp-fg-muted)]">{c.unavailableBody}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pool === "error" && <p role="alert" className="text-sm text-[var(--mp-error-text)]">{c.loadError}</p>}
                    <button type="button" className="mp-btn mp-btn--primary min-h-11 inline-flex items-center gap-2" aria-busy={pool === "loading"} onClick={() => void start()}>
                      <Mic className="size-4" aria-hidden="true" />{pool === "loading" ? c.starting : pool === "error" ? c.retry : c.start}
                    </button>
                  </div>
                )}
                <p className="text-xs leading-relaxed text-[var(--mp-fg-muted)]">{c.scoreNote}</p>
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
                  <Link href={GM_QUIZ_HREF} className="underline underline-offset-4">{c.mcq}</Link>
                  <Link href={`/gerichtsmedizin?lang=${gmLang(lang)}`} className="underline underline-offset-4">{c.backToPage}</Link>
                </div>
                <p className="text-xs leading-relaxed text-[var(--mp-fg-muted)]">{c.mcqNote}</p>
              </section>
              <GmFormatCard lang={lang} />
            </>
          )}
        </div>
      </main>
    </AppLayout>
  );
}

function DrillRunner({ copy, session, onChange }: { copy: GmCopy; session: DrillSession; onChange: (s: DrillSession) => void }) {
  const item = session.items[session.idx];
  const [left, setLeft] = useState(() => remainingSeconds(session.startedAt, session.durationS));
  const [notice, setNotice] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const latest = useRef(session);
  useEffect(() => { latest.current = session; }, [session]);
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

  // Wall clock (as /exam and /exam/kaf): survives reload and background tabs.
  useEffect(() => {
    let previous = remainingSeconds(session.startedAt, session.durationS);
    const said = new Set<number>();
    const tick = () => {
      previous = wallClockRemaining(session.startedAt, session.durationS, Date.now(), previous);
      setLeft(previous);
      for (const m of [5, 1]) if (previous > 0 && previous <= m * 60 && !said.has(m)) { said.add(m); setNotice(fill(copy.timeNotice, { n: m })); }
      if (previous === 0) onChange(finish(latest.current, Date.now(), true));
    };
    tick();
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("pageshow", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("pageshow", tick);
      window.removeEventListener("focus", tick);
    };
  }, [session.startedAt, session.durationS, copy.timeNotice, onChange]);

  const stopSpeaking = useCallback(() => { if (canSpeak) window.speechSynthesis.cancel(); setSpeaking(false); }, [canSpeak]);
  useEffect(() => stopSpeaking, [stopSpeaking]);
  useLayoutEffect(() => {
    stopSpeaking();
    headingRef.current?.focus({ preventScroll: true });
  }, [session.idx, stopSpeaking]);
  useEffect(() => { if (session.revealed) answerRef.current?.focus({ preventScroll: false }); }, [session.revealed]);

  if (!item) return null;
  const speak = () => {
    if (!canSpeak) return;
    if (speaking) { stopSpeaking(); return; }
    const u = new SpeechSynthesisUtterance(item.prompt);
    u.lang = "de-AT";
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  };
  const rate = (value: DrillScore) => onChange(score(session, value, Date.now()));

  return (
    <AppLayout variant="focus">
      <main id="main" className="mp-focus-main safe-area-top bg-[var(--mp-surface-sunken)]">
        <header className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 py-2">
          <button type="button" className="mp-btn mp-btn--ghost min-h-11 px-2 text-sm" onClick={() => { stopSpeaking(); onChange(finish(session, Date.now())); }}>{copy.end}</button>
          <span className="font-mono text-xs">{fill(copy.progress, { n: session.idx + 1 })}</span>
          <span dir="ltr" role="timer" aria-label={`${copy.clock} ${clock(left)}`} className={`inline-flex items-center gap-1 font-mono font-bold tabular-nums ${left <= 60 ? "text-[var(--mp-error-text)]" : "text-[var(--mp-fg)]"}`}>
            <Clock className="h-4 w-4" aria-hidden="true" />{clock(left)}
          </span>
        </header>
        <p className="sr-only" aria-live="polite">{notice}</p>
        <div className="mp-exam-pane flex-1 px-4 py-5 lg:px-10">
          <div className="mx-auto max-w-2xl space-y-5">
            <h1 ref={headingRef} tabIndex={-1} data-gm-prompt className="whitespace-pre-line text-lg font-semibold leading-relaxed text-[var(--mp-fg)] outline-none lg:text-xl" lang="de" dir="ltr">{item.prompt}</h1>
            {!session.revealed && <p className="text-sm text-[var(--mp-fg-muted)]">{copy.answerAloud}</p>}
            {canSpeak && (
              <button type="button" className="mp-btn mp-btn--secondary min-h-11 inline-flex items-center gap-2" aria-pressed={speaking} onClick={speak}>
                {speaking ? <Square className="size-4" aria-hidden="true" /> : <Volume2 className="size-4" aria-hidden="true" />}{speaking ? copy.stopReading : copy.readAloud}
              </button>
            )}
            {session.revealed && (
              <div ref={answerRef} tabIndex={-1} data-gm-answer className="mp-card space-y-3 p-4 outline-none">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)]">{copy.modelAnswer}</p>
                <p className="font-semibold text-[var(--mp-fg)]" lang="de" dir="ltr">{item.answer}</p>
                {item.explanation && (<><p className="text-xs font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)]">{copy.explanation}</p><p className="text-sm leading-relaxed" lang="de" dir="ltr">{item.explanation}</p></>)}
                {item.source && <p className="break-words border-t border-[var(--mp-border)] pt-3 text-xs leading-relaxed text-[var(--mp-fg-muted)]" lang="de" dir="ltr">{copy.source}: {item.source}</p>}
              </div>
            )}
          </div>
        </div>
        <footer className="flex-shrink-0 border-t border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 py-2 safe-area-bottom">
          <div className="mx-auto max-w-2xl">
            {!session.revealed ? (
              <button type="button" className="mp-btn mp-btn--primary min-h-11 w-full" onClick={() => onChange(reveal(session))}>{copy.reveal}</button>
            ) : (
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">{copy.scorePrompt}</legend>
                <div className="grid grid-cols-3 gap-2">
                  {(["known", "partial", "unknown"] as const).map((v) => (
                    <button key={v} type="button" data-gm-score={v} className="mp-btn mp-btn--secondary min-h-11 px-2 text-sm" onClick={() => rate(v)}>{copy[v]}</button>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        </footer>
      </main>
    </AppLayout>
  );
}

function DrillSummary({ copy, session, onAgain }: { copy: GmCopy; session: DrillSession; onAgain: () => void }) {
  const s = summarize(session);
  const ending = session.timeUp ? copy.timeUp : s.scored === session.items.length ? copy.allDone : "";
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  return (
    <section className="space-y-5" data-gm-summary>
      <header className="space-y-2">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold outline-none">{copy.summaryTitle}</h1>
        {ending && <p className="text-[var(--mp-fg-muted)]">{ending}</p>}
        <p className="font-semibold">{s.scored ? fill(copy.summaryCounts, { known: s.known, partial: s.partial, unknown: s.unknown }) : copy.noneScored}</p>
        <p className="text-xs text-[var(--mp-fg-muted)]">{copy.scoreNote}</p>
      </header>
      {s.review.length > 0 && (
        <section aria-labelledby="gm-review-title" className="space-y-3">
          <h2 id="gm-review-title" className="text-lg font-bold">{copy.reviewTitle}</h2>
          <ul className="space-y-3">
            {s.review.map((it) => (
              <li key={it.id} className="mp-card space-y-2 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)]">{copy[session.scores[String(it.id)] ?? "unknown"]}</p>
                <p className="font-semibold" lang="de" dir="ltr">{it.prompt}</p>
                <p className="text-sm" lang="de" dir="ltr"><span className="font-semibold">{copy.modelAnswer}:</span> {it.answer}</p>
                {it.source && <p className="break-words text-xs text-[var(--mp-fg-muted)]" lang="de" dir="ltr">{copy.source}: {it.source}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="mp-btn mp-btn--primary min-h-11" onClick={onAgain}>{copy.again}</button>
        <Link href={GM_QUIZ_HREF} className="mp-btn mp-btn--secondary min-h-11">{copy.mcq}</Link>
      </div>
    </section>
  );
}
