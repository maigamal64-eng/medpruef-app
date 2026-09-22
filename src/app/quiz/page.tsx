"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandedLoader } from "@/components/Logo";
// Auth-aware fetch wrapper: adds the x-user-id header that server
// routes expect under the 2026-04-15 auth-guard regime. Import alias
// means the existing `fetch(...)` call sites in this file don't need
// to be rewritten — they automatically get the header.
import { authFetch as fetch } from "@/lib/authFetch";
import { shouldIgnoreGlobalKey } from "@/lib/keyboard-guard";
import Link from "next/link";
import { t, getLang, setLang } from "@/lib/i18n";
import { trackEvent, trackPageView } from "@/lib/tracker";
import { getStoredSession, storeSession } from "@/lib/auth";
import { getPaywallCopy } from "@/lib/paywall-copy";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { recordAnswer } from "@/lib/weakness";
import { Inbox, Trophy, Sparkles, Gift } from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import QuestionCard from "@/components/QuestionCard";
import QuestionActions from "@/components/QuestionActions";
import { QuizTopBar, QuizFooterAction, type QuizFooterMode } from "@/components/QuizChrome";
import QuizSetup, { type QuizConfig } from "@/components/QuizSetup";
import CreateTestBuilder from "@/components/CreateTestBuilder";
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

// ─── Quiz session trail (resume after reload / break) ───────────────────
const QUIZ_SESSION_KEY = "medpruef_quiz_session_v2";
const QUIZ_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const QUIZ_SESSION_MAX_TRAIL = 400;

interface SavedQuizSession {
  v: 2;
  savedAt: number;
  examSource: string;
  topics: string[];
  targetCount: number;
  answered: Array<{ id: number; correct: boolean }>;
}

/** Only sessions for the SAME exam source + topic filter and fresher than
 * the TTL are resumable. Anything malformed fails closed to null. */
function loadSavedQuizSession(config: QuizConfig): SavedQuizSession | null {
  try {
    const raw = localStorage.getItem(QUIZ_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedQuizSession;
    if (!s || s.v !== 2 || !Array.isArray(s.answered) || s.answered.length === 0) return null;
    if (s.examSource !== config.examSource) return null;
    const sameTopics =
      JSON.stringify((s.topics ?? []).slice().sort()) ===
      JSON.stringify((config.topics ?? []).slice().sort());
    if (!sameTopics) return null;
    if (Date.now() - (s.savedAt ?? 0) > QUIZ_SESSION_TTL_MS) return null;
    return s;
  } catch {
    return null;
  }
}

function clearSavedQuizSession(): void {
  try {
    localStorage.removeItem(QUIZ_SESSION_KEY);
  } catch {
    /* non-fatal */
  }
}

function saveQuizSessionNow(config: QuizConfig | null, trail: Array<{ id: number; correct: boolean }>): void {
  if (!config) return;
  try {
    const payload: SavedQuizSession = {
      v: 2,
      savedAt: Date.now(),
      examSource: config.examSource,
      topics: config.topics ?? [],
      targetCount: config.targetCount,
      answered: trail.slice(-QUIZ_SESSION_MAX_TRAIL),
    };
    localStorage.setItem(QUIZ_SESSION_KEY, JSON.stringify(payload));
  } catch {
    /* non-fatal */
  }
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

  // Phase C filter: builder-set filter takes precedence over URL practiceMode.
  // Mapping: all=default, unused→practiceMode=unseen, incorrect→practiceMode=wrong,
  // flagged→pass bookmark ids as the ids param (no practiceMode change).
  if (config.filter && config.filter !== "all") {
    if (config.filter === "unused") {
      p.set("practiceMode", "unseen");
    } else if (config.filter === "incorrect") {
      p.set("practiceMode", "wrong");
    } else if (config.filter === "flagged" && config.flaggedIds && config.flaggedIds.length > 0) {
      // Serve only flagged IDs, minus already-seen ones in this session.
      const unseenFlagged = config.flaggedIds.filter(
        (id) => !(excludeIds ?? []).includes(id)
      );
      if (unseenFlagged.length > 0) {
        p.set("ids", unseenFlagged.join(","));
        // Clear the practiceMode param if set to avoid conflicting server logic.
        p.delete("practiceMode");
      }
      // If all flagged Qs are already seen, the `ids` param stays unset and the
      // quiz runner will naturally return null (no more questions in the pool).
    }
  } else if (practiceMode && practiceMode !== "all") {
    // Fallback to URL-level practiceMode for non-builder paths.
    p.set("practiceMode", practiceMode);
  }

  // Phase C: exam-year tag filter (YYYY, expands to all 12 months server-side).
  if (config.examYear) p.set("examYear", config.examYear);

  return p;
}

function QuizContent() {
  const router = useRouter();
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
  // Tier + role: sourced live from /api/auth/me via useUserTier so that
  // server-side Pro grants (e.g. admin grant_pro) are reflected without
  // requiring a full logout/login cycle. This fixed Obai's AI-card still
  // showing "Pro required" after the session-invalidate fix in PR #10
  // landed — quiz/page.tsx was the last surface still reading stale tier
  // from the session blob. useUserTier seeds from localStorage for the
  // initial paint (no flash) then updates within milliseconds.
  const { tier: tierLive, role: roleLive } = useUserTier();
  // Keep legacy setUserTier / setUserRole writeable for the paramId
  // branch (userId from URL) which shouldn't override the live hook.
  const userTier = tierLive;
  const userRole = roleLive;
  const [lang, setLangState] = useState<Lang>("de");
  const [config, setConfig] = useState<QuizConfig | null>(null);

  // KAF recall-first training (2026-07-03): only offered for the
  // Kenntnisprüfung (the real exam asks open short-answer questions);
  // persisted so the choice sticks across sessions.
  const [kafMode, setKafMode] = useState(false);
  // UX-1 (2026-07-04): first-run KAF explainer. Shown the first time a user
  // turns KAF on (or opens it via the "?"), so the mode is introduced instead
  // of appearing as an unexplained toggle.
  const [kafIntroOpen, setKafIntroOpen] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setKafMode(localStorage.getItem("medpruef-kaf-mode") === "1");
    }
  }, []);
  const toggleKafMode = () => {
    setKafMode((v) => {
      const next = !v;
      try {
        localStorage.setItem("medpruef-kaf-mode", next ? "1" : "0");
        // On the FIRST activation ever, introduce the mode.
        if (next && localStorage.getItem("medpruef-kaf-introduced") !== "1") {
          localStorage.setItem("medpruef-kaf-introduced", "1");
          setKafIntroOpen(true);
        }
      } catch { /* noop */ }
      return next;
    });
  };
  const kafEligible = examSource === "kenntnispruefung";

  // Quiz state
  const seenIdsRef = useRef<number[]>([]);
  // ── Quiz session trail (2026-09-20, customer feedback: progress reset) ──
  // /quiz streams one question at a time and kept NO state across reloads,
  // so a deploy-triggered service-worker reload, a mobile tab eviction or a
  // simple break restarted the quiz from question 1 (verified in Munir's
  // answer_history: the same spaced-rep batch answered twice in identical
  // order 35 minutes apart). The trail persists per-answer and seeds a
  // resume offer on return.
  const answeredTrailRef = useRef<Array<{ id: number; correct: boolean }>>([]);
  const resumeDecidedRef = useRef(false);
  const [resumeOffer, setResumeOffer] = useState<SavedQuizSession | null>(null);
  const [resumeGate, setResumeGate] = useState<"checking" | "offered" | "cleared">("checking");
  const [question, setQuestion] = useState<Question | null>(null);
  const [nextQuestion, setNextQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(false);
  const [answered, setAnswered] = useState(false);
  // BUG-1 fix (2026-07-04): a monotonic nonce bumped on every advance(). It is
  // folded into the QuestionCard `key` so the card ALWAYS remounts fresh when we
  // move on, even if the fetched next question has the SAME id (a dedup gap in a
  // filtered / KAF pool). Without this, an identical id meant QuestionCard's
  // id-keyed reset never fired and the card stayed stuck in the answered state.
  const [advanceNonce, setAdvanceNonce] = useState(0);
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
  // Top-bar "mark for later" toggle. This is the SAME bookmark store the
  // rest of the app uses (`medpruef_favorites` — the star in QuestionActions
  // writes it, and the quiz "Gemerkte/flagged" filter in CreateTestBuilder
  // reads it via readBookmarkIds()). So marking a question from the quiz
  // top bar genuinely adds it to the set you can later drill into — it is
  // NOT a private, orphaned key. Uses a Bookmark icon (not Flag) to stay
  // distinct from QuestionActions' Flag = "report a problem".
  // UX-2 (2026-07-04): the quiz's own top-bar bookmark state was removed with
  // the duplicate button. Bookmarking now lives solely in the QuestionActions
  // star (medpruef_favorites), present on both the mobile row and desktop rail.

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
      // tier + role are now sourced from useUserTier() (live /api/auth/me)
      // rather than from the stale session blob, so we don't set them here.
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
    // Phase C: exam year narrows the pool — reflect in the milestone count.
    if (config.examYear) p.set("examYear", config.examYear);
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
  // ── Resume offer check: runs once per config identity, BEFORE the initial
  // fetch (the initial-load effect below stays gated until this resolves).
  // resumeDecidedRef: once the user picked (resume/fresh), later config
  // identity changes (e.g. the targetCount restore in resumeSession) must
  // not re-offer the same session.
  useEffect(() => {
    if (!config) return;
    if (resumeDecidedRef.current) {
      setResumeGate("cleared");
      return;
    }
    // Study now explicitly means unseen questions. Do not let the generic
    // resume trail override that choice; the separate Continue card remains
    // the deliberate resume entry point.
    const s = initialQuestionId || practiceMode === "unseen"
      ? null
      : loadSavedQuizSession(config);
    if (s) {
      setResumeOffer(s);
      setResumeGate("offered");
    } else {
      setResumeGate("cleared");
    }
  }, [config, initialQuestionId, practiceMode]);

  const resumeSession = useCallback(() => {
    if (!resumeOffer || !config) return;
    resumeDecidedRef.current = true;
    seenIdsRef.current = resumeOffer.answered.map((a) => a.id);
    answeredTrailRef.current = resumeOffer.answered.slice();
    setQuestionCount(resumeOffer.answered.length);
    setCorrectCount(resumeOffer.answered.filter((a) => a.correct).length);
    setSessionHistory(resumeOffer.answered.map((a) => ({ correct: a.correct })));
    const target = resumeOffer.targetCount ?? config.targetCount;
    if (resumeOffer.answered.length >= target) {
      // The saved session already reached its goal — show the terminal card.
      clearSavedQuizSession();
      setResumeOffer(null);
      setResumeGate("cleared");
      setQuizFinished(true);
      return;
    }
    if (target !== config.targetCount) setConfig({ ...config, targetCount: target });
    setResumeOffer(null);
    setResumeGate("cleared");
    // The initial-load effect now fires with seeded excludeIds and serves
    // the next FRESH question — the learner continues, not restarts.
  }, [resumeOffer, config]);

  const startFresh = useCallback(() => {
    resumeDecidedRef.current = true;
    clearSavedQuizSession();
    answeredTrailRef.current = [];
    setResumeOffer(null);
    setResumeGate("cleared");
  }, []);

  // Initial question load (or specific id from search deep-link)
  useEffect(() => {
    if (!config || question || quizFinished || resumeGate !== "cleared") return;
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
    // resumeGate IS load-bearing here: the gate starts "checking" while the
    // resume offer is evaluated and only flips to "cleared" after config is
    // set. Without it in deps this effect would never re-run post-flip and
    // the first question would never load (the 09-20 no-questions outage).
  }, [config, fetchQuestion, initialQuestionId, question, quizFinished, resumeGate]);

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

  // Clear the saved trail once the run is over (finished or timed out) so a
  // finished session is never offered again.
  useEffect(() => {
    if (quizFinished) clearSavedQuizSession();
  }, [quizFinished]);

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
    // Bump the nonce so QuestionCard remounts fresh even on a same-id repeat.
    setAdvanceNonce((n) => n + 1);
    setAnswered(false);
    setXpEarned(null);
    setShowXpFloat(false);
    setStartTime(Date.now());
  }, [nextQuestion, fetchQuestion, questionCount, config]);

  // ─── Keyboard: N / → for next ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Use shared keyboard guard — covers typing in inputs/textareas
      // AND any key inside a dialog overlay. Closes the regression
      // where typing "n" in the FeedbackWidget while on /quiz would
      // advance to the next question and close the dialog
      // (review-2026-04-26-A1).
      if (shouldIgnoreGlobalKey(e)) return;
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
    async (isCorrect: boolean, selectedIndexes: number[] = []) => {
      if (!question || answered) return;
      setAnswered(true);
      const newCount = questionCount + 1;
      setQuestionCount(newCount);
      if (isCorrect) setCorrectCount((c) => c + 1);
      setSessionHistory((prev) => [...prev, { correct: isCorrect }]);
      recordAnswer(question.topic, isCorrect);
      // Persist the answered trail so a reload/break resumes instead of
      // restarting from question 1 (the exact bug Munir reported).
      answeredTrailRef.current.push({ id: question.id, correct: isCorrect });
      saveQuizSessionNow(config, answeredTrailRef.current);
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
            userAnswer: selectedIndexes
              .map((index) => question.options?.[index]?.text)
              .filter((text): text is string => Boolean(text))
              .join(" | ") || "",
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
            userAnswer: selectedIndexes
              .map((index) => question.options?.[index]?.text)
              .filter((text): text is string => Boolean(text))
              .join(" | ") || null,
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
    answeredTrailRef.current = [];
    seenIdsRef.current = [];
    setConfig(null); // back to setup
  };

  const sessionAccuracy = questionCount > 0 ? Math.round((correctCount / questionCount) * 100) : 0;

  // ─── Setup screen ───
  // ?setup=1 → CreateTestBuilder (Phase C full customization flow).
  // Legacy QuizSetup is kept for backward compat; it's no longer reachable
  // via the normal ?setup=1 path but remains importable for any future use.
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
          {wantsSetup ? (
            // Phase C: full builder with mode/filter/year/name customization.
            <CreateTestBuilder
              lang={lang}
              examSource={examSource}
              onStart={(c) => {
                // Timed mode routes to /exam (the existing deferred-grading
                // simulator) rather than the tutor quiz player. Carry over
                // the topic / count / filter state as URL params.
                if (c.quizMode === "timed") {
                  const p = new URLSearchParams({ examSource: c.examSource });
                  if (c.topics.length > 0) p.set("topics", c.topics.join(","));
                  if (c.targetCount && c.targetCount < 9999)
                    p.set("limit", String(c.targetCount));
                  if (c.filter && c.filter !== "all")
                    p.set("practiceMode",
                      c.filter === "unused"    ? "unseen"
                      : c.filter === "incorrect" ? "wrong"
                      : "all"
                    );
                  if (c.filter === "flagged" && c.flaggedIds && c.flaggedIds.length > 0)
                    p.set("ids", c.flaggedIds.join(","));
                  if (c.examYear) p.set("examYear", c.examYear);
                  if (c.timeLimitMin) p.set("timeLimitMin", String(c.timeLimitMin));
                  router.push(`/exam?${p.toString()}`);
                  return;
                }
                setConfig(c);
              }}
              onCancel={() => window.history.back()}
            />
          ) : (
            // Fallback: minimal QuizSetup (topic + count + time) for
            // legacy entry points that land on the setup screen without ?setup=1.
            <QuizSetup
              lang={lang}
              examSource={examSource}
              initialTopic={initialTopic}
              onStart={(c) => setConfig(c)}
            />
          )}
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
        {/* ── Distraction-free quiz top bar (approved 02-quiz design) ──
            Close → home/setup · mono progress counter with teal current-
            index · optional timer · flag. Theme/lang toggles deliberately
            do NOT live on this focus surface. The fill is the one blessed
            decorative spark here (viridian→teal + glow). */}
        <QuizTopBar
          lang={lang}
          current={Math.min(
            questionCount + (answered ? 0 : 1),
            autoStarted && topicTotal > 0 ? topicTotal : config.targetCount,
          )}
          total={autoStarted && topicTotal > 0 ? topicTotal : config.targetCount}
          progressPct={progressPct}
          timeLabel={
            timeRemaining !== null
              ? `${Math.floor(timeRemaining / 60)}:${String(timeRemaining % 60).padStart(2, "0")}`
              : null
          }
          timeUrgent={timeRemaining !== null && timeRemaining < 60}
          onClose={() => {
            if (autoStarted) router.push("/");
            else restart();
          }}
        />
        {/* UX-2 (2026-07-04): the top-bar bookmark was removed as a duplicate of
            the QuestionActions star (both wrote medpruef_favorites). The star,
            grouped with the other per-question actions, is now the single
            bookmark on both mobile and desktop. */}

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
                    ? "Deine Antworten werden gespeichert und automatisch synchronisiert, sobald du wieder online bist."
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
              ) : resumeGate === "offered" && resumeOffer ? (
                // Resume prompt: a saved session for this exam + filter exists.
                <div className="card p-5 mb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--mp-fg)] text-sm mb-0.5">
                        {lang === "de" ? "Sitzung fortsetzen?" : "Resume your session?"}
                      </p>
                      <p className="text-xs text-[var(--mp-fg-subtle)]">
                        {resumeOffer.answered.length}{" "}
                        {lang === "de"
                          ? "Fragen in dieser Sitzung bereits beantwortet. Du machst dort weiter, wo du aufgehört hast."
                          : "questions already answered in this session. You continue where you left off."}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={resumeSession} className="mp-btn mp-btn--primary text-sm">
                        {lang === "de" ? "Fortsetzen" : "Resume"}
                      </button>
                      <button onClick={startFresh} className="mp-btn mp-btn--secondary text-sm">
                        {lang === "de" ? "Neu starten" : "Start fresh"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : loading || resumeGate === "checking" ? (
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
                  {/* KAF recall-first toggle: KP only (the real exam asks open
                      short-answer questions). Persisted in localStorage. */}
                  {kafEligible && (
                    <div className="flex items-center justify-end gap-1.5 mb-2">
                      <button
                        onClick={toggleKafMode}
                        role="switch"
                        aria-checked={kafMode}
                        title={t("kaf_toggle_hint", lang)}
                        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                          kafMode
                            ? "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)]"
                            : "border-[var(--mp-border)] text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)]"
                        }`}
                      >
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            kafMode ? "bg-[var(--mp-viridian)]" : "bg-[var(--mp-border-strong)]"
                          }`}
                        />
                        {t("kaf_toggle", lang)}
                      </button>
                      <button
                        onClick={() => setKafIntroOpen(true)}
                        aria-label={t("kaf_intro_title", lang)}
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--mp-border)] text-[11px] font-bold text-[var(--mp-fg-subtle)] hover:text-[var(--mp-viridian)] hover:border-[var(--mp-viridian)] transition-colors"
                      >
                        ?
                      </button>
                    </div>
                  )}
                  {kafIntroOpen && (
                    <div
                      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-4"
                      onClick={() => setKafIntroOpen(false)}
                      role="dialog"
                      aria-modal="true"
                    >
                      <div
                        className="mp-card w-full max-w-md rounded-2xl p-5 bg-[var(--mp-surface-raised)] border border-[var(--mp-border)]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] text-sm font-bold">
                            KAF
                          </span>
                          <div>
                            <h3 className="mp-h3 text-[16px] text-[var(--mp-fg)]">{t("kaf_intro_title", lang)}</h3>
                            <p className="mt-1.5 text-sm leading-relaxed text-[var(--mp-fg-muted)]">
                              {t("kaf_hint", lang)}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setKafIntroOpen(false)}
                          className="btn-primary mt-4 w-full rounded-xl py-2.5 text-sm font-semibold"
                        >
                          {t("kaf_intro_ok", lang)}
                        </button>
                      </div>
                    </div>
                  )}
                  <QuestionCard
                    key={`q-${question.id}-${advanceNonce}`}
                    question={question}
                    questionNumber={questionCount + (answered ? 0 : 1)}
                    totalQuestions={autoStarted && topicTotal > 0 ? topicTotal : config.targetCount}
                    lang={lang}
                    onAnswer={handleAnswer}
                    imageUrl={question.image_url}
                    hideActions
                    recallFirst={kafEligible && kafMode}
                  />

                  {/* Mobile/tablet action row — visible on screens without side rail.
                      metaOnly: bookmark + flag only. AI + Notes live in the
                      QuestionCard ContextTabs below (FEEDBACK #4b/#4c/#4e/#6 — one
                      home per action, no duplicate/dead buttons). */}
                  <div className="xl:hidden mt-3">
                    <QuestionActions
                      question={question}
                      lang={lang}
                      userTier={userTier}
                      userRole={userRole}
                      layout="row"
                      unlockAfterAnswer
                      answered={answered}
                      metaOnly
                    />
                  </div>

                  {/* ── Footer action — one full-width, state-swapping primary
                      (approved 02-quiz design). After grading: CTA-blue
                      "Nächste Frage" / "Quiz beenden". Before grading on a
                      single-select question: a calm disabled "Antwort prüfen"
                      affordance (picking an option IS the check). Multi-select
                      keeps its own in-card check button, so we suppress the
                      pre-answer footer there to avoid a double prüfen. ── */}
                  {(() => {
                    const nCorrect = (question.options ?? []).filter((o) => o.correct).length;
                    const isMulti = nCorrect >= 2;
                    const isFinish = questionCount >= config.targetCount;
                    let mode: QuizFooterMode | null = null;
                    if (answered) mode = isFinish ? "finish" : "next";
                    else if (!isMulti && (question.options ?? []).length >= 2) mode = "locked";
                    if (!mode) return null;
                    return (
                      <div className="mt-4 space-y-2 animate-fade-in">
                        <QuizFooterAction
                          lang={lang}
                          mode={mode}
                          onPress={advance}
                        />
                        {answered && (
                          <p className="text-[10px] text-[var(--mp-fg-subtle)] text-center">
                            {lang === "de" ? "Drücke" : "Press"}{" "}
                            <kbd className="px-1.5 py-0.5 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded text-[10px] font-mono">N</kbd>{" "}
                            {lang === "de" ? "für die nächste Frage" : "for the next question"}
                          </p>
                        )}
                      </div>
                    );
                  })()}

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
                  metaOnly
                />
              </aside>
            )}
          </div>
        </div>

        {/* Login prompt for unauthenticated users */}
        {!userId && !quizFinished && (
          <p className="px-4 pb-2 text-center text-xs text-[var(--mp-fg-subtle)]">
            {lang === "de"
              ? "Nicht angemeldet, Fortschritt wird nicht gespeichert"
              : "Not signed in: progress will not be saved"}
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
            ? `Free-Kontingent verbraucht: 150/150 Fragen gesehen`
            : `Free tier complete: 150/150 questions seen`
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
              ? "Upgrade schaltet über 10.000 Fragen, Spaced-Repetition-Wiederholung, Prüfungssimulation, Bookmarks und die Pass-Until-You-Pass-Garantie der Prüfungs-Kohorte frei."
              : "Upgrade unlocks over 10,000 questions, spaced-repetition review, mock exam, bookmarks, and the Pass-Until-You-Pass guarantee on the Exam Cohort."}
          </p>
          <Alert variant="info">
            {lang === "de"
              ? "Wechsle zu einer anderen Prüfung, um weitere 150 kostenlose Fragen zu bekommen, klicke auf den Prüfungswechsler oben links."
              : "Switch to a different exam for another 150 free questions: use the exam switcher in the top-left sidebar."}
          </Alert>
          {paywall?.kind === "qbank_limit" && (
            // Subtle, factual — must not compete with the upgrade CTA above.
            <p className="text-xs text-[var(--mp-fg-subtle)] leading-snug">
              {getPaywallCopy({ lang }).secondAccountNote}
            </p>
          )}
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
  // Invite-only gate (2026-06-25): suppress the share chip for accounts
  // not enrolled in the referral program.
  const { referralsEnabled } = useUserTier();

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
  if (!referralsEnabled) return null;

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
        style={{ background: "var(--mp-viridian)", color: "white" }}
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
            ? "Teile deinen Empfehlungscode: wenn zwei Kolleg:innen den Pro-Trial starten (0 € heute, danach 19 €/Monat) und aktiv üben, bekommst du Pro kostenlos durchs Prüfungsfenster."
            : "Share your referral code: once two colleagues start the Pro trial (0 € today, then 19 €/month) and are actively practising, you get Pro free through the exam window."}
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
