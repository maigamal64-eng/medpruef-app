"use client";

// CreateTestBuilder — Phase C "Create New Test" quiz customization builder.
//
// Renders the full test-builder flow: test name, Tutor/Timed mode, question-pool
// filter, topic picker (per exam type), question count, and exam-year tag.
// Calls onStart() with an extended QuizConfig; the quiz runner picks it up.
//
// "omitted" (answered-but-skipped) is DISABLED because no skip event is
// recorded in answer_history — it cannot be queried. Rendered as a disabled
// option with a short explanation so the UX is honest.
//
// No raw hex. No em dashes. Austrian DE + EN i18n throughout.

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Play,
  Hash,
  Clock,
  BookOpen,
  Bookmark,
  XCircle,
  Eye,
  GraduationCap,
  Flame,
  Calendar,
  ChevronRight,
  Info,
  Inbox,
} from "lucide-react";
import TopicIcon from "@/components/TopicIcon";
import { getTopicConfig } from "@/lib/topics";
import { type QuizConfig } from "@/components/QuizSetup";
import { getStoredSession } from "@/lib/auth";
import { authFetch } from "@/lib/authFetch";

type Lang = "de" | "en";

type QuizMode = "tutor" | "timed";
type QuizFilter = "all" | "unused" | "incorrect" | "flagged";

interface TopicCount {
  topic: string;
  count: number;
}

interface Props {
  lang: Lang;
  examSource: string;
  onStart: (config: QuizConfig) => void;
  onCancel?: () => void;
}

const COUNT_PRESETS = [10, 20, 30, 50, 100];

// Available Austrian exam years for year-tag filter.
// Extend when new exam cohorts are added to the DB.
const EXAM_YEARS = ["2025", "2024", "2023", "2022", "2021", "2020"];

function bookmarkCacheKey(userId: string) {
  return `medpruef_favorites:${userId}`;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function readBookmarkIds(userId: string | null): number[] {
  if (!userId) return [];
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(bookmarkCacheKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPositiveInteger);
  } catch {
    return [];
  }
}

// -------------------------------------------------
// Sub-component: compact chip button
// -------------------------------------------------
function Chip({
  active,
  disabled,
  onClick,
  children,
  title,
}: {
  active: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      title={title}
      disabled={disabled}
      aria-pressed={active}
      className={[
        "px-4 py-2 rounded-xl text-xs font-semibold transition-all select-none",
        active
          ? "bg-[var(--mp-viridian)] text-white shadow-[var(--shadow-card)]"
          : disabled
          ? "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)] cursor-not-allowed opacity-50"
          : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] hover:bg-[var(--mp-viridian)]/10",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// -------------------------------------------------
// Main component
// -------------------------------------------------
export default function CreateTestBuilder({ lang, examSource, onStart, onCancel }: Props) {
  const de = lang === "de";
  const router = useRouter();

  // Config state
  const [testName, setTestName]         = useState("");
  const [quizMode, setQuizMode]         = useState<QuizMode>("tutor");
  const [filter, setFilter]             = useState<QuizFilter>("all");
  const [targetCount, setTargetCount]   = useState<number>(20);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [examYear, setExamYear]         = useState<string>("");

  // Topic fetch state
  const [topicCounts, setTopicCounts] = useState<TopicCount[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsError, setTopicsError] = useState(false);
  const [topicsRetry, setTopicsRetry] = useState(0);

  // Pro gate info for incorrect filter
  const [bookmarkCount, setBookmarkCount] = useState<number>(0);
  const [bookmarkIds, setBookmarkIds] = useState<number[]>([]);
  const userId = getStoredSession()?.user?.id || null;

  // Fetch topics on mount / exam source change
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10_000);
    setTopicsLoading(true);
    setTopicsError(false);
    setTopicCounts([]);
    void (async () => {
      try {
        const response = await fetch("/api/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "topics", examSource }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Topic request failed");
        const data: unknown = await response.json();
        if (!Array.isArray(data)) throw new Error("Invalid topic response");
        if (!cancelled) setTopicCounts(data as TopicCount[]);
      } catch {
        if (!cancelled) setTopicsError(true);
      } finally {
        window.clearTimeout(timeoutId);
        if (!cancelled) setTopicsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [examSource, topicsRetry]);

  // Read the account's server-backed bookmark list. The old global key is
  // deliberately ignored for signed-in users to prevent account crossover.
  useEffect(() => {
    let cancelled = false;
    const cacheKey = userId ? bookmarkCacheKey(userId) : null;
    const applyOfflineFallback = () => {
      const fallback = readBookmarkIds(userId);
      if (!cancelled) {
        setBookmarkIds(fallback);
        setBookmarkCount(fallback.length);
      }
    };
    if (!userId) {
      setBookmarkIds([]);
      setBookmarkCount(0);
      return () => { cancelled = true; };
    }
    void (async () => {
      try {
        const response = await authFetch("/api/bookmarks", { cache: "no-store" });
        if (response.status === 401 || response.status === 403) {
          if (!cancelled) {
            setBookmarkIds([]);
            setBookmarkCount(0);
          }
          return;
        }
        if (!response.ok) throw new Error("Bookmark fetch failed");
        const payload = await response.json() as { questionIds?: unknown };
        if (!Array.isArray(payload.questionIds)) throw new Error("Invalid bookmark response");
        const ids = payload.questionIds.filter(isPositiveInteger);
        if (cancelled) return;
        setBookmarkIds(ids);
        setBookmarkCount(ids.length);
        try { localStorage.setItem(cacheKey!, JSON.stringify(ids)); } catch { /* storage may be unavailable */ }
      } catch {
        // Offline fallback is explicitly per-account. No legacy global data is read.
        applyOfflineFallback();
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const toggleTopic = (topic: string) => {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  };

  const totalAvailable = topicCounts
    .filter((t) => selectedTopics.size === 0 || selectedTopics.has(t.topic))
    .reduce((sum, t) => sum + t.count, 0);

  const handleStart = () => {
    if (quizMode === "timed") {
      // Timed mode uses /exam (deferred-grading + timer engine).
      // /exam reads examSource + part from URL; topic/filter pre-seeding
      // requires a larger /exam change, so the user selects topics there.
      router.push(`/exam?examSource=${encodeURIComponent(examSource)}`);
      return;
    }

    // Tutor mode: pass full config to the quiz runner.
    const flaggedIds = filter === "flagged" ? bookmarkIds : undefined;
    onStart({
      topics: Array.from(selectedTopics),
      tags: [],
      targetCount: Math.min(targetCount, totalAvailable || targetCount),
      timeLimitMin: null,
      examDateFrom: null,
      examDateTo: null,
      examSource,
      testName: testName.trim() || undefined,
      quizMode,
      filter,
      examYear: examYear || undefined,
      flaggedIds,
    });
  };

  // Weak-topics preset: select all topics, filter incorrect, 20 Qs
  const applyWeakTopics = () => {
    setFilter("incorrect");
    setSelectedTopics(new Set());
    setTargetCount(20);
  };

  // This-week preset: year = current year, filter all, 30 Qs
  const applyThisWeek = () => {
    setFilter("all");
    setExamYear(new Date().getFullYear().toString());
    setTargetCount(30);
    setSelectedTopics(new Set());
  };

  // -------------------------------------------------
  // Filter options definition
  // -------------------------------------------------
  const filterOptions: Array<{
    id: QuizFilter;
    icon: ReactNode;
    label: { de: string; en: string };
    hint?: { de: string; en: string };
    badge?: string;
  }> = [
    {
      id: "all",
      icon: <Eye className="w-4 h-4" />,
      label: { de: "Alle Fragen", en: "All questions" },
    },
    {
      id: "unused",
      icon: <Inbox className="w-4 h-4" />,
      label: { de: "Ungesehen",   en: "Unused"       },
      hint: {
        de: "Fragen, die du noch nie gesehen hast",
        en: "Questions you have never seen before",
      },
    },
    {
      id: "incorrect",
      icon: <XCircle className="w-4 h-4" />,
      label: { de: "Falsch beantwortet", en: "Previously incorrect" },
      hint: {
        de: "Nur für Pro-Nutzer",
        en: "Pro users only",
      },
      badge: "Pro",
    },
    {
      id: "flagged",
      icon: <Bookmark className="w-4 h-4" />,
      label: { de: "Gespeichert",   en: "Saved"   },
      hint: {
        de: bookmarkCount > 0 ? `${bookmarkCount} gespeicherte Fragen` : "Keine gespeicherten Fragen",
        en: bookmarkCount > 0 ? `${bookmarkCount} saved questions` : "No saved questions",
      },
    },
  ];

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)] py-8 px-4">
      <div className="max-w-2xl mx-auto animate-scale-in">

        {/* ── Header ── */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[var(--mp-viridian)]/10 border border-[var(--mp-viridian)]/30 mb-3">
            <GraduationCap className="w-7 h-7 text-[var(--mp-viridian)]" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-[var(--mp-fg)] font-display">
            {de ? "Neuen Test erstellen" : "Create new test"}
          </h1>
          <p className="text-sm text-[var(--mp-fg-subtle)] mt-1">
            {de
              ? "Wähle Modus, Fragenpool und Fachgebiete"
              : "Choose mode, question pool, and topics"}
          </p>
        </div>

        {/* ── Preset shortcuts ── */}
        <div className="flex gap-2 mb-6 flex-wrap">
          <button
            type="button"
            onClick={applyWeakTopics}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-[var(--mp-border)] text-[var(--mp-fg-muted)] hover:border-[var(--mp-viridian)]/50 hover:text-[var(--mp-fg)] hover:bg-[var(--mp-viridian)]/5 transition-all"
          >
            <Flame className="w-3.5 h-3.5 text-[var(--mp-error)]" />
            {de ? "Schwache Themen" : "Weak topics"}
          </button>
          <button
            type="button"
            onClick={applyThisWeek}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border border-[var(--mp-border)] text-[var(--mp-fg-muted)] hover:border-[var(--mp-viridian)]/50 hover:text-[var(--mp-fg)] hover:bg-[var(--mp-viridian)]/5 transition-all"
          >
            <Calendar className="w-3.5 h-3.5 text-[var(--mp-viridian)]" />
            {de ? "Diese Woche" : "This week"}
          </button>
        </div>

        <div className="space-y-5">

          {/* ── Test name (optional) ── */}
          <section className="card rounded-2xl p-5">
            <label
              htmlFor="ctb-test-name"
              className="text-sm font-semibold text-[var(--mp-fg)] block mb-3"
            >
              {de ? "Testname (optional)" : "Test name (optional)"}
            </label>
            <input
              id="ctb-test-name"
              type="text"
              maxLength={60}
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              placeholder={de ? "z. B. Innere Medizin Intensiv" : "e.g. Internal medicine review"}
              className="w-full px-3 py-2.5 rounded-xl text-sm bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] text-[var(--mp-fg)] placeholder-[var(--mp-fg-subtle)] focus:outline-none focus:border-[var(--mp-viridian)] transition-colors"
            />
          </section>

          {/* ── Mode: Tutor vs Timed ── */}
          <section className="card rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-[var(--mp-fg)] flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-[var(--mp-viridian)]" />
              {de ? "Modus" : "Mode"}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {(["tutor", "timed"] as QuizMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setQuizMode(m)}
                  aria-pressed={quizMode === m}
                  className={[
                    "flex flex-col items-center gap-1.5 p-4 rounded-xl border text-left transition-all",
                    quizMode === m
                      ? "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/8 text-[var(--mp-fg)]"
                      : "border-[var(--mp-border)] hover:border-[var(--mp-viridian)]/40 hover:bg-[var(--mp-viridian)]/5 text-[var(--mp-fg-muted)]",
                  ].join(" ")}
                >
                  {m === "tutor"
                    ? <BookOpen className="w-5 h-5" />
                    : <Clock className="w-5 h-5" />}
                  <span className="text-xs font-semibold">
                    {m === "tutor"
                      ? (de ? "Tutor" : "Tutor")
                      : (de ? "Zeitlimit" : "Timed")}
                  </span>
                  <span className="text-[10px] text-[var(--mp-fg-subtle)] text-center leading-tight">
                    {m === "tutor"
                      ? (de ? "Sofortige Auswertung nach jeder Frage" : "Immediate feedback after each question")
                      : (de ? "Öffnet den Prüfungssimulator (4 Std.)" : "Opens exam simulator (4 hr timer)")}
                  </span>
                </button>
              ))}
            </div>

            {/* Timed mode: note that filter/topic config happens inside the exam simulator */}
            {quizMode === "timed" && (
              <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)]">
                <Info className="w-4 h-4 text-[var(--mp-fg-subtle)] flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-[var(--mp-fg-subtle)] leading-snug">
                  {de
                    ? "Der Prüfungssimulator hat einen eigenen 4-Stunden-Timer und Themenwähler. Filterauswahl gilt dort."
                    : "The exam simulator has its own 4-hour timer and topic selector. Filter settings apply inside."}
                </p>
              </div>
            )}
          </section>

          {/* ── Question pool filter ── */}
          <section className="card rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-[var(--mp-fg)] flex items-center gap-2 mb-3">
              <Eye className="w-4 h-4 text-[var(--mp-viridian)]" />
              {de ? "Fragenpool" : "Question pool"}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filterOptions.map((opt) => {
                const isActive = filter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setFilter(opt.id)}
                    aria-pressed={isActive}
                    className={[
                      "flex items-start gap-3 p-3 rounded-xl border text-left transition-all",
                      isActive
                        ? "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/8 text-[var(--mp-fg)]"
                        : "border-[var(--mp-border)] hover:border-[var(--mp-viridian)]/40 hover:bg-[var(--mp-viridian)]/5 text-[var(--mp-fg-muted)]",
                    ].join(" ")}
                  >
                    <span className={isActive ? "text-[var(--mp-viridian)]" : "text-[var(--mp-fg-subtle)]"}>
                      {opt.icon}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold">{opt.label[lang]}</span>
                        {opt.badge && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--mp-viridian)]/15 text-[var(--mp-viridian)]">
                            {opt.badge}
                          </span>
                        )}
                      </span>
                      {opt.hint && (
                        <span className="text-[10px] text-[var(--mp-fg-subtle)] leading-tight block mt-0.5">
                          {opt.hint[lang]}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}

            </div>

            {/* Bookmarks empty-state warning */}
            {filter === "flagged" && bookmarkCount === 0 && (
              <p className="mt-3 text-[11px] text-[var(--mp-warning)] bg-[var(--mp-warning)]/10 rounded-xl px-3 py-2">
                {de
                  ? "Keine gespeicherten Fragen vorhanden. Speichere zuerst Fragen, dann nutze diesen Filter."
                  : "No saved questions yet. Save questions first, then use this filter."}
              </p>
            )}
          </section>

          {/* ── Topic selection ── */}
          <section className="card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[var(--mp-fg)] flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[var(--mp-viridian)]" />
                {de ? "Fachgebiete" : "Topics"}
                <span className="text-xs text-[var(--mp-fg-subtle)] font-normal">
                  {selectedTopics.size === 0
                    ? `(${de ? "alle" : "all"})`
                    : `(${selectedTopics.size} ${de ? "ausgewählt" : "selected"})`}
                </span>
              </h2>
              {selectedTopics.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedTopics(new Set())}
                  className="text-xs text-[var(--mp-fg-subtle)] hover:text-[var(--mp-error)] transition-colors"
                >
                  {de ? "Zurücksetzen" : "Clear"}
                </button>
              )}
            </div>

            {topicsLoading ? (
              <div className="text-xs text-[var(--mp-fg-subtle)] animate-pulse">
                {de ? "Lade Fachgebiete…" : "Loading topics…"}
              </div>
            ) : topicsError ? (
              <div role="alert" className="rounded-xl border border-[var(--mp-warning)]/30 bg-[var(--mp-warning)]/10 p-3">
                <p className="text-xs text-[var(--mp-fg)]">
                  {de
                    ? "Fachgebiete konnten nicht geladen werden. Deine Prüfungsauswahl bleibt erhalten. Bitte versuche es erneut."
                    : "Topics could not be loaded. Your exam selection is unchanged. Please try again."}
                </p>
                <button
                  type="button"
                  onClick={() => setTopicsRetry((attempt) => attempt + 1)}
                  className="mt-2 rounded-lg px-3 py-2 text-xs font-semibold text-[var(--mp-viridian)] hover:bg-[var(--mp-viridian)]/10"
                >
                  {de ? "Erneut versuchen" : "Try again"}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {topicCounts.map((t) => {
                  const cfg = getTopicConfig(t.topic);
                  const isSel = selectedTopics.has(t.topic);
                  return (
                    <button
                      key={t.topic}
                      type="button"
                      onClick={() => toggleTopic(t.topic)}
                      aria-pressed={isSel}
                      className={[
                        "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all active:scale-[0.98]",
                        isSel
                          ? "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/8 text-[var(--mp-fg)]"
                          : "border-[var(--mp-border)] hover:border-[var(--mp-viridian)]/40 hover:bg-[var(--mp-viridian)]/5 text-[var(--mp-fg-muted)]",
                      ].join(" ")}
                    >
                      <span
                        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `${cfg.color}18`, color: cfg.color }}
                      >
                        <TopicIcon name={cfg.icon} className="w-4 h-4" />
                      </span>
                      <span className="flex-1 text-xs font-medium truncate">{t.topic}</span>
                      <span className="text-[10px] font-mono text-[var(--mp-fg-subtle)]">{t.count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Question count ── */}
          <section className="card rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-[var(--mp-fg)] flex items-center gap-2 mb-3">
              <Hash className="w-4 h-4 text-[var(--mp-viridian)]" />
              {de ? "Anzahl Fragen" : "Number of questions"}
            </h2>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {COUNT_PRESETS.map((n) => (
                <Chip
                  key={n}
                  active={targetCount === n}
                  onClick={() => setTargetCount(n)}
                >
                  {n}
                </Chip>
              ))}
              <input
                type="number"
                min={1}
                max={500}
                value={targetCount}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v) && v > 0) setTargetCount(v);
                }}
                aria-label={
                  de
                    ? "Eigene Anzahl (1 bis 500)"
                    : "Custom count (1 to 500)"
                }
                className="w-20 px-3 py-2 rounded-xl text-sm font-mono text-center bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] text-[var(--mp-fg)] focus:outline-none focus:border-[var(--mp-viridian)]"
              />
            </div>
            {totalAvailable > 0 && (
              <p className="text-[11px] text-[var(--mp-fg-subtle)]">
                {de
                  ? `${totalAvailable.toLocaleString("de-DE")} Fragen verfügbar`
                  : `${totalAvailable.toLocaleString("en-US")} questions available`}
              </p>
            )}
          </section>

          {/* ── Exam year tag ── */}
          <section className="card rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-[var(--mp-fg)] flex items-center gap-2 mb-3">
              <Calendar className="w-4 h-4 text-[var(--mp-viridian)]" />
              {de ? "Prüfungsjahr (optional)" : "Exam year (optional)"}
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <Chip active={examYear === ""} onClick={() => setExamYear("")}>
                {de ? "Alle Jahre" : "All years"}
              </Chip>
              {EXAM_YEARS.map((y) => (
                <Chip key={y} active={examYear === y} onClick={() => setExamYear(y)}>
                  {y}
                </Chip>
              ))}
            </div>
            {examYear && (
              <p className="mt-2 text-[11px] text-[var(--mp-fg-subtle)]">
                {de
                  ? `Nur Fragen aus Prüfungen ${examYear}`
                  : `Questions from ${examYear} exam sittings only`}
              </p>
            )}
          </section>

        </div>

        {/* ── Actions ── */}
        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={handleStart}
            disabled={topicsLoading || topicsError || (quizMode === "tutor" && filter === "flagged" && bookmarkCount === 0)}
            className="w-full btn-primary py-4 text-base rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="w-5 h-5" />
            {quizMode === "timed"
              ? (de ? "Prüfungssimulator öffnen" : "Open exam simulator")
              : (de
                  ? `Test starten (${Math.min(targetCount, totalAvailable || targetCount)} Fragen)`
                  : `Start test (${Math.min(targetCount, totalAvailable || targetCount)} questions)`)}
            <ChevronRight className="w-4 h-4" />
          </button>

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-3 text-sm text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors"
            >
              {de ? "Abbrechen" : "Cancel"}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
