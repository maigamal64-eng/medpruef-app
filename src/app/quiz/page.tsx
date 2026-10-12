"use client";
import PartialTranslationNote from "@/components/PartialTranslationNote";
import { referralDisclosure } from "@/lib/referral-copy";

import { stripLegacyIdentity } from "@/lib/quiz-links";
import { asPuypExamType } from "@/lib/exam-dates";
import { buildAuthHref } from "@/lib/auth-entry";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ResultCard } from "@/components/ui/ResultCard";
import { BrandedLoader } from "@/components/Logo";
// Auth-aware fetch wrapper: attaches the signed session token required by
// server-side route guards. The alias keeps all request paths authenticated.
import { authFetch as fetch } from "@/lib/authFetch";
import { studyShortcutsEnabled } from "@/lib/study-shortcuts";
import { shouldIgnoreGlobalKey } from "@/lib/keyboard-guard";
import Link from "next/link";
import { t, getLang } from "@/lib/i18n";
import { trackEvent } from "@/lib/tracker";
import { trackFunnelEvent } from "@/lib/funnel-events";
import { getStoredSession, storeSession } from "@/lib/auth";
import { useActiveExam } from "@/lib/hooks/useActiveExam";
import ExamSelector from "@/components/ExamSelector";
import ExamMismatchNotice from "@/components/ExamMismatchNotice";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { gradeSelection } from "@/lib/practice-exam-state";
import { recordAnswer } from "@/lib/weakness";
import { Inbox, Sparkles, Gift } from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import QuestionCard from "@/components/QuestionCard";
import FirstQuestionPrimer from "@/components/FirstQuestionPrimer";
import QuestionActions from "@/components/QuestionActions";
import OfflineSyncNotice from "@/components/question/OfflineSyncNotice";
import { QuizTopBar, QuizFooterAction, type QuizFooterMode } from "@/components/QuizChrome";
import QuizSetup, { type QuizConfig } from "@/components/QuizSetup";
import CreateTestBuilder from "@/components/CreateTestBuilder";
import { SkeletonCard } from "@/components/Skeleton";
import { Alert } from "@/components/ui";
import PaywallUpgradeModal from "@/components/PaywallUpgradeModal";
import { EXAM_SOURCE_IDS, type ExamSourceId } from "@/lib/topics";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import type { MCQOption } from "@/lib/mcq";
import {
  getAllQuestions,
  getQuestionsByTopic,
  queuePendingAnswer,
  type OfflineQuestion,
} from "@/lib/offlineDb";
import { buildMCQFromChoices, type StoredChoice } from "@/lib/mcq";
import { isUnscoredAnswerReveal } from "@/lib/quizAnswer";
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

// Resume keys include account, exam, mode and every question filter.
import { studyScope, readStudySession, writeStudySession, clearStudySession, getQuizAttemptStats, type SavedQuizSession, type PracticeMode, resolvePracticeMode } from "@/lib/study-session";

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
  } else if (config.filter !== "all" && practiceMode && practiceMode !== "all") {
    // Fallback to URL-level practiceMode for non-builder paths.
    p.set("practiceMode", practiceMode);
  }

  // Phase C: exam-year tag filter (YYYY, expands to all 12 months server-side).
  if (config.examYear) p.set("examYear", config.examYear);

  // UX-PRA-55: "Offene Fehler wiederholen" practises open mistakes only.
  if (p.get("practiceMode") === "wrong" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("open") === "1") {
    p.set("open", "1");
  }

  return p;
}

function QuizContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTopic = searchParams.get("topic");
  // UX-GLOBAL-30: the account preference is the single source. No hard-coded
  // default; a URL exam that disagrees never silently wins (see active-exam.ts).
  const { resolution: examResolution, switchExam } = useActiveExam(searchParams.get("examSource"));
  const examSource: string = examResolution.status === "ready" ? examResolution.exam : "";
  const examPreferenceReady = examResolution.status === "ready";
  // A topic in a link for another exam does not exist in the active exam.
  const urlExamMismatch = examResolution.status === "ready" && examResolution.urlMismatch !== null;
  // A question link for another exam cannot load in the active exam; the
  // mismatch notice offers the switch instead.
  const initialQuestionId = urlExamMismatch ? null : searchParams.get("questionId");
  const [examPickError, setExamPickError] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("unseen");
  const [modeReady, setModeReady] = useState(false);
  useEffect(() => {
    // Resolve the account before loading its saved preference. This effect is
    // declared before auth hydration below, so reading localStorage here
    // without waiting for userId would otherwise use the empty-account key.
    if (!userId) return;
    if (!examPreferenceReady) return;
    const account = userId;
    let stored: string | null = null;
    try { stored = localStorage.getItem(`medpruef-study-mode:${account}:${examSource}`); } catch {}
    const mode = resolvePracticeMode(searchParams.get("practiceMode"), stored);
    setPracticeMode(mode);
    setModeReady(true);
    try { localStorage.removeItem("medpruef_quiz_session_v2"); } catch {}
    try { localStorage.setItem(`medpruef-study-mode:${account}:${examSource}`, mode); } catch {}
  }, [searchParams, examSource, userId, examPreferenceReady]);
  // Explicit opt-in for the customize-quiz screen. Default is auto-start so
  // topic cards, practice-mode buttons, and random-practice links go straight
  // into questions — customize is a separate, explicit flow, not the default.
  // Old links carrying `autoStart=1` still work since auto-start is default.
  const wantsSetup = searchParams.get("setup") === "1";

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
  const answeredTrailRef = useRef<Array<{ id: number; correct: boolean; revealed?: boolean }>>([]);
  const resumeDecidedRef = useRef(false);
  const [resumeOffer, setResumeOffer] = useState<SavedQuizSession | null>(null);
  const [resumeGate, setResumeGate] = useState<"checking" | "offered" | "cleared">("checking");
  const [loadError, setLoadError] = useState(false);
  const [loadErrorReason, setLoadErrorReason] = useState<string | null>(null);
  const [answerQueuedOffline, setAnswerQueuedOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // True only when we entered the question player directly, without opening
  // the explicit quiz builder.
  const [autoStarted, setAutoStarted] = useState(false);
  const pendingAnswer = useRef<{ correct: boolean; selected: number[]; requestId: string } | null>(null);
  const saveInFlight = useRef(false);
  const effectiveMode: PracticeMode = config?.filter === "unused" ? "unseen" : config?.filter === "incorrect" ? "wrong" : config?.filter === "all" || config?.filter === "flagged" ? "all" : practiceMode;
  // Dashboard Study now and topic links pass unseen mode without a limit.
  // In that path the daily goal is progress guidance, not a quiz length.
  // Explicit limits and the quiz builder remain bounded sessions.
  const continuousPractice = autoStarted && !wantsSetup
    && effectiveMode === "unseen"
    && !searchParams.has("limit");
  const scope = config ? studyScope(userId, config, effectiveMode) : "";
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
  const [attemptCount, setAttemptCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalXpSession, setTotalXpSession] = useState(0);
  const [xpEarned, setXpEarned] = useState<number | null>(null);
  // UX-PRA-26: what the server returned for the current answer, shown in the
  // strip; UX-PRA-18: a stored report offers a skip for this question.
  const [lastAnswerXp, setLastAnswerXp] = useState<number | null>(null);
  const [lastReviewDays, setLastReviewDays] = useState<number | null>(null);
  const [reportedId, setReportedId] = useState<number | null>(null);
  const [showXpFloat, setShowXpFloat] = useState(false);
  const [startTime, setStartTime] = useState(Date.now());
  const [partialAnswerCount, setPartialAnswerCount] = useState(0);
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
  const [answerAuthExpired, setAnswerAuthExpired] = useState(false);
  const [answerRejected, setAnswerRejected] = useState(false);
  const [planRejected, setPlanRejected] = useState(false);
  // The learner's own result, shown in the paywall as positive context.
  const paywallAccuracy = (() => {
    const g = getStoredSession()?.gamification;
    const answered = g?.total_questions_answered ?? 0;
    return answered > 0 ? Math.round(((g?.total_correct ?? 0) / answered) * 100) : null;
  })();
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
    if (new URLSearchParams(window.location.search).has('userId')) {
      window.history.replaceState(window.history.state, '', stripLegacyIdentity(window.location.href));
    }
    {
      const session = getStoredSession();
      setUserId(session?.user?.id || "");
      if (!session?.user?.id) router.push(buildAuthHref({ intent: "free", exam: asPuypExamType(new URLSearchParams(window.location.search).get("examSource") || new URLSearchParams(window.location.search).get("exam")) || undefined, next: window.location.pathname + window.location.search }));
      // The saved exam preference is read by useActiveExam.
      // tier + role are now sourced from useUserTier() (live /api/auth/me)
      // rather than from the stale session blob, so we don't set them here.
    }
  }, [searchParams, router]);

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
    if (!modeReady || !userId || !examPreferenceReady) return;
    if (wantsSetup) return; // Explicit opt-in to customize screen
    const requestedLimit = Number.parseInt(searchParams.get("limit") || "", 10);
    const storedDailyGoal = getStoredSession()?.user?.daily_goal || 20;
    const targetCount = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 200)
      : Math.min(Math.max(storedDailyGoal, 1), 200);
    setAutoStarted(true);
    if (searchParams.get("configured") === "1") {
      try {
        const preserved = JSON.parse(sessionStorage.getItem(`medpruef-study-config:${userId}`) || "null") as QuizConfig | null;
        if (preserved && preserved.examSource === examSource && Array.isArray(preserved.topics) && Array.isArray(preserved.tags)) {
          setConfig(preserved);
          return;
        }
      } catch {}
    }
    setConfig({
      topics: initialTopic && initialTopic !== "random" && !urlExamMismatch ? [initialTopic] : [],
      tags: [],
      targetCount,
      timeLimitMin: null,
      examDateFrom: null,
      examDateTo: null,
      examSource,
    });
  }, [wantsSetup, initialTopic, config, examSource, searchParams, modeReady, userId, examPreferenceReady, urlExamMismatch]);

  useEffect(() => {
    if (config && modeReady && userId) trackEvent("quiz_start", { practiceMode: effectiveMode, examSource: config.examSource, topics: config.topics, targetCount: config.targetCount, entryPoint: initialQuestionId ? "question-link" : wantsSetup ? "builder" : "practice" });
  }, [config, modeReady, userId, effectiveMode, initialQuestionId, wantsSetup]);

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
    setLoadError(false);
    setLoadErrorReason(null);
    if (config.filter === "flagged" && !(config.flaggedIds || []).some(id => !seenIdsRef.current.includes(id))) return null;

    // Offline branch reads only content explicitly downloaded to this device.
    // History-dependent modes cannot be reconstructed from this content cache.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      if (effectiveMode === "wrong" || effectiveMode === "review" || config.filter === "unused") {
        setLoadError(true);
        setLoadErrorReason(lang === "de"
          ? "Falsche und fällige Fragen brauchen Ihre Online-Lernhistorie. Verbinden Sie sich erneut, um diesen Modus zu nutzen."
          : "Wrong-answer and due-review queues need your online study history. Reconnect to use this mode.");
        return null;
      }
      try {
        const rows = config.topics.length === 1
          ? await getQuestionsByTopic(config.examSource, config.topics[0])
          : await getAllQuestions(config.examSource);
        const allowedIds = config.filter === "flagged" ? new Set(config.flaggedIds || []) : null;
        const candidates = rows.filter((row) => {
          if (row.exam_type !== config.examSource) return false;
          if (!Array.isArray(row.choices) || row.choices.length < 2) return false;
          if (config.topics.length > 1 && !config.topics.includes(row.topic)) return false;
          if (config.tags.length && !config.tags.some((tag) => row.tags?.includes(tag))) return false;
          if (config.examDateFrom && !row.exam_dates?.some((date) => date >= config.examDateFrom!)) return false;
          if (config.examDateTo && !row.exam_dates?.some((date) => date <= config.examDateTo!)) return false;
          if (config.examYear && !row.exam_dates?.some((date) => date.startsWith(config.examYear!))) return false;
          if (allowedIds && !allowedIds.has(row.id)) return false;
          if (seenIdsRef.current.includes(row.id) || offlineServedRef.current.has(row.id)) return false;
          return true;
        });
        if (!candidates.length) {
          if (rows.length > 0 && rows.every((row) => !Array.isArray(row.choices) || row.choices.length < 2)) {
            setLoadError(true);
            setLoadErrorReason(lang === "de"
              ? "Die gespeicherten Fragen haben keine offline nutzbaren Antwortoptionen. Lade Fragen mit Antwortoptionen in den Einstellungen herunter."
              : "The cached questions have no offline-ready choices. Download questions with answer options in Settings.");
          }
          return null;
        }
        const index = Math.floor(Math.random() * candidates.length);
        const selected = candidates[index];
        offlineServedRef.current.add(selected.id);
        seenIdsRef.current.push(selected.id);
        const offlineQuestion = offlineToQuestion(selected);
        if (!offlineQuestion) {
          setLoadError(true);
          setLoadErrorReason(lang === "de"
            ? "Die gespeicherten Fragen enthalten keine offline nutzbaren Antwortoptionen. Lade Fragen mit Antwortoptionen in den Einstellungen herunter."
            : "The cached question has no offline-ready choices. Download questions with answer options in Settings.");
        }
        return offlineQuestion;
      } catch {
        setLoadError(true);
        setLoadErrorReason(lang === "de"
          ? "Keine gespeicherten Fragen gefunden. Lade zuerst Fragen in den Einstellungen herunter."
          : "No cached questions found. Download questions in Settings first.");
        return null;
      }
    }

    try {
      const params = buildQueryParams(config, userId, seenIdsRef.current, effectiveMode);
      const res = await fetch(`/api/questions?${params}`);
      // Free-tier gate: 402 → pro-only practice mode. Client can't recover,
      // only upsell.
      if (res.status === 402) {
        setPlanRejected(true);
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
      if (!res.ok) throw new Error("Question load failed");
      const data = await res.json();
      // Free-tier gate: 200 with paywallHit → user has seen all 150.
      if (data && data.paywallHit === true) {
        setPlanRejected(true);
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
      setLoadError(true);
    }
    return null;
  }, [config, userId, offlineToQuestion, practiceMode, effectiveMode, lang]);

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
    const startsFreshUnseenPractice = searchParams.get("practiceMode") === "unseen";
    const s = initialQuestionId || startsFreshUnseenPractice ? null : readStudySession(scope);
    if (s) {
      setResumeOffer(s);
      setResumeGate("offered");
    } else {
      setResumeGate("cleared");
    }
  }, [config, initialQuestionId, scope]);

  const resumeSession = useCallback(() => {
    if (!resumeOffer || !config) return;
    resumeDecidedRef.current = true;
    seenIdsRef.current = resumeOffer.answered.map((a) => a.id);
    answeredTrailRef.current = resumeOffer.answered.slice();
    setQuestionCount(resumeOffer.answered.length);
    const resumedStats = getQuizAttemptStats(resumeOffer.answered);
    setCorrectCount(resumedStats.correct);
    setAttemptCount(resumedStats.attempts);
    setSessionHistory(resumeOffer.answered.filter((a) => !a.revealed).map((a) => ({ correct: a.correct })));
    const target = resumeOffer.targetCount ?? config.targetCount;
    if (resumeOffer.answered.length >= target) {
      // The saved session already reached its goal — show the terminal card.
      clearStudySession(scope, target);
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
  }, [resumeOffer, config, scope]);

  const startFresh = useCallback(() => {
    resumeDecidedRef.current = true;
    clearStudySession(scope, resumeOffer?.targetCount);
    answeredTrailRef.current = [];
    setResumeOffer(null);
    setResumeGate("cleared");
  }, [scope, resumeOffer]);

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
          if (!res.ok) throw new Error("Question unavailable");
          if (Array.isArray(data) && data.length > 0) {
            q = data[0];
            if (q) seenIdsRef.current.push(q.id);
          } else setLoadError(true);
        } catch { setLoadError(true); }
      } else q = await fetchQuestion();
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

  // Clear the saved trail once the run is over (finished or timed out) so a
  // finished session is never offered again.
  useEffect(() => {
    if (quizFinished) clearStudySession(scope);
  }, [quizFinished, scope]);

  // ─── Time limit countdown ───
  useEffect(() => {
    if (!config?.timeLimitMin || saving || saveError) return;
    setTimeRemaining(prev => prev ?? config.timeLimitMin! * 60);
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
  }, [config?.timeLimitMin, saving, saveError]);

  // ─── Advance to next question ───
  const advance = useCallback(() => {
    if (!config || saving || saveError || !answered) return;
    pendingAnswer.current = null;
    setAnswerRejected(false); setPlanRejected(false);
    setAnswerQueuedOffline(false);
    // If we've hit the target, show terminal completion card
    if (!continuousPractice && questionCount >= config.targetCount) {
      setQuizFinished(true);
      return;
    }
    if (prefetchPaywall.current) {
      const held = prefetchPaywall.current;
      prefetchPaywall.current = null;
      setPlanRejected(true);
      setPaywall({ kind: "qbank_limit", seen: held.seen, limit: held.limit });
      return;
    }
    if (nextQuestion && !seenIdsRef.current.includes(nextQuestion.id)) {
      seenIdsRef.current.push(nextQuestion.id);
      setQuestion(nextQuestion);
      setNextQuestion(null);
    } else {
      setNextQuestion(null);
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
    setLastAnswerXp(null);
    setLastReviewDays(null);
    setReportedId(null);
    setStartTime(Date.now());
  }, [nextQuestion, fetchQuestion, questionCount, config, saving, saveError, answered, continuousPractice]);

  // UX-PRA-18 (part 1): after a stored report the learner may skip the
  // question: nothing is saved, no XP, no free-cap count; it leaves the session.
  const skipReported = useCallback(() => {
    if (!question || answered || saving || saveError || reportedId !== question.id) return;
    if (!seenIdsRef.current.includes(question.id)) seenIdsRef.current.push(question.id);
    prefetchPaywall.current = null;
    setReportedId(null);
    setLoading(true);
    void fetchQuestion().then((q) => {
      setQuestion(q);
      if (q && !seenIdsRef.current.includes(q.id)) seenIdsRef.current.push(q.id);
    }).catch(() => setLoadError(true)).finally(() => setLoading(false));
    setAdvanceNonce((n) => n + 1);
    setStartTime(Date.now());
  }, [question, answered, saving, saveError, reportedId, fetchQuestion]);

  // UX-PRA-46: prefetch the next question once the current answer is saved
  // (after the save on slow or data-saver connections too, so the save goes
  // first). A prefetch never marks a question seen and never counts toward
  // the free cap; a paywall answer is held until the learner presses Next.
  const prefetchToken = useRef(0);
  const prefetchPaywall = useRef<{ seen?: number; limit?: number } | null>(null);
  useEffect(() => {
    if (!config || !question || !answered || saving || saveError || nextQuestion || quizFinished) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (!continuousPractice && questionCount >= config.targetCount) return;
    if (config.filter === "flagged") return;
    const token = ++prefetchToken.current;
    const controller = new AbortController();
    const exclude = seenIdsRef.current.includes(question.id) ? seenIdsRef.current : [...seenIdsRef.current, question.id];
    const params = buildQueryParams(config, userId, exclude, effectiveMode);
    void fetch(`/api/questions?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (token !== prefetchToken.current) return;
        if (data && data.paywallHit === true) {
          prefetchPaywall.current = { seen: typeof data.seen === "number" ? data.seen : undefined, limit: typeof data.limit === "number" ? data.limit : 150 };
          return;
        }
        const item = Array.isArray(data) ? (data[0] as Question | undefined) : undefined;
        if (item?.id && !seenIdsRef.current.includes(item.id)) setNextQuestion(item);
      })
      .catch(() => { /* a failed prefetch just means Next fetches as before */ });
    return () => controller.abort();
  }, [config, question, answered, saving, saveError, nextQuestion, quizFinished, continuousPractice, questionCount, userId, effectiveMode]);

  // UX-PRA-46: a load that takes longer than 4 s says so and offers a retry.
  const [slowLoad, setSlowLoad] = useState(false);
  useEffect(() => {
    if (!loading) { setSlowLoad(false); return; }
    const timer = setTimeout(() => setSlowLoad(true), 4000);
    return () => clearTimeout(timer);
  }, [loading]);

  // UX-PRA-51: one unique document title per screen.
  useEffect(() => {
    if (!question || quizFinished) return;
    document.title = `${t("a23_quiz_title", lang).replace("{n}", String(questionCount + (answered ? 0 : 1)))} | MedPrüf`;
  }, [question, quizFinished, questionCount, answered, lang]);

  // ─── Keyboard: N / → for next ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Use shared keyboard guard — covers typing in inputs/textareas
      // AND any key inside a dialog overlay. Closes the regression
      // where typing "n" in the FeedbackWidget while on /quiz would
      // advance to the next question and close the dialog
      // (review-2026-04-26-A1).
      if (shouldIgnoreGlobalKey(e) || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !studyShortcutsEnabled()) return;
      if ((e.key === "n" || e.key === "ArrowRight") && answered && !quizFinished) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [answered, advance, quizFinished]);

  // ─── Answer handler ───
  useEffect(() => { setAnswerRejected(false); setPlanRejected(false); }, [question?.id, advanceNonce]);
  useEffect(() => { if (answerRejected) document.querySelector<HTMLButtonElement>("[data-next-question]")?.focus(); }, [answerRejected]);

  const handleAnswer = useCallback(
    async (isCorrect: boolean, selectedIndexes: number[] = []) => {
      if (!question || answered || planRejected || paywall) return;
      if (saveInFlight.current) return;
      saveInFlight.current = true;
      setSaving(true);
      setSaveError(false);
      if (!pendingAnswer.current) pendingAnswer.current = { correct: isCorrect, selected: selectedIndexes, requestId: crypto.randomUUID() };
      try {
        // Open-answer reveal is navigation progress, not an answer attempt.
        // Keep it out of answer_history and the XP ledger instead of sending
        // isCorrect=true with an empty response to the authoritative RPC.
        const revealedWithoutAttempt = isUnscoredAnswerReveal(isCorrect, selectedIndexes);
        let data: { saved: boolean; xp: number; gamification?: Record<string, unknown> | null; review?: { intervalDays?: number } | null };
        if (revealedWithoutAttempt) {
          data = { saved: true, xp: 0 };
        } else if (typeof navigator !== "undefined" && !navigator.onLine) {
          const userAnswer = selectedIndexes
            .map((index) => question.options?.[index]?.text)
            .filter((text): text is string => Boolean(text))
            .join(" | ");
          if (!userId || !userAnswer) throw new Error("Cannot queue an anonymous or empty offline answer");
          await queuePendingAnswer({
            id: pendingAnswer.current.requestId,
            userId,
            questionId: question.id,
            userAnswer,
            isCorrect,
            timeSpentMs: Date.now() - startTime,
          });
          data = { saved: false, xp: 0 };
          setAnswerQueuedOffline(true);
        } else {
          const res = await fetch("/api/answer", {
            method: "POST",
            skipAuthRedirect: true,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              requestId: pendingAnswer.current.requestId,
              questionId: question.id,
              isCorrect,
              userAnswer: selectedIndexes
                .map((index) => question.options?.[index]?.text)
                .filter((text): text is string => Boolean(text))
                .join(" | ") || null,
              timeSpentMs: Date.now() - startTime,
            }),
          });
          if (res.status === 402) {
            const rejection = await res.json().catch(() => ({}));
            setPlanRejected(true);
            // Server-side free allowance reached (e.g. a trial ended mid-
            // session): show the upgrade prompt instead of a save error.
            pendingAnswer.current = null;
            setPaywall({ kind: "qbank_limit", limit: typeof rejection.limit === "number" ? rejection.limit : undefined });
            return;
          }
          if (res.status === 404 || res.status === 409) {
            pendingAnswer.current = null;
            setAnswerRejected(true);
            setAnswered(true);
            return;
          }
          if (res.status === 401) setAnswerAuthExpired(true);
          if (res.status === 401 || res.status >= 500) {
            const userAnswer = selectedIndexes.map(index => question.options?.[index]?.text).filter(Boolean).join(" | ");
            if (!userId || !userAnswer) throw new Error("Cannot queue answer");
            await queuePendingAnswer({ id: pendingAnswer.current.requestId, userId, questionId: question.id, userAnswer, isCorrect, timeSpentMs: Date.now() - startTime });
            setAnswerQueuedOffline(true);
            data = { saved: false, xp: 0 };
          } else {
          if (!res.ok) throw new Error("Answer was not confirmed saved");
          data = await res.json();
          if (data?.saved !== true) throw new Error("Answer save was not confirmed");
          }
        }
      setAnswered(true);
      const newCount = questionCount + 1;
      setQuestionCount(newCount);
      if (!revealedWithoutAttempt) {
        if (gradeSelection(question.options || [], selectedIndexes).state === "partial") setPartialAnswerCount(count => count + 1);
        setAttemptCount((count) => count + 1);
        if (isCorrect) setCorrectCount((c) => c + 1);
        setSessionHistory((prev) => [...prev, { correct: isCorrect }]);
        recordAnswer(question.topic, isCorrect);
      }
      // Persist the answered trail so a reload/break resumes instead of
      // restarting from question 1 (the exact bug Munir reported).
      answeredTrailRef.current.push({ id: question.id, correct: isCorrect, ...(revealedWithoutAttempt ? { revealed: true } : {}) });
      writeStudySession(scope, config!.targetCount, answeredTrailRef.current);
      if (!revealedWithoutAttempt) trackEvent("question_answer", {
        questionId: question.id,
        topic: question.topic,
        isCorrect,
        timeSpent: Date.now() - startTime,
        examSource: config?.examSource,
        practiceMode: effectiveMode,
        entryPoint: initialQuestionId ? "question-link" : wantsSetup ? "builder" : "practice",
      });
      if (!revealedWithoutAttempt) trackFunnelEvent("first_answer", { exam: config?.examSource || "unknown" }, { once: true });

      // Trigger milestone card every 20 questions (unless this is also the final)
      if (config && newCount % 20 === 0 && (continuousPractice || newCount < config.targetCount)) {
        setMilestoneVisible(true);
        setTimeout(() => setMilestoneVisible(false), 8000);
      }
        setLastAnswerXp(data.saved ? data.xp : null);
        setLastReviewDays(data.saved && typeof data.review?.intervalDays === "number" ? data.review.intervalDays : null);
        if (data.xp > 0) setTotalXpSession(p => p + data.xp);
        if (data.xp > 0 && isCorrect) {
          setXpEarned(data.xp);
          setShowXpFloat(true);
          setTimeout(() => setShowXpFloat(false), 1500);
        }
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
        pendingAnswer.current = null;
      } catch (e) {
        console.error(e);
        const userAnswer = selectedIndexes.map(index => question.options?.[index]?.text).filter(Boolean).join(" | ");
        if (pendingAnswer.current && userId && userAnswer) {
          try {
            await queuePendingAnswer({ id: pendingAnswer.current.requestId, userId, questionId: question.id, userAnswer, isCorrect, timeSpentMs: Date.now() - startTime });
            setAnswerQueuedOffline(true); setAnswered(true); pendingAnswer.current = null;
          } catch { setSaveError(true); }
        } else setSaveError(true);
      } finally {
        saveInFlight.current = false;
        setSaving(false);
      }
    },
    [question, answered, userId, startTime, config, questionCount, scope, effectiveMode, initialQuestionId, wantsSetup, continuousPractice, planRejected, paywall]
  );

  useEffect(() => {
    if (!saving && !saveError) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const blockNavigation = (event: MouseEvent) => {
      if ((event.target as Element)?.closest('a[href]')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", blockNavigation, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", blockNavigation, true); };
  }, [saving, saveError]);

  const restart = () => {
    prefetchPaywall.current = null;
    setQuestion(null);
    setNextQuestion(null);
    setAnswered(false);
    setQuestionCount(0);
    setAttemptCount(0);
    setCorrectCount(0);
    setAnswerQueuedOffline(false);
    setTotalXpSession(0);
    setSessionHistory([]);
    setQuizFinished(false);
    setMilestoneVisible(false);
    answeredTrailRef.current = [];
    seenIdsRef.current = [];
    clearStudySession(scope);
    resumeDecidedRef.current = true;
    setConfig(null); // back to setup
  };

  const sessionAccuracy = attemptCount > 0 ? Math.round((correctCount / attemptCount) * 100) : 0;

  // ─── Setup screen ───
  // ?setup=1 → CreateTestBuilder (Phase C full customization flow).
  // Legacy QuizSetup is kept for backward compat; it's no longer reachable
  // via the normal ?setup=1 path but remains importable for any future use.
  // No saved exam yet: the learner picks before any study starts (ONB-49).
  if (userId && examResolution.status === "needs-picker") {
    return (
      <>
        <ExamSelector lang={lang} onSelect={async (id) => { setExamPickError(false); if (!(await switchExam(id))) setExamPickError(true); }} />
        {examPickError && (
          <p role="alert" className="fixed inset-x-4 bottom-6 z-[60] mx-auto max-w-md rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-3 text-center text-sm text-[var(--mp-fg)]">
            {lang === "de" ? "Auswahl nicht gespeichert. Bitte erneut versuchen." : "Choice not saved. Please try again."}
          </p>
        )}
      </>
    );
  }

  if (!config) {
    // Deep links from Study now, topic cards, and other instant-practice
    // entry points resolve auth and the saved exam preference before building
    // their config. Do not briefly show the quiz builder while those requests
    // are pending. The builder is only an explicit `?setup=1` destination,
    // and it waits for the confirmed exam like every other entry.
    if (!wantsSetup || !examPreferenceReady) {
      return (
        <div
          className="flex min-h-screen items-center justify-center bg-[var(--mp-surface-sunken)] px-4"
          data-quiz-initializing="true"
          role="status"
          aria-label={lang === "de" ? "Lernsitzung wird vorbereitet" : "Preparing your study session"}
        >
          <BrandedLoader />
          <span className="sr-only">{lang === "de" ? "Lernsitzung wird vorbereitet" : "Preparing your study session"}</span>
        </div>
      );
    }
    return (
      <div className="app-layout">
        <Sidebar lang={lang} userId={userId} />
        <main className="main-content safe-area-top safe-area-bottom min-h-screen">
        <PartialTranslationNote />
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
              initialFilter={searchParams.get("filter") === "flagged" ? "flagged" : undefined}
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

      <main className="main-content safe-area-top safe-area-bottom flex flex-col min-h-screen bg-[var(--mp-surface-sunken)] mp-quiz-main">
        <h1 className="sr-only">{t("a23_quiz_title", lang).replace("{n}", String(questionCount + (answered ? 0 : 1)))}</h1>
        <PartialTranslationNote />
        {examResolution.status === "ready" && examResolution.urlMismatch && (
          <ExamMismatchNotice lang={lang} active={examResolution.exam} linked={examResolution.urlMismatch} onSwitch={switchExam} />
        )}
        {/* ── Distraction-free quiz top bar (approved 02-quiz design) ──
            Close → home/setup · mono progress counter with teal current-
            index · optional timer · flag. Theme/lang toggles deliberately
            do NOT live on this focus surface. The fill is the one blessed
            decorative spark here (viridian→teal + glow). */}
        <QuizTopBar
          lang={lang}
          current={continuousPractice
            ? questionCount + (answered ? 0 : 1)
            : Math.min(questionCount + (answered ? 0 : 1), config.targetCount)}
          total={continuousPractice ? null : config.targetCount}
          progressPct={progressPct}
          timeLabel={
            timeRemaining !== null
              ? `${Math.floor(timeRemaining / 60)}:${String(timeRemaining % 60).padStart(2, "0")}`
              : null
          }
          timeUrgent={timeRemaining !== null && timeRemaining < 60}
          onClose={() => {
            if (saving || saveError) return;
            if (autoStarted) router.push("/");
            else restart();
          }}
        />
        {/* UX-2 (2026-07-04): the top-bar bookmark was removed as a duplicate of
            the QuestionActions star (both wrote medpruef_favorites). The star,
            grouped with the other per-question actions, is now the single
            bookmark on both mobile and desktop. */}

        <section className="px-4 lg:px-8 py-3 border-b border-[var(--mp-border)]" aria-label={lang === "de" ? "Lernmodus" : "Study mode"}>
          <div className="max-w-3xl mx-auto space-y-2">
            <label className="text-[13px] font-semibold flex items-center gap-3 w-full">
              {t("a23_mode_label", lang)}
              <select className="rounded-lg border border-[var(--mp-border-control)] bg-[var(--mp-surface)] p-2 text-sm min-w-0 flex-1 sm:flex-none max-w-full min-h-11" value={effectiveMode}
                disabled={saving || saveError}
                onChange={(event) => {
                  const mode = event.target.value as PracticeMode;
                  try { localStorage.setItem(`medpruef-study-mode:${userId}:${examSource}`, mode); } catch {}
                  const nextConfig = { ...config, filter: undefined, flaggedIds: undefined };
                  try { sessionStorage.setItem(`medpruef-study-config:${userId}`, JSON.stringify(nextConfig)); } catch {}
                  const params = new URLSearchParams({ examSource: config.examSource, practiceMode: mode, configured: "1" });
                  if (config.topics.length === 1) params.set("topic", config.topics[0]);
                  if (mode !== "unseen" || searchParams.has("limit") || !autoStarted) {
                    params.set("limit", String(config.targetCount));
                  }
                  window.location.assign(`/quiz?${params}`);
                }}>
                {/* UX-PRA-11/12 (interim, native select): mode names from one
                    source; Pro modes say so in text for free accounts. */}
                <option value="unseen">{t("a23_mode_unseen", lang)}</option>
                <option value="wrong">{t("a23_mode_wrong", lang)}{tierLive === "free" && roleLive !== "admin" ? ` (${t("a23_mode_pro", lang)})` : ""}</option>
                <option value="review">{t("a23_mode_review", lang)}{tierLive === "free" && roleLive !== "admin" ? ` (${t("a23_mode_pro", lang)})` : ""}</option>
                <option value="all">{t("a23_mode_all", lang)}</option>
              </select>
            </label>
            <p className="text-[13px] text-[var(--mp-fg-muted)]" aria-live="polite">
              {continuousPractice
                ? t("a23_quiz_session_open", lang).replace("{n}", String(questionCount))
                : t("a23_quiz_session_goal", lang).replace("{n}", String(questionCount)).replace("{total}", String(config.targetCount))}
            </p>
            <Link className="text-xs underline" href={`/mistakes?examSource=${encodeURIComponent(config.examSource)}${config.topics.length === 1 ? `&topic=${encodeURIComponent(config.topics[0])}` : ""}`}>
              {lang === "de" ? "Fehlerliste ansehen" : "View mistake list"}
            </Link>
          </div>
        </section>

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
                    ? "Bitte verbinde dich mit dem Internet. Antworten werden erst nach bestätigtem Speichern gezählt."
                    : "Please reconnect to the internet. Answers count only after saving is confirmed."}
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

              <OfflineSyncNotice lang={lang} />
              {(saving || saveError) && <div role="status" className="card p-4 mb-4 text-sm">
                {saving ? (lang === "de" ? "Antwort wird gespeichert…" : "Saving your answer…") : (lang === "de" ? "Antwort noch nicht als gespeichert bestätigt. Bitte erneut versuchen, bevor Sie weitergehen." : "Your answer has not been confirmed saved. Retry before continuing.")}
                {saveError && <button className="mp-btn mp-btn--primary mt-2" onClick={() => { const pending = pendingAnswer.current; if (pending) void handleAnswer(pending.correct, pending.selected); }}>{lang === "de" ? "Speichern erneut versuchen" : "Retry saving"}</button>}
              </div>}
              {quizFinished ? (
                <FinalCompletionCard
                  lang={lang}
                  correctCount={correctCount}
                  questionCount={attemptCount}
                  targetCount={config.targetCount}
                  totalXp={totalXpSession}
                  partialCount={partialAnswerCount}
                  topicTotal={topicTotal}
                  practiceMode={effectiveMode}
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
                <div className="space-y-4" aria-busy="true">
                  {slowLoad && (
                    <div role="status" className="mp-card p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                      <span>{t("a23_quiz_slow", lang)}</span>
                      <span className="flex gap-2">
                        {/* A reload restarts the stuck request; the saved trail
                            resumes the session, and no second fetch can race
                            the first one and swap the question. */}
                        <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => window.location.reload()}>{t("a23_quiz_slow_retry", lang)}</button>
                        <Link href="/" className="mp-btn mp-btn--ghost min-h-11">{t("a23_quiz_slow_back", lang)}</Link>
                      </span>
                    </div>
                  )}
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              ) : !question ? (
                <div className="text-center py-12">
                  <Inbox className="w-12 h-12 text-[var(--mp-fg-subtle)] mx-auto mb-4" />
                  <p className="text-[var(--mp-fg-muted)]">{loadError ? (lang === "de" ? "Fragen konnten nicht geladen werden. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut." : "Questions could not be loaded. Check your connection and retry.") : effectiveMode === "unseen" ? (lang === "de" ? "Alle verfügbaren Fragen in dieser Auswahl sind bearbeitet. Wiederholen Sie nur, wenn Sie möchten." : "You have covered all available questions in this selection. Review only when you choose.") : effectiveMode === "review" ? (lang === "de" ? "Keine fälligen Wiederholungen in dieser Auswahl." : "No due reviews in this selection.") : t("no_questions", lang)}</p>
                  {loadError && <button className="mp-btn mp-btn--primary mt-4" onClick={() => {
                    setLoading(true);
                    setLoadError(false);
                    const load = initialQuestionId
                      ? fetch(`/api/questions?${new URLSearchParams({ ids: initialQuestionId, examSource: config.examSource })}`).then(async response => {
                          if (!response.ok) throw new Error("Question unavailable");
                          const rows = await response.json();
                          const item = Array.isArray(rows) ? rows[0] as Question | undefined : undefined;
                          if (!item) throw new Error("Question unavailable");
                          return item;
                        })
                      : fetchQuestion();
                    void load.then(q => {
                      setQuestion(q);
                      if (q && !seenIdsRef.current.includes(q.id)) seenIdsRef.current.push(q.id);
                    }).catch(() => setLoadError(true)).finally(() => setLoading(false));
                  }}>{lang === "de" ? "Erneut versuchen" : "Retry"}</button>}
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
                  <FirstQuestionPrimer userId={userId} free={tierLive === "free" && roleLive !== "admin"} answered={answered} lang={lang} />
                  {planRejected ? <div role="alert" className="mp-card p-6 space-y-4"><p>{t("practice_plan_limit", lang)}</p><Link href="/pricing" className="mp-btn mp-btn--primary">{t("practice_see_plans", lang)}</Link><Link href="/" className="mp-btn mp-btn--secondary">{t("back_home", lang)}</Link></div> : answerRejected ? <div role="alert" className="mp-card p-6"><p>{t("practice_rejected", lang)}</p></div> : <QuestionCard
                    key={`q-${question.id}-${advanceNonce}`}
                    question={question}
                    questionNumber={questionCount + (answered ? 0 : 1)}
                    totalQuestions={continuousPractice ? null : config.targetCount}
                    lang={lang}
                    onAnswer={handleAnswer}
                    offlineAnswerPending={answerQueuedOffline}
                    answerSaveState={answerAuthExpired ? "auth-expired" : saving || saveError ? "pending" : answerQueuedOffline ? "queued" : "saved"}
                    imageUrl={question.image_url}
                    hideActions
                    recallFirst={kafEligible && kafMode}
                    userTier={userTier}
                    userRole={userRole}
                    xpAwarded={lastAnswerXp}
                    reviewDays={lastReviewDays}
                    onReported={() => setReportedId(question.id)}
                  />}

                  {/* UX-PRA-18: a reported, unanswered question can be skipped. */}
                  {reportedId === question.id && !answered && !planRejected && !answerRejected && (
                    <div role="status" className="mt-3 mp-card p-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-[var(--mp-fg-muted)]">{t("a23_quiz_reported", lang)}</p>
                      <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={skipReported}>{t("a23_quiz_skip", lang)}</button>
                    </div>
                  )}

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
                      onReported={() => setReportedId(question.id)}
                    />
                  </div>

                  {/* ── Footer action (UX-PRA-16 A, UX-PRA-34). Single-select grades
                      on the first tap, so before answering there is no dead
                      "Antwort prüfen" bar: the slot stays reserved (no jump) and
                      empty. After grading, "Nächste Frage" / "Quiz beenden"; on
                      phones it sticks above the opaque bottom nav with the
                      content padded so nothing rests under it. ── */}
                  {(() => {
                    const isFinish = !continuousPractice && questionCount >= config.targetCount;
                    const mode: QuizFooterMode | null = answered ? (isFinish ? "finish" : "next") : null;
                    return (
                      <div className={`mt-4 min-h-[56px] ${mode ? "mp-quiz-sticky-next" : ""}`} data-quiz-footer>
                        {mode && (
                          <div className="space-y-2 animate-fade-in">
                            <QuizFooterAction
                              lang={lang}
                              mode={mode}
                              onPress={advance}
                            />
                            <p className="mp-study-shortcut-hint justify-center text-[12px] text-[var(--mp-fg-muted)]">
                              {t("a23_quiz_next_hint", lang)}
                            </p>
                          </div>
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
                              ? `${sessionAccuracy}% Genauigkeit · ${topicTotal.toLocaleString("de-DE")} aktive Fragen insgesamt`
                              : `${sessionAccuracy}% accuracy · ${topicTotal.toLocaleString("en-US")} active questions in total`}
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
                  onReported={() => setReportedId(question.id)}
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
          <div className="mp-study-shortcut-hint items-center justify-center gap-2 px-4 pb-3 text-xs text-[var(--mp-fg-muted)]">
            <span>{t('study_shortcut_hint', lang)}</span>
            <button onClick={dismissShortcutsHint} className="mp-btn mp-btn--ghost min-h-11 min-w-11" aria-label={t('close', lang)}>×</button>
          </div>
        )}
      </main>

      {/* ─── The one paywall (UX-GLOBAL-19): in place, server cap and bank ─── */}
      <PaywallUpgradeModal
        open={paywall !== null}
        onOpenChange={(open) => { if (!open) setPaywall(null); }}
        lang={lang}
        gate={paywall?.kind ?? "qbank_limit"}
        bankLabel={examSource ? getExamLabel(examSource, "full", lang) : undefined}
        limit={paywall?.limit}
        accuracyPct={paywallAccuracy}
        surface="quiz"
        otherExams={EXAM_SOURCE_IDS.filter((id) => id !== examSource).map((id) => ({ id, label: getExamLabel(id, "full", lang) }))}
        onSwitchExam={(id) => { setPaywall(null); void switchExam(id as ExamSourceId); }}
      />

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
            ? "Gute Runde! Kennen Sie jemanden, der auch übt?"
            : "Nice round! Know someone else preparing?"}
        </p>
        {/* TR-27: disclosure next to the share control (the invite itself
            is sent from /referrals). */}
        <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
          {referralDisclosure(lang)}
        </p>
      </div>
      <Link
        href="/referrals"
        onClick={handleClick}
        className="mp-btn mp-btn--primary text-xs px-3 py-1.5 min-h-[44px] flex-shrink-0"
      >
        {lang === "de" ? "Teilen" : "Share"}
      </Link>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-xs min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
        aria-label={lang === "de" ? "Schließen" : "Dismiss"}
      >
        ✕
      </button>
    </div>
  );
}

function FinalCompletionCard({
  lang,
  partialCount,
  correctCount,
  questionCount,
  targetCount,
  totalXp,
  topicTotal,
  practiceMode,
  onRestart,
}: {
  lang: Lang;
  correctCount: number;
  questionCount: number;
  targetCount: number;
  totalXp: number;
  partialCount: number;
  topicTotal: number;
  practiceMode: PracticeMode;
  onRestart: () => void;
}) {
  const accuracy = questionCount > 0 ? Math.round((correctCount / questionCount) * 100) : 0;
  const graded = questionCount;

  // UX-GLOBAL-27: one ResultCard hierarchy. Tiered headlines only from 3
  // graded attempts; a round with nothing graded shows a neutral status line
  // and no accuracy, XP or Richtig tile. Never punitive, no red.
  const headline = (() => {
    if (graded < 3) return t("result_round_short", lang);
    if (accuracy === 100) return lang === "de" ? "Perfekt!" : "Perfect!";
    if (accuracy >= 80) return lang === "de" ? "Starke Runde!" : "Strong round!";
    if (accuracy >= 60) return lang === "de" ? "Solide Runde." : "Solid round.";
    if (accuracy >= 40) return lang === "de" ? "Weiter dran." : "Keep going.";
    return lang === "de" ? "Jeder Fehler zählt als Lernen." : "Every miss counts as learning.";
  })();
  const subline = lang === "de"
    ? `${questionCount} von ${targetCount} Fragen bearbeitet`
    : `${questionCount} of ${targetCount} questions answered`;

  const primary = (
    <div className="flex flex-col sm:flex-row gap-3">
      <button onClick={onRestart} className="mp-btn mp-btn--primary mp-btn--cta flex-1">
        {lang === "de" ? "Neues Quiz starten" : "Start new quiz"}
      </button>
      <Link href="/" className="mp-btn mp-btn--secondary flex-1">
        {t("back_home", lang)}
      </Link>
    </div>
  );

  if (graded === 0) {
    return (
      <ResultCard
        label={t("result_round_label", lang)}
        value={subline}
        status="practice"
        statusLabel={t("result_round_nothing_graded", lang)}
        primary={primary}
      />
    );
  }

  return (
    <ResultCard
      label={t("result_round_label", lang)}
      value={t("result_round_value", lang).replace("{correct}", String(correctCount)).replace("{total}", String(questionCount))}
      status="practice"
      statusLabel={headline}
      note={subline}
      primary={primary}
    >
      {partialCount > 0 && <p className="text-[var(--mp-warning-text)] text-sm mb-3">{t("exam_partial", lang)}: {partialCount}. {t("practice_partial_summary", lang)}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className="mp-stat">
          <p className="mp-stat__label">{lang === "de" ? "Genauigkeit" : "Accuracy"}</p>
          <p className="text-xl font-bold font-mono text-[var(--mp-fg)]">{accuracy} %</p>
        </div>
        <div className="mp-stat">
          <p className="mp-stat__label">{lang === "de" ? "Verfügbar" : "Available"}</p>
          <p className="text-xl font-bold font-mono text-[var(--mp-fg)]">{topicTotal > 0 ? `${topicTotal.toLocaleString("de-DE")}` : "-"}</p>
        </div>
      </div>
      {totalXp > 0 && accuracy >= 60 && (
        <p className="mt-3 text-sm font-semibold text-[var(--mp-fg-muted)]">+{totalXp} XP {lang === "de" ? "verdient" : "earned"}</p>
      )}

      {/* Post-quiz share prompt — only appears at ≥80% accuracy AND
          when the user hasn't yet copied their referral code AND we
          haven't shown it on this device. Self-gating logic lives in
          QuizSharePrompt. Rescue-sprint §4.6. */}
      {accuracy >= 80 && <QuizSharePrompt lang={lang} />}
    </ResultCard>
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
