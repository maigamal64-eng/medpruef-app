"use client";

/**
 * /history — Verlauf (History feature v1, Pro-only).
 *
 * One surface where the learner sees everything they ever did:
 *   - Overview strip: answered, accuracy, streak, XP (reuses /api/stats)
 *   - Prüfungen tab: every saved exam simulation, click → full question-by-
 *     question review (your selection vs correct, explanation, re-practice)
 *   - Fragen tab: the raw answer history with filters (exam type, right/
 *     wrong, window) and re-practice links
 *
 * Pro-only, enforced SERVER-side (the /api/history/* routes 403 free
 * callers with code PRO_REQUIRED) and mirrored in this UI with an upsell.
 * Recording exam attempts stays open to every signed-in user so the upsell
 * can quote real saved data ("3 Prüfungen gespeichert").
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  Crown,
  FileText,
  History as HistoryIcon,
  XCircle,
} from "lucide-react";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { authFetch } from "@/lib/authFetch";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";

type Lang = "de" | "en";

const EXAM_LABELS: Record<string, { de: string; en: string }> = {
  kenntnispruefung: { de: "Kenntnisprüfung (Wien)", en: "Kenntnisprüfung (Vienna)" },
  kmp_innsbruck: { de: "Stichprobentest (Innsbruck)", en: "Stichprobentest (Innsbruck)" },
  pharma: { de: "Pharmakologie", en: "Pharmacology" },
};

interface AttemptSummary {
  id: string;
  exam_type: string;
  title: string | null;
  config: Record<string, unknown> | null;
  correct_count: number;
  total_count: number;
  score_pct: number;
  duration_ms: number | null;
  completed_at: string;
}

interface ReviewOption {
  text: string;
  is_correct: boolean;
  is_selected: boolean;
}

interface ReviewQuestion {
  question_id: number;
  removed: boolean;
  topic?: string;
  stem?: string;
  options: ReviewOption[];
  is_correct: boolean;
  explanation?: string | null;
  ai_explanation?: string | null;
  image_url?: string | null;
  is_active?: boolean;
}

interface AnswerRow {
  id: number;
  question_id: number;
  user_answer: string | null;
  is_correct: boolean;
  time_spent_ms: number | null;
  created_at: string;
  question: {
    id: number;
    topic: string;
    question: string;
    answer: string;
    explanation: string | null;
    is_active: boolean;
    exam_type: string;
  } | null;
}

function fmtDate(iso: string, lang: Lang): string {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "de" ? "de-AT" : "en-IE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtDuration(ms: number | null, lang: Lang): string {
  if (!ms || ms < 1000) return "–";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} ${lang === "de" ? "Min" : "min"}`;
  return `${Math.floor(min / 60)} ${lang === "de" ? "h" : "h"} ${min % 60} ${lang === "de" ? "Min" : "min"}`;
}

function ScoreBar({ pct, passed }: { pct: number; passed: boolean }) {
  return (
    <div className="w-full h-2 rounded-full bg-[var(--mp-border-subtle)] overflow-hidden">
      <div
        className={`h-full rounded-full ${passed ? "bg-[var(--mp-accent-teal)]" : "bg-[var(--mp-error)]"}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

export default function HistoryPage() {
  const { isPaid, isLoading: tierLoading } = useUserTier();
  const [lang, setLang] = useState<Lang>("de");
  const [tab, setTab] = useState<"exams" | "questions">("exams");

  const [attempts, setAttempts] = useState<AttemptSummary[] | null>(null);
  const [openAttempt, setOpenAttempt] = useState<{ summary: AttemptSummary; questions: ReviewQuestionRow[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [answers, setAnswers] = useState<AnswerRow[] | null>(null);
  const [answersTotal, setAnswersTotal] = useState<number | null>(null);
  const [filterExam, setFilterExam] = useState("");
  const [filterCorrect, setFilterCorrect] = useState<"all" | "correct" | "wrong">("all");
  const [filterDays, setFilterDays] = useState<0 | 7 | 30>(0);
  const [answerOffset, setAnswerOffset] = useState(0);
    const [loadingMore, setLoadingMore] = useState(false);

  const [overview, setOverview] = useState<{
    answered: number | null;
    accuracy: number | null;
    streak: number | null;
    xp: number | null;
  } | null>(null);

  interface ReviewQuestionRow {
    question_id: number;
    removed: boolean;
    topic?: string;
    stem?: string;
    options: ReviewOption[];
    is_correct: boolean;
    explanation?: string | null;
    ai_explanation?: string | null;
    image_url?: string | null;
  }

  const de = lang === "de";

  // UI language from localStorage (same key the app shell uses).
  useEffect(() => {
    const stored = window.localStorage.getItem("medpruef_lang");
    if (stored === "en" || stored === "de") setLang(stored);
  }, []);

  useEffect(() => {
    if (!isPaid) return;
    void (async () => {
      try {
        const res = await authFetch("/api/stats");
        if (!res.ok) return;
        const d = await res.json();
        const gam = d?.gamification ?? {};
        const answered = typeof gam.total_questions_answered === "number" ? gam.total_questions_answered : null;
        const correct = typeof gam.total_correct === "number" ? gam.total_correct : null;
        setOverview({
          answered,
          accuracy: answered && correct !== null ? Math.round((correct / answered) * 100) : null,
          streak: typeof gam.current_streak === "number" ? gam.current_streak : null,
          xp: typeof gam.total_xp === "number" ? gam.total_xp : null,
        });
      } catch {
        /* overview is best-effort */
      }
    })();
  }, [isPaid]);

  const loadAttempts = useCallback(async () => {
    try {
      const res = await authFetch("/api/history/exams?limit=50");
      if (res.status === 403) return;
      const d = await res.json();
      setAttempts(Array.isArray(d?.attempts) ? d.attempts : []);
    } catch {
      setAttempts([]);
    }
  }, []);

  useEffect(() => {
    if (!isPaid) return;
    void loadAttempts();
  }, [isPaid, loadAttempts]);

  const loadAnswers = useCallback(
    async (offset: number, append: boolean) => {
      try {
        const params = new URLSearchParams();
        params.set("limit", "20");
        params.set("offset", String(offset));
        if (filterExam) params.set("exam_type", filterExam);
        if (filterCorrect !== "all") params.set("correctness", filterCorrect);
        if (filterDays > 0) params.set("days", String(filterDays));
        const res = await authFetch(`/api/history/answers?${params.toString()}`);
        if (res.status === 403) return;
        const d = await res.json();
        const rows = (Array.isArray(d?.answers) ? d.answers : []) as AnswerRow[];
        setAnswers((prev) => (append && prev ? [...prev, ...rows] : rows));
        if (typeof d?.total === "number") setAnswersTotal(d.total);
      } catch {
        setAnswers((prev) => (append && prev ? prev : []));
      }
    },
    [filterExam, filterCorrect, filterDays]
  );

  useEffect(() => {
    if (!isPaid || tab !== "questions") return;
    void loadAnswers(answerOffset, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaid, tab, filterExam, filterCorrect, filterDays]);

  const openExam = useCallback(async (summary: AttemptSummary) => {
    try {
      const res = await authFetch(`/api/history/exams/${summary.id}`);
      if (!res.ok) return;
      const d = await res.json();
      if (Array.isArray(d?.questions)) {
        setOpenAttempt({ summary, questions: d.questions as ReviewQuestionRow[] });
      }
    } catch {
      /* keep list view */
    }
  }, []);

  const L = (de: string, en: string) => (lang === "de" ? de : en);

  // ── Loading / gate states ─────────────────────────────────────────
  if (tierLoading) {
    return (
      <main className="min-h-screen bg-[var(--mp-bg)] px-4 py-10">
        <div className="max-w-3xl mx-auto animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-[var(--mp-border-subtle)]" />
          <div className="h-24 rounded-2xl bg-[var(--mp-border-subtle)]" />
          <div className="h-64 rounded-2xl bg-[var(--mp-border-subtle)]" />
        </div>
      </main>
    );
  }

  if (!isPaid) {
    return (
      <main className="min-h-screen bg-[var(--mp-bg)] px-4 py-10">
        <div className="max-w-xl mx-auto">
          <Link href="/" className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm inline-flex items-center gap-1.5 mb-8">
            <ArrowLeft className="w-4 h-4" /> {L("Zurück", "Back")}
          </Link>
          <div className="mp-card p-10 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#F4A261]/10 text-[#F4A261]">
              <Crown className="w-7 h-7" />
            </div>
            <h1 className="mp-h2 mb-3">{L("Dein Verlauf ist ein Pro-Feature", "Your history is a Pro feature")}</h1>
            <p className="text-[var(--mp-fg-subtle)] mb-6">
              {L(
                "Mit Pro siehst du jede gespeicherte Prüfung Frage für Frage, deinen kompletten Fragen-Verlauf und deinen Fortschritt auf einen Blick.",
                "With Pro you can reopen every saved exam question by question, browse your full answer history and see your progress at a glance."
              )}
            </p>
            <Link href="/pricing" className="mp-btn mp-btn--primary">
              {L("Zu Pro", "Get Pro")}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ── Exam review (detail) view ─────────────────────────────────────
  if (openAttempt) {
    const a = openAttempt.summary;
    return (
      <main className="min-h-screen bg-[var(--mp-bg)]">
        <div className="border-b border-[var(--mp-border-subtle)] px-4 lg:px-8 py-3 flex items-center justify-between">
          <button
            onClick={() => setOpenAttempt(null)}
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" /> {L("Zurück zum Verlauf", "Back to history")}
          </button>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={setLang} />
          </div>
        </div>
        <div className="px-4 lg:px-8 py-6 max-w-6xl mx-auto">
          <h1 className="mp-h2 mb-1">{a.title ?? EXAM_LABELS[a.exam_type]?.[lang] ?? a.exam_type}</h1>
          <p className="text-[var(--mp-fg-subtle)] text-sm mb-6">
            {fmtDate(a.completed_at, lang)} · {a.correct_count}/{a.total_count} {L("richtig", "correct")} · {Math.round(a.score_pct)}%
          </p>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {openAttempt.questions.map((q, i) => (
              <div key={`${q.question_id}-${i}`} className="card p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className="text-xs font-mono text-[var(--mp-fg-subtle)]">#{i + 1}</span>
                  {q.removed ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--mp-border-subtle)] text-[var(--mp-fg-subtle)]">
                      {L("aus dem Fragenpool entfernt", "removed from the bank")}
                    </span>
                  ) : q.is_correct ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--mp-accent-teal)]">
                      <CheckCircle2 className="w-4 h-4" /> {L("Richtig", "Correct")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--mp-error)]">
                      <XCircle className="w-4 h-4" /> {L("Falsch", "Wrong")}
                    </span>
                  )}
                </div>
                {!q.removed && (
                  <>
                    {q.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={q.image_url} alt="" className="max-h-48 rounded-lg mb-2 border border-[var(--mp-border-subtle)]" />
                    )}
                    <p className="text-[var(--mp-fg)] text-sm mb-2 whitespace-pre-wrap">{q.stem}</p>
                    <div className="space-y-1.5 mb-2">
                      {q.options.map((o, oi) => (
                        <div
                          key={oi}
                          className={`text-sm rounded-lg px-3 py-1.5 border ${
                            o.is_correct
                              ? "border-[var(--mp-accent-teal)]/50 bg-[var(--mp-accent-teal)]/8 text-[var(--mp-fg)]"
                              : o.is_selected
                                ? "border-[var(--mp-error)]/50 bg-[var(--mp-error)]/8 text-[var(--mp-fg)]"
                                : "border-transparent text-[var(--mp-fg-subtle)]"
                          }`}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {o.is_correct ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--mp-accent-teal)] shrink-0" />
                            ) : o.is_selected ? (
                              <XCircle className="w-3.5 h-3.5 text-[var(--mp-error)] shrink-0" />
                            ) : (
                              <span className="w-3.5 shrink-0" />
                            )}
                            {o.text}
                          </span>
                        </div>
                      ))}
                    </div>
                    {(q.explanation || q.ai_explanation) && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)]">
                          {L("Erklärung", "Explanation")}
                        </summary>
                        <p className="mt-2 text-[var(--mp-fg-subtle)] whitespace-pre-wrap">{q.explanation ?? q.ai_explanation}</p>
                      </details>
                    )}
                    <Link
                      href={`/quiz?questionId=${q.question_id}`}
                      className="text-xs text-[var(--mp-cta)] hover:underline inline-flex items-center gap-1 mt-2"
                    >
                      <FileText className="w-3 h-3" /> {L("Diese Frage üben", "Practice this question")}
                    </Link>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  // ── Main history view ─────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-[var(--mp-bg)]">
      <div className="border-b border-[var(--mp-border-subtle)] px-4 lg:px-8 py-3 flex items-center justify-between">
        <Link href="/" className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm inline-flex items-center gap-1.5">
          <ArrowLeft className="w-4 h-4" /> {L("Startseite", "Home")}
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguageToggle lang={lang} onChange={setLang} />
        </div>
      </div>

      <div className="px-4 lg:px-8 py-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--mp-accent-teal)]/10 text-[var(--mp-accent-teal)]">
            <HistoryIcon className="w-5 h-5" />
          </div>
          <div>
            <h1 className="mp-h2">{L("Verlauf", "History")}</h1>
            <p className="text-sm text-[var(--mp-fg-subtle)]">
              {L("Alles, was du je geübt hast — Prüfungen, Fragen, Fortschritt.", "Everything you ever did: exams, questions, progress.")}
            </p>
          </div>
        </div>

        {/* Overview strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label={L("Beantwortet", "Answered")} value={overview?.answered ?? "–"} />
          <StatCard label={L("Trefferquote", "Accuracy")} value={overview?.accuracy !== null && overview?.accuracy !== undefined ? `${overview.accuracy}%` : "–"} valueTone="accent" />
          <StatCard label={L("Streak", "Streak")} value={overview?.streak ?? "–"} valueTone="accent" />
          <StatCard label={L("Prüfungen", "Exams")} value={attempts?.length ?? "–"} />
        </div>

        {/* Tabs (MPDS .mp-tabs primitives) */}
        <div className="mp-tabs mb-4" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "exams"}
            onClick={() => setTab("exams")}
            className={`mp-tabs__tab ${tab === "exams" ? "mp-tabs__tab--active" : ""}`}
          >
            {L("Prüfungen", "Exams")}
          </button>
          <button
            role="tab"
            aria-selected={tab === "questions"}
            onClick={() => setTab("questions")}
            className={`mp-tabs__tab ${tab === "questions" ? "mp-tabs__tab--active" : ""}`}
          >
            {L("Fragen-Verlauf", "Question history")}
          </button>
        </div>

        {tab === "exams" && (
          <section>
            {attempts === null ? (
              <p className="text-sm text-[var(--mp-fg-subtle)]">{L("Lädt …", "Loading …")}</p>
            ) : attempts.length === 0 ? (
              <div className="mp-empty">
                <p>{L("Noch keine gespeicherte Prüfung. Starte eine Simulation unter „Prüfung“.", "No saved exams yet. Start one under Exam.")}</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {attempts.map((a) => {
                  const passed = a.score_pct >= 60;
                  return (
                    <button
                      key={a.id}
                      onClick={() => void openExam(a)}
                      className="card card-interactive w-full text-left p-4 flex items-center gap-4"
                    >
                      <div className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border text-sm font-black font-mono ${passed ? "border-[var(--mp-accent-teal)]/40 text-[var(--mp-accent-teal)]" : "border-[var(--mp-error)]/40 text-[var(--mp-error)]"}`}>
                        {Math.round(a.score_pct)}%
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-semibold text-sm text-[var(--mp-fg)] truncate">
                            {a.title ?? EXAM_LABELS[a.exam_type]?.[lang] ?? a.exam_type}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--mp-fg-subtle)] flex items-center gap-2 flex-wrap">
                          <span>{EXAM_LABELS[a.exam_type]?.[lang] ?? a.exam_type}</span>
                          <span>·</span>
                          <span>{fmtDate(a.completed_at, lang)}</span>
                          {a.duration_ms ? (
                            <>
                              <span>·</span>
                              <Clock className="w-3 h-3 inline" /> {fmtDuration(a.duration_ms, lang)}
                            </>
                          ) : null}
                          <span>·</span>
                          <span className="font-mono">{a.correct_count}/{a.total_count}</span>
                        </div>
                        <div className="mt-1.5 w-full h-1.5 rounded-full bg-[var(--mp-border-subtle)]">
                          <div className={`h-full rounded-full ${passed ? "bg-[var(--mp-accent-teal)]" : "bg-[var(--mp-error)]"}`} style={{ width: `${Math.min(100, a.score_pct)}%` }} />
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[var(--mp-fg-subtle)] shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {tab === "questions" && (
          <section>
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <select
                value={filterExam}
                onChange={(e) => { setFilterExam(e.target.value); setAnswerOffset(0); }}
                className="mp-field text-sm"
                aria-label={L("Prüfungsart", "Exam type")}
              >
                <option value="">{L("Alle Prüfungen", "All exams")}</option>
                <option value="kenntnispruefung">Kenntnisprüfung (Wien)</option>
                <option value="kmp_innsbruck">Stichprobentest (Innsbruck)</option>
                <option value="pharma">Pharmakologie</option>
              </select>
              <select
                value={filterCorrect}
                onChange={(e) => { setFilterCorrect(e.target.value as typeof filterCorrect); setAnswerOffset(0); }}
                className="mp-field text-sm"
                aria-label={L("Ergebnis", "Result")}
              >
                <option value="all">{L("Alle", "All")}</option>
                <option value="correct">{L("Richtig", "Correct")}</option>
                <option value="wrong">{L("Falsch", "Wrong")}</option>
              </select>
              <select
                value={filterDays}
                onChange={(e) => { setFilterDays(Number(e.target.value) as typeof filterDays); setAnswerOffset(0); }}
                className="mp-field text-sm"
                aria-label={L("Zeitraum", "Period")}
              >
                <option value={0}>{L("Jederzeit", "Any time")}</option>
                <option value={7}>{L("Letzte 7 Tage", "Last 7 days")}</option>
                <option value={30}>{L("Letzte 30 Tage", "Last 30 days")}</option>
              </select>
              {answersTotal !== null && (
                <span className="text-xs text-[var(--mp-fg-subtle)] ml-auto font-mono">{answersTotal}</span>
              )}
            </div>

            {answers === null ? (
              <p className="text-sm text-[var(--mp-fg-subtle)]">{L("Lädt …", "Loading …")}</p>
            ) : answers.length === 0 ? (
              <div className="mp-empty">
                <p>{L("Keine Einträge für diese Filter.", "Nothing matches these filters.")}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {answers.map((row) => (
                  <AnswerRow key={row.id} row={row} lang={lang} />
                ))}
                {answers.length < (answersTotal ?? 0) && (
                  <button
                    onClick={() => {
                      const next = answerOffset + 20;
                      setAnswerOffset(next);
                      void loadAnswers(next, true);
                    }}
                    className="mp-btn mp-btn--secondary w-full"
                  >
                    {L("Mehr laden", "Load more")}
                  </button>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function StatCard({ label, value, valueTone }: { label: string; value: string | number; valueTone?: "accent" }) {
  return (
    <div className="mp-stat">
      <div className="mp-stat__label">{label}</div>
      <div className={`text-2xl font-black font-mono ${valueTone === "accent" ? "text-[var(--mp-accent-teal)]" : "text-[var(--mp-fg)]"}`}>
        {value}
      </div>
    </div>
  );
}

function AnswerRow({ row, lang }: { row: AnswerRow; lang: Lang }) {
  const q = row.question;
  const date = fmtDate(row.created_at, lang);
  return (
    <div className="card p-3.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs text-[var(--mp-fg-subtle)] font-mono">{fmtDate(row.created_at, lang)}</span>
        {row.is_correct ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--mp-accent-teal)]">
            <CheckCircle2 className="w-3.5 h-3.5" /> {lang === "de" ? "Richtig" : "Correct"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--mp-error)]">
            <XCircle className="w-3.5 h-3.5" /> {lang === "de" ? "Falsch" : "Wrong"}
          </span>
        )}
      </div>
      {q ? (
        <>
          <p className="text-sm text-[var(--mp-fg)] mb-1 whitespace-pre-wrap break-words">{q.question}</p>
          <div className="flex items-center gap-2 text-xs text-[var(--mp-fg-subtle)] mb-1.5 flex-wrap">
            <span className="px-2 py-0.5 rounded-full bg-[var(--mp-border-subtle)]">{q.topic}</span>
            {typeof row.time_spent_ms === "number" && row.time_spent_ms > 0 && (
              <span className="font-mono">{Math.max(1, Math.round(row.time_spent_ms / 1000))} s</span>
            )}
            {!q.is_active && (
              <span className="px-2 py-0.5 rounded-full bg-[#F4A261]/10 text-[#F4A261]">
                {lang === "de" ? "aus dem Fragenpool entfernt" : "removed from the bank"}
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--mp-fg-subtle)]">
            <span className="font-semibold">{lang === "de" ? "Deine Antwort:" : "Your answer:"}</span>{" "}
            <span className={`min-w-0 break-words ${row.is_correct ? "text-[var(--mp-accent-teal)]" : "text-[var(--mp-error)]"}`}>
              {row.user_answer ?? "–"}
            </span>
            {!row.is_correct && (
              <>
                {/* Legacy rows stored the correct answer text as user_answer,
                    which would render "your answer" == "correct" on a WRONG
                    row — suppress the misleading field in that case. */}
                {!(row.user_answer && row.user_answer.trim() === q.answer.trim()) && (
                  <>
                    {" · "}
                    <span className="font-semibold">{lang === "de" ? "Richtig:" : "Correct:"}</span>{" "}
                    <span className="text-[var(--mp-accent-teal)]">{q.answer}</span>
                  </>
                )}
              </>
            )}
          </div>
          <Link
            href={`/quiz?questionId=${q.id}`}
            className="text-xs text-[var(--mp-cta)] hover:underline inline-flex items-center gap-1 mt-2"
          >
            {lang === "de" ? "Nochmal üben" : "Practice again"} <ChevronRight className="w-3 h-3" />
          </Link>
        </>
      ) : (
        <p className="text-xs text-[var(--mp-fg-subtle)]">
          {lang === "de" ? "Frage nicht mehr im Fragenpool." : "Question no longer in the bank."}
        </p>
      )}
    </div>
  );
}
