"use client";
import PartialTranslationNote from "@/components/PartialTranslationNote";
import { DataRegion } from "@/components/ui/DataRegion";
import { createRequestSequence } from "@/lib/async-data";

import { useEffect, useState, useCallback, useRef, useMemo, useLayoutEffect, Suspense } from "react";
import { BrandedLoader } from "@/components/Logo";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
// authFetch sends the signed x-session-token. WITHOUT it, every /api/questions
// call in this page was treated as a GUEST, so the route applied the free-tier
// cap and the per-topic loads returned near-empty. The whole app uses this
// alias for authed calls.
import { authFetch as fetch } from "@/lib/authFetch";
import { getStoredExamSource, getTopicConfig } from "@/lib/topics";
import { t, getLang } from "@/lib/i18n";
import { getStoredSession, hasProAccess } from "@/lib/auth";
import { AppLayout, Dialog } from "@/components/ui";
import { Alert } from "@/components/ui/Alert";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { Switch } from "@/components/ui/Switch";
import { useUserTier } from "@/lib/hooks/useUserTier";
import LatestSimulation from "@/components/exam/LatestSimulation";
import { ExamClock } from "@/components/exam/ExamClock";
import { ExamMinimap, type CellState, type CellVerdict } from "@/components/exam/ExamMinimap";
import { ExamSubmitDialog } from "@/components/exam/ExamSubmitDialog";
import { ExamResults } from "@/components/exam/ExamResults";
import { ExamEntryFacts, ExamFormatLine } from "@/components/exam/ExamEntryInfo";
import { PaceLine, usePacePreference } from "@/components/exam/PaceLine";
import { createFinaliseGuard, examSelectionState, updateExamSelection } from "@/lib/practice-exam-state";
import { listNoteQuestionIds } from "@/lib/notes-store";
import { BOOKMARK_EVENT, loadBookmarks, readCachedBookmarks } from "@/lib/bookmarks";
import { safeStorage } from "@/lib/safe-storage";
import {
  saveExamSession, loadPendingExams, savePendingExam, acknowledgePendingExam,
  loadExamSession,
  loadLegacyExamSession,
  claimLegacyExamSession,
  discardLegacyExamSession,
  clearExamSession,
  remainingSeconds,
  type SavedExamSession,
} from "@/lib/examSession";
import type { MCQOption } from "@/lib/mcq";
import { isExamBatchComplete } from "@/lib/examLoad";
import { EXAM_PRESETS, PRACTICE_DURATION_S, blueprintTotal, canStartPreset, getExamPreset, type ExamPresetId, type PassRuleId } from "@/lib/master-exam";
import {
  cappedDwell, customDurationS, daysUntil, formatDurationLabel, missedQuestionIds, normalizePart, partsForSource, planRun,
  reviewIndices, runCounts, runVerdict, subjectResults, weakestTopics, gradeAt,
  UNTIMED_MAX_QUESTIONS, type ExamPart, type ReviewFilter,
} from "@/lib/exam-run";
import { examLang, te, type ExamCopyKey } from "@/lib/i18n-exam";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import TopicIcon from "@/components/TopicIcon";
import QuestionActions from "@/components/QuestionActions";
import QuestionCard from "@/components/QuestionCard";
import { consumeSelfPop, hasHistoryOverlay } from "@/lib/overlay-stack";
import { announce } from "@/lib/announce";
import { Check, ChevronDown, Flag, GraduationCap, LayoutGrid, Map as MapIcon, Minus, NotebookPen, X } from "lucide-react";

type Lang = "de" | "en";
type ExamPhase = "entry" | "loading" | "exam" | "results" | "review";

interface CustomFilters {
  subjects: string[];
  tags: string;
  dateFrom: string;
  dateTo: string;
  bookmarksOnly: boolean;
  notesOnly: boolean;
  search: string;
  limit: number;
  untimed: boolean;
}

const DEFAULT_CUSTOM_FILTERS: CustomFilters = {
  subjects: [],
  tags: "",
  dateFrom: "",
  dateTo: "",
  bookmarksOnly: false,
  notesOnly: false,
  search: "",
  limit: 50,
  untimed: false,
};

const CUSTOM_COUNT_CHIPS = [10, 20, 50, 70];
const PART_KEY = (source: string) => `medpruef_exam_part:${source}`;
const MAX_VISITS = 2000;

interface Question {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  difficulty: number;
  exam_dates: string[];
  options?: MCQOption[];
  n_correct?: number;
  image_url?: string;
}

interface RunInfo {
  presetId: ExamPresetId | null;
  passRuleId: PassRuleId | null;
  untimed: boolean;
  owed: string[];
}

const NO_RUN: RunInfo = { presetId: null, passRuleId: null, untimed: false, owed: [] };

function partLabelKey(examSource: string, part: ExamPart): ExamCopyKey {
  if (part === "custom") return "part_custom";
  if (part === "sip4") return "part_sip4";
  if (part === "sip5") return "part_sip5";
  if (examSource === "kmp_innsbruck") return "part_all_kmp";
  if (examSource === "pharma") return "part_all_pharma";
  return "part_all";
}

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return desktop;
}

function requiredCount(q: Question | undefined): number {
  return q?.n_correct ?? q?.options?.filter((o) => o.correct).length ?? 1;
}

function ExamContent() {
  const searchParams = useSearchParams();
  const { isPaid, isLoading: tierLoading } = useUserTier();
  const isDesktop = useIsDesktop();
  const paneRef = useRef<HTMLDivElement>(null);
  const finaliseGuard = useRef(createFinaliseGuard());
  const durationRef = useRef(PRACTICE_DURATION_S);
  const runningSourceRef = useRef("kenntnispruefung");
  const finishedAtRef = useRef<number | null>(null);
  const saveInFlight = useRef(new Set<string>());
  const currentAttemptRef = useRef<string | null>(null);
  const replaceAllowed = useRef(false);
  const recoveredPending = useRef(false);
  const resumeBusy = useRef(false);
  const loadBusy = useRef(false);
  const visitsRef = useRef<[number, number][]>([]);
  const autosaveFails = useRef(0);
  const [confirmAction, setConfirmAction] = useState<"replace" | "discard" | "leave" | "unsaved" | null>(null);
  const [pendingDestination, setPendingDestination] = useState<string | null>(null);
  const [timeExpired, setTimeExpired] = useState(false);
  const [clockNotice, setClockNotice] = useState("");
  const [timerNotice, setTimerNotice] = useState("");
  const [online, setOnline] = useState(true);
  const [autosaveFailed, setAutosaveFailed] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [otherTab, setOtherTab] = useState(false);
  const [pendingLocal, setPendingLocal] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);
  const [awake, setAwake] = useState(false);
  const [paceOn, setPaceOn] = usePacePreference();

  const [storedExamSource, setStoredExamSourceState] = useState("kenntnispruefung");
  const [examPreferenceReady, setExamPreferenceReady] = useState(false);
  const [examDate, setExamDate] = useState<string | null>(null);
  const examSource = searchParams.get("examSource") || storedExamSource;
  useEffect(() => {
    setStoredExamSourceState(getStoredExamSource());
    let alive = true;
    const session = getStoredSession();
    if (session?.user?.id && !session.user.id.startsWith("guest_")) {
      fetch("/api/user/exam-preference").then(async (res) => {
        if (!res.ok) throw new Error("Preference unavailable");
        return res.json();
      }).then((data) => {
        if (!alive) return;
        if (typeof data?.activeExam === "string" && !searchParams.get("examSource")) setStoredExamSourceState(data.activeExam);
        if (typeof data?.examDate === "string") setExamDate(data.examDate);
      }).catch(() => {}).finally(() => { if (alive) setExamPreferenceReady(true); });
    } else setExamPreferenceReady(true);
    return () => { alive = false; };
  }, [searchParams]);

  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [bookmarkIds, setBookmarkIds] = useState<number[]>([]);
  const [bookmarksReady, setBookmarksReady] = useState(false);
  const [userName, setUserName] = useState("");
  const [selectedPart, setSelectedPart] = useState<ExamPart>("all");
  const [owed, setOwed] = useState<string[]>([]);
  const [showBlueprint, setShowBlueprint] = useState(false);
  const [phase, setPhase] = useState<ExamPhase>("entry");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [runInfo, setRunInfo] = useState<RunInfo>(NO_RUN);
  const [loadProgress, setLoadProgress] = useState(0);
  const examRequest = useRef(createRequestSequence());
  const [countError, setCountError] = useState(false);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [flaggedIdxs, setFlaggedIdxs] = useState<Set<number>>(new Set());
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [reviewTopic, setReviewTopic] = useState<string | null>(null);
  const [reviewGridOpen, setReviewGridOpen] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [customFilters, setCustomFilters] = useState<CustomFilters>(DEFAULT_CUSTOM_FILTERS);
  const [customCount, setCustomCount] = useState<number | null>(null);
  const [customCounting, setCustomCounting] = useState(false);
  const [weakTopics, setWeakTopics] = useState<string[]>([]);
  const [availability, setAvailability] = useState<"idle" | "checking" | "ok" | "short" | "error">("idle");
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [kafAvailable, setKafAvailable] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [savedAttemptId, setSavedAttemptId] = useState<string | null>(null);
  const [examAttemptId, setExamAttemptId] = useState<string | null>(null);
  const [historySaveState, setHistorySaveState] = useState<"idle" | "saving" | "saved" | "failed" | "rejected">("idle");
  const [historySaveRetry, setHistorySaveRetry] = useState(0);
  // A saved in-progress exam detected on mount: offer resume on the entry
  // screen (never a silent resume, so the learner can discard and start fresh).
  const [resumable, setResumable] = useState<ReturnType<typeof loadExamSession>>(null);
  const [legacyResumable, setLegacyResumable] = useState<ReturnType<typeof loadLegacyExamSession>>(null);
  // Absolute exam start time (epoch ms): the timer is derived from it.
  const startedAtRef = useRef<number | null>(null);
  // Guards the persistence effect so it never writes a half-built exam.
  const examReadyRef = useRef(false);

  const parts = useMemo(() => partsForSource(examSource), [examSource]);
  const plan = useMemo(() => planRun({
    examSource, part: selectedPart, owed,
    customCount: Math.min(customCount ?? customFilters.limit, customFilters.limit), untimed: customFilters.untimed,
  }), [examSource, selectedPart, owed, customCount, customFilters.limit, customFilters.untimed]);
  const basePreset = useMemo(() => (selectedPart === "custom" ? null : getExamPreset(plan.presetId ?? "")), [plan.presetId, selectedPart]);

  // URL ?part= wins when valid for the bank, otherwise the last choice for this bank (UX-EXM-16/26).
  useEffect(() => {
    const fromUrl = searchParams.get("part");
    const remembered = safeStorage.getItem(PART_KEY(examSource));
    setSelectedPart(normalizePart(examSource, fromUrl ?? remembered));
    setOwed([]);
  }, [examSource, searchParams]);
  const choosePart = (part: ExamPart) => {
    setSelectedPart(part);
    setOwed([]);
    setLoadFailure(null);
    safeStorage.setItem(PART_KEY(examSource), part);
  };

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
      // The mock exam is Pro-only (pick-free-features A): free users land on
      // /pricing?gate=mock_exam, which explains why.
      if (!hasProAccess(session)) {
        window.location.href = "/pricing?gate=mock_exam";
      }
    }
    // UX-EXM-15: say before Start when this device cannot store the exam.
    try {
      const probe = "medpruef_exam_probe";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      setStorageOk(true);
    } catch { setStorageOk(false); }
  }, []);

  useEffect(() => {
    if (!userId) {
      setBookmarksReady(true);
      return;
    }
    let cancelled = false;
    const syncCached = () => setBookmarkIds(readCachedBookmarks(userId));
    syncCached();
    const refresh = () => {
      void loadBookmarks(userId).then((ids) => {
        if (cancelled) return;
        if (ids) setBookmarkIds(ids);
        setBookmarksReady(true);
      });
    };
    window.addEventListener(BOOKMARK_EVENT, syncCached);
    window.addEventListener("online", refresh);
    refresh();
    return () => {
      cancelled = true;
      window.removeEventListener(BOOKMARK_EVENT, syncCached);
      window.removeEventListener("online", refresh);
    };
  }, [userId]);

  const switchLang = (l: Lang) => {
    setLangState(l);
  };

  // KAF practice card: shown only when the reviewed pool route reports items.
  useEffect(() => {
    if (!isPaid || examSource !== "kenntnispruefung") { setKafAvailable(false); return; }
    let alive = true;
    fetch("/api/exam/kaf-pool?countOnly=1", { skipAuthRedirect: true, timeoutMs: 8_000 })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive) setKafAvailable(typeof data?.count === "number" && data.count > 0); })
      .catch(() => { if (alive) setKafAvailable(false); });
    return () => { alive = false; };
  }, [isPaid, examSource]);

  // Live availability for presets whose rows may not exist yet (SIM-05: the
  // pharma MC preset lights up once its reviewed rows are applied).
  useEffect(() => {
    const preset = basePreset;
    if (!preset || !preset.tagFilter || !isPaid) { setAvailability("idle"); return; }
    const controller = new AbortController();
    setAvailability("checking");
    (async () => {
      try {
        const counts: Record<string, number> = {};
        for (const entry of preset.blueprint) {
          const params = new URLSearchParams({ examSource, topic: entry.topic, mcqOnly: "1", countOnly: "1", practiceMode: "exam" });
          if (preset.tagFilter) params.set("tagsAny", preset.tagFilter.join(","));
          const res = await fetch(`/api/questions?${params}`, { signal: controller.signal, timeoutMs: 8_000 });
          const data = await res.json();
          if (!res.ok || typeof data?.count !== "number") throw new Error("count");
          counts[entry.topic] = data.count;
        }
        if (controller.signal.aborted) return;
        setAvailability(canStartPreset(preset, counts).ok ? "ok" : "short");
      } catch {
        if (!controller.signal.aborted) setAvailability("error");
      }
    })();
    return () => controller.abort();
  }, [basePreset, examSource, isPaid, availabilityRetry]);

  // Weakest-3 preset for the custom builder (UX-EXM-24), hidden without data.
  useEffect(() => {
    if (selectedPart !== "custom" || !userId) return;
    let alive = true;
    fetch(`/api/user/topic-progress?examType=${encodeURIComponent(examSource)}`, { timeoutMs: 8_000 })
      .then(async (res) => (res.ok ? res.json() : []))
      .then((rows) => { if (alive && Array.isArray(rows)) setWeakTopics(weakestTopics(rows)); })
      .catch(() => { if (alive) setWeakTopics([]); });
    return () => { alive = false; };
  }, [selectedPart, examSource, userId]);

  // Detect a saved in-progress exam and surface a resume affordance.
  useEffect(() => {
    if (phase === "entry") resumeBusy.current = false;
    if (!userId) {
      setResumable(null);
      setLegacyResumable(null);
      return;
    }
    const saved = loadExamSession(userId);
    setResumable(saved);
    setLegacyResumable(saved ? null : loadLegacyExamSession());
  }, [userId, phase]);

  // Restore a saved exam into live state and jump into the exam (or straight
  // to results if it expired while the learner was away).
  const restoreExam = useCallback((saved: SavedExamSession) => {
    if (!userId) return;
    finaliseGuard.current.reset();
    durationRef.current = saved.durationS || PRACTICE_DURATION_S;
    runningSourceRef.current = saved.examSource;
    setStoredExamSourceState(saved.examSource);
    finishedAtRef.current = saved.finishedAt || null;
    setTimeExpired(!!saved.timeExpired);
    setHistorySaveState("idle");
    setSavedAttemptId(null);
    startedAtRef.current = saved.startedAt;
    const restoredAttemptId = saved.attemptId || crypto.randomUUID();
    currentAttemptRef.current = restoredAttemptId;
    setExamAttemptId(restoredAttemptId);
    const untimed = !!saved.untimed;
    const left = untimed ? 1 : remainingSeconds(saved.startedAt, durationRef.current);
    const presetId = (saved.presetId && getExamPreset(saved.presetId)?.id) || null;
    setRunInfo({
      presetId,
      // Older saves without a stored rule keep the rule their part had then.
      passRuleId: saved.passRuleId !== undefined ? (saved.passRuleId as PassRuleId | null) : presetId ? EXAM_PRESETS[presetId].passRuleId : (saved.selectedPart === "all" && saved.examSource === "kenntnispruefung" ? "overall-60" : null),
      untimed,
      owed: saved.owed ?? [],
    });
    visitsRef.current = Array.isArray(saved.visits) ? saved.visits.slice(-MAX_VISITS) : [];
    setQuestions(saved.questions as Question[]);
    setAnswers(saved.answers || {});
    setFlaggedIdxs(new Set(saved.flaggedIdxs || []));
    const idx = Math.min(Math.max(0, saved.currentIdx || 0), Math.max(0, saved.questions.length - 1));
    setCurrentIdx(idx);
    setSelectedPart(normalizePart(saved.examSource, saved.selectedPart));
    setResumable(null);
    setLegacyResumable(null);
    examReadyRef.current = true;
    const done = !!saved.finishedAt || left <= 0;
    if (!done) visitsRef.current.push([idx, Date.now()]);
    setPhase(done ? "results" : "exam");
    if (left <= 0) { setTimeExpired(true); finishedAtRef.current ||= saved.startedAt + durationRef.current * 1000; }
  }, [userId]);

  const resumeExam = useCallback(() => {
    if (resumeBusy.current) return;
    resumeBusy.current = true;
    const saved = userId ? loadExamSession(userId) : null;
    if (!saved) {
      setResumable(null);
      resumeBusy.current = false;
      return;
    }
    restoreExam(saved);
  }, [userId, restoreExam]);

  const claimAndResumeLegacyExam = useCallback(() => {
    if (!userId) return;
    const claimed = claimLegacyExamSession(userId);
    setLegacyResumable(null);
    if (claimed) restoreExam(claimed);
    else setResumable(loadExamSession(userId));
  }, [userId, restoreExam]);

  const discardLegacyExam = useCallback(() => {
    discardLegacyExamSession();
    setLegacyResumable(null);
  }, []);

  const discardSavedExam = useCallback(() => {
    if (userId) clearExamSession(userId);
    setResumable(null);
  }, [userId]);

  /**
   * Build URLSearchParams from custom filter state. Bookmarks and notes are
   * client-side filters: their IDs are intersected into the `ids` param.
   */
  const buildCustomParams = useCallback((f: CustomFilters) => {
    const p = new URLSearchParams({ examSource, practiceMode: "exam" });
    if (f.subjects.length > 0) p.set("topics", f.subjects.join(","));
    const tagList = f.tags.split(",").map((s) => s.trim()).filter(Boolean);
    if (tagList.length > 0) p.set("tags", tagList.join(","));
    if (f.dateFrom) p.set("examDateFrom", f.dateFrom);
    if (f.dateTo) p.set("examDateTo", f.dateTo);
    if (f.search.trim()) p.set("search", f.search.trim());
    let ids: number[] | null = null;
    if (f.bookmarksOnly) ids = bookmarkIds;
    if (f.notesOnly) {
      const noteIds = listNoteQuestionIds();
      ids = ids ? ids.filter((x) => noteIds.includes(x)) : noteIds;
    }
    return { params: p, ids };
  }, [examSource, bookmarkIds]);

  // Debounced live count for the custom builder.
  useEffect(() => {
    if (selectedPart !== "custom") {
      setCustomCount(null);
      return;
    }
    if (customFilters.bookmarksOnly && !bookmarksReady) return;
    setCustomCounting(true);
    const controller = new AbortController();
    setCountError(false);
    const handle = setTimeout(async () => {
      try {
        const { params, ids } = buildCustomParams(customFilters);
        params.set("countOnly", "1");
        params.set("mcqOnly", "1");
        if (ids !== null) {
          if (ids.length === 0) { setCustomCount(0); setCustomCounting(false); return; }
          params.set("ids", ids.join(","));
        }
        const res = await fetch(`/api/questions?${params}`, { signal: controller.signal });
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok || typeof data.count !== "number") throw new Error("Count unavailable");
        setCustomCount(data.count);
      } catch {
        if (!controller.signal.aborted) { setCountError(true); setCustomCount(null); }
      } finally {
        setCustomCounting(false);
      }
    }, 300);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [selectedPart, customFilters, buildCustomParams, bookmarksReady]);

  const presetUnavailable = !!basePreset?.tagFilter && availability !== "ok";

  const loadExam = useCallback(async () => {
    if (!examPreferenceReady || tierLoading || !isPaid) return;
    if (userId && loadExamSession(userId) && !replaceAllowed.current) { setConfirmAction("replace"); return; }
    if (loadBusy.current) return;
    replaceAllowed.current = false;
    loadBusy.current = true;
    try {
      const request = examRequest.current.begin();
      setLoadFailure(null);
      setPhase("loading");
      setLoadProgress(0);
      const allQuestions: Question[] = [];
      const topicFailures: string[] = [];

      if (plan.part === "custom") {
        try {
          const { params, ids } = buildCustomParams(customFilters);
          params.set("limit", String(customFilters.limit));
          params.set("mcqOnly", "1");
          if (ids !== null) {
            if (ids.length === 0) {
              setLoadFailure(te("load_no_match", lang));
              setPhase("entry");
              return;
            }
            params.set("ids", ids.join(","));
          }
          setLoadProgress(40);
          const res = await fetch(`/api/questions?${params}`, { signal: request.signal, timeoutMs: 25_000 });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data: Question[] = await res.json();
          if (!request.current()) return;
          if (!Array.isArray(data)) throw new Error("invalid");
          allQuestions.push(...data);
          setLoadProgress(90);
          // With a failed count the learner may still start with what is served.
          const expected = countError ? data.length : Math.min(customCount ?? customFilters.limit, customFilters.limit);
          if (data.length === 0 || !isExamBatchComplete(data.length, expected)) topicFailures.push(`${te("part_custom", lang)}: ${data.length}/${expected}`);
        } catch (error) {
          if (!request.current()) return;
          topicFailures.push(`${te("part_custom", lang)}: ${error instanceof Error ? error.message : "error"}`);
        }
      } else {
        for (let i = 0; i < plan.blueprint.length; i++) {
          const { topic, count } = plan.blueprint[i];
          try {
            // practiceMode=exam: the blueprint draw never takes the due-review shortcut (UX-EXM-23).
            const params = new URLSearchParams({ topic, limit: String(count), examSource, mcqOnly: "1", practiceMode: "exam" });
            if (plan.tagsAny) params.set("tagsAny", plan.tagsAny.join(","));
            const res = await fetch(`/api/questions?${params}`, { signal: request.signal, timeoutMs: 25_000 });
            if (!res.ok) throw new Error(`${topic}: HTTP ${res.status}`);
            const data: Question[] = await res.json();
            if (!request.current()) return;
            if (!Array.isArray(data)) throw new Error(`${topic}: invalid`);
            allQuestions.push(...data);
            if (!isExamBatchComplete(data.length, count)) topicFailures.push(`${topic}: ${data.length}/${count}`);
          } catch (error) {
            if (!request.current()) return;
            topicFailures.push(error instanceof Error ? error.message : `${topic}: error`);
          }
          setLoadProgress(Math.round(((i + 1) / plan.blueprint.length) * 100));
        }
      }

      // A partial blueprint never looks like a completed full simulation, and
      // a long clock never starts on an unexpectedly small set (UX-EXM-23).
      if (topicFailures.length > 0 || allQuestions.length === 0) {
        setLoadFailure(
          `${te("load_incomplete", lang)} ${topicFailures.slice(0, 5).join(", ")}${topicFailures.length > 5 ? `, ${te("load_more_topics", lang)}` : ""}`
        );
        setPhase("entry");
        return;
      }

      // ECG quota (per Mohamed): every SIP4 or full run carries 2 to 3 ECG
      // questions, identified by "EKG" in the stem. Short runs fetch extras.
      const isEkg = (q: Question) => /ekg/i.test(q.question || "");
      if (plan.ekgQuota) {
        const target = 3;
        const present = allQuestions.filter(isEkg).length;
        const need = Math.max(0, target - present);
        if (need > 0) {
          try {
            const params = new URLSearchParams({ search: "EKG", limit: String(need + 4), mcqOnly: "1", examSource, practiceMode: "exam" });
            const res = await fetch(`/api/questions?${params}`, { signal: request.signal, timeoutMs: 25_000 });
            const ekgPool: Question[] = await res.json();
            if (Array.isArray(ekgPool)) {
              const seen = new Set(allQuestions.map((q) => q.id));
              const inject = ekgPool.filter((q) => !seen.has(q.id) && isEkg(q)).slice(0, need);
              for (const ekgQ of inject) {
                const replaceIdx = allQuestions.findIndex((q) => q.topic === ekgQ.topic && !isEkg(q));
                if (replaceIdx >= 0) allQuestions[replaceIdx] = ekgQ;
              }
            }
          } catch {
            /* best effort */
          }
        }
        if (allQuestions.filter(isEkg).length < target) {
          setLoadFailure(te("load_ekg", lang));
          setPhase("entry");
          return;
        }
      }

      if (!request.current()) return;
      // Questions of one subject come consecutively; shuffled within the subject.
      const groups = new Map<string, Question[]>();
      const topicOrder: string[] = [];
      for (const q of allQuestions) {
        const key = q.topic || "Sonstige";
        if (!groups.has(key)) {
          groups.set(key, []);
          topicOrder.push(key);
        }
        groups.get(key)!.push(q);
      }
      const grouped: Question[] = [];
      for (const topic of topicOrder) {
        const bucket = groups.get(topic)!;
        for (let i = bucket.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [bucket[i], bucket[j]] = [bucket[j], bucket[i]];
        }
        grouped.push(...bucket);
      }

      finaliseGuard.current.reset();
      // Custom runs get a clock from their real size; preset runs keep the preset clock.
      const durationS = plan.part === "custom" ? (plan.untimed ? 0 : customDurationS(grouped.length)) : plan.durationS;
      durationRef.current = durationS || PRACTICE_DURATION_S;
      runningSourceRef.current = examSource;
      finishedAtRef.current = null;
      setRunInfo({ presetId: plan.presetId, passRuleId: plan.passRuleId, untimed: plan.untimed, owed: plan.part === "custom" ? [] : owed });
      setTimeExpired(false); setTimerNotice(""); setClockNotice(""); setHistorySaveState("idle"); setSavedAttemptId(null); setAuthExpired(false);
      autosaveFails.current = 0; setAutosaveFailed(false); setOtherTab(false);
      startedAtRef.current = Date.now();
      visitsRef.current = [[0, Date.now()]];
      const nextAttemptId = crypto.randomUUID();
      currentAttemptRef.current = nextAttemptId;
      setExamAttemptId(nextAttemptId);
      examReadyRef.current = true;
      if (userId) clearExamSession(userId);
      setQuestions(grouped);
      setAnswers({});
      setFlaggedIdxs(new Set());
      setCurrentIdx(0);
      setPhase("exam");
    } finally { loadBusy.current = false; }
  }, [examSource, plan, owed, customFilters, buildCustomParams, customCount, countError, lang, examPreferenceReady, userId, isPaid, tierLoading]);

  const handleSubmitExam = useCallback((expired = false) => {
    finaliseGuard.current.run(() => {
      finishedAtRef.current = expired && startedAtRef.current !== null ? startedAtRef.current + durationRef.current * 1000 : Date.now();
      setTimeExpired(expired);
      setShowSubmitConfirm(false); setMobileDrawerOpen(false);
      setPhase("results");
    });
  }, []);

  const onClockExpire = useCallback(() => handleSubmitExam(true), [handleSubmitExam]);
  const onClockMilestone = useCallback((minutes: number) => setTimerNotice(t("exam_time_notice", lang).replace("{n}", String(minutes))), [lang]);
  const onClockResync = useCallback((secondsLeft: number) => {
    const h = Math.floor(secondsLeft / 3600), m = Math.floor((secondsLeft % 3600) / 60), s = secondsLeft % 60;
    setClockNotice(t("exam_clock_resynced", lang).replace("{time}", `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`));
  }, [lang]);

  // Navigation log for the per-subject average time (pick-exam-pace A).
  useEffect(() => {
    if (phase !== "exam") return;
    const last = visitsRef.current[visitsRef.current.length - 1];
    if (!last || last[0] !== currentIdx) {
      visitsRef.current.push([currentIdx, Date.now()]);
      if (visitsRef.current.length > MAX_VISITS) visitsRef.current = visitsRef.current.slice(-MAX_VISITS);
    }
  }, [phase, currentIdx]);

  useLayoutEffect(() => {
    if (phase !== "exam" && phase !== "review") return;
    if (paneRef.current) paneRef.current.scrollTop = 0;
    else window.scrollTo(0, 0);
    paneRef.current?.querySelector<HTMLElement>("[data-question-heading]")?.focus({ preventScroll: true });
  }, [currentIdx, reviewIdx, phase]);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine); sync();
    window.addEventListener("online", sync); window.addEventListener("offline", sync);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);

  useEffect(() => {
    if (phase !== "exam" || !("wakeLock" in navigator)) return;
    let disposed = false;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try { const next = await navigator.wakeLock.request("screen"); if (disposed) { await next.release(); return; } lock = next; setAwake(true); next.addEventListener("release", () => { if (!disposed) setAwake(false); }); } catch { if (!disposed) setAwake(false); }
    };
    void acquire(); document.addEventListener("visibilitychange", acquire);
    return () => { disposed = true; setAwake(false); document.removeEventListener("visibilitychange", acquire); void lock?.release(); };
  }, [phase]);

  useEffect(() => { if (!clockNotice) return; const timer = setTimeout(() => setClockNotice(""), 5000); return () => clearTimeout(timer); }, [clockNotice]);

  // UX-EXM-15: a second tab writing the same exam is announced, never silent.
  useEffect(() => {
    if (phase !== "exam" || !userId) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key.startsWith("medpruef_exam_autosave:v1:") && event.key.endsWith(encodeURIComponent(userId))) setOtherTab(true);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [phase, userId]);

  useEffect(() => {
    if (!userId || phase !== "entry") return;
    const attempt = searchParams.get("attempt");
    if (attempt && /^[a-f0-9-]{36}$/i.test(attempt)) { window.location.replace(`/history/${encodeURIComponent(attempt)}`); return; }
    if (recoveredPending.current) return;
    recoveredPending.current = true;
    const pending = loadPendingExams(userId)[0];
    if (pending) restoreExam(pending);
  }, [userId, phase, restoreExam, searchParams]);

  // Persist exam progress on every meaningful change. The question array is
  // stored verbatim (answers are keyed by position) and the timer as the
  // absolute startedAt, so a refresh restores the same exam and clock.
  useEffect(() => {
    if (phase !== "exam" || !userId || !examReadyRef.current || startedAtRef.current === null) return;
    const ok = saveExamSession(userId, {
      startedAt: startedAtRef.current, durationS: runInfo.untimed ? 0 : durationRef.current,
      questions,
      answers,
      flaggedIdxs: [...flaggedIdxs],
      currentIdx,
      selectedPart,
      examSource: runningSourceRef.current,
      attemptId: examAttemptId || crypto.randomUUID(),
      presetId: runInfo.presetId,
      passRuleId: runInfo.passRuleId,
      untimed: runInfo.untimed,
      owed: runInfo.owed,
      visits: visitsRef.current,
    });
    autosaveFails.current = ok ? 0 : autosaveFails.current + 1;
    setAutosaveFailed(autosaveFails.current >= 2);
  }, [phase, userId, questions, answers, flaggedIdxs, currentIdx, selectedPart, examSource, examAttemptId, runInfo]);

  // A result the server permanently refused is only removed on an explicit choice.
  const discardRejectedResult = () => {
    if (userId && examAttemptId) {
      acknowledgePendingExam(userId, examAttemptId);
      if (loadExamSession(userId)?.attemptId === examAttemptId) clearExamSession(userId);
    }
    examReadyRef.current = false;
    window.history.replaceState(null, "", "/exam");
    setHistorySaveState("idle");
    setPhase("entry");
  };

  // Every terminal path (submit, time-up) saves the attempt to the durable
  // History ledger and acknowledges success before clearing the local copy.
  useEffect(() => {
    if (phase === "results" && historySaveState !== "saved" && historySaveState !== "rejected") {
      const snapshotQuestions = questions;
      const snapshotAnswers = answers;
      const startedAt = startedAtRef.current;
      if (snapshotQuestions.length > 0 && userId && examAttemptId && !saveInFlight.current.has(examAttemptId || "")) {
        finishedAtRef.current ||= Date.now();
        setPendingLocal(savePendingExam(userId, {
          startedAt: startedAt || Date.now(), durationS: runInfo.untimed ? 0 : durationRef.current, finishedAt: finishedAtRef.current, timeExpired,
          questions: snapshotQuestions, answers: snapshotAnswers, flaggedIdxs: [...flaggedIdxs], currentIdx, selectedPart,
          examSource: runningSourceRef.current, attemptId: examAttemptId,
          presetId: runInfo.presetId, passRuleId: runInfo.passRuleId, untimed: runInfo.untimed, owed: runInfo.owed, visits: visitsRef.current,
        }));

        // SELECTED OPTION TEXTS, not indices: /api/questions shuffles options
        // per load, so indices are meaningless against the stored choices.
        const answersByQid: Record<string, string[]> = {};
        snapshotQuestions.forEach((q, idx) => {
          const sel = snapshotAnswers[idx];
          if (Array.isArray(sel) && sel.length > 0 && q.options) {
            const texts = sel.map((i) => q.options?.[i]?.text).filter((x): x is string => typeof x === "string");
            if (texts.length > 0) answersByQid[String(q.id)] = texts;
          }
        });
        const preset = runInfo.presetId ? EXAM_PRESETS[runInfo.presetId] : null;
        const passRule = runVerdict(runInfo.passRuleId, []);
        const attemptBody = {
          exam_type: runningSourceRef.current,
          title: `${te(partLabelKey(runningSourceRef.current, normalizePart(runningSourceRef.current, selectedPart)), "de")}${runInfo.owed.length > 0 ? ` (${runInfo.owed.length} Fächer)` : ""}`,
          config: {
            kind: "mcq",
            part: selectedPart,
            presetId: preset?.id ?? null,
            passRuleId: runInfo.passRuleId,
            ruleStatus: passRule.ruleStatus,
            subjects: selectedPart === "custom" ? customFilters.subjects : [],
            owed: runInfo.owed,
            count: snapshotQuestions.length, durationS: runInfo.untimed ? 0 : durationRef.current, untimed: runInfo.untimed, timeExpired,
            flagged_ids: [...flaggedIdxs].map((i) => snapshotQuestions[i]?.id).filter((id): id is number => typeof id === "number"),
          },
          question_ids: snapshotQuestions.map((q) => q.id),
          answers: answersByQid,
          duration_ms: startedAt !== null ? finishedAtRef.current - startedAt : null,
          started_at: startedAt !== null ? new Date(startedAt).toISOString() : null,
          attempt_id: examAttemptId,
        };
        saveInFlight.current.add(examAttemptId);

        setHistorySaveState("saving");
        void (async () => {
          try {
            const res = await fetch("/api/history/exams", {
              method: "POST",
              skipAuthRedirect: true,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(attemptBody),
            });
            if (res.status === 401 && currentAttemptRef.current === examAttemptId) setAuthExpired(true);
            // 400/402/403 are final (invalid payload, free allowance, lapsed
            // access): stop retrying and let the learner discard the result.
            if (res.status === 400 || res.status === 402 || res.status === 403) {
              if (currentAttemptRef.current === examAttemptId) setHistorySaveState("rejected");
              return;
            }
            if (!res.ok) throw new Error(`History save failed (${res.status})`);
            const data = await res.json();
            if (!data?.attempt?.id || data?.attempt?.attempt_id !== examAttemptId) throw new Error("History save was not acknowledged");
            acknowledgePendingExam(userId, examAttemptId);
            if (currentAttemptRef.current !== examAttemptId) return;
            setAuthExpired(false);
            window.history.replaceState(null, "", `/exam?attempt=${data.attempt.id}`);
            setSavedAttemptId(data.attempt.id);
            setHistorySaveState("saved");
            if (userId && loadExamSession(userId)?.attemptId === examAttemptId) clearExamSession(userId);
            examReadyRef.current = false;
          } catch (error) {
            console.error("[exam] history save failed", error);
            if (currentAttemptRef.current === examAttemptId) setHistorySaveState("failed");
          } finally { saveInFlight.current.delete(examAttemptId); }
        })();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, historySaveRetry]);

  useEffect(() => {
    if ((phase !== "results" && phase !== "review") || historySaveState === "saved" || historySaveState === "rejected") return;
    const retry = () => { if (navigator.onLine && !saveInFlight.current.has(examAttemptId || "")) { setPhase((p) => (p === "review" ? p : "results")); setHistorySaveRetry(n => n + 1); } };
    const timer = setTimeout(retry, Math.min(60_000, 5_000 * 2 ** Math.min(historySaveRetry, 4)));
    window.addEventListener("online", retry); window.addEventListener("pageshow", retry); document.addEventListener("visibilitychange", retry);
    return () => { clearTimeout(timer); window.removeEventListener("online", retry); window.removeEventListener("pageshow", retry); document.removeEventListener("visibilitychange", retry); };
  }, [phase, historySaveState, historySaveRetry, examAttemptId]);

  useEffect(() => {
    if (phase !== "exam" && !((phase === "results" || phase === "review") && historySaveState !== "saved" && historySaveState !== "rejected")) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const click = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.closest('[role="dialog"]') || anchor.href.includes("/login?")) return;
      event.preventDefault(); event.stopPropagation(); setPendingDestination(anchor.href);
      setConfirmAction(phase === "exam" ? "leave" : "unsaved");
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", click, true); };
  }, [phase, historySaveState]);

  // UX-GLOBAL-15: the result's save chip is plain text; speak changes once.
  useEffect(() => {
    if (phase !== "results") return;
    if (historySaveState === "saved") announce(t("result_saved", lang));
    else if (historySaveState === "failed") announce(t("result_not_saved", lang), "assertive");
  }, [phase, historySaveState, lang]);

  useEffect(() => {
    if (phase !== "exam" && phase !== "review") return;
    // A same-URL history entry lets Back ask before leaving the exam, and
    // returns from the review to the result instead of leaving /exam (UX-EXM-02).
    const url = window.location.pathname + window.location.search;
    window.history.pushState({ ...window.history.state, mpExamFocus: true }, "", url);
    const back = () => {
      // An overlay closing through Back is not the learner leaving the exam.
      if (consumeSelfPop() || hasHistoryOverlay()) return;
      if (phase === "review") { setPhase("results"); return; }
      window.history.pushState({ ...window.history.state, mpExamFocus: true }, "", url); setConfirmAction("leave");
    };
    window.addEventListener("popstate", back);
    return () => { window.removeEventListener("popstate", back); if (window.history.state?.mpExamFocus) { const state = { ...window.history.state }; delete state.mpExamFocus; window.history.replaceState(state, "", window.location.href); } };
  }, [phase]);

  const resumableAnswered = Object.values(resumable?.answers || {}).filter(a => a.length).length;
  const leaveBody = autosaveFailed || !storageOk ? te("storage_unavailable", lang) : t("exam_leave_body", lang);
  const safetyDialog = <Dialog open={confirmAction !== null} onOpenChange={open => { if (!open) { setConfirmAction(null); setPendingDestination(null); } }} hideCloseButton kind="confirm" title={t(confirmAction === "replace" ? "exam_replace" : confirmAction === "discard" ? "exam_discard_body" : confirmAction === "leave" ? "exam_leave" : "exam_not_saved", lang).replace("{n}", String(resumableAnswered))} footer={<>
    <button data-dialog-safe className="mp-btn mp-btn--secondary" onClick={() => { setConfirmAction(null); setPendingDestination(null); }}>{t("exam_keep", lang)}</button>
    {confirmAction === "unsaved" && historySaveState === "rejected" && <button className="mp-btn mp-btn--primary" onClick={() => { setConfirmAction(null); discardRejectedResult(); }}>{te("discard_result", lang)}</button>}
    {confirmAction === "unsaved" && historySaveState !== "rejected" && <button className="mp-btn mp-btn--primary" disabled={historySaveState === "saving"} onClick={() => { setConfirmAction(null); setPhase("results"); setHistorySaveRetry(n => n + 1); }}>{t("exam_retry_save", lang)}</button>}
    <button className="mp-btn mp-btn--secondary" onClick={() => {
      const action = confirmAction; setConfirmAction(null);
      if (action === "replace") { replaceAllowed.current = true; void loadExam(); }
      else if (action === "discard") discardSavedExam();
      else if (pendingDestination) { window.location.assign(pendingDestination); }
      else { window.history.replaceState(null, "", "/exam"); setPhase("entry"); }
    }}>{t(confirmAction === "replace" ? "exam_replace" : confirmAction === "leave" ? "exam_leave" : confirmAction === "discard" ? "exam_discard" : "exam_continue_anyway", lang)}</button>
  </>}><p>{confirmAction === "leave" ? leaveBody : t(confirmAction === "replace" ? "exam_replace_body" : confirmAction === "discard" ? "exam_discard_body" : "exam_unsaved_confirm", lang).replace("{n}", String(resumableAnswered)).replace("{minutes}", String(Math.max(0, Math.floor((Date.now() - (resumable?.startedAt || Date.now())) / 60000))))}</p></Dialog>;

  const toggleFlag = useCallback((idx: number) => {
    setFlaggedIdxs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const currentIdxRef = useRef(currentIdx);
  currentIdxRef.current = currentIdx;
  const onCommit = useCallback((idxs: number[]) => {
    setAnswers((prev) => updateExamSelection(prev, currentIdxRef.current, idxs));
  }, []);
  const jumpTo = useCallback((idx: number) => { setCurrentIdx(idx); setMobileDrawerOpen(false); }, []);

  // Topic groups used by the navigator section headers.
  const topicGroups = useMemo(() => {
    const groups: { topic: string; startIdx: number; count: number }[] = [];
    let lastTopic = "";
    for (let i = 0; i < questions.length; i++) {
      const topic = questions[i].topic || "Sonstige";
      if (topic !== lastTopic) {
        groups.push({ topic, startIdx: i, count: 1 });
        lastTopic = topic;
      } else {
        groups[groups.length - 1].count++;
      }
    }
    return groups;
  }, [questions]);

  const cellStates = useMemo<CellState[]>(() => questions.map((q, i) => {
    const s = examSelectionState(requiredCount(q), answers[i]);
    return s === "empty" ? "open" : s === "partial" ? "partial" : "answered";
  }), [questions, answers]);

  const reviewVerdicts = useMemo<CellVerdict[]>(() => questions.map((q, i) => {
    const g = gradeAt(q, answers[i]);
    return g.correct ? "right" : g.answered ? "wrong" : "open";
  }), [questions, answers]);

  const runDurationLabel = (seconds: number, untimed: boolean) => (untimed ? te("duration_untimed", lang) : formatDurationLabel(seconds, examLang(lang)));

  // ── ENTRY ──
  if (phase === "entry") {
    const preset = basePreset;
    const formatKey = preset?.formatExamKey ?? (examSource === "kmp_innsbruck" ? "stichprobentest" : examSource === "pharma" ? "rezeptierkunde" : "sip4a");
    const allBlueprint = preset?.blueprint ?? [];
    const thresholdKey: ExamCopyKey = plan.passRuleId === "overall-60" ? "threshold_practice" : plan.passRuleId === "sip-overall-and-blocks-60" ? "threshold_rule" : "threshold_none";
    const durationText = plan.durationKind === "official"
      ? te("duration_official", lang, { duration: runDurationLabel(plan.durationS, false) })
      : te("duration_practice", lang, { duration: runDurationLabel(plan.durationS, plan.untimed) });
    const partLine = plan.part === "custom"
      ? te("part_line_custom", lang, { duration: plan.untimed ? te("duration_untimed", lang) : te("duration_practice", lang, { duration: runDurationLabel(plan.durationS, false) }) })
      : te("part_line", lang, { count: plan.total, threshold: te(thresholdKey, lang), duration: durationText });
    const customReady = plan.part !== "custom" || ((customCount !== null && customCount > 0) || countError) && !(customFilters.bookmarksOnly && !bookmarksReady);
    const startDisabled = Boolean(loadFailure) || !examPreferenceReady || !customReady || (plan.part !== "custom" && (presetUnavailable || plan.total === 0));
    const startCount = plan.part === "custom" ? (countError ? customFilters.limit : Math.min(customCount ?? 0, customFilters.limit)) : plan.total;
    const scopeKey: ExamCopyKey | null = examSource === "kmp_innsbruck" && plan.part !== "custom" ? "scope_kmp" : examSource === "pharma" && plan.part !== "custom" ? "scope_pharma" : null;

    return (
      <div className="app-layout">
        {safetyDialog}
        <Sidebar lang={lang} userId={userId} userName={userName} />
        <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
          <PartialTranslationNote />
          <div className="px-4 lg:px-10 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border)]">
            <Link href="/" className="text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] text-sm transition-colors min-h-11 inline-flex items-center">
              ← {t("back_home", lang)}
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageToggle lang={lang} onChange={switchLang} />
            </div>
          </div>

          <div className="px-4 pt-6 pb-32 lg:pb-12">
            <div className="max-w-lg w-full mx-auto">
              {legacyResumable && !resumable && (() => {
                const savedAnswered = Object.keys(legacyResumable.answers || {}).length;
                const savedTotal = legacyResumable.questions.length;
                return (
                  <div className="mb-6 mp-card p-4">
                    <p className="text-sm font-semibold text-[var(--mp-fg)] mb-1">{te("legacy_title", lang)}</p>
                    <p className="text-sm text-[var(--mp-fg-muted)]">{te("legacy_body", lang, { answered: savedAnswered, total: savedTotal })}</p>
                    <div className="flex gap-2 mt-3">
                      <button type="button" onClick={claimAndResumeLegacyExam} className="mp-btn mp-btn--primary min-h-11">{te("legacy_resume", lang)}</button>
                      <button type="button" onClick={discardLegacyExam} className="mp-btn mp-btn--ghost min-h-11">{te("discard", lang)}</button>
                    </div>
                  </div>
                );
              })()}
              {resumable && (() => {
                const savedTotal = resumable.questions.length;
                const untimed = !!resumable.untimed;
                const left = untimed ? 1 : remainingSeconds(resumable.startedAt, resumable.durationS);
                const expired = left <= 0;
                const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60);
                const timeText = `${h}:${String(m).padStart(2, "0")}`;
                return (
                  <div className="mb-6 mp-card p-4 border border-[var(--mp-viridian)]/40">
                    <p className="text-sm font-semibold text-[var(--mp-fg)] mb-0.5">{te(expired ? "resume_expired_title" : "resume_title", lang)}</p>
                    <p className="text-sm text-[var(--mp-fg-muted)]">
                      {expired ? te("resume_expired_body", lang, { answered: resumableAnswered, total: savedTotal })
                        : untimed ? te("resume_body_untimed", lang, { answered: resumableAnswered, total: savedTotal })
                          : te("resume_body", lang, { answered: resumableAnswered, total: savedTotal, time: timeText })}
                    </p>
                    {!untimed && !expired && <p className="text-[13px] text-[var(--mp-fg-muted)]">{te("duration_practice", lang, { duration: formatDurationLabel(resumable.durationS || PRACTICE_DURATION_S, examLang(lang)) })}</p>}
                    <div className="flex flex-col gap-2 mt-3">
                      <button type="button" onClick={resumeExam} className="mp-btn mp-btn--primary w-full min-h-12">
                        {expired ? te("resume_view_result", lang) : t("exam_resume_primary", lang)}
                      </button>
                      <button type="button" onClick={() => setConfirmAction("discard")} className="mp-btn mp-btn--ghost min-h-11 mt-4 text-[var(--mp-error-text)]">
                        {te("discard", lang)}
                      </button>
                    </div>
                  </div>
                );
              })()}
              {userId && loadPendingExams(userId).length > 0 && <div className="mp-card p-4 mb-4"><p>{t("exam_not_saved", lang)}</p><button className="mp-btn mp-btn--secondary min-h-11" onClick={() => { const pending = loadPendingExams(userId)[0]; if (pending) restoreExam(pending); }}>{t("exam_retry_save", lang)}</button></div>}
              {isPaid && <LatestSimulation lang={lang} />}

              <div className="mb-5">
                <div className="flex items-center gap-3 mb-1">
                  <span className="w-10 h-10 rounded-xl bg-[var(--mp-oxford-blue)]/10 text-[var(--mp-oxford-blue)] dark:text-[var(--mp-fg)] flex items-center justify-center shrink-0"><GraduationCap className="w-5 h-5" aria-hidden /></span>
                  <h1 className="mp-h2">{te("entry_title", lang)}</h1>
                </div>
                {plan.part !== "custom" && plan.blueprint.length > 0 && (
                  <p className="text-sm text-[var(--mp-fg-muted)]">{te("entry_summary", lang, { count: plan.total, subjects: plan.blueprint.length })}</p>
                )}
              </div>

              {/* Part selector: a radiogroup of 44 px pills, remembered per bank (UX-EXM-16/18/26). */}
              <fieldset className="mb-3">
                <legend className="text-sm font-semibold text-[var(--mp-fg)] mb-2">{te("entry_part_label", lang)}</legend>
                <div role="radiogroup" className="flex flex-wrap gap-2">
                  {parts.map((p) => {
                    const checked = selectedPart === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        onClick={() => choosePart(p)}
                        className={`min-h-11 px-4 rounded-full text-sm font-semibold inline-flex items-center gap-1.5 transition-colors ${checked
                          ? "bg-[var(--mp-viridian)]/10 border-[1.5px] border-[var(--mp-viridian)] text-[var(--mp-fg)]"
                          : "bg-[var(--mp-surface-raised)] border border-[var(--mp-border-control,var(--mp-border))] text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"}`}
                      >
                        {checked && <Check className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden />}
                        {te(partLabelKey(examSource, p), lang)}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-sm text-[var(--mp-fg)] tabular-nums">{partLine}</p>
              </fieldset>

              {/* SIM-03: which subjects the learner still owes, for SIP4a and SIP5a. */}
              {(selectedPart === "sip4" || selectedPart === "sip5") && preset && (
                <fieldset className="mb-4 mp-card p-4">
                  <legend className="text-sm font-semibold text-[var(--mp-fg)] px-1">{te("owed_label", lang)}</legend>
                  <div className="grid gap-1 mt-1">
                    {preset.blueprint.map((e) => (
                      <label key={e.topic} className="flex items-center gap-3 min-h-11 text-sm text-[var(--mp-fg)] cursor-pointer">
                        <input
                          type="checkbox"
                          className="w-5 h-5 accent-[var(--mp-viridian)]"
                          checked={owed.length === 0 || owed.includes(e.topic)}
                          onChange={(ev) => {
                            const current = owed.length === 0 ? preset.blueprint.map((b) => b.topic) : owed;
                            const next = ev.target.checked ? [...new Set([...current, e.topic])] : current.filter((s) => s !== e.topic);
                            setOwed(next.length === preset.blueprint.length ? [] : next);
                          }}
                        />
                        <span className="flex-1">{e.topic}</span>
                        <span className="font-mono text-[13px] text-[var(--mp-fg-muted)]">{e.count}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-[13px] text-[var(--mp-fg-muted)] mt-1">{te("owed_hint", lang)}</p>
                </fieldset>
              )}

              {/* Blueprint, collapsed (UX-EXM-16). */}
              {selectedPart !== "custom" && allBlueprint.length > 1 && (
                <div className="mb-4">
                  <button type="button" className="mp-btn mp-btn--ghost min-h-11 px-1" aria-expanded={showBlueprint} onClick={() => setShowBlueprint((v) => !v)}>
                    <ChevronDown className={`w-4 h-4 transition-transform ${showBlueprint ? "rotate-180" : ""}`} aria-hidden />
                    {showBlueprint ? te("blueprint_hide", lang) : te("blueprint_show", lang, { n: plan.blueprint.length })}
                  </button>
                  {showBlueprint && (
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-1 text-[13px] text-[var(--mp-fg)]">
                      {plan.blueprint.map(({ topic, count }) => (
                        <li key={topic} className="flex items-center gap-2 min-w-0">
                          <TopicIcon name={getTopicConfig(topic).icon} className="w-4 h-4 shrink-0" />
                          <span className="flex-1 min-w-0 break-words">{topic}</span>
                          <span className="font-mono tabular-nums text-[var(--mp-fg-muted)]">{count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Custom builder for every MCQ bank (UX-EXM-24/26). */}
              {selectedPart === "custom" && (
                <div className="mb-4 mp-card p-4 space-y-4">
                  {weakTopics.length > 0 && (
                    <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => setCustomFilters((f) => ({ ...f, subjects: weakTopics }))}>
                      {te("custom_weakest", lang)}
                    </button>
                  )}
                  <fieldset>
                    <legend className="block text-sm font-semibold text-[var(--mp-fg)] mb-2">{t("custom_subjects", lang)}</legend>
                    <div className="flex flex-wrap gap-2">
                      {(preset?.blueprint ?? EXAM_PRESETS[examSource === "kmp_innsbruck" ? "kmp_innsbruck_legacy" : examSource === "pharma" ? "rx_mc_30" : "kp_full"].blueprint).map(({ topic }) => {
                        const checked = customFilters.subjects.includes(topic);
                        return (
                          <label key={topic} className={`min-h-11 px-3 py-2 rounded-xl border text-sm cursor-pointer inline-flex items-center gap-2 ${checked ? "bg-[var(--mp-viridian)]/10 border-[var(--mp-viridian)] text-[var(--mp-fg)]" : "bg-[var(--mp-surface-raised)] border-[var(--mp-border)] text-[var(--mp-fg-muted)]"}`}>
                            <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => setCustomFilters((f) => ({ ...f, subjects: e.target.checked ? [...f.subjects, topic] : f.subjects.filter((s) => s !== topic) }))} />
                            {checked && <Check className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden />}
                            <span className="break-words">{topic}</span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-[13px] text-[var(--mp-fg-muted)] mt-2">{te("custom_all_subjects", lang)}</p>
                  </fieldset>

                  <fieldset>
                    <legend className="block text-sm font-semibold text-[var(--mp-fg)] mb-2">{te("custom_count_label", lang)}</legend>
                    <div className="flex flex-wrap items-center gap-2">
                      {CUSTOM_COUNT_CHIPS.map((n) => (
                        <button key={n} type="button" aria-pressed={customFilters.limit === n} onClick={() => setCustomFilters((f) => ({ ...f, limit: n, untimed: n <= UNTIMED_MAX_QUESTIONS ? f.untimed : false }))}
                          className={`min-h-11 min-w-11 px-3 rounded-full border text-sm font-semibold ${customFilters.limit === n ? "bg-[var(--mp-viridian)]/10 border-[var(--mp-viridian)] text-[var(--mp-fg)]" : "bg-[var(--mp-surface-raised)] border-[var(--mp-border)] text-[var(--mp-fg-muted)]"}`}>{n}</button>
                      ))}
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={200}
                        aria-label={te("custom_count_label", lang)}
                        value={customFilters.limit}
                        onChange={(e) => {
                          const n = Math.max(1, Math.min(200, Number.parseInt(e.target.value || "0", 10) || 1));
                          setCustomFilters((f) => ({ ...f, limit: n, untimed: n <= UNTIMED_MAX_QUESTIONS ? f.untimed : false }));
                        }}
                        className="w-20 min-h-11 px-3 text-base rounded-lg border border-[var(--mp-border-control,var(--mp-border))] bg-[var(--mp-surface-raised)] text-[var(--mp-fg)]"
                      />
                    </div>
                  </fieldset>

                  {customFilters.limit <= UNTIMED_MAX_QUESTIONS && (
                    <Switch checked={customFilters.untimed} onChange={(on) => setCustomFilters((f) => ({ ...f, untimed: on }))} label={te("custom_untimed", lang)} />
                  )}

                  <details className="rounded-lg border border-[var(--mp-border)] p-3">
                    <summary className="min-h-11 flex items-center text-sm font-semibold text-[var(--mp-fg)] cursor-pointer">{te("custom_more_filters", lang)}</summary>
                    <div className="space-y-3 mt-2">
                      <label className="block text-sm text-[var(--mp-fg)]">{t("custom_tags", lang)}
                        <input type="text" value={customFilters.tags} onChange={(e) => setCustomFilters((f) => ({ ...f, tags: e.target.value }))} placeholder="cardio, sip4a" className="mt-1 w-full min-h-11 px-3 text-base rounded-lg border border-[var(--mp-border-control,var(--mp-border))] bg-[var(--mp-surface-raised)]" />
                      </label>
                      <fieldset>
                        <legend className="text-sm text-[var(--mp-fg)]">{t("custom_date_range", lang)}</legend>
                        <div className="flex items-center gap-2 mt-1">
                          <input type="month" aria-label={t("custom_date_range", lang)} value={customFilters.dateFrom} onChange={(e) => setCustomFilters((f) => ({ ...f, dateFrom: e.target.value }))} className="flex-1 min-w-0 min-h-11 px-2 text-base rounded-lg border border-[var(--mp-border-control,var(--mp-border))] bg-[var(--mp-surface-raised)]" />
                          <span className="text-sm text-[var(--mp-fg-muted)]" aria-hidden>{te("date_to", lang)}</span>
                          <input type="month" aria-label={t("custom_date_range", lang)} value={customFilters.dateTo} onChange={(e) => setCustomFilters((f) => ({ ...f, dateTo: e.target.value }))} className="flex-1 min-w-0 min-h-11 px-2 text-base rounded-lg border border-[var(--mp-border-control,var(--mp-border))] bg-[var(--mp-surface-raised)]" />
                        </div>
                      </fieldset>
                      <label className="flex items-center gap-3 min-h-11 text-sm text-[var(--mp-fg)]"><input type="checkbox" className="w-5 h-5" checked={customFilters.bookmarksOnly} onChange={(e) => setCustomFilters((f) => ({ ...f, bookmarksOnly: e.target.checked }))} />{t("custom_bookmarks_only", lang)}</label>
                      <label className="flex items-center gap-3 min-h-11 text-sm text-[var(--mp-fg)]"><input type="checkbox" className="w-5 h-5" checked={customFilters.notesOnly} onChange={(e) => setCustomFilters((f) => ({ ...f, notesOnly: e.target.checked }))} />{t("custom_notes_only", lang)}</label>
                      <label className="block text-sm text-[var(--mp-fg)]">{t("custom_search_label", lang)}
                        <input type="text" value={customFilters.search} onChange={(e) => setCustomFilters((f) => ({ ...f, search: e.target.value }))} placeholder={t("search_placeholder", lang)} className="mt-1 w-full min-h-11 px-3 text-base rounded-lg border border-[var(--mp-border-control,var(--mp-border))] bg-[var(--mp-surface-raised)]" />
                      </label>
                    </div>
                  </details>

                  <div className="pt-3 border-t border-[var(--mp-border)]" role="status">
                    {customCounting ? (
                      <p className="text-sm text-[var(--mp-fg-muted)]">{t("custom_loading_count", lang)}</p>
                    ) : countError ? (
                      <Alert variant="warning">{te("custom_count_error", lang)}</Alert>
                    ) : customCount === 0 ? (
                      <p className="text-sm text-[var(--mp-error-text)] font-semibold">{t("custom_no_matches", lang)}</p>
                    ) : (
                      <p className="text-sm text-[var(--mp-fg)]"><span className="font-mono font-bold tabular-nums">{customCount ?? ""}</span> {te("custom_matching", lang)}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Pharma MC availability (SIM-05): built now, live once the reviewed rows exist. */}
              {basePreset?.tagFilter && availability !== "ok" && (
                <div className="mp-card p-4 mb-4" role="status">
                  {availability === "checking" || availability === "idle" ? (
                    <p className="text-sm text-[var(--mp-fg-muted)]">{te("availability_checking", lang)}</p>
                  ) : availability === "error" ? (
                    <DataRegion error retry={() => setAvailabilityRetry((n) => n + 1)} />
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-[var(--mp-fg)] mb-1">{te("pharma_unavailable_title", lang)}</p>
                      <p className="text-sm text-[var(--mp-fg-muted)] mb-3">{te("pharma_unavailable_body", lang)}</p>
                      <Link href="/quiz?examSource=pharma" className="mp-btn mp-btn--secondary min-h-11">{te("pharma_go_quiz", lang)}</Link>
                    </>
                  )}
                </div>
              )}

              <ExamFormatLine formatExamKey={formatKey} lang={lang} />
              {!storageOk && <Alert variant="error" className="mb-4">{te("storage_unavailable", lang)}</Alert>}
              <ExamEntryFacts lang={lang} untimed={plan.untimed} scopeKey={scopeKey} />

              {kafAvailable && (
                <div className="mp-card p-4 mb-4">
                  <p className="text-sm font-semibold text-[var(--mp-fg)] inline-flex items-center gap-2"><NotebookPen className="w-4 h-4" aria-hidden />{te("kaf_card_title", lang)}</p>
                  <p className="text-sm text-[var(--mp-fg-muted)] mt-1 mb-2">{te("kaf_card_body", lang)}</p>
                  <Link href="/exam/kaf" className="mp-btn mp-btn--secondary min-h-11">{te("kaf_card_cta", lang)}</Link>
                </div>
              )}

              <DataRegion error={countError && selectedPart !== "custom"} retry={() => { setCustomFilters(f => ({ ...f })); }} />
              {loadFailure && (
                <div role="alert" className="mb-5 rounded-xl border border-[var(--mp-error)]/30 bg-[var(--mp-error-bg)] p-4 text-sm text-[var(--mp-error-text)]">
                  <p className="font-semibold">{loadFailure}</p>
                  <button type="button" onClick={() => { setLoadFailure(null); void loadExam(); }} disabled={!examPreferenceReady || (customFilters.bookmarksOnly && !bookmarksReady)} className="mp-btn mp-btn--secondary mt-3 min-h-11 disabled:opacity-50">
                    {te("retry", lang)}
                  </button>
                </div>
              )}
            </div>
          </div>
          {!(basePreset?.tagFilter && availability !== "ok") && (
            <StickyActionBar label={te("start", lang)}>
              <button
                type="button"
                onClick={loadExam}
                aria-disabled={startDisabled || undefined}
                disabled={startDisabled}
                className="mp-btn mp-btn--primary w-full max-w-lg mx-auto min-h-12 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <GraduationCap className="w-5 h-5" aria-hidden /> {resumable ? te("start_replace", lang) : startCount > 0 ? te("start_count", lang, { n: startCount }) : te("start", lang)}
              </button>
            </StickyActionBar>
          )}
        </main>
        <BottomNav lang={lang} userId={userId} />
      </div>
    );
  }

  // ── LOADING ──
  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)] px-4">
        <div className="text-center animate-fade-in max-w-sm w-full">
          <GraduationCap className="w-10 h-10 text-[var(--mp-oxford-blue)] dark:text-[var(--mp-fg)] mx-auto mb-4" aria-hidden />
          <p className="text-[var(--mp-fg)] font-semibold mb-6">{te("loading", lang)}</p>
          <div className="bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded-full h-2 mb-3 overflow-hidden">
            <div className="h-full bg-[var(--mp-viridian)] rounded-full transition-all duration-300" style={{ width: `${loadProgress}%` }} />
          </div>
          <p className="text-[var(--mp-fg-muted)] text-sm font-mono" role="status">{loadProgress} %</p>
          <button type="button" className="mp-btn mp-btn--secondary mt-4 min-h-11" onClick={() => { examRequest.current.cancel(); setPhase("entry"); }}>{te("cancel", lang)}</button>
        </div>
      </div>
    );
  }

  const runCountsNow = runCounts(questions, answers, flaggedIdxs);

  // ── REVIEW ── (UX-EXM-32/34): filters with counts, position in the filtered set, grid sheet.
  if (phase === "review") {
    const filtered = reviewIndices(reviewFilter, questions, answers, flaggedIdxs, reviewTopic);
    const pos = filtered.indexOf(reviewIdx);
    const rq = pos >= 0 ? questions[reviewIdx] : undefined;
    const userSelections = rq ? answers[reviewIdx] : undefined;
    const verdict = rq ? reviewVerdicts[reviewIdx] : null;
    const counts: Record<ReviewFilter, number> = {
      wrong: runCountsNow.wrong,
      open: runCountsNow.open,
      flagged: runCountsNow.flagged,
      all: runCountsNow.total,
    };
    const pickFilter = (f: ReviewFilter) => {
      setReviewFilter(f);
      const list = reviewIndices(f, questions, answers, flaggedIdxs, reviewTopic);
      if (!list.includes(reviewIdx) && list.length > 0) setReviewIdx(list[0]);
    };
    const emptyKey: ExamCopyKey = reviewFilter === "wrong" ? "review_empty_wrong" : reviewFilter === "open" ? "review_empty_open" : reviewFilter === "flagged" ? "review_empty_flagged" : "review_empty_all";
    const VerdictIcon = verdict === "right" ? Check : verdict === "wrong" ? X : Minus;

    return (
      <AppLayout variant="focus">
        {safetyDialog}
        <main className="mp-focus-main safe-area-top bg-[var(--mp-surface-sunken)]">
          <PartialTranslationNote />
          <header className="px-3 py-2 border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)] flex-shrink-0">
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => setPhase("results")} className="mp-btn mp-btn--ghost min-h-11">← {te("review_back", lang)}</button>
              <span className="text-sm font-mono tabular-nums text-[var(--mp-fg)]" aria-live="polite">{pos >= 0 ? te("review_position", lang, { pos: pos + 1, count: filtered.length }) : ""}</span>
              <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => setReviewGridOpen(true)}><LayoutGrid className="w-4 h-4" aria-hidden /><span className="sr-only sm:not-sr-only">{te("review_grid", lang)}</span></button>
            </div>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [mask-image:linear-gradient(to_right,black_85%,transparent)]" role="group" aria-label={te("review_grid", lang)}>
              {(["wrong", "open", "flagged", "all"] as ReviewFilter[]).map((f) => (
                <button key={f} type="button" aria-pressed={reviewFilter === f} onClick={() => pickFilter(f)}
                  className={`min-h-11 shrink-0 px-3 rounded-full border text-sm font-semibold ${reviewFilter === f ? "bg-[var(--mp-viridian)]/10 border-[var(--mp-viridian)] text-[var(--mp-fg)]" : "bg-[var(--mp-surface-raised)] border-[var(--mp-border)] text-[var(--mp-fg-muted)]"}`}>
                  {te(f === "wrong" ? "filter_wrong" : f === "open" ? "filter_open" : f === "flagged" ? "filter_flagged" : "filter_all", lang)} ({counts[f]})
                </button>
              ))}
              {reviewTopic && (
                <button type="button" onClick={() => setReviewTopic(null)} className="min-h-11 shrink-0 px-3 rounded-full border border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/10 text-sm font-semibold text-[var(--mp-fg)] inline-flex items-center gap-1">
                  {te("filter_topic", lang, { topic: reviewTopic })}<X className="w-4 h-4" aria-label={te("filter_clear_topic", lang)} />
                </button>
              )}
            </div>
          </header>

          <div ref={paneRef} className="mp-exam-pane flex-1">
            <div className="px-4 lg:px-8 py-4 max-w-3xl mx-auto">
              {!rq ? (
                <div className="mp-card p-6 text-center text-sm text-[var(--mp-fg-muted)]">{te(emptyKey, lang)}</div>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-[var(--mp-fg-muted)] truncate">{rq.topic}</span>
                    <span className={`inline-flex items-center gap-1 text-sm font-semibold px-2 py-0.5 rounded ${verdict === "right" ? "text-[var(--mp-success-text)]" : verdict === "wrong" ? "text-[var(--mp-error-text)]" : "text-[var(--mp-fg-muted)]"}`}>
                      <VerdictIcon className="w-4 h-4" aria-hidden />
                      {te(verdict === "right" ? "review_status_right" : verdict === "wrong" ? "review_status_wrong" : "review_status_open", lang)}
                      {flaggedIdxs.has(reviewIdx) && <Flag className="w-4 h-4 text-[var(--mp-status-warning)] fill-current" aria-label={te("flagged", lang)} />}
                    </span>
                  </div>
                  <div className="mb-4">
                    <QuestionCard
                      key={`review-${rq.id}`}
                      question={rq}
                      questionNumber={reviewIdx + 1}
                      totalQuestions={questions.length}
                      lang={lang}
                      hideActions
                      hideFeedbackStrip
                      initialSelected={userSelections}
                      initiallyAnswered={true}
                    />
                  </div>
                  <div className="mb-4">
                    <QuestionActions
                      question={{ id: rq.id, topic: rq.topic, question: rq.question, answer: rq.answer, explanation: rq.explanation, options: rq.options }}
                      lang={lang}
                      layout="row"
                      answered={true}
                      metaOnly
                    />
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="mp-exam-actions">
            <button className="mp-btn mp-btn--secondary min-h-12" disabled={pos <= 0} onClick={() => pos > 0 && setReviewIdx(filtered[pos - 1])}>{te("previous", lang)}</button>
            <button className="mp-btn mp-btn--primary flex-1 min-h-12" disabled={pos < 0 || pos >= filtered.length - 1} onClick={() => pos < filtered.length - 1 && setReviewIdx(filtered[pos + 1])}>{te("next", lang)}</button>
          </div>
          <Dialog open={reviewGridOpen} onOpenChange={setReviewGridOpen} title={te("review_grid", lang)} placement="sheet" maxWidth="440px">
            {reviewGridOpen && <ExamMinimap count={questions.length} states={cellStates} verdicts={reviewVerdicts} flagged={flaggedIdxs} currentIdx={reviewIdx} onlyFlagged={false} lang={lang} onJump={(i) => { setReviewFilter("all"); setReviewTopic(null); setReviewIdx(i); setReviewGridOpen(false); }} />}
          </Dialog>
        </main>
      </AppLayout>
    );
  }

  // ── RESULTS ──
  if (phase === "results") {
    const secondsByIndex = finishedAtRef.current ? cappedDwell(visitsRef.current, finishedAtRef.current) : undefined;
    const subjects = subjectResults(questions, answers, secondsByIndex && Object.keys(secondsByIndex).length > 0 ? secondsByIndex : undefined);
    const verdict = runVerdict(runInfo.passRuleId, subjects);
    const durationMs = startedAtRef.current !== null && finishedAtRef.current !== null ? finishedAtRef.current - startedAtRef.current : null;
    const runPreset = runInfo.presetId ? EXAM_PRESETS[runInfo.presetId] : null;
    const openReview = (filter: "wrong" | "all", topic?: string) => {
      const f: ReviewFilter = filter;
      setReviewFilter(f);
      setReviewTopic(topic ?? null);
      const list = reviewIndices(f, questions, answers, flaggedIdxs, topic ?? null);
      setReviewIdx(list[0] ?? 0);
      setPhase("review");
    };
    const saveError = (
      <>
        {historySaveState === "saving" && <p role="status" className="mb-4 text-sm text-[var(--mp-fg-muted)]">{te("saving", lang)}</p>}
        {historySaveState === "rejected" && (
          <div role="alert" className="mb-5 mp-card p-4 text-sm">
            <p>{te("rejected", lang)}</p>
            <button type="button" onClick={discardRejectedResult} className="mp-btn mp-btn--secondary mt-2 min-h-11">{te("discard_result", lang)}</button>
          </div>
        )}
        {historySaveState === "failed" && (
          <div role="alert" className="mb-5 rounded-xl border border-[var(--mp-error)]/30 bg-[var(--mp-error-bg)] p-4 text-sm text-[var(--mp-error-text)]">
            <p>{t(authExpired ? "exam_save_auth" : "exam_save_failed", lang)} {pendingLocal ? t("exam_save_local", lang) : t("exam_autosave_failed", lang)} {authExpired && <Link className="underline" href="/login?next=/exam">{t("home_sign_in", lang)}</Link>}</p>
            <button type="button" onClick={() => setHistorySaveRetry((n) => n + 1)} className="mp-btn mp-btn--secondary mt-2 min-h-11">{te("retry_save", lang)}</button>
          </div>
        )}
      </>
    );

    return (
      <AppLayout sidebar={<Sidebar lang={lang} userId={userId} userName={userName} />} bottomNav={<BottomNav lang={lang} userId={userId} />}>
        {safetyDialog}
        <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
          <PartialTranslationNote />
          <div className="px-4 lg:px-10 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border)]">
            <Link href="/" className="text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] text-sm transition-colors min-h-11 inline-flex items-center">← {t("back_home", lang)}</Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageToggle lang={lang} onChange={switchLang} />
            </div>
          </div>
          <div className="px-4 lg:px-8 py-6 max-w-2xl mx-auto">
            <ExamResults
              lang={lang}
              examSource={runningSourceRef.current}
              isPart={selectedPart !== "all" || runInfo.owed.length > 0}
              verdict={verdict}
              subjects={subjects}
              counts={runCountsNow}
              durationMs={durationMs}
              timeExpired={timeExpired}
              missedIds={missedQuestionIds(questions, answers)}
              daysToExam={daysUntil(examDate)}
              isPaid={isPaid}
              saveState={historySaveState}
              savedAttemptId={savedAttemptId}
              saveError={saveError}
              formatExamKey={verdict.kind === "blocks" ? runPreset?.formatExamKey ?? null : null}
              onReview={openReview}
              onNewExam={() => (historySaveState === "saved" ? (window.history.replaceState(null, "", "/exam"), setPhase("entry")) : setConfirmAction("unsaved"))}
            />
          </div>
        </main>
      </AppLayout>
    );
  }

  // ── EXAM ── (focus shell: one top bar, one action bar, overview in a sheet)
  const q = questions[currentIdx];
  if (!q) return null;
  const selectedForQ = answers[currentIdx];
  const answeredCount = cellStates.filter((s) => s === "answered").length;
  const partialCount = cellStates.filter((s) => s === "partial").length;
  const unansweredCount = questions.length - answeredCount;
  const currentFlagged = flaggedIdxs.has(currentIdx);
  const firstOpenIdx = cellStates.findIndex((s) => s !== "answered");
  const firstFlaggedIdx = [...flaggedIdxs].sort((a, b) => a - b)[0] ?? null;
  const runTargetS = runInfo.presetId ? EXAM_PRESETS[runInfo.presetId].pacingTargetS : 90;
  const secondsLeft = runInfo.untimed || startedAtRef.current === null ? null : remainingSeconds(startedAtRef.current, durationRef.current);

  const sidebarContent = (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between"><span className="text-[var(--mp-fg-muted)]">{t("answered", lang)}</span><span className="font-mono font-bold tabular-nums text-[var(--mp-fg)]">{answeredCount} / {questions.length}</span></div>
        {partialCount > 0 && <div className="flex items-center justify-between"><span className="text-[var(--mp-fg-muted)]">{te("legend_partial", lang)}</span><span className="font-mono font-bold tabular-nums text-[var(--mp-fg)]">{partialCount}</span></div>}
        <div className="flex items-center justify-between"><span className="text-[var(--mp-fg-muted)]">{te("flagged", lang)}</span><span className="font-mono font-bold tabular-nums text-[var(--mp-fg)]">{flaggedIdxs.size}</span></div>
      </div>
      {!runInfo.untimed && startedAtRef.current !== null && (
        <PaceLine startedAt={startedAtRef.current} answered={answeredCount} total={questions.length} targetS={runTargetS} lang={lang} on={paceOn} onToggle={setPaceOn} />
      )}
      {topicGroups.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          {topicGroups.map((g) => {
            const groupAnswered = Array.from({ length: g.count }, (_, i) => cellStates[g.startIdx + i] === "answered").filter(Boolean).length;
            const isCurrentGroup = currentIdx >= g.startIdx && currentIdx < g.startIdx + g.count;
            return (
              <button key={`${g.topic}-${g.startIdx}`} type="button" onClick={() => jumpTo(g.startIdx)}
                className={`min-h-11 shrink-0 text-left px-3 py-1.5 rounded-lg flex items-center gap-2 text-sm border ${isCurrentGroup ? "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/10 text-[var(--mp-fg)]" : "border-[var(--mp-border)] text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"}`}>
                <TopicIcon name={getTopicConfig(g.topic).icon} className="w-4 h-4 shrink-0" />
                <span className="truncate lg:flex-1">{g.topic}</span>
                <span className="text-[13px] font-mono tabular-nums">{groupAnswered}/{g.count}</span>
              </button>
            );
          })}
        </div>
      )}
      <div>
        <button type="button" onClick={() => setOnlyFlagged((v) => !v)} aria-pressed={onlyFlagged}
          className={`mb-2 min-h-11 px-3 rounded-full border text-sm font-semibold inline-flex items-center gap-1.5 ${onlyFlagged ? "border-[var(--mp-status-warning)] text-[var(--mp-fg)]" : "border-[var(--mp-border)] text-[var(--mp-fg-muted)]"}`}>
          <Flag className="w-4 h-4" aria-hidden />{onlyFlagged ? te("show_all", lang) : te("only_flagged", lang)}
        </button>
        <ExamMinimap count={questions.length} states={cellStates} flagged={flaggedIdxs} currentIdx={currentIdx} onlyFlagged={onlyFlagged} lang={lang} onJump={jumpTo} />
      </div>
      <div className="flex gap-2"><ThemeToggle /><LanguageToggle lang={lang} onChange={switchLang} /></div>
    </div>
  );

  return (
    <AppLayout variant="focus">
      {safetyDialog}
      <main className="mp-focus-main safe-area-top bg-[var(--mp-surface-sunken)]">
        <PartialTranslationNote />
        <header className="px-3 py-2 border-b border-[var(--mp-border)] flex-shrink-0 bg-[var(--mp-surface-raised)]">
          <div className="flex items-center justify-between gap-2">
            <button className="mp-btn mp-btn--ghost min-h-11 px-1 text-sm" onClick={() => setConfirmAction("leave")}>{t("exam_leave", lang)}</button>
            {startedAtRef.current !== null && (
              <ExamClock startedAt={startedAtRef.current} durationS={durationRef.current} untimed={runInfo.untimed} lang={lang} onExpire={onClockExpire} onMilestone={onClockMilestone} onResync={onClockResync} />
            )}
          </div>
          <div className="flex items-center justify-between gap-2 mt-1">
            <button className="mp-btn mp-btn--secondary min-h-11 lg:hidden" onClick={() => setMobileDrawerOpen(true)}><MapIcon className="w-4 h-4" aria-hidden />{te("drawer_title", lang)} <bdi>{answeredCount}/{questions.length}</bdi></button>
            <span className="font-mono text-sm tabular-nums text-[var(--mp-fg)]">{t("q", lang)} {currentIdx + 1} / {questions.length}</span>
          </div>
          <div className="mt-2 h-1 rounded-full bg-[var(--mp-surface-sunken)] overflow-hidden" aria-hidden>
            <div className="h-full bg-[var(--mp-viridian)] transition-all" style={{ width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%` }} />
          </div>
        </header>
        <div className="px-4 py-1 min-h-8 text-[13px] bg-[var(--mp-surface-raised)]" role="status">
          {!online ? t("exam_offline", lang) : null}
          {timerNotice && <span className="ms-2">{timerNotice}</span>}
          {clockNotice && <span className="ms-2">{clockNotice}</span>}
          {awake && <span className="ms-2">{t("exam_awake", lang)}</span>}
        </div>
        {(autosaveFailed || !storageOk) && <Alert variant="error" className="mx-3 my-1">{autosaveFailed ? te("autosave_alert", lang) : te("storage_unavailable", lang)}</Alert>}
        {otherTab && (
          <Alert variant="warning" className="mx-3 my-1">
            {te("other_tab", lang)}{" "}
            <button type="button" className="underline min-h-11" onClick={() => { const saved = userId ? loadExamSession(userId) : null; setOtherTab(false); if (saved && saved.attemptId === examAttemptId) restoreExam(saved); }}>{te("other_tab_continue", lang)}</button>
          </Alert>
        )}
        <p className="sr-only" aria-live="polite">{t("q", lang)} {currentIdx + 1} / {questions.length}</p>
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {isDesktop && (
            <aside className="flex flex-col w-[320px] flex-shrink-0 border-r border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-y-auto p-4">
              {sidebarContent}
              <button type="button" onClick={() => setShowSubmitConfirm(true)} className="mp-btn mp-btn--secondary w-full justify-center mt-4 min-h-12">
                <GraduationCap className="w-4 h-4" aria-hidden />{te("submit", lang)}{unansweredCount > 0 ? ` (${unansweredCount} ${te("legend_open", lang)})` : ""}
              </button>
            </aside>
          )}
          <div ref={paneRef} className="mp-exam-pane flex-1 flex flex-col">
            <div className="px-4 lg:px-8 py-4 max-w-3xl w-full mx-auto">
              {q.topic && (
                <p className="mb-3 text-[13px] font-semibold text-[var(--mp-fg-muted)] truncate">{q.topic}</p>
              )}
              <div className="mb-4">
                <QuestionCard
                  key={`active-${q.id}`}
                  question={q}
                  questionNumber={currentIdx + 1}
                  totalQuestions={questions.length}
                  lang={lang}
                  hideFeedbackStrip
                  initialSelected={selectedForQ}
                  initiallyAnswered={false}
                  examMode
                  hideActions
                  onCommit={onCommit}
                />
              </div>
            </div>
          </div>
        </div>

        <Dialog open={mobileDrawerOpen && !isDesktop} onOpenChange={setMobileDrawerOpen} title={te("drawer_title", lang)} placement="sheet" maxWidth="440px"
          footer={<button type="button" className="mp-btn mp-btn--primary w-full min-h-12" onClick={() => { setMobileDrawerOpen(false); setShowSubmitConfirm(true); }}>{te("submit", lang)}</button>}>
          {mobileDrawerOpen && (
            <div className="space-y-4">
              {sidebarContent}
              <QuestionActions question={q} lang={lang} userTier="pro" userRole="user" layout="row" metaOnly />
              <button className="mp-btn mp-btn--secondary min-h-11 w-full" onClick={() => { setMobileDrawerOpen(false); setConfirmAction("leave"); }}>{t("exam_leave", lang)}</button>
            </div>
          )}
        </Dialog>
        <div className="mp-exam-actions">
          <button className="mp-btn mp-btn--secondary min-h-12" disabled={currentIdx === 0} onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}>{te("previous", lang)}</button>
          <button className={`mp-btn mp-btn--secondary min-h-12 ${currentFlagged ? "border-[var(--mp-status-warning)]" : ""}`} aria-pressed={currentFlagged} onClick={() => toggleFlag(currentIdx)}>
            <Flag className={`w-4 h-4 ${currentFlagged ? "fill-current text-[var(--mp-status-warning)]" : ""}`} aria-hidden />{currentFlagged ? te("flagged", lang) : te("flag", lang)}
          </button>
          <button className="mp-btn mp-btn--primary flex-1 min-h-12" onClick={() => currentIdx === questions.length - 1 ? setShowSubmitConfirm(true) : setCurrentIdx(i => i + 1)}>{currentIdx === questions.length - 1 ? te("submit", lang) : te("next", lang)}</button>
        </div>
        <ExamSubmitDialog
          open={showSubmitConfirm}
          onOpenChange={setShowSubmitConfirm}
          lang={lang}
          answered={answeredCount}
          openCount={unansweredCount}
          partial={partialCount}
          flagged={flaggedIdxs.size}
          secondsLeft={secondsLeft}
          firstOpenIdx={firstOpenIdx >= 0 ? firstOpenIdx : null}
          firstFlaggedIdx={firstFlaggedIdx}
          onJump={jumpTo}
          onSubmit={() => handleSubmitExam(false)}
        />
      </main>
    </AppLayout>
  );
}

export default function ExamPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)]">
        <BrandedLoader />
      </div>
    }>
      <ExamContent />
    </Suspense>
  );
}
