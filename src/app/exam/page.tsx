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
// 150-cap paywall intersection and the per-topic loads returned near-empty —
// collapsing the default 180-question exam to ~44 (defeated the #2a blueprint
// fix). The whole app uses this alias for authed calls; the exam page had
// silently been on the unauthenticated global fetch.
import { authFetch as fetch } from "@/lib/authFetch";
import { getStoredExamSource, getTopicConfig, VIENNA_EXAM_PARTS } from "@/lib/topics";
import { t, getLang } from "@/lib/i18n";
import { getStoredSession, hasProAccess } from "@/lib/auth";
import { AppLayout, Dialog } from "@/components/ui";
import { useUserTier } from "@/lib/hooks/useUserTier";
import LatestSimulation from "@/components/exam/LatestSimulation";
import { wallClockRemaining, createFinaliseGuard, examSelectionState, updateExamSelection } from "@/lib/practice-exam-state";
import { listNoteQuestionIds } from "@/lib/notes-store";
import { BOOKMARK_EVENT, loadBookmarks, readCachedBookmarks } from "@/lib/bookmarks";
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
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import TopicIcon from "@/components/TopicIcon";
import QuestionActions from "@/components/QuestionActions";
import QuestionCard from "@/components/QuestionCard";
import ImageLightbox from "@/components/ImageLightbox";
import { GraduationCap, Clock, AlertTriangle, Search, Map as MapIcon, X } from "lucide-react";

type Lang = "de" | "en";
type ExamPhase = "entry" | "loading" | "exam" | "results" | "review";
type ExamPart = "all" | "sip4" | "sip5" | "custom";

interface CustomFilters {
  subjects: string[];
  tags: string;
  dateFrom: string;
  dateTo: string;
  bookmarksOnly: boolean;
  notesOnly: boolean;
  search: string;
  limit: number;
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
};

function readNoteIds(): number[] {
  return listNoteQuestionIds();
}

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

interface TopicResult {
  topic: string;
  total: number;
  correct: number;
}

// ─── Real exam blueprints (per exam_type) ────────────────────────────────
// Each blueprint mirrors the ACTUAL exam structure for that recognition
// route, NOT an arbitrary fixed count. The `topic` strings MUST match the
// `questions.topic` values EXACTLY (case-sensitive — the API filters on
// them), or the per-topic fetch silently under-fills and the simulation
// collapses to a fraction of its size (the "52-question" / "Augenheilkunde
// 20, others 1-2" bug). Counts are weighted by the live DB topic
// distribution and sum to a realistic full-exam length.
//
// SOT-REF: exam structure @ MEDPRUF-SOT.md §1
//  - Kenntnisprüfung Wien: SIP4a/SIP5a-derived clinical MCQ practice,
//    10 bank specialties, 180-item practice configuration. Not the ÖÄK exam.
//  - Stichprobentest (Innsbruck, DB key kmp_innsbruck): national
//    Nostrifizierung screening, ~10-11 clinical blocks, pass ≈ 6/10 blocks
//    at ≥60%. Topics from the MedUni Innsbruck curriculum (KoalaMed).
//  - Pharmakologie: open-answer only (no MCQ) → no MCQ simulation.
type ExamBlueprintEntry = { topic: string; count: number };

const EXAM_BLUEPRINTS: Record<string, ExamBlueprintEntry[]> = {
  // Kenntnisprüfung Wien — 180 MCQ across the 10 SIP 4/5 specialties.
  kenntnispruefung: [
    { topic: "Innere Medizin", count: 28 },
    { topic: "Chirurgische Fächer", count: 28 },
    { topic: "Notfall- und Intensivmedizin", count: 20 },
    { topic: "Neurologie", count: 18 },
    { topic: "Frauenheilkunde/Gynäkologie", count: 18 },
    { topic: "Psychiatrie", count: 16 },
    { topic: "Dermatologie und Venerologie", count: 14 },
    { topic: "Kinder- und Jugendheilkunde", count: 14 },
    { topic: "Hals-Nasen-Ohrenheilkunde", count: 12 },
    { topic: "Augenheilkunde", count: 12 },
  ],
  // Stichprobentest (Innsbruck) — national Nostrifizierung screening, the
  // real clinical blocks (DB topic casing is authoritative, incl. "Und").
  kmp_innsbruck: [
    { topic: "Neurologie", count: 20 },
    { topic: "Innere Medizin", count: 18 },
    { topic: "Psychiatrie", count: 16 },
    { topic: "Chirurgische Spezialfächer Und Anästhesie", count: 14 },
    { topic: "Augenheilkunde", count: 14 },
    { topic: "Allgemeine Chirurgie", count: 12 },
    { topic: "Frauenheilkunde/Gynäkologie", count: 12 },
    { topic: "Kinder Und Jugendheilkunde", count: 12 },
    { topic: "Dermatologie und Venerologie", count: 10 },
    { topic: "Hals-Nasen-Ohrenheilkunde", count: 10 },
    { topic: "Kinder Und Jugendpsychiatrie", count: 8 },
  ],
};

/** The blueprint for the active exam source (falls back to Kenntnisprüfung). */
function getExamBlueprint(examSource: string): ExamBlueprintEntry[] {
  return EXAM_BLUEPRINTS[examSource] ?? EXAM_BLUEPRINTS.kenntnispruefung;
}

const EXAM_DURATION_S = 4 * 60 * 60; // 4 hours
const PASS_THRESHOLD = 0.6;

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function ExamContent() {
  const searchParams = useSearchParams();
  const { isPaid, isLoading: tierLoading } = useUserTier();
  const paneRef = useRef<HTMLDivElement>(null);
  const finaliseGuard = useRef(createFinaliseGuard());
  const timeLeftRef = useRef(EXAM_DURATION_S);
  const durationRef = useRef(EXAM_DURATION_S);
  const runningSourceRef = useRef("kenntnispruefung");
  const finishedAtRef = useRef<number | null>(null);
  const saveInFlight = useRef(new Set<string>());
  const currentAttemptRef = useRef<string | null>(null);
  const replaceAllowed = useRef(false);
  const recoveredPending = useRef(false);
  const resumeBusy = useRef(false);
  const loadBusy = useRef(false);
  const [confirmAction, setConfirmAction] = useState<"replace" | "discard" | "leave" | "unsaved" | null>(null);
  const [pendingDestination, setPendingDestination] = useState<string | null>(null);
  const [showTimeUp, setShowTimeUp] = useState(false);
  const [timeExpired, setTimeExpired] = useState(false);
  const [clockNotice, setClockNotice] = useState("");
  const [timerNotice, setTimerNotice] = useState("");
  const [online, setOnline] = useState(true);
  const [autosaveFailed, setAutosaveFailed] = useState(false);
  const [pendingLocal, setPendingLocal] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);
  const [awake, setAwake] = useState(false);
  const [submitReady, setSubmitReady] = useState(false);
  const milestoneRef = useRef(new Set<number>());

  const [storedExamSource, setStoredExamSourceState] = useState("kenntnispruefung");
  const [examPreferenceReady, setExamPreferenceReady] = useState(false);
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
        if (alive && typeof data?.activeExam === "string" && !searchParams.get("examSource")) setStoredExamSourceState(data.activeExam);
      }).catch(() => {}).finally(() => { if (alive) setExamPreferenceReady(true); });
    } else setExamPreferenceReady(true);
    return () => { alive = false; };
  }, [searchParams]);
  // The real exam blueprint for this exam source + its full length. Drives
  // the entry info-cards, the default question count, and the load loop.
  const examConfig = useMemo(() => getExamBlueprint(examSource), [examSource]);
  const examTotal = useMemo(() => examConfig.reduce((s, c) => s + c.count, 0), [examConfig]);
  // Pharma has no MCQ questions → a standard MCQ simulation cannot be built.
  const mcqSimUnavailable = examSource === "pharma";
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [bookmarkIds, setBookmarkIds] = useState<number[]>([]);
  const [bookmarksReady, setBookmarksReady] = useState(false);
  const [userName, setUserName] = useState("");
  const [selectedPart, setSelectedPart] = useState<ExamPart>(
    (searchParams.get("part") as ExamPart) || "all"
  );
  const [phase, setPhase] = useState<ExamPhase>("entry");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loadProgress, setLoadProgress] = useState(0);
  const examRequest = useRef(createRequestSequence());
  const [countError, setCountError] = useState(false);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number[]>>({}); // questionIndex → selected option indices (multi-select)
  const [flaggedIdxs, setFlaggedIdxs] = useState<Set<number>>(new Set()); // session-only flag state for minimap
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [timeLeft, setTimeLeft] = useState(EXAM_DURATION_S);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [customFilters, setCustomFilters] = useState<CustomFilters>(DEFAULT_CUSTOM_FILTERS);
  const [customCount, setCustomCount] = useState<number | null>(null);
  const [customCounting, setCustomCounting] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [savedAttemptId, setSavedAttemptId] = useState<string | null>(null);
  const [examAttemptId, setExamAttemptId] = useState<string | null>(null);
  const [historySaveState, setHistorySaveState] = useState<"idle" | "saving" | "saved" | "failed" | "rejected">("idle");
  const [historySaveRetry, setHistorySaveRetry] = useState(0);
  // B-01: a saved in-progress exam detected on mount → offer resume on the
  // entry screen (instead of silent resume, so the user can still discard +
  // start fresh, and the expired case has somewhere to land).
  const [resumable, setResumable] = useState<ReturnType<typeof loadExamSession>>(null);
  const [legacyResumable, setLegacyResumable] = useState<ReturnType<typeof loadLegacyExamSession>>(null);
  // Absolute exam start time (epoch ms). The persisted timer is derived from
  // this, so the countdown stays honest across a refresh/crash gap.
  const startedAtRef = useRef<number | null>(null);
  // Guards the persistence effect so it doesn't write before a restore/start
  // has populated startedAtRef (which would save a half-built exam).
  const examReadyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
      // Lock 2026-04-23: the mock exam is Pro-only. Free users get
      // redirected to /pricing with a contextual ?gate= deep-link so
      // the upsell ties back to WHY they landed there.
      //
      // 2026-04-24 fix: use the canonical `hasProAccess` helper so we
      // honour `role='admin'` even when a stale localStorage session
      // has `tier=null`. Previously this page checked only `tier` and
      // redirected admins whose session predated the tier catalogue.
      if (!hasProAccess(session)) {
        window.location.href = "/pricing?gate=mock_exam";
      }
    }
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

  // B-01: on mount, detect a saved in-progress exam and surface a resume
  // affordance on the entry screen. We don't auto-resume so the user can
  // still discard + start a different exam.
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

  // B-01: restore a saved exam into live state and jump into the exam (or
  // straight to results if it expired while the user was away).
  const restoreExam = useCallback((saved: SavedExamSession) => {
    if (!userId) return;
    finaliseGuard.current.reset();
    durationRef.current = saved.durationS || EXAM_DURATION_S;
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
    const left = remainingSeconds(saved.startedAt, durationRef.current);
    setQuestions(saved.questions as Question[]);
    setAnswers(saved.answers || {});
    setFlaggedIdxs(new Set(saved.flaggedIdxs || []));
    setCurrentIdx(
      Math.min(Math.max(0, saved.currentIdx || 0), Math.max(0, saved.questions.length - 1)),
    );
    setSelectedPart((saved.selectedPart as ExamPart) || "all");
    timeLeftRef.current = left;
    setTimeLeft(left);
    setResumable(null);
    setLegacyResumable(null);
    examReadyRef.current = true;
    setPhase(saved.finishedAt || left <= 0 ? "results" : "exam");
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

  // B-01: discard the saved exam and clear the resume affordance.
  const discardSavedExam = useCallback(() => {
    if (userId) clearExamSession(userId);
    setResumable(null);
  }, [userId]);

  /**
   * Build URLSearchParams from custom filter state.
   * Bookmarks/notes are client-side localStorage filters — their IDs are
   * resolved here and intersected into the `ids` param.
   */
  const buildCustomParams = useCallback((f: CustomFilters) => {
    const p = new URLSearchParams({ examSource });
    if (f.subjects.length > 0) p.set("topics", f.subjects.join(","));
    const tagList = f.tags.split(",").map((s) => s.trim()).filter(Boolean);
    if (tagList.length > 0) p.set("tags", tagList.join(","));
    if (f.dateFrom) p.set("examDateFrom", f.dateFrom);
    if (f.dateTo) p.set("examDateTo", f.dateTo);
    if (f.search.trim()) p.set("search", f.search.trim());
    // Client-only filters: intersect bookmark & note ID lists
    let ids: number[] | null = null;
    if (f.bookmarksOnly) ids = bookmarkIds;
    if (f.notesOnly) {
      const noteIds = readNoteIds();
      ids = ids ? ids.filter((x) => noteIds.includes(x)) : noteIds;
    }
    return { params: p, ids };
  }, [examSource, bookmarkIds]);

  // Debounced live count preview for custom exam builder
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

    if (selectedPart === "custom") {
      // Single filtered fetch
      try {
        const { params, ids } = buildCustomParams(customFilters);
        params.set("limit", String(customFilters.limit));
        params.set("mcqOnly", "1");
        if (ids !== null) {
          if (ids.length === 0) {
            setLoadFailure(lang === "de" ? "Für diese Filter gibt es keine passenden Fragen. Passe die Auswahl an und versuche es erneut." : "No questions match these filters. Adjust the selection and try again.");
            setPhase("entry");
            return;
          }
          params.set("ids", ids.join(","));
        }
        setLoadProgress(40);
        const res = await fetch(`/api/questions?${params}`, { signal: request.signal, timeoutMs: 25_000 });
        if (!res.ok) throw new Error(`Fragen konnten nicht geladen werden (${res.status}).`);
        const data: Question[] = await res.json();
        if (!request.current()) return;
        if (!Array.isArray(data)) throw new Error("Die Fragenantwort war ungültig.");
        allQuestions.push(...data);
        setLoadProgress(90);
        const expected = Math.min(customCount ?? customFilters.limit, customFilters.limit);
        if (!isExamBatchComplete(data.length, expected)) topicFailures.push(`Eigene Prüfung: ${data.length}/${expected}`);
      } catch (error) {
        if (!request.current()) return;
        topicFailures.push(error instanceof Error ? error.message : "Eigene Prüfung: Laden fehlgeschlagen");
      }
    } else {
      const partTopics = selectedPart !== "all" ? VIENNA_EXAM_PARTS[selectedPart] : null;
      const configToUse = partTopics
        ? examConfig.filter((c) => partTopics.includes(c.topic))
        : examConfig;

      for (let i = 0; i < configToUse.length; i++) {
        const { topic, count } = configToUse[i];
        try {
          const params = new URLSearchParams({ topic, limit: String(count), examSource, mcqOnly: "1" });
          const res = await fetch(`/api/questions?${params}`, { signal: request.signal, timeoutMs: 25_000 });
          if (!res.ok) throw new Error(`${topic}: HTTP ${res.status}`);
          const data: Question[] = await res.json();
        if (!request.current()) return;
          if (!Array.isArray(data)) throw new Error(`${topic}: ungültige Antwort`);
          allQuestions.push(...data);
          if (!isExamBatchComplete(data.length, count)) topicFailures.push(`${topic}: ${data.length}/${count}`);
        } catch (error) {
          if (!request.current()) return;
        if (!request.current()) return;
          topicFailures.push(error instanceof Error ? error.message : `${topic}: Laden fehlgeschlagen`);
        }
        setLoadProgress(Math.round(((i + 1) / configToUse.length) * 100));
      }
    }

    // A partial blueprint must never look like a completed full simulation.
    // Keep the selected configuration so the learner can retry or choose a
    // smaller custom exam after seeing which topic loads failed.
    if (topicFailures.length > 0 || allQuestions.length === 0) {
      setLoadFailure(
        (lang === "de" ? "Die Prüfungssimulation wurde unvollständig geladen. " : "The exam simulation loaded incomplete. ") +
        topicFailures.slice(0, 5).join(" · ") +
        (topicFailures.length > 5 ? (lang === "de" ? " · weitere Themen fehlen" : " · more topics missing") : "")
      );
      setPhase("entry");
      return;
    }

    // ─── EKG quota (per Mohamed) ─────────────────────────────────────────
    // Every SIP4 / full exam must contain 2-3 ECG questions. We identify
    // them by question text containing "EKG" (case-insensitive); the tag is
    // unreliable. If we are short, fetch a few extras and dedupe by id.
    const isEkg = (q: Question) => /ekg/i.test(q.question || "");
    const enforceEkg = selectedPart === "sip4" || selectedPart === "all";
    if (enforceEkg) {
      const target = 3;
      const present = allQuestions.filter(isEkg).length;
      const need = Math.max(0, target - present);
      if (need > 0) {
        try {
          const params = new URLSearchParams({
            search: "EKG",
            limit: String(need + 4),
            mcqOnly: "1",
            examSource,
          });
          const res = await fetch(`/api/questions?${params}`, { signal: request.signal, timeoutMs: 25_000 });
          const ekgPool: Question[] = await res.json();
          if (Array.isArray(ekgPool)) {
            const seen = new Set(allQuestions.map((q) => q.id));
            const fresh = ekgPool.filter((q) => !seen.has(q.id) && isEkg(q));
            const inject = fresh.slice(0, need);
            // Replace the first non-EKG question of the matching topic when
            // possible so the topic-distribution stays roughly correct.
            for (const ekgQ of inject) {
              const replaceIdx = allQuestions.findIndex(
                (q) => q.topic === ekgQ.topic && !isEkg(q)
              );
              if (replaceIdx >= 0) allQuestions[replaceIdx] = ekgQ;
              // Keep the requested blueprint length exact. If every loaded
              // row is already an EKG question, do not silently exceed it.
            }
          }
        } catch {
          /* swallow — best effort */
        }
      }
      if (allQuestions.filter(isEkg).length < target) {
        setLoadFailure(lang === "de"
          ? "Die Prüfung enthält nicht die erforderlichen EKG-Fragen und wurde nicht gestartet. Bitte versuche es erneut."
          : "The exam is missing its required ECG questions and was not started. Please try again.");
        setPhase("entry");
        return;
      }
    }

    if (!request.current()) return;
    // ─── Group by subject (per Mohamed) ──────────────────────────────────
    // Questions of one subject must come consecutively, then the next
    // subject. Within each subject we still shuffle to add variety.
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
      // Fisher-Yates shuffle within the bucket
      for (let i = bucket.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bucket[i], bucket[j]] = [bucket[j], bucket[i]];
      }
      grouped.push(...bucket);
    }

    // Fresh exam → stamp the start time, clear any stale autosave, and arm
    // persistence. startedAtRef drives the durable timer (B-01).
    finaliseGuard.current.reset();
    milestoneRef.current.clear();
    durationRef.current = EXAM_DURATION_S;
    runningSourceRef.current = examSource;
    finishedAtRef.current = null;
    setTimeExpired(false); setTimerNotice(""); setClockNotice(""); setHistorySaveState("idle"); setSavedAttemptId(null); setAuthExpired(false);
    startedAtRef.current = Date.now();
    const nextAttemptId = crypto.randomUUID();
    currentAttemptRef.current = nextAttemptId;
    setExamAttemptId(nextAttemptId);
    examReadyRef.current = true;
    if (userId) clearExamSession(userId);
    setQuestions(grouped);
    setAnswers({});
    setFlaggedIdxs(new Set());
    setCurrentIdx(0);
    timeLeftRef.current = EXAM_DURATION_S;
    setTimeLeft(EXAM_DURATION_S);
    setPhase("exam");
    } finally { loadBusy.current = false; }
  }, [examSource, selectedPart, customFilters, buildCustomParams, examConfig, customCount, lang, examPreferenceReady, userId, isPaid, tierLoading]);

  const handleSubmitExam = useCallback((expired = false) => {
    finaliseGuard.current.run(() => {
      finishedAtRef.current = expired && startedAtRef.current !== null ? startedAtRef.current + durationRef.current * 1000 : Date.now();
      setTimeExpired(expired);
      setShowSubmitConfirm(false); setMobileDrawerOpen(false);
      setPhase("results");
    });
  }, []);

  useEffect(() => {
    if (phase !== "exam" || startedAtRef.current === null) return;
    let previous = Math.min(timeLeftRef.current, remainingSeconds(startedAtRef.current, durationRef.current));
    const tick = (resync = false) => {
      previous = wallClockRemaining(startedAtRef.current!, durationRef.current, Date.now(), previous);
      timeLeftRef.current = previous;
      setTimeLeft(previous);
      if (resync && document.visibilityState === "visible") setClockNotice(t("exam_clock_resynced", lang).replace("{time}", formatTime(previous)));
      for (const minutes of [30, 10, 5]) {
        if (previous > 0 && previous <= minutes * 60 && !milestoneRef.current.has(minutes)) {
          milestoneRef.current.add(minutes);
          setTimerNotice(t("exam_time_notice", lang).replace("{n}", String(minutes)));
        }
      }
      if (previous === 0) handleSubmitExam(true);
    };
    tick();
    timerRef.current = setInterval(() => tick(), 1000);
    const resync = () => tick(true);
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("pageshow", resync); window.addEventListener("focus", resync);
    return () => { if (timerRef.current) clearInterval(timerRef.current); document.removeEventListener("visibilitychange", resync); window.removeEventListener("pageshow", resync); window.removeEventListener("focus", resync); };
  }, [phase, lang, handleSubmitExam]);

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

  useEffect(() => {
    if (!timeExpired) { setShowTimeUp(false); return; }
    setShowTimeUp(true);
    const timeout = setTimeout(() => setShowTimeUp(false), 3000);
    return () => clearTimeout(timeout);
  }, [timeExpired]);

  useEffect(() => {
    if (!showSubmitConfirm) { setSubmitReady(false); return; }
    const timer = setTimeout(() => setSubmitReady(true), 800); return () => clearTimeout(timer);
  }, [showSubmitConfirm]);

  useEffect(() => {
    if (!userId || phase !== "entry") return;
    const attempt = searchParams.get("attempt");
    if (attempt && /^[a-f0-9-]{36}$/i.test(attempt)) { window.location.replace(`/history?attempt=${encodeURIComponent(attempt)}`); return; }
    if (recoveredPending.current) return;
    recoveredPending.current = true;
    const pending = loadPendingExams(userId)[0];
    if (pending) restoreExam(pending);
  }, [userId, phase, restoreExam, searchParams]);

  // B-01: persist exam progress on every meaningful change while in the exam.
  // The question array is stored verbatim (answers are keyed by position and
  // the array is built non-deterministically — re-fetching would mis-map), and
  // the timer is stored as the absolute startedAt so it survives a refresh.
  useEffect(() => {
    if (phase !== "exam" || !userId || !examReadyRef.current || startedAtRef.current === null) return;
    setAutosaveFailed(!saveExamSession(userId, {
      startedAt: startedAtRef.current, durationS: durationRef.current,
      questions,
      answers,
      flaggedIdxs: [...flaggedIdxs],
      currentIdx,
      selectedPart,
      examSource: runningSourceRef.current,
      attemptId: examAttemptId || crypto.randomUUID(),
    }));
  }, [phase, userId, questions, answers, flaggedIdxs, currentIdx, selectedPart, examSource, examAttemptId]);

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

  // B-01: clear the saved exam on EVERY terminal path. Gating on the `results`
  // phase covers both the submit button (handleSubmitExam) and the timer-hits-0
  // branch, so neither can leak a stale autosave.
  useEffect(() => {
    if (phase === "results" && historySaveState !== "saved" && historySaveState !== "rejected") {
      // Persist the attempt to the durable History ledger and acknowledge
      // success before clearing the only local copy. A failed request leaves
      // the autosave available and exposes an explicit retry on the result.
      const snapshotQuestions = questions;
      const snapshotAnswers = answers;
      const startedAt = startedAtRef.current;
      if (snapshotQuestions.length > 0 && userId && examAttemptId && !saveInFlight.current.has(examAttemptId || "")) {
        finishedAtRef.current ||= Date.now();
        setPendingLocal(savePendingExam(userId, { startedAt: startedAt || Date.now(), durationS: durationRef.current, finishedAt: finishedAtRef.current, timeExpired, questions: snapshotQuestions, answers: snapshotAnswers, flaggedIdxs: [...flaggedIdxs], currentIdx, selectedPart, examSource: runningSourceRef.current, attemptId: examAttemptId }));

        // Store SELECTED OPTION TEXTS, not indices: /api/questions shuffles
        // the options per load (buildMCQFromChoices), so client indices are
        // meaningless against the DB's choices. Texts are stable, display
        // order-independent, and re-gradeable server-side.
        const answersByQid: Record<string, string[]> = {};
        snapshotQuestions.forEach((q, idx) => {
          const sel = answers[idx];
          if (Array.isArray(sel) && sel.length > 0 && q.options) {
            const texts = sel
              .map((i) => q.options?.[i]?.text)
              .filter((t): t is string => typeof t === "string");
            if (texts.length > 0) answersByQid[String(q.id)] = texts;
          }
        });
        const attemptBody = {
          exam_type: runningSourceRef.current,
          title:
            selectedPart === "custom"
              ? lang === "de" ? "Eigene Prüfung" : "Custom exam"
              : selectedPart === "sip4"
                ? lang === "de" ? "SIP4a Teilprüfung" : "SIP4a part exam"
                : selectedPart === "sip5"
                  ? lang === "de" ? "SIP5a Teilprüfung" : "SIP5a part exam"
                  : lang === "de" ? "Prüfungssimulation" : "Exam simulation",
          config: {
            part: selectedPart,
            subjects: customFilters.subjects,
            count: snapshotQuestions.length, durationS: durationRef.current, timeExpired,
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
    const retry = () => { if (navigator.onLine && !saveInFlight.current.has(examAttemptId || "")) { setPhase("results"); setHistorySaveRetry(n => n + 1); } };
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

  useEffect(() => {
    if (phase !== "exam") return;
    // A same-URL history entry lets the first browser Back ask before leaving.
    const url = window.location.pathname + window.location.search;
    window.history.pushState({ ...window.history.state, mpExamFocus: true }, "", url);
    const back = () => { window.history.pushState({ ...window.history.state, mpExamFocus: true }, "", url); setConfirmAction("leave"); };
    window.addEventListener("popstate", back);
    return () => { window.removeEventListener("popstate", back); if (window.history.state?.mpExamFocus) { const state = { ...window.history.state }; delete state.mpExamFocus; window.history.replaceState(state, "", window.location.href); } };
  }, [phase]);

  const safetyDialog = <Dialog open={confirmAction !== null} onOpenChange={open => { if (!open) { setConfirmAction(null); setPendingDestination(null); } }} hideCloseButton title={t(confirmAction === "replace" ? "exam_replace" : confirmAction === "discard" ? "exam_discard_body" : confirmAction === "leave" ? "exam_leave" : "exam_not_saved", lang).replace("{n}", String(Object.values(resumable?.answers || {}).filter(a => a.length).length))} footer={<>
    <button className="mp-btn mp-btn--secondary" onClick={() => { setConfirmAction(null); setPendingDestination(null); }}>{t("exam_keep", lang)}</button>
    {confirmAction === "unsaved" && historySaveState === "rejected" && <button className="mp-btn mp-btn--primary" onClick={() => { setConfirmAction(null); discardRejectedResult(); }}>{lang === "de" ? "Ergebnis verwerfen" : "Discard result"}</button>}
    {confirmAction === "unsaved" && historySaveState !== "rejected" && <button className="mp-btn mp-btn--primary" disabled={historySaveState === "saving"} onClick={() => { setConfirmAction(null); setPhase("results"); setHistorySaveRetry(n => n + 1); }}>{t("exam_retry_save", lang)}</button>}
    <button className="mp-btn mp-btn--secondary" onClick={() => {
      const action = confirmAction; setConfirmAction(null);
      if (action === "replace") { replaceAllowed.current = true; void loadExam(); }
      else if (action === "discard") discardSavedExam();
      else if (pendingDestination) { window.location.assign(pendingDestination); }
      else { window.history.replaceState(null, "", "/exam"); setPhase("entry"); }
    }}>{t(confirmAction === "replace" ? "exam_replace" : confirmAction === "leave" ? "exam_leave" : confirmAction === "discard" ? "exam_discard" : "exam_continue_anyway", lang)}</button>
  </>}><p>{t(confirmAction === "replace" ? "exam_replace_body" : confirmAction === "leave" ? "exam_leave_body" : confirmAction === "discard" ? "exam_discard_body" : "exam_unsaved_confirm", lang).replace("{n}", String(Object.values(resumable?.answers || {}).filter(a => a.length).length)).replace("{minutes}", String(Math.max(0, Math.floor((Date.now() - (resumable?.startedAt || Date.now())) / 60000))))}</p></Dialog>;

  const toggleFlag = useCallback((idx: number) => {
    setFlaggedIdxs((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  /**
   * Strict grading: a question is correct when the selected option indices
   * exactly match the set of correct option indices (full credit, no partial).
   */
  const isQuestionCorrect = (q: Question | undefined, selected: number[] | undefined): boolean => {
    if (!q?.options || !selected || selected.length === 0) return false;
    const correctIdxs = q.options
      .map((o, i) => o.correct ? i : -1)
      .filter(i => i >= 0);
    if (selected.length !== correctIdxs.length) return false;
    const selSet = new Set(selected);
    return correctIdxs.every(i => selSet.has(i));
  };

  // Compute results grouped by topic
  const computeResults = (): TopicResult[] => {
    const map: Record<string, { total: number; correct: number }> = {};
    questions.forEach((q, idx) => {
      if (!map[q.topic]) map[q.topic] = { total: 0, correct: 0 };
      map[q.topic].total += 1;
      if (isQuestionCorrect(q, answers[idx])) {
        map[q.topic].correct += 1;
      }
    });
    return Object.entries(map).map(([topic, v]) => ({ topic, ...v }));
  };

  const totalCorrect = Object.entries(answers).filter(([idxStr, selected]) =>
    isQuestionCorrect(questions[parseInt(idxStr)], selected)
  ).length;

  const overallPct = questions.length > 0 ? totalCorrect / questions.length : 0;
  const passed = overallPct >= PASS_THRESHOLD;

  // Topic groups used by the sidebar navigator + minimap section headers.
  // Memoized because it's derived from the (stable-per-load) questions array.
  const topicGroups = useMemo(() => {
    const groups: { topic: string; startIdx: number; count: number }[] = [];
    let lastTopic = "";
    for (let i = 0; i < questions.length; i++) {
      const t = questions[i].topic || "Sonstige";
      if (t !== lastTopic) {
        groups.push({ topic: t, startIdx: i, count: 1 });
        lastTopic = t;
      } else {
        groups[groups.length - 1].count++;
      }
    }
    return groups;
  }, [questions]);

  // ── ENTRY ──
  if (phase === "entry") {
    return (
      <div className="app-layout">
        {safetyDialog}
        <Sidebar lang={lang} userId={userId} userName={userName} />
        <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        <PartialTranslationNote />
          <div className="px-6 lg:px-10 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border)]">
            <Link href="/" className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors">
              ← {t("back_home", lang)}
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageToggle lang={lang} onChange={switchLang} />
            </div>
          </div>

          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-60px)] px-4 py-8">
            <div className="max-w-lg w-full">
              {/* B-01: resume an in-progress exam saved before a refresh/crash */}
              {legacyResumable && !resumable && (() => {
                const savedAnswered = Object.keys(legacyResumable.answers || {}).length;
                const savedTotal = legacyResumable.questions.length;
                return (
                  <div className="mb-8 rounded-2xl border border-[var(--mp-status-warning)]/40 bg-[var(--mp-status-warning)]/[0.06] p-4">
                    <p className="text-sm font-semibold text-[var(--mp-fg)] mb-1">
                      {lang === "de" ? "Ungespeicherte Prüfung auf diesem Gerät" : "An unsaved exam was found on this device"}
                    </p>
                    <p className="text-xs text-[var(--mp-fg-muted)]">
                      {lang === "de"
                        ? `${savedAnswered}/${savedTotal} beantwortet. Diese ältere Sicherung ist keinem Konto zugeordnet. Nur fortfahren, wenn du sie selbst gestartet hast.`
                        : `${savedAnswered}/${savedTotal} answered. This older save is not linked to an account. Continue only if you started it.`}
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button type="button" onClick={claimAndResumeLegacyExam} className="mp-btn mp-btn--primary mp-btn--sm">
                        {lang === "de" ? "Meine Prüfung fortsetzen" : "Resume my exam"}
                      </button>
                      <button type="button" onClick={discardLegacyExam} className="mp-btn mp-btn--ghost mp-btn--sm">
                        {lang === "de" ? "Verwerfen" : "Discard"}
                      </button>
                    </div>
                  </div>
                );
              })()}
              {resumable && (() => {
                const savedAnswered = Object.values(resumable.answers || {}).filter(a => a.length > 0).length;
                const savedTotal = resumable.questions.length;
                const left = remainingSeconds(resumable.startedAt, resumable.durationS);
                const expired = left <= 0;
                return (
                  <div className="mb-8 rounded-2xl border border-[var(--mp-viridian)]/40 bg-[var(--mp-viridian)]/[0.06] p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[var(--mp-viridian)]/15 flex items-center justify-center flex-shrink-0">
                        <Clock className="w-4.5 h-4.5 text-[var(--mp-viridian)]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[var(--mp-fg)] mb-0.5">
                          {expired
                            ? (lang === "de" ? "Frühere Prüfung gefunden" : "Earlier exam found")
                            : (lang === "de" ? "Prüfung läuft noch" : "Exam in progress")}
                        </p>
                        <p className="text-xs text-[var(--mp-fg-muted)]">
                          {expired
                            ? (lang === "de"
                                ? `Die Zeit ist abgelaufen. ${savedAnswered}/${savedTotal} beantwortet. Ergebnis ansehen?`
                                : `Time has run out. ${savedAnswered}/${savedTotal} answered. View your result?`)
                            : (lang === "de"
                                ? `${savedAnswered}/${savedTotal} beantwortet, ${formatTime(left)} verbleibend.`
                                : `${savedAnswered}/${savedTotal} answered, ${formatTime(left)} left.`)}
                        </p>
                        <div className="flex flex-col gap-2 mt-3">
                          <button
                            type="button"
                            onClick={resumeExam}
                            className="mp-btn mp-btn--primary w-full min-h-12"
                          >
                            {expired
                              ? (lang === "de" ? "Ergebnis ansehen" : "View result")
                              : t("exam_resume_primary", lang)}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmAction("discard")}
                            className="mp-btn mp-btn--ghost min-h-11 mt-4 text-[var(--mp-error-text)]"
                          >
                            {lang === "de" ? "Verwerfen" : "Discard"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
              {userId && loadPendingExams(userId).length > 0 && <div className="mp-card p-4 mb-4"><p>{t("exam_not_saved", lang)}</p><button className="mp-btn mp-btn--secondary min-h-11" onClick={() => { const pending = loadPendingExams(userId)[0]; if (pending) restoreExam(pending); }}>{t("exam_retry_save", lang)}</button></div>}
              {isPaid && <LatestSimulation lang={lang} />}

              <div className="bg-gradient-to-r from-[var(--mp-fg)]/[0.04] to-[var(--mp-viridian)]/[0.04] rounded-2xl p-6 text-center mb-8">
                <div className="w-20 h-20 rounded-2xl border border-[var(--mp-status-warning)]/30 bg-[var(--mp-status-warning)]/10 flex items-center justify-center mx-auto mb-5">
                  <GraduationCap className="w-10 h-10 text-[var(--mp-status-warning)]" />
                </div>
                <h1 className="mp-h2 mb-2">{t("exam_sim_title", lang)}</h1>
                {/* Dynamic summary — reflects the REAL exam length + structure
                    for the active exam source / selected part (never a stale
                    hardcoded "250"). Hidden in custom mode (count is the live
                    filter preview) and when MCQ sim is unavailable. */}
                {!mcqSimUnavailable && selectedPart !== "custom" && (() => {
                  const shown =
                    selectedPart === "sip4" || selectedPart === "sip5"
                      ? examConfig.filter((c) => VIENNA_EXAM_PARTS[selectedPart].includes(c.topic))
                      : examConfig;
                  const count = shown.reduce((s, c) => s + c.count, 0);
                  const specialties = shown.length;
                  return (
                    <p className="text-[var(--mp-fg-subtle)] text-sm">
                      <span className="font-mono font-semibold text-[var(--mp-fg-muted)]">{count}</span>{" "}
                      {t("questions", lang)} ·{" "}
                      <span className="font-mono font-semibold text-[var(--mp-fg-muted)]">{specialties}</span>{" "}
                      {lang === "de" ? "Fachgebiete" : "specialties"} ·{" "}
                      {lang === "de" ? "4 Stunden" : "4 hours"}
                    </p>
                  );
                })()}
                {mcqSimUnavailable && (
                  <p className="text-[var(--mp-fg-subtle)] text-sm">
                    {lang === "de" ? "Pharmakologie / Rezeptierkunde" : "Pharmacology / prescribing"}
                  </p>
                )}
              </div>

              {/* Pharma has open-answer questions only → no MCQ simulation.
                  Offer the quiz instead of a broken 0-question exam. */}
              {mcqSimUnavailable && (
                <div className="card rounded-2xl p-5 mb-8 text-center">
                  <p className="text-sm font-semibold text-[var(--mp-fg)] mb-1.5">
                    {lang === "de"
                      ? "Keine Prüfungssimulation für Pharmakologie"
                      : "No exam simulation for Pharmacology"}
                  </p>
                  <p className="text-xs text-[var(--mp-fg-muted)] mb-4">
                    {lang === "de"
                      ? "Pharmakologie/Rezeptierkunde nutzt offene Antworten, keine Multiple-Choice-Fragen. Übe sie im Quiz-Modus."
                      : "Pharmacology/prescribing uses open answers, not multiple-choice. Practise it in quiz mode."}
                  </p>
                  <Link href="/quiz?examSource=pharma" className="btn-primary inline-flex px-5 py-2.5 text-sm">
                    {lang === "de" ? "Zum Quiz" : "Go to quiz"}
                  </Link>
                </div>
              )}

              {/* Exam info cards — filtered by selected part (hidden in custom mode, replaced by filter panel) */}
              {!mcqSimUnavailable && selectedPart !== "custom" && (() => {
                const displayedConfig =
                  selectedPart === "sip4" || selectedPart === "sip5"
                    ? examConfig.filter((c) => VIENNA_EXAM_PARTS[selectedPart].includes(c.topic))
                    : examConfig;
                return (
                  <div className="grid grid-cols-2 gap-6 mb-10 stagger">
                    {displayedConfig.map(({ topic, count }) => {
                      const cfg = getTopicConfig(topic);
                      return (
                        <div
                          key={topic}
                          className="card rounded-2xl p-3 flex items-center gap-3"
                        >
                          <TopicIcon name={cfg.icon} className="w-5 h-5" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-[var(--mp-fg)] leading-tight line-clamp-2 break-words">{topic}</p>
                            <p className="text-[10px] text-[var(--mp-fg-subtle)] font-mono">{count} {t("questions", lang)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* SIP part selector — only shown for SIP exam source */}
              {examSource === "kenntnispruefung" && (
                <div className="mb-6">
                  <p className="text-xs text-[var(--mp-fg-subtle)] font-semibold uppercase tracking-wider mb-2 text-center">
                    {t("exam_part_selector", lang)}
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {(["all", "sip4", "sip5", "custom"] as ExamPart[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => setSelectedPart(p)}
                        className={`py-3 rounded-2xl text-sm font-semibold border transition-colors ${
                          selectedPart === p
                            ? "bg-[var(--mp-status-warning)] border-[var(--mp-status-warning)] text-[#1A0E00]"
                            : "bg-[var(--mp-surface-raised)] border-[var(--mp-border)] text-[var(--mp-fg-muted)] hover:border-[var(--mp-status-warning)]/40"
                        }`}
                      >
                        {p === "all"
                          ? t("all_parts", lang)
                          : p === "sip4"
                          ? "SIP 4"
                          : p === "sip5"
                          ? "SIP 5"
                          : t("custom_exam", lang)}
                      </button>
                    ))}
                  </div>
                  {selectedPart === "sip4" || selectedPart === "sip5" ? (
                    <p className="text-[10px] text-[var(--mp-fg-subtle)] text-center mt-2">
                      {selectedPart === "sip4" ? t("sip4_label", lang) : t("sip5_label", lang)}
                      {" · "}
                      {examConfig.filter((c) =>
                        VIENNA_EXAM_PARTS[selectedPart].includes(c.topic)
                      ).reduce((s, c) => s + c.count, 0)}{" "}
                      {t("questions", lang)}
                    </p>
                  ) : null}
                </div>
              )}

              {/* Custom filter panel */}
              {selectedPart === "custom" && (
                <div className="mb-6 card p-4 space-y-4">
                  <p className="text-xs text-[var(--mp-fg-subtle)] font-semibold uppercase tracking-wider">
                    {t("custom_exam_label", lang)}
                  </p>

                  {/* Subjects multi-select */}
                  <div>
                    <label className="block text-xs font-semibold text-[var(--mp-fg-muted)] mb-2">
                      {t("custom_subjects", lang)}
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {examConfig.map(({ topic }) => {
                        const checked = customFilters.subjects.includes(topic);
                        return (
                          <label
                            key={topic}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer text-xs transition-colors ${
                              checked
                                ? "bg-[var(--mp-status-warning)]/10 border-[var(--mp-status-warning)]/40 text-[var(--mp-fg)]"
                                : "bg-[var(--mp-surface-sunken)] border-[var(--mp-border)] text-[var(--mp-fg-muted)] hover:border-[var(--mp-status-warning)]/30"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setCustomFilters((f) => ({
                                  ...f,
                                  subjects: e.target.checked
                                    ? [...f.subjects, topic]
                                    : f.subjects.filter((s) => s !== topic),
                                }));
                              }}
                              className="w-3 h-3 accent-[var(--mp-status-warning)]"
                            />
                            <span className="truncate">{topic}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Tags input */}
                  <div>
                    <label className="block text-xs font-semibold text-[var(--mp-fg-muted)] mb-1.5">
                      {t("custom_tags", lang)}
                    </label>
                    <input
                      type="text"
                      value={customFilters.tags}
                      onChange={(e) => setCustomFilters((f) => ({ ...f, tags: e.target.value }))}
                      placeholder="cardio, sip4a"
                      className="w-full px-3 py-2 text-xs border border-[var(--mp-border)] rounded focus:outline-none focus:border-[var(--mp-status-warning)]"
                    />
                  </div>

                  {/* Date range */}
                  <div>
                    <label className="block text-xs font-semibold text-[var(--mp-fg-muted)] mb-1.5">
                      {t("custom_date_range", lang)}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="month"
                        value={customFilters.dateFrom}
                        onChange={(e) => setCustomFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                        className="flex-1 px-3 py-2 text-xs border border-[var(--mp-border)] rounded focus:outline-none focus:border-[var(--mp-status-warning)]"
                      />
                      <span className="text-xs text-[var(--mp-fg-subtle)]">—</span>
                      <input
                        type="month"
                        value={customFilters.dateTo}
                        onChange={(e) => setCustomFilters((f) => ({ ...f, dateTo: e.target.value }))}
                        className="flex-1 px-3 py-2 text-xs border border-[var(--mp-border)] rounded focus:outline-none focus:border-[var(--mp-status-warning)]"
                      />
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 px-3 py-2 rounded border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] text-xs text-[var(--mp-fg-muted)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={customFilters.bookmarksOnly}
                        onChange={(e) => setCustomFilters((f) => ({ ...f, bookmarksOnly: e.target.checked }))}
                        className="w-3 h-3 accent-[var(--mp-status-warning)]"
                      />
                      <span>{t("custom_bookmarks_only", lang)}</span>
                    </label>
                    <label className="flex items-center gap-2 px-3 py-2 rounded border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] text-xs text-[var(--mp-fg-muted)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={customFilters.notesOnly}
                        onChange={(e) => setCustomFilters((f) => ({ ...f, notesOnly: e.target.checked }))}
                        className="w-3 h-3 accent-[var(--mp-status-warning)]"
                      />
                      <span>{t("custom_notes_only", lang)}</span>
                    </label>
                  </div>

                  {/* Search */}
                  <div>
                    <label className="block text-xs font-semibold text-[var(--mp-fg-muted)] mb-1.5">
                      {t("custom_search_label", lang)}
                    </label>
                    <input
                      type="text"
                      value={customFilters.search}
                      onChange={(e) => setCustomFilters((f) => ({ ...f, search: e.target.value }))}
                      placeholder={t("search_placeholder", lang)}
                      className="w-full px-3 py-2 text-xs border border-[var(--mp-border)] rounded focus:outline-none focus:border-[var(--mp-status-warning)]"
                    />
                  </div>

                  {/* Exam size slider */}
                  <div>
                    <label className="block text-xs font-semibold text-[var(--mp-fg-muted)] mb-1.5">
                      {t("custom_size", lang)}: <span className="font-mono text-[var(--mp-status-warning)]">{customFilters.limit}</span>
                    </label>
                    <input
                      type="range"
                      min={10}
                      max={200}
                      step={10}
                      value={customFilters.limit}
                      onChange={(e) => setCustomFilters((f) => ({ ...f, limit: parseInt(e.target.value, 10) }))}
                      className="w-full accent-[var(--mp-status-warning)]"
                    />
                  </div>

                  {/* Live count */}
                  <div className="pt-3 border-t border-[var(--mp-border)] text-center">
                    {customCounting ? (
                      <p className="text-xs text-[var(--mp-fg-subtle)] font-mono">{t("custom_loading_count", lang)}</p>
                    ) : customCount === 0 ? (
                      <p className="text-xs text-[var(--mp-error)] font-semibold">{t("custom_no_matches", lang)}</p>
                    ) : (
                      <p className="text-xs text-[var(--mp-fg-muted)]">
                        <span className="font-mono font-bold text-[var(--mp-status-warning)] text-base">
                          ≈ {customCount ?? "—"}
                        </span>{" "}
                        {t("custom_matching", lang)}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <DataRegion error={countError} retry={() => { setCustomFilters(f => ({ ...f })); }} />
              {/* Pass threshold notice */}
              {loadFailure && (
                <div role="alert" className="mb-5 rounded-xl border border-[var(--mp-error)]/30 bg-[var(--mp-error-bg)] p-4 text-sm text-[var(--mp-error)]">
                  <p className="font-semibold">{loadFailure}</p>
                  <button type="button" onClick={loadExam} disabled={!examPreferenceReady || (customFilters.bookmarksOnly && !bookmarksReady)} className="mp-btn mp-btn--secondary mt-3 min-h-11 disabled:opacity-50">
                    {lang === "de" ? "Erneut versuchen" : "Try again"}
                  </button>
                </div>
              )}
              {!mcqSimUnavailable && (
                <div className="bg-[var(--mp-status-warning)]/6 border border-[var(--mp-status-warning)]/25 rounded p-4 mb-6 text-center">
                  <p className="text-sm text-[var(--mp-status-warning)] flex items-center justify-center gap-1"><AlertTriangle className="w-4 h-4 inline" /> {t("pass_threshold", lang)}</p>
                </div>
              )}

              {!mcqSimUnavailable && (() => {
                // The real default length for the start button — full exam, or
                // the selected SIP part, or the live custom count.
                const defaultCount =
                  selectedPart === "sip4" || selectedPart === "sip5"
                    ? examConfig
                        .filter((c) => VIENNA_EXAM_PARTS[selectedPart].includes(c.topic))
                        .reduce((s, c) => s + c.count, 0)
                    : examTotal;
                return (
                  <button
                    onClick={loadExam}
                    disabled={Boolean(loadFailure) || !examPreferenceReady || (selectedPart === "custom" && (customFilters.bookmarksOnly && !bookmarksReady || customCount === null || customCount === 0))}
                    className="btn-primary w-full py-4 text-base disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <GraduationCap className="w-5 h-5 inline" /> {resumable ? t("exam_replace", lang) : t("start_exam", lang)}
                    {selectedPart === "custom" ? (
                      customCount !== null && customCount > 0 && (
                        <span className="ml-2 font-mono text-sm opacity-70">
                          ({Math.min(customCount, customFilters.limit)})
                        </span>
                      )
                    ) : (
                      <span className="ml-2 font-mono text-sm opacity-70">· {defaultCount}</span>
                    )}
                  </button>
                );
              })()}
            </div>
          </div>
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
          <GraduationCap className="w-10 h-10 text-[var(--mp-status-warning)] mx-auto mb-4" />
          <p className="text-[var(--mp-fg-muted)] font-semibold mb-6">{t("exam_loading", lang)}</p>
          <div className="bg-[var(--mp-surface-sunken)] rounded-full h-2 mb-3 overflow-hidden">
            <div
              className="h-full bg-[var(--mp-status-warning)] rounded-full transition-all duration-300"
              style={{ width: `${loadProgress}%` }}
            />
          </div>
          <p className="text-[var(--mp-fg-subtle)] text-sm font-mono" role="status">{loadProgress}%</p>
          <button type="button" className="mp-btn mp-btn--secondary mt-4 min-h-11" onClick={() => { examRequest.current.cancel(); setPhase('entry'); }}>{lang === 'de' ? 'Abbrechen' : 'Cancel'}</button>
        </div>
      </div>
    );
  }

  // ── REVIEW ──
  if (phase === "review") {
    const rq = questions[reviewIdx];
    if (!rq) return null;
    const userSelections = answers[reviewIdx];
    const wasAnswered = userSelections !== undefined && userSelections.length > 0;
    const wasCorrect = wasAnswered && isQuestionCorrect(rq, userSelections);

    return (
      <AppLayout variant="focus">
        {safetyDialog}

        <main ref={paneRef} className="mp-exam-pane flex-1 safe-area-top bg-[var(--mp-surface-sunken)]">
        <PartialTranslationNote />
          <div className="px-6 lg:px-10 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border)]">
            <button
              onClick={() => setPhase("results")}
              className="mp-btn mp-btn--ghost min-h-11"
            >
              ← {lang === "de" ? "Ergebnisse" : "Results"}
            </button>
            <span className="text-xs text-[var(--mp-fg-subtle)] font-mono">
              {reviewIdx + 1} / {questions.length}
            </span>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageToggle lang={lang} onChange={switchLang} />
            </div>
          </div>

          <div className="px-4 lg:px-8 py-4 max-w-3xl mx-auto">
            {/* Progress bar */}
            <div className="h-1 bg-[var(--mp-surface-sunken)] rounded-full mb-6 overflow-hidden">
              <div
                className="h-full bg-[var(--mp-viridian)] rounded-full transition-all"
                style={{ width: `${((reviewIdx + 1) / questions.length) * 100}%` }}
              />
            </div>

            <div className="mb-2 flex items-center justify-end">
              <span className={`text-xs font-medium font-mono px-2 py-0.5 rounded ${
                wasCorrect
                  ? "bg-[var(--mp-accent-teal)]/15 text-[var(--mp-accent-teal)]"
                  : wasAnswered
                  ? "bg-[var(--mp-error)]/15 text-[var(--mp-error)]"
                  : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)]"
              }`}>
                {!wasAnswered
                  ? t("unanswered", lang)
                  : wasCorrect
                  ? `✓ ${t("correct", lang)}`
                  : `✗ ${t("wrong", lang)}`}
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

            {/* Action rail — bookmark + flag only (metaOnly). In review the
                QuestionCard above is answered, so its ContextTabs own AI +
                Notes + Translate; the rail keeps just the persistent meta
                actions so there is no duplicate surface (matches the quiz IA,
                FEEDBACK #4e). */}
            <div className="mb-4">
              <QuestionActions
                question={{
                  id: rq.id,
                  topic: rq.topic,
                  question: rq.question,
                  answer: rq.answer,
                  explanation: rq.explanation,
                  options: rq.options,
                }}
                lang={lang}
                layout="row"
                answered={true}
                metaOnly
              />
            </div>

            {lightboxSrc && (
              <ImageLightbox src={lightboxSrc} alt="Medizinische Abbildung" onClose={() => setLightboxSrc(null)} />
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setReviewIdx(Math.max(0, reviewIdx - 1))}
                disabled={reviewIdx === 0}
                className="flex-1 py-3 border border-[var(--mp-border)] rounded text-[var(--mp-fg-muted)] text-sm font-medium disabled:opacity-30 hover:border-[var(--mp-viridian)]/40 transition-colors"
              >
                ← {lang === "de" ? "Zurück" : "Previous"}
              </button>
              <button
                onClick={() => setReviewIdx(Math.min(questions.length - 1, reviewIdx + 1))}
                disabled={reviewIdx === questions.length - 1}
                className="flex-1 py-3 border border-[var(--mp-border)] rounded text-[var(--mp-fg-muted)] text-sm font-medium disabled:opacity-30 hover:border-[var(--mp-viridian)]/40 transition-colors"
              >
                {lang === "de" ? "Weiter" : "Next"} →
              </button>
            </div>
          </div>
        </main>

      </AppLayout>
    );
  }

  // ── RESULTS ──
  if (phase === "results") {
    const topicResults = computeResults();

    return (
      <AppLayout sidebar={<Sidebar lang={lang} userId={userId} userName={userName} />} bottomNav={<BottomNav lang={lang} userId={userId} />}>
        {safetyDialog}

        <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        <PartialTranslationNote />
          <div className="px-6 lg:px-10 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border)]">
            <Link href="/" className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors">
              ← {t("back_home", lang)}
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageToggle lang={lang} onChange={switchLang} />
            </div>
          </div>

          <div className="px-4 lg:px-8 py-6 max-w-2xl mx-auto">
            <h1 className="mp-h2 mb-6">{t("exam_finished", lang)}</h1>{selectedPart !== "all" && <p className="mb-3">{t("exam_part_run", lang)} · {questions.length}</p>}

            {/* Overall result */}
            <div className={`rounded-2xl p-8 border mb-6 text-center animate-scale-in ${
              passed
                ? "bg-[var(--mp-accent-teal)]/8 border-[var(--mp-accent-teal)]/40"
                : "bg-[var(--mp-error)]/8 border-[var(--mp-error)]/40"
            }`}>
              <div className={`text-5xl font-black font-mono mb-2 ${passed ? "text-[var(--mp-accent-teal)]" : "text-[var(--mp-error)]"}`}>
                {Math.round(overallPct * 100)}%
              </div>
              <div className={`text-lg font-bold mb-2 ${passed ? "text-[var(--mp-accent-teal)]" : "text-[var(--mp-error)]"}`}>
                {passed ? t("exam_passed", lang) : t("exam_failed", lang)}
              </div>
              <p className="text-[var(--mp-fg-subtle)] text-sm font-mono">
                {totalCorrect} / {questions.length} {t("correct", lang)} · {t("pass_threshold", lang)}
              </p>
            </div>

            {timeExpired && <p role="status" className="mp-card p-3 mb-3">{t("exam_expired", lang)}. {showTimeUp && <button className="mp-btn mp-btn--ghost min-h-11" onClick={() => setShowTimeUp(false)}>{t(historySaveState === "saved" ? "exam_time_up_submitted" : "exam_time_up", lang)}</button>}</p>}
            <p role="status">{t(historySaveState === "saved" ? "exam_saved" : historySaveState === "failed" ? "exam_not_saved" : "exam_saving", lang)}</p>
            {/* History ledger link: the attempt is saved server-side and can
                be reviewed any time under Verlauf (Pro). */}
            {historySaveState === "saving" && (
              <p role="status" className="mb-4 text-center text-sm text-[var(--mp-fg-subtle)]">
                {lang === "de" ? "Ergebnis wird im Verlauf gespeichert …" : "Saving your result to history …"}
              </p>
            )}
            {historySaveState === "rejected" && (
              <div role="alert" className="mb-5 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-4 text-sm text-center">
                <p>{lang === "de" ? "Dieses Ergebnis kann nicht im Verlauf gespeichert werden (zum Beispiel, weil Ihr Pro-Zugang abgelaufen ist). Sie sehen es hier, bis Sie es verwerfen." : "This result cannot be saved to your history (for example because your Pro access has ended). It stays here until you discard it."}</p>
                <button type="button" onClick={discardRejectedResult} className="mp-btn mp-btn--secondary mt-2 min-h-11">
                  {lang === "de" ? "Ergebnis verwerfen" : "Discard result"}
                </button>
              </div>
            )}
            {historySaveState === "failed" && (
              <div role="alert" className="mb-5 rounded-xl border border-[var(--mp-error)]/30 bg-[var(--mp-error-bg)] p-4 text-sm text-[var(--mp-error)] text-center">
                <p>{t(authExpired ? "exam_save_auth" : "exam_save_failed", lang)} {pendingLocal ? t("exam_save_local", lang) : t("exam_autosave_failed", lang)} {authExpired && <Link href="/login?next=/exam">{t("home_sign_in", lang)}</Link>}</p>
                <button type="button" onClick={() => setHistorySaveRetry((n) => n + 1)} className="mp-btn mp-btn--secondary mt-2 min-h-11">
                  {lang === "de" ? "Speichern erneut versuchen" : "Retry saving"}
                </button>
              </div>
            )}
            {savedAttemptId && (
              <div className="mb-6 flex justify-center">
                <Link
                  href={`/history?attempt=${savedAttemptId}`}
                  className="mp-btn mp-btn--secondary text-sm"
                >
                  {lang === "de"
                    ? "Im Verlauf ansehen (gespeichert)"
                    : "View in your history (saved)"}
                </Link>
              </div>
            )}

            {/* Specialty breakdown */}
            <h2 className="text-base font-semibold text-[var(--mp-fg)] mb-3">{t("specialty_results", lang)}</h2>
            <div className="space-y-2 mb-6">
              {topicResults
                .sort((a, b) => b.total - a.total)
                .map(({ topic, total, correct }) => {
                  const cfg = getTopicConfig(topic);
                  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
                  const topicPassed = pct >= 60;
                  return (
                    <div key={topic} className="card p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <TopicIcon name={cfg.icon} className="w-4 h-4" />
                          <span className="text-sm text-[var(--mp-fg)] font-medium">{topic}</span>
                        </div>
                        <span className={`text-sm font-bold font-mono ${topicPassed ? "text-[var(--mp-accent-teal)]" : "text-[var(--mp-error)]"}`}>
                          {pct}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-[var(--mp-surface-sunken)] rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: topicPassed ? "var(--mp-viridian)" : pct >= 40 ? "var(--mp-status-warning)" : "var(--mp-error)",
                            }}
                          />
                        </div>
                        <span className="text-[10px] text-[var(--mp-fg-subtle)] font-mono w-14 text-right">
                          {correct}/{total}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { setReviewIdx(0); setPhase("review"); }}
                className="w-full py-3.5 border border-[var(--mp-border)] rounded text-[var(--mp-fg)] font-medium hover:border-[var(--mp-viridian)]/40 transition-colors"
              >
                <Search className="w-4 h-4 inline" /> {t("review_answers", lang)}
              </button>
              <button
                onClick={() => historySaveState === "saved" ? (window.history.replaceState(null, "", "/exam"), setPhase("entry")) : setConfirmAction("unsaved")}
                className="btn-primary w-full py-3.5"
              >
                <GraduationCap className="w-5 h-5 inline" /> {t("exam_new", lang)}
              </button>
            </div>
          </div>
        </main>

      </AppLayout>
    );
  }

  // ── EXAM ── (Exam-B: minimap sidebar + question pane)
  const q = questions[currentIdx];
  if (!q) return null;
  const selectedForQ = answers[currentIdx];
  const answeredCount = Object.values(answers).filter(a => a.length > 0).length;
  const partialCount = questions.filter((q, i) => examSelectionState(q.n_correct ?? q.options?.filter(o => o.correct).length ?? 1, answers[i]) === "partial").length;
  const flaggedCount = flaggedIdxs.size;
  const unansweredCount = questions.length - answeredCount + partialCount;
  const currentFlagged = flaggedIdxs.has(currentIdx);

  // Submit CTA variant — success when everything answered, secondary w/ count otherwise.
  const submitClass = unansweredCount === 0 ? "mp-btn mp-btn--success" : "mp-btn mp-btn--secondary";
  const submitLabel = unansweredCount === 0
    ? t("exam_submit", lang)
    : `${t("exam_submit", lang)} · ${unansweredCount} ${lang === "de" ? "offen" : "open"}`;

  // Visible indices when "only flagged" filter is on.
  const visibleIdxs = onlyFlagged
    ? Array.from({ length: questions.length }, (_, i) => i).filter((i) => flaggedIdxs.has(i))
    : Array.from({ length: questions.length }, (_, i) => i);

  // Keyboard navigation on the minimap grid.
  // Arrow keys move focus to the next/prev/row-up/row-down cell. Enter/Space jumps.
  const handleMinimapKey = (e: React.KeyboardEvent<HTMLButtonElement>, idxInVisible: number) => {
    // The grid is auto-fill, so the column count is layout-derived. Measure it
    // live by counting the cells that share the first row's offsetTop (falls
    // back to 10 if the grid isn't mounted), so Up/Down jump exactly one row.
    let cols = 10;
    const cells = minimapRef.current?.querySelectorAll<HTMLButtonElement>("[data-cell-idx]");
    if (cells && cells.length > 0) {
      const firstTop = cells[0].offsetTop;
      let c = 0;
      for (const cell of cells) {
        if (cell.offsetTop === firstTop) c++;
        else break;
      }
      if (c > 0) cols = c;
    }
    let next = idxInVisible;
    if (e.key === "ArrowRight") next = Math.min(visibleIdxs.length - 1, idxInVisible + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, idxInVisible - 1);
    else if (e.key === "ArrowDown") next = Math.min(visibleIdxs.length - 1, idxInVisible + cols);
    else if (e.key === "ArrowUp") next = Math.max(0, idxInVisible - cols);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const targetIdx = visibleIdxs[idxInVisible];
      if (targetIdx !== undefined) {
        setCurrentIdx(targetIdx);
        setMobileDrawerOpen(false);
      }
      return;
    } else {
      return;
    }
    e.preventDefault();
    if (next !== idxInVisible) {
      const target = minimapRef.current?.querySelector<HTMLButtonElement>(`[data-cell-idx="${visibleIdxs[next]}"]`);
      target?.focus();
    }
  };

  // Minimap cell — shared between desktop sidebar and mobile drawer.
  // State priority: current > flagged > answered > unanswered.
  const MinimapCell = ({ idx, idxInVisible }: { idx: number; idxInVisible: number }) => {
    const isCurrent = idx === currentIdx;
    const isAnswered = (answers[idx]?.length || 0) > 0;
    const isPartial = examSelectionState(questions[idx]?.n_correct ?? questions[idx]?.options?.filter(o => o.correct).length ?? 1, answers[idx]) === "partial";
    const isFlagged = flaggedIdxs.has(idx);

    // No min-width — the auto-fill grid track already guarantees a sensible
    // cell size; a min-width wider than the track is what caused the overlap.
    let cellClasses = "aspect-square min-h-11 w-full rounded-md font-mono text-[10px] font-bold flex items-center justify-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mp-viridian)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--mp-surface-raised)]";

    if (isCurrent) {
      cellClasses += " bg-[var(--mp-viridian)]/15 text-[var(--mp-viridian)] border-2 border-[var(--mp-viridian)] shadow-[0_0_0_3px_rgba(0,168,150,0.2)]";
    } else if (isFlagged && isAnswered) {
      cellClasses += " bg-[var(--mp-warning-bg)] text-[var(--mp-status-warning)] border border-[var(--mp-status-warning)] ring-1 ring-[var(--mp-status-warning)]/40";
    } else if (isFlagged) {
      cellClasses += " bg-[var(--mp-warning-bg)] text-[var(--mp-status-warning)] border-2 border-[var(--mp-status-warning)]";
    } else if (isAnswered) {
      cellClasses += " bg-[var(--mp-oxford-blue)] text-white border border-transparent hover:bg-[var(--mp-cta-blue)] dark:hover:bg-[var(--mp-viridian-dk)]";
    } else {
      cellClasses += " bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)] border border-[var(--mp-border)] hover:border-[var(--mp-viridian)]/50 hover:text-[var(--mp-fg)]";
    }

    return (
      <button
        type="button"
        data-cell-idx={idx}
        onClick={() => {
          setCurrentIdx(idx);
          setMobileDrawerOpen(false);
        }}
        onKeyDown={(e) => handleMinimapKey(e, idxInVisible)}
        className={`${cellClasses} ${isPartial ? "mp-exam-cell-partial" : ""}`}
        aria-label={`${lang === "de" ? "Frage" : "Question"} ${idx + 1}${isPartial ? ` · ${t("exam_partial", lang)}` : ""}${isAnswered ? ` · ${t("answered", lang)}` : ""}${isFlagged ? ` · ${lang === "de" ? "markiert" : "flagged"}` : ""}`}
        aria-current={isCurrent ? "true" : undefined}
      >
        {idx + 1}{isPartial && <span aria-label={t("exam_partial", lang)}>◐</span>}
      </button>
    );
  };

  // Shared sidebar content — rendered in desktop <aside> and mobile drawer.
  const sidebarContent = (
    <div className="flex flex-col h-full min-h-0">
      {/* Header: title + timer */}
      <div className="p-4 border-b border-[var(--mp-border-subtle)] flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="min-w-0">
            <p className="mp-caption text-[var(--mp-fg-subtle)]">
              {lang === "de" ? "Simulation" : "Simulation"}
            </p>
            <p className="text-sm font-bold text-[var(--mp-fg)] truncate">
              {t("exam_sim_title", lang)}
            </p>
          </div>
          {/* Mobile close button */}
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(false)}
            className="lg:hidden min-h-11 min-w-11 p-1.5 rounded-md text-[var(--mp-fg-subtle)] hover:bg-[var(--mp-surface-sunken)] hover:text-[var(--mp-fg)] transition-colors"
            aria-label={lang === "de" ? "Schließen" : "Close"}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

      </div>

      {/* Stats + current-question flag */}
      <div className="p-4 border-b border-[var(--mp-border-subtle)] flex-shrink-0">
        <h3 className="mp-caption text-[var(--mp-fg-subtle)] mb-2">
          {lang === "de" ? "Status" : "Status"}
        </h3>
        <div className="space-y-1.5 mb-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--mp-fg-muted)]">{t("answered", lang)}</span>
            <span className="font-mono font-bold text-[var(--mp-fg)] tabular-nums">
              {answeredCount} / {questions.length}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--mp-fg-muted)]">{lang === "de" ? "Markiert" : "Flagged"}</span>
            <span className="font-mono font-bold text-[var(--mp-status-warning)] tabular-nums">{flaggedCount}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--mp-fg-muted)]">{lang === "de" ? "Offen" : "Open"}</span>
            <span className="font-mono font-bold text-[var(--mp-fg-subtle)] tabular-nums">{unansweredCount}</span>
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-1.5 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)] rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-[var(--mp-viridian)] rounded-full transition-all"
            style={{ width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Topics section — compact list, clicking jumps to first question of group */}
      {topicGroups.length > 1 && (
        <div className="p-4 border-b border-[var(--mp-border-subtle)] flex-shrink-0">
          <h3 className="mp-caption text-[var(--mp-fg-subtle)] mb-2">
            {lang === "de" ? "Fachgebiete" : "Topics"}
          </h3>
          <div className="space-y-1">
            {topicGroups.map((g) => {
              const groupAnswered = Array.from({ length: g.count }, (_, i) => (answers[g.startIdx + i]?.length || 0) > 0).filter(Boolean).length;
              const isCurrentGroup = currentIdx >= g.startIdx && currentIdx < g.startIdx + g.count;
              const topicConfig = getTopicConfig(g.topic);
              return (
                <button
                  key={`${g.topic}-${g.startIdx}`}
                  type="button"
                  onClick={() => {
                    setCurrentIdx(g.startIdx);
                    setMobileDrawerOpen(false);
                  }}
                  className={`min-h-11 w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors ${
                    isCurrentGroup
                      ? "bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)]"
                      : "hover:bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]"
                  }`}
                >
                  <TopicIcon name={topicConfig.icon} className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="text-xs font-medium truncate flex-1">{g.topic}</span>
                  <span className="text-[10px] font-mono tabular-nums text-[var(--mp-fg-subtle)] flex-shrink-0">
                    {groupAnswered}/{g.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Minimap grid + legend — scrollable inner region */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="mp-caption text-[var(--mp-fg-subtle)]">
            {lang === "de" ? "Navigation" : "Navigation"}
          </h3>
          <button
            type="button"
            onClick={() => setOnlyFlagged((v) => !v)}
            className={`min-h-11 text-xs font-mono uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${
              onlyFlagged
                ? "bg-[var(--mp-status-warning)]/15 text-[var(--mp-status-warning)]"
                : "text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)]"
            }`}
            aria-pressed={onlyFlagged}
          >
            {onlyFlagged
              ? lang === "de" ? "Alle zeigen" : "Show all"
              : lang === "de" ? "Nur markierte" : "Only flagged"}
          </button>
        </div>
        <div
          ref={minimapRef}
          role="group"
          aria-label={lang === "de" ? "Frage-Navigation" : "Question navigation"}
          // auto-fill + minmax derives the column count from the available
          // width, so cells never overflow their track (the overlap bug) and
          // the grid scales cleanly to ANY question count (52 → 180+).
          className="grid gap-1.5 mb-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(44px, 1fr))" }}
        >
          {visibleIdxs.length === 0 ? (
            <p className="text-center text-xs text-[var(--mp-fg-subtle)] py-6" style={{ gridColumn: "1 / -1" }}>
              {lang === "de" ? "Keine markierten Fragen" : "No flagged questions"}
            </p>
          ) : (
            visibleIdxs.map((idx, pos) => (
              <MinimapCell key={idx} idx={idx} idxInVisible={pos} />
            ))
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-[var(--mp-fg-subtle)] mb-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[var(--mp-oxford-blue)]" />
            {lang === "de" ? "beantw." : "answered"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm border-2 border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/15" />
            {lang === "de" ? "aktuell" : "current"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[var(--mp-warning-bg)] border-2 border-[var(--mp-status-warning)]" />
            {lang === "de" ? "markiert" : "flagged"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)]" />
            {lang === "de" ? "offen" : "open"}
          </span>
        </div>
      </div>

      {/* Submit CTA — sticky at sidebar bottom */}
      <div className="p-4 border-t border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] flex-shrink-0">
        <button
          type="button"
          onClick={() => { setMobileDrawerOpen(false); setShowSubmitConfirm(true); }}
          className={`${submitClass} w-full justify-center`}
        >
          <GraduationCap className="w-4 h-4" />
          {submitLabel}
        </button>
      </div>
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
            <span dir="ltr" className={`inline-flex gap-1 items-center font-mono tabular-nums font-bold ${timeLeft <= 300 ? "text-[var(--mp-error-text)]" : "text-[var(--mp-fg)]"}`}><Clock className="w-4 h-4" aria-hidden />{formatTime(timeLeft)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button className="mp-btn mp-btn--secondary min-h-11" onClick={() => setMobileDrawerOpen(true)}><MapIcon className="w-4 h-4" aria-hidden />{t("exam_overview", lang)} <bdi>{answeredCount}/{questions.length}</bdi></button>
            <span className="font-mono text-xs">{t("q", lang)} {currentIdx + 1} / {questions.length}</span>
            <div className="hidden lg:flex gap-2"><ThemeToggle /><LanguageToggle lang={lang} onChange={switchLang} /></div>
          </div>
        </header>
        <div className="px-4 py-1 min-h-8 text-xs bg-[var(--mp-surface-raised)]" role="status">{!online ? t("exam_offline", lang) : autosaveFailed ? t("exam_autosave_failed", lang) : <><span>{timerNotice}</span><span className="ms-2">{clockNotice}</span></>}{awake && <span className="ms-2">{t("exam_awake", lang)}</span>}</div>
        <p className="sr-only" aria-live="polite">{t("q", lang)} {currentIdx + 1} / {questions.length}</p>
        {/* Exam body: minimap sidebar (desktop) + question pane */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Desktop sidebar — .mp-card styling, 300px wide */}
          <aside className="hidden lg:flex flex-col w-[300px] flex-shrink-0 border-r border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
            {sidebarContent}
          </aside>

          {/* Main question pane */}
          <div ref={paneRef} className="mp-exam-pane flex-1 flex flex-col">
            <div className="px-4 lg:px-8 py-4 max-w-3xl w-full mx-auto">
              {/* Question category pill — echoes alt-exam.html b-cat */}
              <div className="flex items-center justify-between mb-3">
                <span className="mp-caption text-[var(--mp-fg-subtle)] font-mono tabular-nums">
                  {t("q", lang)}{currentIdx + 1} / {questions.length}
                </span>
                {q.topic && (
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] truncate max-w-[60%]">
                    {q.topic}
                  </span>
                )}
              </div>

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
                  onCommit={(idxs) => {
                    setAnswers(prev => updateExamSelection(prev, currentIdx, idxs));
                  }}
                />
              </div>

              {lightboxSrc && (
                <ImageLightbox src={lightboxSrc} alt="Medizinische Abbildung" onClose={() => setLightboxSrc(null)} />
              )}

            </div>
          </div>
        </div>

        <Dialog open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen} title={t("exam_overview", lang)} maxWidth="440px">
          <div className="max-h-[65dvh] overflow-y-auto">{sidebarContent}</div><QuestionActions question={q} lang={lang} userTier="pro" userRole="user" layout="row" metaOnly /><div className="flex gap-2"><ThemeToggle /><LanguageToggle lang={lang} onChange={switchLang} /></div>
          <button className="mp-btn mp-btn--secondary min-h-11" onClick={() => { setMobileDrawerOpen(false); setConfirmAction("leave"); }}>{t("exam_leave", lang)}</button>
        </Dialog>
        <div className="mp-exam-actions">
          <button className="mp-btn mp-btn--secondary" disabled={currentIdx === 0} onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}>{t("exam_previous", lang)}</button>
          <button className="mp-btn mp-btn--secondary" aria-pressed={currentFlagged} onClick={() => toggleFlag(currentIdx)}>{t("exam_flag", lang)}</button>
          <button className="mp-btn mp-btn--primary flex-1" onClick={() => currentIdx === questions.length - 1 ? setShowSubmitConfirm(true) : setCurrentIdx(i => i + 1)}>{currentIdx === questions.length - 1 ? t("exam_submit", lang) : t("exam_next", lang)}</button>
        </div>
        <Dialog open={showSubmitConfirm} onOpenChange={setShowSubmitConfirm} hideCloseButton title={t("exam_submit", lang)} footer={<>
          <button className="mp-btn mp-btn--secondary" onClick={() => setShowSubmitConfirm(false)}>{t("cancel", lang)}</button>
          <button className="mp-btn mp-btn--primary" disabled={!submitReady} onClick={() => handleSubmitExam(false)}>{t("exam_submit", lang)}</button>
        </>}><p>{t("exam_submit_confirm", lang)}</p><p>{unansweredCount} {lang === "de" ? "offen" : "open"} · {partialCount} {t("exam_partial", lang)}</p></Dialog>
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
