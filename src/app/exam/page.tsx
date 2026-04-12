"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { BrandedLoader } from "@/components/Logo";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getTopicConfig, VIENNA_EXAM_PARTS } from "@/lib/topics";
import { t, getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { trackEvent, trackPageView } from "@/lib/tracker";
import type { MCQOption } from "@/lib/mcq";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import TopicIcon from "@/components/TopicIcon";
import QuestionActions from "@/components/QuestionActions";
import QuestionCard from "@/components/QuestionCard";
import ImageLightbox from "@/components/ImageLightbox";
import { GraduationCap, Clock, AlertTriangle, Search } from "lucide-react";

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

function readBookmarkIds(): number[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem("medpruef_favorites");
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => (typeof x === "number" ? x : parseInt(String(x), 10))).filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

function readNoteIds(): number[] {
  if (typeof window === "undefined") return [];
  const out: number[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith("medpruef_notes_")) {
      const id = parseInt(k.replace("medpruef_notes_", ""), 10);
      if (Number.isFinite(id)) out.push(id);
    }
  }
  return out;
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

const EXAM_CONFIG = [
  { topic: "Innere Medizin", count: 30 },
  { topic: "Chirurgische Fächer", count: 30 },
  { topic: "Kinder- und Jugendheilkunde", count: 30 },
  { topic: "Neurologie", count: 25 },
  { topic: "Dermatologie und Venerologie", count: 25 },
  { topic: "Frauenheilkunde/Gynäkologie", count: 25 },
  { topic: "Notfall- und Intensivmedizin", count: 25 },
  { topic: "Hals-Nasen-Ohrenheilkunde", count: 20 },
  { topic: "Psychiatrie", count: 20 },
  { topic: "Augenheilkunde", count: 20 },
];

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
  const examSource = searchParams.get("examSource") || "kenntnispruefung";
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [selectedPart, setSelectedPart] = useState<ExamPart>(
    (searchParams.get("part") as ExamPart) || "all"
  );
  const [phase, setPhase] = useState<ExamPhase>("entry");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loadProgress, setLoadProgress] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number[]>>({}); // questionIndex → selected option indices (multi-select)
  const [timeLeft, setTimeLeft] = useState(EXAM_DURATION_S);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [customFilters, setCustomFilters] = useState<CustomFilters>(DEFAULT_CUSTOM_FILTERS);
  const [customCount, setCustomCount] = useState<number | null>(null);
  const [customCounting, setCustomCounting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
    }
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

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
    if (f.bookmarksOnly) ids = readBookmarkIds();
    if (f.notesOnly) {
      const noteIds = readNoteIds();
      ids = ids ? ids.filter((x) => noteIds.includes(x)) : noteIds;
    }
    return { params: p, ids };
  }, [examSource]);

  // Debounced live count preview for custom exam builder
  useEffect(() => {
    if (selectedPart !== "custom") {
      setCustomCount(null);
      return;
    }
    setCustomCounting(true);
    const handle = setTimeout(async () => {
      try {
        const { params, ids } = buildCustomParams(customFilters);
        params.set("countOnly", "1");
        params.set("mcqOnly", "1");
        if (ids !== null) {
          if (ids.length === 0) { setCustomCount(0); setCustomCounting(false); return; }
          params.set("ids", ids.join(","));
        }
        const res = await fetch(`/api/questions?${params}`);
        const data = await res.json();
        setCustomCount(typeof data.count === "number" ? data.count : 0);
      } catch {
        setCustomCount(0);
      } finally {
        setCustomCounting(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [selectedPart, customFilters, buildCustomParams]);

  const loadExam = useCallback(async () => {
    setPhase("loading");
    setLoadProgress(0);
    const allQuestions: Question[] = [];

    if (selectedPart === "custom") {
      // Single filtered fetch
      try {
        const { params, ids } = buildCustomParams(customFilters);
        params.set("limit", String(customFilters.limit));
        params.set("mcqOnly", "1");
        if (ids !== null) {
          if (ids.length === 0) {
            setQuestions([]);
            setAnswers({});
            setCurrentIdx(0);
            setTimeLeft(EXAM_DURATION_S);
            setPhase("exam");
            return;
          }
          params.set("ids", ids.join(","));
        }
        setLoadProgress(40);
        const res = await fetch(`/api/questions?${params}`);
        const data: Question[] = await res.json();
        if (Array.isArray(data)) allQuestions.push(...data);
        setLoadProgress(90);
      } catch {
        // swallow — proceed with empty set
      }
    } else {
      const partTopics = selectedPart !== "all" ? VIENNA_EXAM_PARTS[selectedPart] : null;
      const configToUse = partTopics
        ? EXAM_CONFIG.filter((c) => partTopics.includes(c.topic))
        : EXAM_CONFIG;

      for (let i = 0; i < configToUse.length; i++) {
        const { topic, count } = configToUse[i];
        try {
          const params = new URLSearchParams({ topic, limit: String(count), examSource, mcqOnly: "1" });
          const res = await fetch(`/api/questions?${params}`);
          const data: Question[] = await res.json();
          allQuestions.push(...data);
        } catch {
          // If a topic fails, continue with others
        }
        setLoadProgress(Math.round(((i + 1) / configToUse.length) * 100));
      }
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
          const res = await fetch(`/api/questions?${params}`);
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
              else allQuestions.push(ekgQ);
            }
          }
        } catch {
          /* swallow — best effort */
        }
      }
    }

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

    setQuestions(grouped);
    setAnswers({});
    setCurrentIdx(0);
    setTimeLeft(EXAM_DURATION_S);
    setPhase("exam");
  }, [examSource, selectedPart, customFilters, buildCustomParams]);

  // Timer management
  useEffect(() => {
    if (phase === "exam") {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            setPhase("results");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  const handleSubmitExam = () => {
    setShowSubmitConfirm(false);
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase("results");
  };

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

  // ── ENTRY ──
  if (phase === "entry") {
    return (
      <div className="app-layout">
        <Sidebar lang={lang} userId={userId} userName={userName} />
        <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
          <div className="px-6 lg:px-10 pt-4 pb-2 flex items-center justify-between border-b border-[#E4E9F0]">
            <Link href="/" className="text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors">
              ← {t("back_home", lang)}
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageToggle lang={lang} onChange={switchLang} />
            </div>
          </div>

          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-60px)] px-4 py-8">
            <div className="max-w-lg w-full">
              <div className="bg-gradient-to-r from-[#001B3D]/[0.04] to-[#007B5F]/[0.04] rounded-2xl p-6 text-center mb-8">
                <div className="w-20 h-20 rounded-2xl border border-[#F4A261]/30 bg-[#F4A261]/10 flex items-center justify-center mx-auto mb-5">
                  <GraduationCap className="w-10 h-10 text-[#F4A261]" />
                </div>
                <h1 className="text-2xl font-bold text-[#1A2B3C] mb-2">{t("exam_sim_title", lang)}</h1>
                <p className="text-[#A0AEC0] text-sm">{t("exam_sim_desc", lang)}</p>
              </div>

              {/* Exam info cards — filtered by selected part (hidden in custom mode, replaced by filter panel) */}
              {selectedPart !== "custom" && (() => {
                const displayedConfig =
                  selectedPart === "sip4" || selectedPart === "sip5"
                    ? EXAM_CONFIG.filter((c) => VIENNA_EXAM_PARTS[selectedPart].includes(c.topic))
                    : EXAM_CONFIG;
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
                            <p className="text-xs font-medium text-[#1A2B3C] truncate">{topic}</p>
                            <p className="text-[10px] text-[#A0AEC0] font-mono">{count} {t("questions", lang)}</p>
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
                  <p className="text-xs text-[#A0AEC0] font-semibold uppercase tracking-wider mb-2 text-center">
                    {t("exam_part_selector", lang)}
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {(["all", "sip4", "sip5", "custom"] as ExamPart[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => setSelectedPart(p)}
                        className={`py-3 rounded-2xl text-sm font-semibold border transition-colors ${
                          selectedPart === p
                            ? "bg-[#F4A261] border-[#F4A261] text-[#1A0E00]"
                            : "bg-[#FFFFFF] border-[#E4E9F0] text-[#4A5568] hover:border-[#F4A261]/40"
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
                    <p className="text-[10px] text-[#A0AEC0] text-center mt-2">
                      {selectedPart === "sip4" ? t("sip4_label", lang) : t("sip5_label", lang)}
                      {" · "}
                      {EXAM_CONFIG.filter((c) =>
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
                  <p className="text-xs text-[#A0AEC0] font-semibold uppercase tracking-wider">
                    {t("custom_exam_label", lang)}
                  </p>

                  {/* Subjects multi-select */}
                  <div>
                    <label className="block text-xs font-semibold text-[#4A5568] mb-2">
                      {t("custom_subjects", lang)}
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {EXAM_CONFIG.map(({ topic }) => {
                        const checked = customFilters.subjects.includes(topic);
                        return (
                          <label
                            key={topic}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer text-xs transition-colors ${
                              checked
                                ? "bg-[#F4A261]/10 border-[#F4A261]/40 text-[#1A2B3C]"
                                : "bg-[#F7F9FC] border-[#E4E9F0] text-[#4A5568] hover:border-[#F4A261]/30"
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
                              className="w-3 h-3 accent-[#F4A261]"
                            />
                            <span className="truncate">{topic}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Tags input */}
                  <div>
                    <label className="block text-xs font-semibold text-[#4A5568] mb-1.5">
                      {t("custom_tags", lang)}
                    </label>
                    <input
                      type="text"
                      value={customFilters.tags}
                      onChange={(e) => setCustomFilters((f) => ({ ...f, tags: e.target.value }))}
                      placeholder="cardio, sip4a"
                      className="w-full px-3 py-2 text-xs border border-[#E4E9F0] rounded focus:outline-none focus:border-[#F4A261]"
                    />
                  </div>

                  {/* Date range */}
                  <div>
                    <label className="block text-xs font-semibold text-[#4A5568] mb-1.5">
                      {t("custom_date_range", lang)}
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="month"
                        value={customFilters.dateFrom}
                        onChange={(e) => setCustomFilters((f) => ({ ...f, dateFrom: e.target.value }))}
                        className="flex-1 px-3 py-2 text-xs border border-[#E4E9F0] rounded focus:outline-none focus:border-[#F4A261]"
                      />
                      <span className="text-xs text-[#A0AEC0]">—</span>
                      <input
                        type="month"
                        value={customFilters.dateTo}
                        onChange={(e) => setCustomFilters((f) => ({ ...f, dateTo: e.target.value }))}
                        className="flex-1 px-3 py-2 text-xs border border-[#E4E9F0] rounded focus:outline-none focus:border-[#F4A261]"
                      />
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 px-3 py-2 rounded border border-[#E4E9F0] bg-[#F7F9FC] text-xs text-[#4A5568] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={customFilters.bookmarksOnly}
                        onChange={(e) => setCustomFilters((f) => ({ ...f, bookmarksOnly: e.target.checked }))}
                        className="w-3 h-3 accent-[#F4A261]"
                      />
                      <span>{t("custom_bookmarks_only", lang)}</span>
                    </label>
                    <label className="flex items-center gap-2 px-3 py-2 rounded border border-[#E4E9F0] bg-[#F7F9FC] text-xs text-[#4A5568] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={customFilters.notesOnly}
                        onChange={(e) => setCustomFilters((f) => ({ ...f, notesOnly: e.target.checked }))}
                        className="w-3 h-3 accent-[#F4A261]"
                      />
                      <span>{t("custom_notes_only", lang)}</span>
                    </label>
                  </div>

                  {/* Search */}
                  <div>
                    <label className="block text-xs font-semibold text-[#4A5568] mb-1.5">
                      {t("custom_search_label", lang)}
                    </label>
                    <input
                      type="text"
                      value={customFilters.search}
                      onChange={(e) => setCustomFilters((f) => ({ ...f, search: e.target.value }))}
                      placeholder={t("search_placeholder", lang)}
                      className="w-full px-3 py-2 text-xs border border-[#E4E9F0] rounded focus:outline-none focus:border-[#F4A261]"
                    />
                  </div>

                  {/* Exam size slider */}
                  <div>
                    <label className="block text-xs font-semibold text-[#4A5568] mb-1.5">
                      {t("custom_size", lang)}: <span className="font-mono text-[#F4A261]">{customFilters.limit}</span>
                    </label>
                    <input
                      type="range"
                      min={10}
                      max={200}
                      step={10}
                      value={customFilters.limit}
                      onChange={(e) => setCustomFilters((f) => ({ ...f, limit: parseInt(e.target.value, 10) }))}
                      className="w-full accent-[#F4A261]"
                    />
                  </div>

                  {/* Live count */}
                  <div className="pt-3 border-t border-[#E4E9F0] text-center">
                    {customCounting ? (
                      <p className="text-xs text-[#A0AEC0] font-mono">{t("custom_loading_count", lang)}</p>
                    ) : customCount === 0 ? (
                      <p className="text-xs text-[#D64545] font-semibold">{t("custom_no_matches", lang)}</p>
                    ) : (
                      <p className="text-xs text-[#4A5568]">
                        <span className="font-mono font-bold text-[#F4A261] text-base">
                          ≈ {customCount ?? "—"}
                        </span>{" "}
                        {t("custom_matching", lang)}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Pass threshold notice */}
              <div className="bg-[#F4A261]/6 border border-[#F4A261]/25 rounded p-4 mb-6 text-center">
                <p className="text-sm text-[#F4A261] flex items-center justify-center gap-1"><AlertTriangle className="w-4 h-4 inline" /> {t("pass_threshold", lang)}</p>
              </div>

              <button
                onClick={loadExam}
                disabled={selectedPart === "custom" && (customCount === null || customCount === 0)}
                className="btn-primary w-full py-4 text-base disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <GraduationCap className="w-5 h-5 inline" /> {t("start_exam", lang)}
                {selectedPart === "custom" && customCount !== null && customCount > 0 && (
                  <span className="ml-2 font-mono text-sm opacity-70">
                    ({Math.min(customCount, customFilters.limit)})
                  </span>
                )}
              </button>
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
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#F7F9FC] px-4">
        <div className="text-center animate-fade-in max-w-sm w-full">
          <GraduationCap className="w-10 h-10 text-[#F4A261] mx-auto mb-4" />
          <p className="text-[#4A5568] font-semibold mb-6">{t("exam_loading", lang)}</p>
          <div className="bg-[#F7F9FC] rounded-full h-2 mb-3 overflow-hidden">
            <div
              className="h-full bg-[#F4A261] rounded-full transition-all duration-300"
              style={{ width: `${loadProgress}%` }}
            />
          </div>
          <p className="text-[#A0AEC0] text-sm font-mono">{loadProgress}%</p>
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
      <div className="app-layout">
        <Sidebar lang={lang} userId={userId} userName={userName} />
        <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
          <div className="px-6 lg:px-10 pt-4 pb-2 flex items-center justify-between border-b border-[#E4E9F0]">
            <button
              onClick={() => setPhase("results")}
              className="text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors"
            >
              ← {lang === "de" ? "Ergebnisse" : "Results"}
            </button>
            <span className="text-xs text-[#A0AEC0] font-mono">
              {reviewIdx + 1} / {questions.length}
            </span>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageToggle lang={lang} onChange={switchLang} />
            </div>
          </div>

          <div className="px-4 lg:px-8 py-4 max-w-3xl mx-auto">
            {/* Progress bar */}
            <div className="h-1 bg-[#F7F9FC] rounded-full mb-6 overflow-hidden">
              <div
                className="h-full bg-[#007B5F] rounded-full transition-all"
                style={{ width: `${((reviewIdx + 1) / questions.length) * 100}%` }}
              />
            </div>

            <div className="mb-2 flex items-center justify-end">
              <span className={`text-xs font-medium font-mono px-2 py-0.5 rounded ${
                wasCorrect
                  ? "bg-[#00A896]/15 text-[#00A896]"
                  : wasAnswered
                  ? "bg-[#D64545]/15 text-[#D64545]"
                  : "bg-[#F7F9FC] text-[#A0AEC0]"
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

            {/* Action rail — favorite, AI explain, notes, report */}
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
              />
            </div>

            {lightboxSrc && (
              <ImageLightbox src={lightboxSrc} alt="Medizinische Abbildung" onClose={() => setLightboxSrc(null)} />
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setReviewIdx(Math.max(0, reviewIdx - 1))}
                disabled={reviewIdx === 0}
                className="flex-1 py-3 border border-[#E4E9F0] rounded text-[#4A5568] text-sm font-medium disabled:opacity-30 hover:border-[#007B5F]/40 transition-colors"
              >
                ← {lang === "de" ? "Zurück" : "Previous"}
              </button>
              <button
                onClick={() => setReviewIdx(Math.min(questions.length - 1, reviewIdx + 1))}
                disabled={reviewIdx === questions.length - 1}
                className="flex-1 py-3 border border-[#E4E9F0] rounded text-[#4A5568] text-sm font-medium disabled:opacity-30 hover:border-[#007B5F]/40 transition-colors"
              >
                {lang === "de" ? "Weiter" : "Next"} →
              </button>
            </div>
          </div>
        </main>
        <BottomNav lang={lang} userId={userId} />
      </div>
    );
  }

  // ── RESULTS ──
  if (phase === "results") {
    const topicResults = computeResults();

    return (
      <div className="app-layout">
        <Sidebar lang={lang} userId={userId} userName={userName} />
        <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
          <div className="px-6 lg:px-10 pt-4 pb-2 flex items-center justify-between border-b border-[#E4E9F0]">
            <Link href="/" className="text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors">
              ← {t("back_home", lang)}
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageToggle lang={lang} onChange={switchLang} />
            </div>
          </div>

          <div className="px-4 lg:px-8 py-6 max-w-2xl mx-auto">
            <h1 className="text-xl font-bold text-[#1A2B3C] mb-6">{t("exam_finished", lang)}</h1>

            {/* Overall result */}
            <div className={`rounded-2xl p-8 border mb-6 text-center animate-scale-in ${
              passed
                ? "bg-[#00A896]/8 border-[#00A896]/40"
                : "bg-[#D64545]/8 border-[#D64545]/40"
            }`}>
              <div className={`text-5xl font-black font-mono mb-2 ${passed ? "text-[#00A896]" : "text-[#D64545]"}`}>
                {Math.round(overallPct * 100)}%
              </div>
              <div className={`text-lg font-bold mb-2 ${passed ? "text-[#00A896]" : "text-[#D64545]"}`}>
                {passed ? t("exam_passed", lang) : t("exam_failed", lang)}
              </div>
              <p className="text-[#A0AEC0] text-sm font-mono">
                {totalCorrect} / {questions.length} {t("correct", lang)} · {t("pass_threshold", lang)}
              </p>
            </div>

            {/* Specialty breakdown */}
            <h2 className="text-base font-semibold text-[#1A2B3C] mb-3">{t("specialty_results", lang)}</h2>
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
                          <span className="text-sm text-[#1A2B3C] font-medium">{topic}</span>
                        </div>
                        <span className={`text-sm font-bold font-mono ${topicPassed ? "text-[#00A896]" : "text-[#D64545]"}`}>
                          {pct}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-[#F7F9FC] rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: topicPassed ? "#00A896" : pct >= 40 ? "#F4A261" : "#D64545",
                            }}
                          />
                        </div>
                        <span className="text-[10px] text-[#A0AEC0] font-mono w-14 text-right">
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
                className="w-full py-3.5 border border-[#E4E9F0] rounded text-[#1A2B3C] font-medium hover:border-[#007B5F]/40 transition-colors"
              >
                <Search className="w-4 h-4 inline" /> {t("review_answers", lang)}
              </button>
              <button
                onClick={() => setPhase("entry")}
                className="btn-primary w-full py-3.5"
              >
                <GraduationCap className="w-5 h-5 inline" /> {t("exam_new", lang)}
              </button>
            </div>
          </div>
        </main>
        <BottomNav lang={lang} userId={userId} />
      </div>
    );
  }

  // ── EXAM ──
  const q = questions[currentIdx];
  if (!q) return null;
  const selectedForQ = answers[currentIdx];
  const qAnswered = selectedForQ !== undefined;
  const answeredCount = Object.keys(answers).length;
  const timerWarning = timeLeft < 600; // last 10 minutes

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={userId} userName={userName} />
      <main className="main-content safe-area-top safe-area-bottom flex flex-col min-h-screen bg-[#F7F9FC]">
        {/* Exam header */}
        <div className="px-4 lg:px-8 pt-3 pb-2 border-b border-[#E4E9F0] flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#A0AEC0] font-mono">
                {t("q", lang)}{currentIdx + 1}/{questions.length}
              </span>
              <span className="text-xs text-[#A0AEC0]">
                ✓ {answeredCount}/{questions.length}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded border font-mono text-sm font-bold ${
                timerWarning
                  ? "bg-[#D64545]/10 border-[#D64545]/30 text-[#D64545] animate-pulse"
                  : "bg-[#F7F9FC] border-[#E4E9F0] text-[#1A2B3C]"
              }`}>
                <Clock className="w-4 h-4 inline" /> {formatTime(timeLeft)}
              </div>
              <ThemeToggle />
              <LanguageToggle lang={lang} onChange={switchLang} />
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-1 bg-[#F7F9FC] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#F4A261] rounded-full transition-all duration-300"
              style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Exam body: 2-column on desktop (navigator left, question right) */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left panel: Topic-based navigator — hidden on mobile, shown on lg+ */}
          <div className="hidden lg:flex flex-col w-64 flex-shrink-0 border-r border-[#E4E9F0] dark:border-white/[0.06] bg-[#F7F9FC] dark:bg-[#0F172A] overflow-y-auto">
            <div className="p-3 border-b border-[#E4E9F0] dark:border-white/[0.06]">
              <p className="text-[10px] uppercase tracking-wider text-[#A0AEC0] font-semibold">
                {lang === "de" ? "Fortschritt" : "Progress"}: {answeredCount}/{questions.length}
              </p>
              <div className="h-1.5 bg-[#E4E9F0] dark:bg-white/10 rounded-full mt-1.5 overflow-hidden">
                <div className="h-full bg-[#003A8C] rounded-full transition-all" style={{ width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%` }} />
              </div>
            </div>
            {(() => {
              // Build topic groups from the question array (already grouped by topic)
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
              // Which group is current?
              const currentGroup = groups.findIndex(g => currentIdx >= g.startIdx && currentIdx < g.startIdx + g.count);
              return groups.map((g, gi) => {
                const groupAnswered = Array.from({ length: g.count }, (_, i) => answers[g.startIdx + i] !== undefined).filter(Boolean).length;
                const isCurrentGroup = gi === currentGroup;
                const pct = g.count > 0 ? Math.round((groupAnswered / g.count) * 100) : 0;
                const topicConfig = getTopicConfig(g.topic);
                return (
                  <div key={`${g.topic}-${g.startIdx}`} className="border-b border-[#E4E9F0] dark:border-white/[0.06] last:border-b-0">
                    {/* Topic header — always visible, clickable to jump to first question */}
                    <button
                      onClick={() => setCurrentIdx(g.startIdx)}
                      className={`w-full text-left px-3 py-2.5 flex items-center gap-2 transition-colors ${
                        isCurrentGroup ? "bg-[#003A8C]/8 dark:bg-[#3A7CA5]/10" : "hover:bg-[#F7F9FC] dark:hover:bg-white/5"
                      }`}
                    >
                      <TopicIcon name={topicConfig.icon} className="w-4 h-4 flex-shrink-0" style={{ color: topicConfig.color }} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium truncate ${isCurrentGroup ? "text-[#003A8C] dark:text-[#3A7CA5]" : "text-[#4A5568] dark:text-[#A0AEC0]"}`}>
                          {g.topic}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <div className="flex-1 h-1 bg-[#E4E9F0] dark:bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-[#003A8C] rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[9px] font-mono text-[#A0AEC0] flex-shrink-0">{groupAnswered}/{g.count}</span>
                        </div>
                      </div>
                    </button>
                    {/* Expanded question numbers — only for current group */}
                    {isCurrentGroup && (
                      <div className="px-3 pb-2 flex flex-wrap gap-1">
                        {Array.from({ length: g.count }, (_, i) => {
                          const idx = g.startIdx + i;
                          const isAnswered = answers[idx] !== undefined;
                          const isCurrent = idx === currentIdx;
                          return (
                            <button
                              key={idx}
                              onClick={() => setCurrentIdx(idx)}
                              className={`w-6 h-6 rounded text-[8px] font-mono flex items-center justify-center transition-all ${
                                isCurrent
                                  ? "bg-[#003A8C] text-white ring-1 ring-[#003A8C]"
                                  : isAnswered
                                  ? "bg-[#003A8C]/15 text-[#003A8C]"
                                  : "bg-white dark:bg-white/5 text-[#A0AEC0] border border-[#E4E9F0] dark:border-white/10"
                              }`}
                            >
                              {idx + 1}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>

          {/* Right panel: question content + navigation */}
          <div className="flex-1 flex flex-col overflow-y-auto">
            {/* Mobile-only: compact horizontal question navigator */}
            <div className="lg:hidden px-4 pt-3">
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {questions.map((_, idx) => {
                  const isAnswered = answers[idx] !== undefined;
                  const isCurrent = idx === currentIdx;
                  return (
                    <button
                      key={idx}
                      onClick={() => setCurrentIdx(idx)}
                      className={`w-6 h-6 rounded text-[8px] font-mono flex-shrink-0 flex items-center justify-center ${
                        isCurrent
                          ? "bg-[#003A8C] text-white"
                          : isAnswered
                          ? "bg-[#003A8C]/15 text-[#003A8C]"
                          : "bg-[#F7F9FC] text-[#A0AEC0] border border-[#E4E9F0]"
                      }`}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-4 lg:px-8 py-4 max-w-3xl w-full mx-auto">
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
                  onCommit={(idxs) => {
                    setAnswers((prev) => ({ ...prev, [currentIdx]: idxs }));
                  }}
                />
              </div>

              {lightboxSrc && (
                <ImageLightbox src={lightboxSrc} alt="Medizinische Abbildung" onClose={() => setLightboxSrc(null)} />
              )}

              {/* Navigation */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
                  disabled={currentIdx === 0}
                  className="flex-1 py-3 border border-[#E4E9F0] rounded-xl text-[#4A5568] text-sm font-medium disabled:opacity-30 hover:border-[#007B5F]/40 transition-colors"
                >
                  ← {lang === "de" ? "Zurück" : "Back"}
                </button>
                <button
                  onClick={() => setCurrentIdx(Math.min(questions.length - 1, currentIdx + 1))}
                  disabled={currentIdx === questions.length - 1}
                  className="flex-1 py-3 bg-[#007B5F]/12 border border-[#007B5F]/25 rounded-xl text-[#007B5F] text-sm font-medium disabled:opacity-30 hover:bg-[#007B5F]/20 transition-colors"
                >
                  {lang === "de" ? "Weiter" : "Next"} →
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Submit bar */}
        <div className="px-4 lg:px-8 py-3 border-t border-[#E4E9F0] glass flex-shrink-0">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <span className="text-xs text-[#A0AEC0] font-mono">
              {answeredCount}/{questions.length} {t("answered", lang)}
            </span>
            <button
              onClick={() => setShowSubmitConfirm(true)}
              className="btn-primary px-5 py-2.5 text-sm"
            >
              {t("exam_submit", lang)}
            </button>
          </div>
        </div>

        {/* Submit confirm modal */}
        {showSubmitConfirm && (
          <div className="fixed inset-0 z-50 bg-[#F7F9FC]/80 flex items-center justify-center px-4">
            <div className="card p-6 max-w-sm w-full animate-scale-in">
              <p className="text-[#1A2B3C] font-semibold mb-2">{t("exam_submit", lang)}</p>
              <p className="text-[#A0AEC0] text-sm mb-5">{t("exam_submit_confirm", lang)}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSubmitConfirm(false)}
                  className="flex-1 py-2.5 border border-[#E4E9F0] rounded text-[#4A5568] text-sm hover:border-[#007B5F]/40 transition-colors"
                >
                  {t("cancel", lang)}
                </button>
                <button
                  onClick={handleSubmitExam}
                  className="flex-1 py-2.5 bg-[#003A8C] text-white rounded font-bold text-sm hover:bg-[#003A8C]/90 transition-colors"
                >
                  {t("exam_submit", lang)}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      <BottomNav lang={lang} userId={userId} />
    </div>
  );
}

export default function ExamPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-[#F7F9FC]">
        <BrandedLoader />
      </div>
    }>
      <ExamContent />
    </Suspense>
  );
}
