"use client";

/**
 * /exam/kaf: timed KAF (Kurzantwortfragen) practice for SIP (a24, readiness
 * SIM-04 / CNT-14, pick-kaf-pool = build, [name] 2026-10-12).
 *
 * Dark behind KAF_TIMED_ENABLED (the pool route answers 404 while it is off,
 * and the page shows a calm unavailable state). Only rows that passed two
 * Medic reads are served. Flow: entry, running (focus shell, stem and free
 * text only, wall-clock timer that survives reload), self-marking against the
 * reviewed model answers (fetched only after submit), result (self-marked,
 * labelled practice, no pass or fail word), then POST /api/history/exams with
 * kind "kaf". The finished run stays in an own local outbox until the server
 * acknowledges it; nothing here touches the /exam autosave keys.
 */

import { useCallback, useEffect, useRef, useState } from "react";
// authFetch sends the signed x-session-token on every /api call.
import { authFetch as fetch } from "@/lib/authFetch";
import { useLang } from "@/lib/i18n";
import { kafCopy, kafFormatLang } from "@/lib/i18n-kaf";
import { getStoredSession, hasProAccess } from "@/lib/auth";
import { useSignedInRoute } from "@/lib/hooks/useSignedInRoute";
import { AppLayout } from "@/components/ui";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { createFinaliseGuard } from "@/lib/practice-exam-state";
import { remainingSeconds } from "@/lib/examSession";
import {
  cleanTyped, countChoices, kafHistoryBody, parseKafKeys, KAF_DEFAULT_COUNT, KAF_DURATION_S, KAF_MAX_REQUIRED,
  type KafItem, type KafSession,
} from "@/lib/kaf-run";
import { KafEntry, type KafPoolState } from "@/components/exam-kaf/KafEntry";
import { KafRunner } from "@/components/exam-kaf/KafRunner";
import { KafMarking, type KafKeysState } from "@/components/exam-kaf/KafMarking";
import { KafResult, type KafSaveState } from "@/components/exam-kaf/KafResult";
import {
  acknowledgePendingKaf, clearKafSession, loadKafSession, loadPendingKaf, saveKafSession, savePendingKaf,
} from "@/components/exam-kaf/storage";

type View = "entry" | "running" | "marking" | "result";

function toItems(raw: unknown): KafItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const o = r as Record<string, unknown>;
    const id = Number(o?.id);
    const required = Number(o?.required);
    if (!Number.isInteger(id) || id <= 0 || typeof o.stem !== "string" || !o.stem.trim()) return [];
    return [{
      id,
      topic: typeof o.topic === "string" ? o.topic : "",
      stem: o.stem,
      image_url: typeof o.image_url === "string" && o.image_url ? o.image_url : null,
      required: Number.isInteger(required) && required >= 1 && required <= KAF_MAX_REQUIRED ? required : 1,
    }];
  });
}

const answeredCount = (s: KafSession) => s.items.filter((it) => cleanTyped(s.answers[String(it.id)], it.required).length > 0).length;

export default function KafPracticePage() {
  const signedIn = useSignedInRoute();
  const lang = useLang();
  const copy = kafCopy(lang);
  const formatLang = kafFormatLang(lang);
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [view, setView] = useState<View>("entry");
  const [session, setSession] = useState<KafSession | null>(null);
  const [resumable, setResumable] = useState<KafSession | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [poolState, setPoolState] = useState<KafPoolState>("loading");
  const [poolCount, setPoolCount] = useState(0);
  const [poolRetry, setPoolRetry] = useState(0);
  const [count, setCount] = useState<number>(KAF_DEFAULT_COUNT);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(false);
  const [online, setOnline] = useState(true);
  const [autosaveFailed, setAutosaveFailed] = useState(false);
  const [keysState, setKeysState] = useState<KafKeysState>("loading");
  const [keysRetry, setKeysRetry] = useState(0);
  const [saveState, setSaveState] = useState<KafSaveState>("idle");
  const [saveRetry, setSaveRetry] = useState(0);
  const [authExpired, setAuthExpired] = useState(false);
  const finalise = useRef(createFinaliseGuard());
  const saveInFlight = useRef(new Set<string>());
  const recoveredPending = useRef(false);

  // Identity and Pro gate (the routes enforce both again server side).
  useEffect(() => {
    if (!signedIn) return;
    const stored = getStoredSession();
    if (!stored?.user?.id) return;
    setUserId(stored.user.id);
    setUserName(stored.user.first_name ?? "");
    if (!hasProAccess(stored)) setPoolState("pro");
  }, [signedIn]);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);

  // Local state on load: an unsaved finished run opens its result (as /exam
  // does); an unfinished run is offered for resume.
  useEffect(() => {
    if (!userId || view !== "entry") return;
    const pending = loadPendingKaf(userId);
    setPendingCount(pending.length);
    setResumable(loadKafSession(userId));
    if (!recoveredPending.current && pending[0]) {
      recoveredPending.current = true;
      openResult(pending[0]);
    }
  }, [userId, view]);

  // Pool size for the entry card.
  useEffect(() => {
    if (!userId || poolState === "pro") return;
    let alive = true;
    setPoolState("loading");
    void (async () => {
      try {
        const res = await fetch("/api/exam/kaf-pool?countOnly=1", { skipAuthRedirect: true });
        if (!alive) return;
        if (res.status === 403) { setPoolState("pro"); return; }
        if (res.status === 404 || res.status === 503) { setPoolState("unavailable"); return; }
        if (!res.ok) throw new Error(`pool ${res.status}`);
        const data = (await res.json()) as { count?: unknown };
        const n = typeof data.count === "number" && data.count > 0 ? data.count : 0;
        setPoolCount(n);
        const choices = countChoices(n);
        setCount((c) => (choices.includes(c) ? c : choices[Math.min(1, choices.length - 1)] ?? 0));
        setPoolState(n > 0 ? "ready" : "unavailable");
      } catch {
        if (alive) setPoolState("error");
      }
    })();
    return () => { alive = false; };
    // poolState is read only to skip the Pro gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, poolRetry]);

  // Autosave the run while it is running or being marked.
  useEffect(() => {
    if (!userId || !session || (view !== "running" && view !== "marking")) return;
    setAutosaveFailed(!saveKafSession(userId, { ...session, phase: view }));
  }, [userId, session, view]);

  const startRun = async () => {
    if (starting || !userId) return;
    setStarting(true);
    setStartError(false);
    try {
      const res = await fetch(`/api/exam/kaf-pool?limit=${encodeURIComponent(String(count))}`, { skipAuthRedirect: true });
      if (res.status === 403) { setPoolState("pro"); return; }
      if (res.status === 404 || res.status === 503) { setPoolState("unavailable"); return; }
      if (!res.ok) throw new Error(`pool ${res.status}`);
      const items = toItems(((await res.json()) as { items?: unknown }).items);
      if (items.length === 0) { setPoolState("unavailable"); return; }
      const next: KafSession = {
        v: 1, attemptId: crypto.randomUUID(), startedAt: Date.now(), durationS: KAF_DURATION_S,
        finishedAt: null, timeExpired: false, phase: "running", items, answers: {}, marks: {}, keys: null,
        currentIdx: 0, savedAt: Date.now(),
      };
      finalise.current.reset();
      setSession(next);
      setResumable(null);
      setView("running");
    } catch {
      setStartError(true);
    } finally {
      setStarting(false);
    }
  };

  const resumeRun = () => {
    if (!resumable) return;
    finalise.current.reset();
    setSession(resumable);
    if (resumable.phase === "marking") { setView("marking"); return; }
    if (remainingSeconds(resumable.startedAt, resumable.durationS) <= 0) {
      // The clock ran out while the learner was away: submit at the deadline.
      finalise.current.run(() => {
        setSession({ ...resumable, phase: "marking", timeExpired: true, finishedAt: resumable.startedAt + resumable.durationS * 1000 });
        setView("marking");
      });
      return;
    }
    setView("running");
  };

  const discardRun = () => {
    if (!userId || !resumable) return;
    clearKafSession(userId, resumable.attemptId);
    setResumable(null);
  };

  const onAnswer = useCallback((id: number, slot: number, text: string) => {
    setSession((s) => {
      if (!s) return s;
      const item = s.items.find((it) => it.id === id);
      if (!item || slot < 0 || slot >= item.required) return s;
      const current = [...(s.answers[String(id)] ?? [])];
      while (current.length < item.required) current.push("");
      current[slot] = text;
      return { ...s, answers: { ...s.answers, [String(id)]: current } };
    });
  }, []);

  const onNavigate = useCallback((idx: number) => {
    setSession((s) => (s && idx >= 0 && idx < s.items.length ? { ...s, currentIdx: idx } : s));
  }, []);

  const onSubmit = useCallback((expired: boolean) => {
    finalise.current.run(() => {
      setSession((s) => s && ({
        ...s,
        phase: "marking",
        timeExpired: expired,
        finishedAt: expired ? s.startedAt + s.durationS * 1000 : Date.now(),
      }));
      setView("marking");
    });
  }, []);

  const onLeave = () => {
    setResumable(session);
    setSession(null);
    setView("entry");
  };

  // Answer keys: fetched only after submit, kept with the run.
  useEffect(() => {
    if (view !== "marking" || !session) return;
    if (session.keys) { setKeysState("ready"); return; }
    let alive = true;
    setKeysState("loading");
    void (async () => {
      try {
        const ids = session.items.map((it) => it.id);
        const res = await fetch("/api/exam/kaf-pool/answers", {
          method: "POST",
          skipAuthRedirect: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) throw new Error(`answers ${res.status}`);
        const keys = parseKafKeys(await res.json(), ids);
        if (!alive) return;
        setSession((s) => (s && s.attemptId === session.attemptId ? { ...s, keys } : s));
        setKeysState("ready");
      } catch {
        if (alive) setKeysState("error");
      }
    })();
    return () => { alive = false; };
    // Refetch only on a phase change or an explicit retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, session?.attemptId, keysRetry]);

  const onMark = useCallback((id: number, right: boolean) => {
    setSession((s) => (s ? { ...s, marks: { ...s.marks, [String(id)]: right } } : s));
  }, []);

  function openResult(finished: KafSession) {
    setSession(finished);
    setSaveState("idle");
    setAuthExpired(false);
    setView("result");
    setSaveRetry((n) => n + 1);
  }

  const onFinish = () => {
    if (!userId || !session) return;
    const finished: KafSession = { ...session, phase: "result", finishedAt: session.finishedAt ?? Date.now() };
    // Outbox first; the in-progress copy goes only once the outbox holds the run.
    if (savePendingKaf(userId, finished)) clearKafSession(userId, finished.attemptId);
    else setAutosaveFailed(true);
    setPendingCount(loadPendingKaf(userId).length);
    openResult(finished);
  };

  // History save with retry; the local copy stays until acknowledged.
  useEffect(() => {
    if (view !== "result" || !session || !userId || saveState === "saved" || saveState === "rejected") return;
    const attemptId = session.attemptId;
    if (saveInFlight.current.has(attemptId)) return;
    saveInFlight.current.add(attemptId);
    setSaveState("saving");
    const body = kafHistoryBody({
      attemptId, title: copy.historyTitle, items: session.items, answers: session.answers, marks: session.marks,
      startedAt: session.startedAt, finishedAt: session.finishedAt ?? Date.now(), durationS: session.durationS, timeExpired: session.timeExpired,
    });
    void (async () => {
      try {
        const res = await fetch("/api/history/exams", {
          method: "POST",
          skipAuthRedirect: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 401) { setAuthExpired(true); throw new Error("auth"); }
        // 400/402/403 are final (pool changed, access lapsed, mode off): keep the
        // local copy until the learner discards it.
        if (res.status === 400 || res.status === 402 || res.status === 403) { setSaveState("rejected"); return; }
        if (!res.ok) throw new Error(`history ${res.status}`);
        const data = (await res.json()) as { attempt?: { id?: string; attempt_id?: string } };
        if (!data?.attempt?.id || data.attempt.attempt_id !== attemptId) throw new Error("not acknowledged");
        acknowledgePendingKaf(userId, attemptId);
        clearKafSession(userId, attemptId);
        setPendingCount(loadPendingKaf(userId).length);
        setAuthExpired(false);
        setSaveState("saved");
      } catch {
        setSaveState("failed");
      } finally {
        saveInFlight.current.delete(attemptId);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, saveRetry]);

  useEffect(() => {
    if (view !== "result" || saveState !== "failed") return;
    const retry = () => { if (navigator.onLine) setSaveRetry((n) => n + 1); };
    const timer = setTimeout(retry, Math.min(60_000, 5_000 * 2 ** Math.min(saveRetry, 4)));
    window.addEventListener("online", retry);
    window.addEventListener("pageshow", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", retry);
      window.removeEventListener("pageshow", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [view, saveState, saveRetry]);

  const discardResult = () => {
    if (userId && session) {
      acknowledgePendingKaf(userId, session.attemptId);
      clearKafSession(userId, session.attemptId);
      setPendingCount(loadPendingKaf(userId).length);
    }
    setSession(null);
    setSaveState("idle");
    setView("entry");
  };

  const newRun = () => {
    setSession(null);
    setSaveState("idle");
    setView("entry");
  };

  if (!signedIn || !userId) return null;

  if (view === "running" && session) {
    return (
      <KafRunner copy={copy} session={session} online={online} autosaveFailed={autosaveFailed}
        onAnswer={onAnswer} onNavigate={onNavigate} onSubmit={onSubmit} onLeave={onLeave} />
    );
  }
  if (view === "marking" && session) {
    return (
      <KafMarking copy={copy} session={session} keysState={keysState}
        onRetryKeys={() => setKeysRetry((n) => n + 1)} onMark={onMark} onFinish={onFinish} />
    );
  }

  return (
    <AppLayout sidebar={<Sidebar lang={lang} userId={userId} userName={userName} />} bottomNav={<BottomNav lang={lang} userId={userId} />}>
      <main id="main" className="main-content flex-1 pb-24 lg:pb-8">
        {view === "result" && session ? (
          <KafResult copy={copy} session={session} saveState={saveState} authExpired={authExpired}
            onRetrySave={() => setSaveRetry((n) => n + 1)} onDiscard={discardResult} onNewRun={newRun} />
        ) : (
          <KafEntry
            copy={copy}
            formatLang={formatLang}
            poolState={poolState}
            poolCount={poolCount}
            count={count}
            onCount={setCount}
            onStart={() => void startRun()}
            starting={starting}
            startError={startError}
            onRetry={() => { setStartError(false); setPoolRetry((n) => n + 1); }}
            resumable={resumable ? { answered: answeredCount(resumable), total: resumable.items.length } : null}
            onResume={resumeRun}
            onDiscard={discardRun}
            pendingCount={pendingCount}
            onOpenPending={() => { const p = loadPendingKaf(userId)[0]; if (p) openResult(p); }}
          />
        )}
      </main>
    </AppLayout>
  );
}
