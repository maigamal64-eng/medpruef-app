"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { BrandedLoader } from "@/components/Logo";
import { useSearchParams } from "next/navigation";
// Auth-aware fetch wrapper: adds the x-user-id header that server
// routes expect under the 2026-04-15 auth-guard regime. Import alias
// means the existing `fetch(...)` call sites in this file don't need
// to be rewritten — they automatically get the header.
import { authFetch as fetch } from "@/lib/authFetch";
import Link from "next/link";
import { t, getLang, setLang } from "@/lib/i18n";
import { trackEvent, trackPageView } from "@/lib/tracker";
import { getStoredSession, storeSession } from "@/lib/auth";
import { recordAnswer } from "@/lib/weakness";
import { Inbox, Clock, Trophy, Sparkles, Gift } from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import QuestionCard from "@/components/QuestionCard";
import QuestionActions from "@/components/QuestionActions";
import QuizSetup, { type QuizConfig } from "@/components/QuizSetup";
import { SkeletonCard } from "@/components/Skeleton";
import { Alert, Dialog, DialogFooter } from "@/components/ui";
import type { MCQOption } from "@/lib/mcq";
import {
  getAllQuestions,
  getQuestionsByTopic,
  queuePendingAnswer,
  type OfflineQuestion,
} from "@/lib/offlineDb";
import { buildMCQFromChoices, type StoredChoice } from "@/lib/mcq";
import { CloudOff } from "lucide-react";

type Lang = "de" | "en";

interface Question {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  difficulty: number;
  exam_dates: string[];
  options?: MCQOption[];
  image_url?: string;
}

function buildQueryParams(config: QuizConfig, userId: string, excludeIds?: number[], practiceMode?: string): URLSearchParams {
  const p = new URLSearchParams({ limit: "1", examSource: config.examSource });
  if (userId) p.set("userId", userId);
  if (config.topics.length === 1) p.set("topic", config.topics[0]);
  else if (config.topics.length > 1) p.set("topics", config.topics.join(","));
  if (config.tags.length > 0) p.set("tags", config.tags.join(","));
  if (config.examDateFrom) p.set("examDateFrom", config.examDateFrom);
  if (config.examDateTo) p.set("examDateTo", config.examDateTo);
  if (excludeIds && excludeIds.length > 0) {
    p.set("excludeIds", excludeIds.join(","));
  }
  if (practiceMode && practiceMode !== "all") {
    p.set("practiceMode", practiceMode);
  }
  return p;
}

function QuizContent() {
  const searchParams = useSearchParams();
  const initialTopic = searchParams.get("topic");
  const initialQuestionId = searchParams.get("questionId");
  const examSource = searchParams.get("examSource") || "kenntnispruefung";
  const practiceMode = searchParams.get("practiceMode") || "all";
  // Explicit opt-in for the customize-quiz screen. Default is auto-start so
  // topic cards, practice-mode buttons, and random-practice links go straight
  // into questions — customize is a separate, explicit flow, not the default.
  // Old links carrying `autoStart=1` still work since auto-start is default.
  const wantsSetup = searchParams.get("setup") === "1";

  const [userId, setUserId] = useState<string>("");
  // Tier surfaces client-side gates on bookmarks/notes (both Pro-only
  // as of the 2026-04-23 Lock). Populated from the stored session
  // where available; defaults to 'free' so a missing tier fails-closed.
  //
  // 2026-04-24: also track `userRole` so admin operators (whose tier
  // may be `'free'`/`null` because they never subscribed) still get
  // Pro-level access. Passed alongside `userTier` to QuestionActions
  // + QuestionCard + AIChatAssistant.
  const [userTier, setUserTier] = useState<string>("free");
  const [userRole, setUserRole] = useState<string>("user");
  const [lang, setLangState] = useState<Lang>("de");
  const [config, setConfig] = useState<QuizConfig | null>(null);

  // Quiz state
  const seenIdsRef = useRef<number[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);
  const [nextQuestion, setNextQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [questionCount, setQuestionCount] = useState(0); // answered count
  const [correctCount, setCorrectCount] = useState(0);
  const [totalXpSession, setTotalXpSession] = useState(0);
  const [xpEarned, setXpEarned] = useState<number | null>(null);
  const [showXpFloat, setShowXpFloat] = useState(false);
  const [startTime, setStartTime] = useState(Date.now());
  const [sessionHistory, setSessionHistory] = useState<Array<{ correct: boolean }>>([]);
  const [milestoneVisible, setMilestoneVisible] = useState(false);
  const [quizFinished, setQuizFinished] = useState(false);
  const [topicTotal, setTopicTotal] = useState<number>(0);

  // ─── Shortcuts hint — a one-time, dismissible rail at the bottom
  // of the quiz surface. Persisted in localStorage so we don't nag
  // returning users; hidden on mobile where on-screen actions already
  // telegraph the same affordances. ───
  const SHORTCUTS_HINT_KEY = "medpruef_quiz_shortcuts_dismissed";
  const [shortcutsHintVisible, setShortcutsHintVisible] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = localStorage.getItem(SHORTCUTS_HINT_KEY) === "1";
    if (!dismissed) setShortcutsHintVisible(true);
  }, []);
  const dismissShortcutsHint = () => {
    setShortcutsHintVisible(false);
    try { localStorage.setItem(SHORTCUTS_HINT_KEY, "1"); } catch { /* non-fatal */ }
  };

  // Time limit
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null); // seconds

  // ─── Offline mode ───
  // Tracks `navigator.onLine` so the fetch + answer paths can branch
  // to IndexedDB without touching the online flow. Also used to render
  // the inline "Offline-Modus aktiv" banner above the question.
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );

  // ─── Paywall (Lock 2026-04-23, free-tier gating) ───
  // Raised when /api/questions returns `paywallHit: true` (free user
  // exhausted their 150-question slice) or a 402 (Pro-only practice
  // mode requested — e.g. review / wrong-only).
  const [paywall, setPaywall] = useState<
    | {
        kind: "qbank_limit" | "spaced_repetition" | "wrong_only";
        seen?: number;
        limit?: number;
      }
    | null
  >(null);
  // Randomized pool of OfflineQuestion — replenished when it empties.
  // Tracks IDs we've already served this session so repeats are avoided
  // (mirrors the server-side excludeIds behavior).
  const offlinePoolRef = useRef<OfflineQuestion[]>([]);
  const offlineServedRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // ─── Init ───
  useEffect(() => {
    setLangState(getLang());
    trackPageView("quiz");
    const paramId = searchParams.get("userId") || "";
    if (paramId) {
      setUserId(paramId);
    } else {
      const session = getStoredSession();
      setUserId(session?.user?.id || "");
      setUserTier(session?.user?.tier || "free");
      setUserRole(session?.user?.role || "user");
    }
  }, [searchParams]);

  // Track whether the quiz was auto-started from a topic link (instant practice)
  // vs manually configured via the QuizSetup screen
  const [autoStarted, setAutoStarted] = useState(false);

  // DEFAULT: auto-start. Every entry to /quiz is a practice session — topic
  // cards, random-practice, practice modes (unseen/wrong/review), deep-links
  // from search results. The /api/questions route already handles spaced-rep
  // review prioritization for logged-in users under practiceMode='all', so
  // "continue where I left off in this topic" works automatically.
  //
  // OPT-IN customize: the QuizSetup screen is ONLY shown when the URL
  // explicitly carries `?setup=1`. Customize is a quiz-specific feature, not
  // the default entry gate for practice. Old links carrying `autoStart=1`
  // still work — they just hit the same default auto-start branch.
  useEffect(() => {
    if (config) return;
    if (wantsSetup) return; // Explicit opt-in to customize screen
    // Auto-start — skips QuizSetup, jumps straight into questions
    setAutoStarted(true);
    setConfig({
      topics: initialTopic && initialTopic !== "random" ? [initialTopic] : [],
      tags: [],
      targetCount: 9999,
      timeLimitMin: null,
      examDateFrom: null,
      examDateTo: null,
      examSource,
    });
  }, [wantsSetup, initialTopic, config, examSource]);

  // Once config exists, fetch total available pool size for the milestone card
  useEffect(() => {
    if (!config) return;
    const p = new URLSearchParams({ countOnly: "1", examSource: config.examSource });
    if (config.topics.length === 1) p.set("topic", config.topics[0]);
    else if (config.topics.length > 1) p.set("topics", config.topics.join(","));
    if (config.tags.length > 0) p.set("tags", config.tags.join(","));
    if (config.examDateFrom) p.set("examDateFrom", config.examDateFrom);
    if (config.examDateTo) p.set("examDateTo", config.examDateTo);
    fetch(`/api/questions?${p}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.count) setTopicTotal(d.count);
      })
      .catch(() => {});
  }, [config]);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  // ─── Offline → Question adapter ───
  // Converts an IndexedDB `OfflineQuestion` into the quiz's runtime
  // `Question` shape, including the shuffled `options` array produced
  // by `buildMCQFromChoices`. Open-answer fallbacks (no `choices`) are
  // skipped in the offline pipeline for now.
  const offlineToQuestion = useCallback(
    (q: OfflineQuestion): Question | null => {
      const storedChoices = q.choices as StoredChoice[] | null | undefined;
      if (!Array.isArray(storedChoices) || storedChoices.length < 2) {
        return null;
      }
      const options = buildMCQFromChoices(storedChoices);
      return {
        id: q.id,
        topic: q.topic,
        question: q.question,
        answer: q.answer,
        explanation: q.explanation ?? "",
        difficulty: 2,
        exam_dates: q.exam_dates ?? [],
        options: options ?? undefined,
        image_url: q.image_url ?? undefined,
      };
    },
    [],
  );

  // ─── Question fetching ───
  const fetchQuestion = useCallback(async (): Promise<Question | null> => {
    if (!config) return null;

    // Offline branch — pull from IndexedDB instead of hitting the
    // network. If the pool is empty, top it up from IDB filtered by
    // examSource + (optionally) the first selected topic. We shuffle
    // in place so each draw is a different question.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      try {
        if (offlinePoolRef.current.length === 0) {
          const exam = config.examSource;
          const topic =
            config.topics.length === 1 ? config.topics[0] : null;
          const rows: OfflineQuestion[] = topic
            ? await getQuestionsByTopic(exam, topic)
            : await getAllQuestions(exam);
          const fresh = rows.filter((r) => !offlineServedRef.current.has(r.id));
          // Fisher-Yates shuffle so each session order differs.
          for (let i = fresh.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
          }
          offlinePoolRef.current = fresh;
        }
        while (offlinePoolRef.current.length > 0) {
          const next = offlinePoolRef.current.shift()!;
          const q = offlineToQuestion(next);
          if (!q) continue;
          offlineServedRef.current.add(next.id);
          seenIdsRef.current.push(next.id);
          return q;
        }
      } catch (e) {
        console.error("[quiz] offline fetch failed", e);
      }
      return null;
    }

    try {
      const params = buildQueryParams(config, userId, seenIdsRef.current, practiceMode);
      const res = await fetch(`/api/questions?${params}`);
      // Free-tier gate: 402 → pro-only practice mode. Client can't recover,
      // only upsell.
      if (res.status === 402) {
        const body = await res.json().catch(() => ({}));
        const gate = (body?.gate as string) || "qbank_limit";
        setPaywall({
          kind:
            gate === "spaced_repetition"
              ? "spaced_repetition"
              : gate === "wrong_only"
              ? "wrong_only"
              : "qbank_limit",
        });
        return null;
      }
      const data = await res.json();
      // Free-tier gate: 200 with paywallHit → user has seen all 150.
      if (data && data.paywallHit === true) {
        setPaywall({
          kind: "qbank_limit",
          seen: typeof data.seen === "number" ? data.seen : undefined,
          limit: typeof data.limit === "number" ? data.limit : 150,
        });
        return null;
      }
      if (Array.isArray(data) && data.length > 0) {
        const q = data[0];
        if (q.id) seenIdsRef.current.push(q.id);
        return q;
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  }, [config, userId, offlineToQuestion, practiceMode]);

  // Initial question load (or specific id from search deep-link)
  useEffect(() => {
    if (!config || question || quizFinished) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      let q: Question | null = null;
      if (initialQuestionId) {
        try {
          const params = new URLSearchParams({ ids: initialQuestionId, examSource: config.examSource });
          const res = await fetch(`/api/questions?${params}`);
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) q = data[0];
        } catch {}
      }
      if (!q) q = await fetchQuestion();
      if (cancelled) return;
      setQuestion(q);
      setLoading(false);
      setStartTime(Date.now());
    })();
    return () => {
      cancelled = true;
    };
  }, [config, fetchQuestion, initialQuestionId, question, quizFinished]);

  // Preload the NEXT question as soon as the current one is answered
  useEffect(() => {
    if (!answered || nextQuestion || !config || quizFinished) return;
    let cancelled = false;
    fetchQuestion().then((q) => {
      if (!cancelled) setNextQuestion(q);
    });
    return () => {
      cancelled = true;
    };
  }, [answered, nextQuestion, fetchQuestion, config, quizFinished]);

  // ─── Time limit countdown ───
  useEffect(() => {
    if (!config?.timeLimitMin) return;
    setTimeRemaining(config.timeLimitMin * 60);
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(interval);
          setQuizFinished(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [config?.timeLimitMin]);

  // ─── Advance to next question ───
  const advance = useCallback(() => {
    if (!config) return;
    // If we've hit the target, show terminal completion card
    if (questionCount >= config.targetCount) {
      setQuizFinished(true);
      return;
    }
    if (nextQuestion) {
      setQuestion(nextQuestion);
      setNextQuestion(null);
    } else {
      // fallback: fetch synchronously if preload didn't finish
      setLoading(true);
      fetchQuestion().then((q) => {
        setQuestion(q);
        setLoading(false);
      });
    }
    setAnswered(false);
    setXpEarned(null);
    setShowXpFloat(false);
    setStartTime(Date.now());
  }, [nextQuestion, fetchQuestion, questionCount, config]);

  // ─── Keyboard: N / → for next ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === "n" || e.key === "ArrowRight") && answered && !quizFinished) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [answered, advance, quizFinished]);

  // ─── Answer handler ───
  const handleAnswer = useCallback(
    async (isCorrect: boolean) => {
      if (!question || answered) return;
      setAnswered(true);
      const newCount = questionCount + 1;
      setQuestionCount(newCount);
      if (isCorrect) setCorrectCount((c) => c + 1);
      setSessionHistory((prev) => [...prev, { correct: isCorrect }]);
      recordAnswer(question.topic, isCorrect);
      trackEvent("question_answer", {
        questionId: question.id,
        topic: question.topic,
        isCorrect,
        timeSpent: Date.now() - startTime,
        examSource: config?.examSource,
      });

      // Trigger milestone card every 20 questions (unless this is also the final)
      if (config && newCount % 20 === 0 && newCount < config.targetCount) {
        setMilestoneVisible(true);
        setTimeout(() => setMilestoneVisible(false), 8000);
      }
      // Mark finished if this answer hit the target
      if (config && newCount >= config.targetCount) {
        // Give the user a beat to see their answer feedback before showing terminal card
        setTimeout(() => setQuizFinished(true), 1200);
      }

      if (!userId) return;

      // Offline branch — queue the answer in IndexedDB. The auto-sync
      // handler in src/lib/offlineSync.ts drains the queue to
      // /api/answer when `online` fires, so XP + streak will settle as
      // soon as the network comes back.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        try {
          await queuePendingAnswer({
            questionId: question.id,
            userAnswer: question.answer,
            isCorrect,
            timeSpentMs: Date.now() - startTime,
          });
        } catch (e) {
          console.error("[quiz] queuePendingAnswer failed", e);
        }
        return;
      }

      try {
        const res = await fetch("/api/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            questionId: question.id,
            isCorrect,
            userAnswer: question.answer,
            timeSpentMs: Date.now() - startTime,
          }),
        });
        const data = await res.json();
        setXpEarned(data.xp);
        setTotalXpSession((p) => p + (data.xp || 0));
        setShowXpFloat(true);
        setTimeout(() => setShowXpFloat(false), 1500);
        // Update stored session with fresh gamification so home page reflects changes.
        // Goes through `storeSession` so the `user` blob is re-sanitized against
        // SAFE_USER_FIELDS — protects against a stale localStorage record that
        // predates the password_hash strip.
        if (data.gamification) {
          try {
            const sess = JSON.parse(localStorage.getItem('medpruef_session') || '{}');
            if (sess.gamification && sess.user) {
              storeSession({
                user: sess.user,
                gamification: { ...sess.gamification, ...data.gamification },
              });
            }
          } catch {} // non-critical
        }
      } catch (e) {
        console.error(e);
      }
    },
    [question, answered, userId, startTime, config, questionCount]
  );

  const restart = () => {
    setQuestion(null);
    setNextQuestion(null);
    setAnswered(false);
    setQuestionCount(0);
    setCorrectCount(0);
    setTotalXpSession(0);
    setSessionHistory([]);
    setQuizFinished(false);
    setMilestoneVisible(false);
    setConfig(null); // back to setup
  };

  const sessionAccuracy = questionCount > 0 ? Math.round((correctCount / questionCount) * 100) : 0;

  // ─── Setup screen ───
  if (!config) {
    return (
      <div className="app-layout">
        <Sidebar lang={lang} userId={userId} />
        <main className="main-content safe-area-top safe-area-bottom min-h-screen">
          <div className="px-4 lg:px-8 pt-4 flex items-center justify-between">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] transition-colors text-sm"
            >
              ← {t("back_home", lang)}
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageToggle lang={lang} onChange={switchLang} />
            </div>
          </div>
          <QuizSetup
            lang={lang}
            examSource={examSource}
            initialTopic={initialTopic}
            onStart={(c) => setConfig(c)}
          />
        </main>
        <BottomNav lang={lang} userId={userId} />
      </div>
    );
  }

  const progressPct = config.targetCount > 0
    ? Math.min(100, Math.round((questionCount / config.targetCount) * 100))
    : 0;

  // ─── Quiz screen ───
  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={userId} />

      <main className="main-content safe-area-top safe-area-bottom flex flex-col min-h-screen bg-[var(--mp-surface-sunken)]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-3 flex items-center justify-between flex-shrink-0 border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)]/60 backdrop-blur-sm">
          {autoStarted ? (
            <Link
              href="/"
              className="flex items-center gap-1.5 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] transition-colors text-sm"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="opacity-60">
                <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              ← {t("back_home", lang)}
            </Link>
          ) : (
            <button
              onClick={restart}
              className="flex items-center gap-1.5 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] transition-colors text-sm"
              title={lang === "de" ? "Zurück zur Konfiguration" : "Back to setup"}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="opacity-60">
                <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {lang === "de" ? "Neue Konfiguration" : "New setup"}
            </button>
          )}

          <div className="flex items-center gap-3">
            {timeRemaining !== null && (
              <div className={`flex items-center gap-1.5 text-sm font-mono font-semibold ${
                timeRemaining < 60 ? "text-[var(--mp-error)] animate-pulse" : "text-[var(--mp-fg-muted)]"
              }`}>
                <Clock className="w-4 h-4" />
                {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, "0")}
              </div>
            )}
            {questionCount > 0 && (
              <div className="flex items-center gap-1.5 text-sm font-mono">
                <span className="text-[var(--mp-accent-teal)] font-semibold">{correctCount}✓</span>
                <span className="text-[var(--mp-border)]">/</span>
                <span className="text-[var(--mp-fg-muted)]">{questionCount}</span>
              </div>
            )}
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Progress bar — precise reflection of custom quiz length */}
        <div className="px-4 lg:px-8 pt-3 pb-2 flex-shrink-0">
          <div className="flex items-center justify-between text-[10px] text-[var(--mp-fg-subtle)] mb-1.5 font-mono">
            <span>
              {questionCount} / {autoStarted && topicTotal > 0 ? topicTotal : config.targetCount} {lang === "de" ? "Fragen" : "questions"}
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 w-full bg-[var(--mp-border)] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[var(--mp-viridian)] to-[var(--mp-accent-teal)] rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Offline banner — appears when navigator.onLine === false.
            Flags that answers queue locally until reconnect. */}
        {isOffline && (
          <div className="px-4 lg:px-8 pt-1 flex-shrink-0">
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-2 px-3 py-2 rounded-lg border text-xs font-medium"
              style={{
                background: "var(--mp-warning-bg, rgba(244, 162, 97, 0.14))",
                color: "var(--mp-status-warning, #F4A261)",
                borderColor:
                  "var(--mp-warning-border, rgba(244, 162, 97, 0.35))",
              }}
            >
              <CloudOff className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0">
                <p className="font-semibold">
                  {lang === "de"
                    ? "Offline-Modus aktiv"
                    : "Offline mode active"}
                </p>
                <p className="text-[11px] opacity-90 mt-0.5">
                  {lang === "de"
                    ? "Ihre Antworten werden gespeichert und automatisch synchronisiert, sobald Sie wieder online sind."
                    : "Your answers are saved and will sync automatically when you reconnect."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Main canvas — full available width with side rails on desktop */}
        <div className="flex-1 w-full px-4 lg:px-8 py-4">
          <div className="max-w-7xl mx-auto flex gap-6 lg:gap-8 items-start relative">
            {/* Left rail (desktop only, decorative spacer + future expansion) */}
            <aside className="hidden xl:block w-16 flex-shrink-0" />

            {/* Center column — question or final completion card */}
            <div className="flex-1 min-w-0 max-w-3xl mx-auto relative">
              {/* Floating XP */}
              {showXpFloat && xpEarned !== null && (
                <div className="absolute -top-2 right-2 z-20 pointer-events-none">
                  <span className="xp-animation inline-block text-[var(--mp-status-warning)] font-bold font-mono text-2xl drop-shadow">
                    +{xpEarned} XP
                  </span>
                </div>
              )}

              {quizFinished ? (
                <FinalCompletionCard
                  lang={lang}
                  correctCount={correctCount}
                  questionCount={questionCount}
                  targetCount={config.targetCount}
                  totalXp={totalXpSession}
                  topicTotal={topicTotal}
                  onRestart={restart}
                />
              ) : loading ? (
                <div className="space-y-4">
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              ) : !question ? (
                <div className="text-center py-12">
                  <Inbox className="w-12 h-12 text-[var(--mp-fg-subtle)] mx-auto mb-4" />
                  <p className="text-[var(--mp-fg-muted)]">{t("no_questions", lang)}</p>
                </div>
              ) : (
                <>
                  <QuestionCard
                    question={question}
                    questionNumber={questionCount + (answered ? 0 : 1)}
                    totalQuestions={autoStarted && topicTotal > 0 ? topicTotal : config.targetCount}
                    lang={lang}
                    onAnswer={handleAnswer}
                    imageUrl={question.image_url}
                    hideActions
                  />

                  {/* Mobile/tablet action row — visible on screens without side rail */}
                  <div className="xl:hidden mt-3">
                    <QuestionActions
                      question={question}
                      lang={lang}
                      userTier={userTier}
                      userRole={userRole}
                      layout="row"
                      unlockAfterAnswer
                      answered={answered}
                    />
                  </div>

                  {/* Next button */}
                  {answered && (
                    <div className="mt-4 space-y-2 animate-fade-in">
                      <button
                        onClick={advance}
                        className="w-full btn-primary py-4 text-base rounded-2xl"
                      >
                        {questionCount >= config.targetCount
                          ? lang === "de"
                            ? "Quiz beenden →"
                            : "Finish quiz →"
                          : `${t("next_question", lang)} →`}
                      </button>
                      <p className="text-[10px] text-[var(--mp-fg-subtle)] text-center">
                        {lang === "de" ? "Drücke" : "Press"}{" "}
                        <kbd className="px-1.5 py-0.5 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded text-[10px] font-mono">N</kbd>{" "}
                        {lang === "de" ? "für die nächste Frage" : "for the next question"}
                      </p>
                    </div>
                  )}

                  {/* Milestone card — appears BELOW, doesn't replace the quiz */}
                  {milestoneVisible && (
                    <div className="mt-4 card rounded-2xl p-5 animate-slide-up border-l-4 border-l-[var(--mp-accent-teal)] bg-gradient-to-br from-[var(--mp-accent-teal)]/5 to-transparent">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[var(--mp-accent-teal)]/15 flex items-center justify-center flex-shrink-0">
                          <Sparkles className="w-5 h-5 text-[var(--mp-accent-teal)]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[var(--mp-fg)]">
                            {lang === "de"
                              ? `${questionCount} Fragen geschafft! Weiter so 💪`
                              : `${questionCount} questions done! Keep going 💪`}
                          </p>
                          <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
                            {lang === "de"
                              ? `${sessionAccuracy}% Genauigkeit · ${topicTotal.toLocaleString("de-DE")}+ Fragen verfügbar`
                              : `${sessionAccuracy}% accuracy · ${topicTotal.toLocaleString("en-US")}+ questions available`}
                          </p>
                        </div>
                        <button
                          onClick={() => setMilestoneVisible(false)}
                          className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] text-xs"
                          aria-label="Dismiss"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Right rail — desktop action buttons in the negative space */}
            {question && !quizFinished && (
              <aside className="hidden xl:block w-16 flex-shrink-0">
                <QuestionActions
                  question={question}
                  lang={lang}
                  userTier={userTier}
                  userRole={userRole}
                  layout="rail"
                  unlockAfterAnswer
                  answered={answered}
                />
              </aside>
            )}
          </div>
        </div>

        {/* Login prompt for unauthenticated users */}
        {!userId && !quizFinished && (
          <p className="px-4 pb-2 text-center text-xs text-[var(--mp-fg-subtle)]">
            {lang === "de"
              ? "Nicht angemeldet — Fortschritt wird nicht gespeichert"
              : "Not signed in — progress will not be saved"}
          </p>
        )}

        {/* Keyboard shortcut hint — desktop only, dismissible once. */}
        {shortcutsHintVisible && !quizFinished && question && (
          <div className="hidden md:flex items-center justify-center gap-2 px-4 pb-3 text-[11px] text-[var(--mp-fg-subtle)]">
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded text-[10px] font-mono">A</kbd>
              <span>–</span>
              <kbd className="px-1.5 py-0.5 bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded text-[10px] font-mono">E</kbd>
              <span>{lang === "de" ? "auswählen" : "select"}</span>
            </span>
            <span aria-hidden className="text-[var(--mp-border)]">·</span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded text-[10px] font-mono">N</kbd>
              <span>{lang === "de" ? "nächste" : "next"}</span>
            </span>
            <span aria-hidden className="text-[var(--mp-border)]">·</span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded text-[10px] font-mono">F</kbd>
              <span>{lang === "de" ? "lesezeichen" : "bookmark"}</span>
            </span>
            <button
              onClick={dismissShortcutsHint}
              className="ml-2 px-1.5 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] transition-colors"
              aria-label={lang === "de" ? "Tastenkürzel-Hinweis schließen" : "Dismiss shortcuts hint"}
            >
              ×
            </button>
          </div>
        )}
      </main>

      {/* ─── Free-tier paywall (Lock 2026-04-23) ─── */}
      <Dialog
        open={paywall !== null}
        onOpenChange={(open) => {
          if (!open) setPaywall(null);
        }}
        title={
          paywall?.kind === "spaced_repetition"
            ? lang === "de"
              ? "Review-Modus ist Pro"
              : "Review mode is Pro"
            : paywall?.kind === "wrong_only"
            ? lang === "de"
              ? "Falsche wiederholen ist Pro"
              : "Wrong only is Pro"
            : lang === "de"
            ? `Free-Kontingent verbraucht — 150/150 Fragen gesehen`
            : `Free tier complete — 150/150 questions seen`
        }
        description={
          paywall?.kind === "qbank_limit"
            ? lang === "de"
              ? `Du hast alle ${paywall.limit ?? 150} kostenlosen ${examSource} Fragen durchgearbeitet.`
              : `You've seen all ${paywall.limit ?? 150} free ${examSource} questions.`
            : undefined
        }
        footer={
          <DialogFooter>
            <button
              type="button"
              onClick={() => setPaywall(null)}
              className="mp-btn mp-btn--secondary"
            >
              {lang === "de" ? "Abbrechen" : "Cancel"}
            </button>
            <Link href="/pricing" className="mp-btn mp-btn--primary">
              {lang === "de" ? "Tarife ansehen" : "See plans"}
            </Link>
          </DialogFooter>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-[var(--mp-fg)]">
            {lang === "de"
              ? "Upgrade schaltet alle 10.993 Fragen, Spaced-Repetition-Wiederholung, Prüfungssimulation, Bookmarks und die Pass-Until-You-Pass-Garantie der Juni-26-Kohorte frei."
              : "Upgrade unlocks all 10,993 questions, spaced-repetition review, mock exam, bookmarks, and the Pass-Until-You-Pass guarantee on the June 26 Cohort."}
          </p>
          <Alert variant="info">
            {lang === "de"
              ? "Wechsle zu einer anderen Prüfung, um weitere 150 kostenlose Fragen zu bekommen — klicke auf den Prüfungswechsler oben links."
              : "Switch to a different exam for another 150 free questions — use the exam switcher in the top-left sidebar."}
          </Alert>
        </div>
      </Dialog>

      <BottomNav lang={lang} userId={userId} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Final completion card — replaces question card when quiz finishes
// ───────────────────────────────────────────────────────────

/**
 * Post-quiz "Teile MedPrüf" chip. Rescue-sprint §4.6 (2026-04-24):
 * a one-time, dismissible prompt at the bottom of the final-completion
 * card that asks for a share — but only when it feels earned.
 *
 * Gates:
 *   1. User answered ≥ 80% correct this session
 *   2. User has NOT yet copied their referral code (checked via
 *      /api/referrals/status — authoritative over localStorage)
 *   3. We haven't shown this chip before on this device
 *      (localStorage `medpruef_quiz_share_shown_v1`)
 *
 * Any of those failing → return null, no render.
 *
 * Analytics:
 *   - `referral_share_prompt_shown` on first render
 *   - `referral_share_prompt_clicked` when the user clicks "Teilen"
 */
function QuizSharePrompt({ lang }: { lang: Lang }) {
  const LOCAL_STORAGE_KEY = "medpruef_quiz_share_shown_v1";
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Abort if we've shown this chip before on this device. Keeps the
    // prompt from nagging users who already said "not now".
    try {
      if (localStorage.getItem(LOCAL_STORAGE_KEY) === "1") return;
    } catch {
      /* swallow quota errors */
    }

    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/referrals/status", {
          skipAuthRedirect: true,
        });
        if (!r.ok) return;
        const data = await r.json();
        // Only show if the user has NOT yet copied their code. Once
        // they've copied we assume they've started sharing already.
        if (data?.referralCodeCopiedAt) return;
        if (!cancelled) {
          setVisible(true);
          // Stamp localStorage and fire the shown event once.
          try {
            localStorage.setItem(LOCAL_STORAGE_KEY, "1");
          } catch {
            /* quota */
          }
          try {
            trackEvent("referral_share_prompt_shown", {
              source: "post_quiz",
            });
          } catch {
            /* non-critical */
          }
        }
      } catch {
        /* non-critical */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!mounted || !visible || dismissed) return null;

  const handleClick = () => {
    try {
      trackEvent("referral_share_prompt_clicked", { source: "post_quiz" });
    } catch {
      /* non-critical */
    }
  };

  return (
    <div
      className="mt-4 rounded-2xl p-3 flex items-center gap-3 bg-[var(--mp-viridian)]/10 border border-[var(--mp-viridian)]/25 animate-fade-in"
      role="region"
      aria-label={
        lang === "de"
          ? "MedPrüf mit anderen teilen"
          : "Share MedPrüf with others"
      }
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: "var(--mp-viridian)", color: "#FFFFFF" }}
        aria-hidden
      >
        <Gift className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className="text-sm font-semibold text-[var(--mp-fg)] leading-snug">
          {lang === "de"
            ? "Gute Runde! Kennst du jemanden, der auch übt?"
            : "Nice round! Know someone else prepping?"}
        </p>
        <p className="text-[11px] text-[var(--mp-fg-subtle)] mt-0.5">
          {lang === "de"
            ? "Teile deinen Empfehlungscode — wenn sie Pro werden, bekommt ihr beide einen Bonus."
            : "Share your referral code — when they go Pro, you both get a bonus."}
        </p>
      </div>
      <Link
        href="/referrals"
        onClick={handleClick}
        className="mp-btn mp-btn--primary text-xs px-3 py-1.5 flex-shrink-0"
      >
        {lang === "de" ? "Teilen" : "Share"}
      </Link>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-xs px-1 flex-shrink-0"
        aria-label={lang === "de" ? "Schließen" : "Dismiss"}
      >
        ✕
      </button>
    </div>
  );
}

function FinalCompletionCard({
  lang,
  correctCount,
  questionCount,
  targetCount,
  totalXp,
  topicTotal,
  onRestart,
}: {
  lang: Lang;
  correctCount: number;
  questionCount: number;
  targetCount: number;
  totalXp: number;
  topicTotal: number;
  onRestart: () => void;
}) {
  const accuracy = questionCount > 0 ? Math.round((correctCount / questionCount) * 100) : 0;

  // Tone-appropriate headline + subline. No red on partial-correct —
  // the accuracy number carries the fact; the copy carries the vibe.
  // Tiers: 100% celebrate, ≥80% strong, ≥60% solid, ≥40% encouraging,
  // <40% constructive. Never punitive.
  const headline = (() => {
    if (accuracy === 100) return lang === "de" ? "Perfekt!" : "Perfect!";
    if (accuracy >= 80) return lang === "de" ? "Starke Runde!" : "Strong round!";
    if (accuracy >= 60) return lang === "de" ? "Solide Runde." : "Solid round.";
    if (accuracy >= 40) return lang === "de" ? "Weiter dran." : "Keep going.";
    return lang === "de" ? "Jeder Fehler zählt als Lernen." : "Every miss counts as learning.";
  })();
  const subline = lang === "de"
    ? `${questionCount} von ${targetCount} Fragen bearbeitet`
    : `${questionCount} of ${targetCount} questions answered`;

  return (
    <div className="card rounded-3xl p-8 md:p-10 text-center animate-scale-in">
      <div className="mb-5">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--mp-viridian)]/10 border border-[var(--mp-viridian)]/30 mb-3">
          <Trophy className="w-8 h-8 text-[var(--mp-viridian)]" />
        </div>
        <h2 className="text-2xl md:text-3xl font-bold text-[var(--mp-fg)] font-display">
          {headline}
        </h2>
        <p className="text-sm text-[var(--mp-fg-subtle)] mt-1">
          {subline}
        </p>
      </div>

      {/* Accuracy ring — viridian regardless of score. The %-number is
          factual; the colour is not a judgement. */}
      <div className="mb-5">
        <div className="text-6xl md:text-7xl font-black font-display text-[var(--mp-viridian)]">
          {accuracy}%
        </div>
        <p className="text-sm text-[var(--mp-fg-subtle)] mt-1">
          {lang === "de" ? "Genauigkeit" : "Accuracy"}
        </p>
      </div>

      {totalXp > 0 && (
        <div className="inline-flex items-center gap-2 bg-[var(--mp-status-warning)]/15 text-[var(--mp-status-warning)] font-bold px-5 py-2.5 rounded-2xl mb-5">
          +{totalXp} XP {lang === "de" ? "verdient" : "earned"}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="card rounded-xl p-3 text-center">
          <p className="text-xl font-bold font-mono text-[var(--mp-fg)]">
            {correctCount}/{questionCount}
          </p>
          <p className="text-[11px] text-[var(--mp-fg-subtle)]">{lang === "de" ? "Richtig" : "Correct"}</p>
        </div>
        <div className="card rounded-xl p-3 text-center">
          <p className="text-xl font-bold font-mono text-[var(--mp-fg)]">
            {topicTotal > 0 ? `${topicTotal.toLocaleString("de-DE")}+` : "—"}
          </p>
          <p className="text-[11px] text-[var(--mp-fg-subtle)]">{lang === "de" ? "Verfügbar" : "Available"}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={onRestart} className="flex-1 btn-primary py-3 text-sm rounded-2xl">
          {lang === "de" ? "Neues Quiz starten" : "Start new quiz"}
        </button>
        <Link href="/" className="flex-1 btn-secondary py-3 text-sm rounded-2xl text-center">
          {t("back_home", lang)}
        </Link>
      </div>

      {/* Post-quiz share prompt — only appears at ≥80% accuracy AND
          when the user hasn't yet copied their referral code AND we
          haven't shown it on this device. Self-gating logic lives in
          QuizSharePrompt. Rescue-sprint §4.6. */}
      {accuracy >= 80 && <QuizSharePrompt lang={lang} />}
    </div>
  );
}

export default function QuizPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)]">
          <BrandedLoader />
        </div>
      }
    >
      <QuizContent />
    </Suspense>
  );
}
