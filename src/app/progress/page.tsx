"use client";

/**
 * Progress — MPDS v2 "Progress-A" dashboard multi-grid.
 *
 * Layout bet: every metric visible at once, no clicks required.
 * Desktop = 2-col grid (radar left, accuracy/line right) with a
 * full-width heatmap + full-width topic rail below. Mobile stacks
 * single-column.
 *
 * All data sources preserved:
 *   - /api/stats?userId=… hydrates gamification + per-topic stats
 *   - /api/questions?ids=… hydrates bookmarked + noted questions
 *   - localStorage: medpruef_favorites, medpruef_notes_*,
 *     medpruef_quiz_results, medpruef_profile.targetDate
 *
 * Charts unchanged — recharts RadarChart + LineChart + calendar
 * heatmap grid are reused, just wrapped in `.mp-card` panels with
 * MPDS typography (.mp-h2 page, .mp-h3 card) and semantic tokens so
 * dark mode is a variable flip.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getLevelFromXP } from "@/lib/xp";
import { getTopicConfig } from "@/lib/topics";
import { t, getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { getStoredExamSource } from "@/lib/topics";
import { QUESTIONS } from "@/lib/content-truth";
import { useUserTier } from "@/lib/hooks/useUserTier";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import TopicIcon from "@/components/TopicIcon";
import {
  TrendingUp,
  Star,
  StickyNote,
  GraduationCap,
  AlertTriangle,
  ArrowUpRight,
  Flame,
} from "lucide-react";
import { SkeletonCard } from "@/components/Skeleton";
import {
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

/* ─────────────────────────────────────────────────────────────
   Chart components — data logic unchanged, visuals rely on
   MPDS tokens via CSS vars so dark mode flips automatically.
   ───────────────────────────────────────────────────────────── */

/** Spider chart showing accuracy by topic. Topic labels shortened to
 *  12 chars on narrow viewports so adjacent labels don't overlap at
 *  375px. Desktop keeps the longer slice. */
function StudyRadar({
  topics,
  lang,
}: {
  topics: { topic: string; answered: number; correct: number }[];
  lang: string;
}) {
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = () => setIsNarrow(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const labelLen = isNarrow ? 10 : 16;

  const data = topics
    .filter((t) => t.answered > 0)
    .map((t) => ({
      subject: t.topic.split("/")[0].replace("- und ", "/").substring(0, labelLen),
      accuracy: Math.round((t.correct / t.answered) * 100),
      fullMark: 100,
    }));

  if (data.length < 3) {
    return (
      <p className="text-sm text-[var(--mp-fg-subtle)] text-center py-12">
        {lang === "de"
          ? "Löse mehr Fragen für den Radar"
          : "Answer more questions to see the radar"}
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="var(--mp-border-subtle)" />
        <PolarAngleAxis
          dataKey="subject"
          tick={{ fontSize: isNarrow ? 9 : 10, fill: "var(--mp-fg-muted)" }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tick={{ fontSize: 9, fill: "var(--mp-fg-subtle)" }}
          axisLine={false}
        />
        <Radar
          name="Accuracy"
          dataKey="accuracy"
          stroke="var(--mp-viridian)"
          fill="var(--mp-viridian)"
          fillOpacity={0.22}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

/** Weekly performance chart — reads quiz results from localStorage */
function WeeklyChart({ lang }: { lang: string }) {
  const [data, setData] = useState<{ day: string; accuracy: number; questions: number }[]>([]);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("medpruef_quiz_results") || "[]");
      if (!Array.isArray(raw) || raw.length === 0) {
        setData([]);
        return;
      }
      const now = new Date();
      const days: Record<string, { correct: number; total: number }> = {};
      const dayNames =
        lang === "de"
          ? ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]
          : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split("T")[0];
        days[key] = { correct: 0, total: 0 };
      }

      for (const r of raw) {
        if (!r.timestamp) continue;
        const key = new Date(r.timestamp).toISOString().split("T")[0];
        if (days[key]) {
          days[key].total += 1;
          if (r.correct) days[key].correct += 1;
        }
      }

      const chartData = Object.entries(days).map(([dateStr, stats]) => {
        const d = new Date(dateStr);
        return {
          day: dayNames[d.getDay()],
          accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
          questions: stats.total,
        };
      });
      setData(chartData);
    } catch {
      setData([]);
    }
  }, [lang]);

  if (data.length === 0 || data.every((d) => d.questions === 0)) {
    return (
      <p className="text-sm text-[var(--mp-fg-subtle)] text-center py-10">
        {lang === "de"
          ? "Beginne zu lernen, um deinen Wochentrend zu sehen"
          : "Start practicing to see your weekly trend"}
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--mp-border-subtle)" />
        <XAxis
          dataKey="day"
          tick={{ fontSize: 11, fill: "var(--mp-fg-subtle)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 10, fill: "var(--mp-fg-subtle)" }}
          axisLine={false}
          tickLine={false}
          width={30}
        />
        <Tooltip
          contentStyle={{
            background: "var(--mp-surface-raised)",
            border: "1px solid var(--mp-border-subtle)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--mp-fg)",
          }}
          formatter={(value: unknown, name: unknown) => [
            `${value}${name === "accuracy" ? "%" : ""}`,
            name === "accuracy"
              ? lang === "de"
                ? "Genauigkeit"
                : "Accuracy"
              : lang === "de"
              ? "Fragen"
              : "Questions",
          ]}
        />
        <Line
          type="monotone"
          dataKey="accuracy"
          stroke="var(--mp-viridian)"
          strokeWidth={2}
          dot={{ r: 4, fill: "var(--mp-viridian)" }}
          activeDot={{ r: 6 }}
        />
        <Line
          type="monotone"
          dataKey="questions"
          stroke="var(--mp-cta-blue)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Activity heatmap — GitHub-style 4 rows × 7 columns */
function ActivityHeatmap({ lang }: { lang: string }) {
  const [cells, setCells] = useState<{ date: string; count: number; label: string }[]>([]);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("medpruef_quiz_results") || "[]");
      const countByDate: Record<string, number> = {};
      if (Array.isArray(raw)) {
        for (const r of raw) {
          if (!r.timestamp) continue;
          const key = new Date(r.timestamp).toISOString().split("T")[0];
          countByDate[key] = (countByDate[key] || 0) + 1;
        }
      }

      const now = new Date();
      const result: { date: string; count: number; label: string }[] = [];
      for (let i = 27; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split("T")[0];
        result.push({
          date: key,
          count: countByDate[key] || 0,
          label: `${d.getDate()}.${d.getMonth() + 1}`,
        });
      }
      setCells(result);
    } catch {
      setCells([]);
    }
  }, []);

  const getColor = (count: number): string => {
    // Dark mode: empty cells (`--mp-surface-sunken` #0F172A) nearly
    // blend into the raised panel `#1E293B`. Adding a subtle border
    // ensures cell-grid edges are always visible, light and dark.
    if (count === 0) return "bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)]";
    if (count <= 5) return "bg-[var(--mp-viridian)]/20";
    if (count <= 15) return "bg-[var(--mp-viridian)]/45";
    if (count <= 30) return "bg-[var(--mp-viridian)]/70";
    return "bg-[var(--mp-viridian)]";
  };

  if (cells.length === 0) return null;

  const weeks: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const dayLabels =
    lang === "de"
      ? ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {dayLabels.map((d) => (
          <span key={d} className="text-[9px] text-[var(--mp-fg-subtle)] text-center font-mono">
            {d}
          </span>
        ))}
      </div>
      <div className="space-y-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((cell) => (
              <div
                key={cell.date}
                className={`calendar-cell ${getColor(cell.count)} rounded-sm transition-colors`}
                title={`${cell.label}: ${cell.count} ${
                  lang === "de" ? "Fragen" : "questions"
                }`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-1 mt-3">
        <span className="text-[10px] text-[var(--mp-fg-subtle)] font-mono">
          {lang === "de" ? "weniger" : "less"}
        </span>
        <div className="calendar-cell bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)] rounded-sm" />
        <div className="calendar-cell bg-[var(--mp-viridian)]/20 rounded-sm" />
        <div className="calendar-cell bg-[var(--mp-viridian)]/45 rounded-sm" />
        <div className="calendar-cell bg-[var(--mp-viridian)]/70 rounded-sm" />
        <div className="calendar-cell bg-[var(--mp-viridian)] rounded-sm" />
        <span className="text-[10px] text-[var(--mp-fg-subtle)] font-mono">
          {lang === "de" ? "mehr" : "more"}
        </span>
      </div>
    </div>
  );
}

type Lang = "de" | "en";

interface TopicStat {
  topic: string;
  answered: number;
  correct: number;
}

interface QuestionItem {
  id: number;
  topic: string;
  question: string;
  image_url?: string;
}

// Known totals per specialty for progress denominator
const TOPIC_TOTALS: Record<string, number> = {
  "Innere Medizin": 1615,
  "Chirurgische Fächer": 1230,
  "Dermatologie und Venerologie": 746,
  "Frauenheilkunde/Gynäkologie": 745,
  "Neurologie": 725,
  "Psychiatrie": 685,
  "Notfall- und Intensivmedizin": 672,
  "Kinder- und Jugendheilkunde": 503,
  "Hals-Nasen-Ohrenheilkunde": 405,
  "Augenheilkunde": 399,
};

// Catalog total across all 3 exam types — sourced from content-truth.ts
// SSoT (review-2026-04-25-B11). Replaces stale hard-coded 10993 that
// missed PR #7's 10,993→10,992 sweep and slightly under-reported
// completion percentages.
const TOTAL_QUESTIONS = QUESTIONS.total;

export default function ProgressPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  // Bookmarks + notes are Pro-only (Lock 2026-04-23). We gate the UI
  // on this tier so the empty state reads "upgrade to unlock"
  // instead of "nothing here".
  // Tier + role read live from /api/auth/me via useUserTier
  // (review-2026-04-26-A2). Replaces the previous stale read from
  // session.user.tier which didn't reflect admin grants until logout.
  // The legacy local-state setters are kept as fallback for the
  // initial render (avoids a free→pro flicker on slow networks).
  const tierLive = useUserTier();
  const [userTier, setUserTier] = useState<string>("free");
  const [userRole, setUserRole] = useState<string>("user");
  // Mirror live state into the local setters so the rest of the page
  // (which reads userTier / userRole) reacts to admin grants.
  useEffect(() => {
    setUserTier(tierLive.tier);
    setUserRole(tierLive.role);
  }, [tierLive.tier, tierLive.role]);
  const [totalXp, setTotalXp] = useState(0);
  const [streak, setStreak] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [totalCorrect, setTotalCorrect] = useState(0);
  const [topicStats, setTopicStats] = useState<TopicStat[]>([]);
  const [sortBy, setSortBy] = useState<"accuracy" | "count">("count");
  const [savedTab, setSavedTab] = useState<"bookmarks" | "notes">("bookmarks");
  const [bookmarkIds, setBookmarkIds] = useState<number[]>([]);
  const [bookmarkQuestions, setBookmarkQuestions] = useState<QuestionItem[]>([]);
  const [noteEntries, setNoteEntries] = useState<{ id: number; note: string }[]>([]);
  const [noteQuestions, setNoteQuestions] = useState<QuestionItem[]>([]);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookmarksLoading, setBookmarksLoading] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);
  const [showAllBookmarks, setShowAllBookmarks] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [accuracy, setAccuracy] = useState(0);

  /* ─── Init: load session, lang, localStorage data ─── */
  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
      setUserTier(session.user.tier || "free");
      setUserRole(session.user.role || "user");
      // Guard against older / minimal sessions that don't embed a
      // gamification snapshot — the server will re-hydrate these after
      // the next /api/stats call. Previous code crashed with
      // "Cannot read properties of undefined (reading 'total_xp')".
      const gm = session.gamification ?? {};
      setTotalXp(gm.total_xp || 0);
      setStreak(gm.current_streak || 0);
      setTotalAnswered(gm.total_questions_answered || 0);
      setTotalCorrect(gm.total_correct || 0);
      const ans = gm.total_questions_answered || 0;
      const cor = gm.total_correct || 0;
      setAccuracy(ans > 0 ? Math.round((cor / ans) * 100) : 0);
    }

    try {
      const favs = JSON.parse(localStorage.getItem("medpruef_favorites") || "[]");
      if (Array.isArray(favs))
        setBookmarkIds(favs.map((id: number | string) => Number(id)));
    } catch {
      /* empty */
    }

    const notes: { id: number; note: string }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("medpruef_notes_")) {
        const qId = parseInt(key.replace("medpruef_notes_", ""), 10);
        if (!isNaN(qId)) {
          const noteText = localStorage.getItem(key) || "";
          if (noteText.trim()) notes.push({ id: qId, note: noteText });
        }
      }
    }
    setNoteEntries(notes);

    try {
      const profile = JSON.parse(localStorage.getItem("medpruef_profile") || "{}");
      if (profile.targetDate) setTargetDate(profile.targetDate);
    } catch {
      /* empty */
    }
  }, []);

  /* ─── Fetch per-topic stats from API ─── */
  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    fetch(`/api/stats?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.gamification) {
          setTotalXp(data.gamification.total_xp || 0);
          setStreak(data.gamification.current_streak || 0);
          setTotalAnswered(data.gamification.total_questions_answered || 0);
          setTotalCorrect(data.gamification.total_correct || 0);
          const ans = data.gamification.total_questions_answered || 0;
          const cor = data.gamification.total_correct || 0;
          setAccuracy(ans > 0 ? Math.round((cor / ans) * 100) : 0);
        }
        if (data.topicStats) {
          const parsed: TopicStat[] = Object.entries(data.topicStats).map(
            ([topic, stat]) => ({
              topic,
              answered: (stat as { total: number; correct: number }).total,
              correct: (stat as { total: number; correct: number }).correct,
            }),
          );
          setTopicStats(parsed);
        }
      })
      .catch(() => {
        /* silent */
      })
      .finally(() => setLoading(false));
  }, [userId]);

  /* ─── Fetch bookmarked questions ─── */
  useEffect(() => {
    if (bookmarkIds.length === 0) return;
    setBookmarksLoading(true);
    const examSource = getStoredExamSource();
    const idsParam = bookmarkIds.slice(0, 50).join(",");
    fetch(`/api/questions?ids=${idsParam}&examSource=${examSource}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setBookmarkQuestions(
            data.map((q: Record<string, unknown>) => ({
              id: q.id as number,
              topic: q.topic as string,
              question: q.question as string,
              image_url: typeof q.image_url === "string" ? q.image_url : undefined,
            })),
          );
        }
      })
      .catch(() => {
        /* silent */
      })
      .finally(() => setBookmarksLoading(false));
  }, [bookmarkIds]);

  /* ─── Fetch noted questions ─── */
  useEffect(() => {
    if (noteEntries.length === 0) return;
    setNotesLoading(true);
    const examSource = getStoredExamSource();
    const idsParam = noteEntries
      .slice(0, 50)
      .map((n) => n.id)
      .join(",");
    fetch(`/api/questions?ids=${idsParam}&examSource=${examSource}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setNoteQuestions(
            data.map((q: Record<string, unknown>) => ({
              id: q.id as number,
              topic: q.topic as string,
              question: q.question as string,
              image_url: typeof q.image_url === "string" ? q.image_url : undefined,
            })),
          );
        }
      })
      .catch(() => {
        /* silent */
      })
      .finally(() => setNotesLoading(false));
  }, [noteEntries]);

  const switchLang = useCallback((l: Lang) => {
    setLang(l);
    setLangState(l);
  }, []);

  const removeBookmark = useCallback(
    (id: number) => {
      const updated = bookmarkIds.filter((bId) => bId !== id);
      setBookmarkIds(updated);
      setBookmarkQuestions((prev) => prev.filter((q) => q.id !== id));
      localStorage.setItem("medpruef_favorites", JSON.stringify(updated));
    },
    [bookmarkIds],
  );

  const xpInfo = getLevelFromXP(totalXp);
  const completionPct = Math.min(
    100,
    Math.round((totalAnswered / TOTAL_QUESTIONS) * 100),
  );

  /* ─── Weak topics (accuracy < 60%, at least 5 answered) ─── */
  const weakTopics = topicStats.filter((ts) => {
    if (ts.answered < 5) return false;
    return ts.answered > 0 && Math.round((ts.correct / ts.answered) * 100) < 60;
  });

  const daysUntilExam = targetDate
    ? Math.max(
        0,
        Math.ceil((new Date(targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      )
    : null;

  /* ─── Topic rail data — all 10 specialties, sorted ─── */
  const allTopics = Object.entries(TOPIC_TOTALS).map(([topic, total]) => {
    const stat = topicStats.find((ts) => ts.topic === topic);
    return {
      topic,
      total,
      answered: stat?.answered || 0,
      correct: stat?.correct || 0,
    };
  });
  const sortedAllTopics = [...allTopics].sort((a, b) => {
    if (sortBy === "accuracy") {
      const accA = a.answered > 0 ? a.correct / a.answered : 0;
      const accB = b.answered > 0 ? b.correct / b.answered : 0;
      return accB - accA;
    }
    return b.answered - a.answered;
  });

  /* ─── Loading skeleton ─── */
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)]">
        <div className="w-full max-w-4xl px-4 space-y-4 animate-fade-in">
          <div className="grid grid-cols-2 gap-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <SkeletonCard />
        </div>
      </div>
    );
  }

  /* ─── Accuracy trend label (compared to last week heuristic) ─── */
  const accuracyTrendUp = accuracy >= 65;

  return (
    <div className="app-layout">
      <Sidebar
        lang={lang}
        userId={userId}
        userName={userName}
        totalXp={totalXp}
        streak={streak}
        accuracy={accuracy}
      />

      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border-subtle)]">
          <Link
            href="/"
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            &larr; {t("back_home", lang)}
          </Link>
          <h1 className="text-base font-bold text-[var(--mp-fg)]">{t("progress", lang)}</h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className="px-4 lg:px-8 py-6 max-w-6xl mx-auto pb-28">
          {/* Page intro */}
          <div className="mb-6">
            <h2 className="mp-h2 text-[var(--mp-fg)]">
              {lang === "de" ? "Fortschritt" : "Progress"}
            </h2>
            <p className="text-sm text-[var(--mp-fg-subtle)] mt-1">
              {lang === "de"
                ? "Alle Kennzahlen auf einen Blick — Radar, Trend, Aktivität und Themen."
                : "Every metric at a glance — radar, trend, activity and topics."}
            </p>
          </div>

          {/* ═══ STAT COUNTERS ROW (.mp-stat) ═══ */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5 stagger">
            {/* Questions Answered */}
            <div className="mp-stat">
              <span className="mp-stat__label">{t("questions_answered", lang)}</span>
              <span className="mp-stat__value">{totalAnswered.toLocaleString("de-DE")}</span>
              <span className="text-[10px] text-[var(--mp-fg-subtle)] font-mono">
                / {TOTAL_QUESTIONS.toLocaleString("de-DE")} &middot; {completionPct}%
              </span>
            </div>

            {/* Overall Accuracy */}
            <div className="mp-stat">
              <span className="mp-stat__label">{t("overall_accuracy", lang)}</span>
              <span
                className="mp-stat__value"
                style={{
                  color:
                    accuracy >= 70
                      ? "var(--mp-viridian)"
                      : accuracy >= 40
                      ? "var(--mp-status-warning)"
                      : accuracy > 0
                      ? "var(--mp-error)"
                      : "var(--mp-fg)",
                }}
              >
                {accuracy}
                <span style={{ fontSize: 20 }}>%</span>
              </span>
              <span
                className={
                  accuracyTrendUp ? "mp-stat__trend mp-stat__trend--up" : "mp-stat__trend"
                }
              >
                {accuracyTrendUp ? <ArrowUpRight className="w-3 h-3" /> : null}
                {totalCorrect} {t("correct_of", lang)} {totalAnswered}
              </span>
            </div>

            {/* Current Streak */}
            <div className="mp-stat">
              <span className="mp-stat__label">{t("current_streak_label", lang)}</span>
              <span className="mp-stat__value flex items-baseline gap-1">
                {streak}
                <span className="text-sm font-semibold text-[var(--mp-fg-subtle)]">
                  {t("days", lang)}
                </span>
              </span>
              <span className="mp-stat__trend" style={{ color: "var(--mp-error)" }}>
                <Flame className="w-3 h-3" />
                {lang === "de" ? "aktiv" : "active"}
              </span>
            </div>

            {/* Level & XP */}
            <div className="mp-stat">
              <span className="mp-stat__label">{t("level_and_xp", lang)}</span>
              <span className="mp-stat__value text-lg">{xpInfo.rank}</span>
              <div className="flex flex-col gap-1">
                <div className="h-1.5 bg-[var(--mp-surface-sunken)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--mp-cta-blue)] rounded-full transition-all duration-700"
                    style={{ width: `${xpInfo.progress}%` }}
                  />
                </div>
                <span className="text-[10px] text-[var(--mp-fg-subtle)] font-mono">
                  {totalXp.toLocaleString("de-DE")} XP &middot; Lv.{xpInfo.level}
                </span>
              </div>
            </div>
          </div>

          {/* ═══ 2-COLUMN: RADAR + ACCURACY/WEEKLY TREND ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            {/* Radar card */}
            <section className="mp-card p-5">
              <header className="flex items-baseline justify-between mb-3">
                <h3 className="mp-h3">
                  {lang === "de" ? "Themen-Radar" : "Study Radar"}
                </h3>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mp-fg-subtle)] font-bold">
                  {topicStats.filter((s) => s.answered > 0).length}{" "}
                  {lang === "de" ? "Bereiche" : "topics"}
                </span>
              </header>
              <div className="flex justify-center">
                <StudyRadar topics={topicStats} lang={lang} />
              </div>
            </section>

            {/* Accuracy / Weekly trend card */}
            <section className="mp-card p-5">
              <header className="flex items-baseline justify-between mb-3">
                <h3 className="mp-h3">
                  {lang === "de" ? "Wochenleistung" : "Weekly Performance"}
                </h3>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mp-fg-subtle)] font-bold">
                  {lang === "de" ? "letzte 7 Tage" : "last 7 days"}
                </span>
              </header>
              <div className="font-display font-black text-[40px] leading-none tracking-tight text-[var(--mp-fg)] font-mono">
                {accuracy}
                <span className="text-lg text-[var(--mp-fg-muted)] font-bold ml-1">%</span>
              </div>
              <span
                className={
                  accuracyTrendUp ? "mp-stat__trend mp-stat__trend--up" : "mp-stat__trend"
                }
              >
                {accuracyTrendUp ? <ArrowUpRight className="w-3 h-3" /> : null}
                {lang === "de" ? "aktuelle Genauigkeit" : "current accuracy"}
              </span>
              <div className="mt-3">
                <WeeklyChart lang={lang} />
              </div>
            </section>
          </div>

          {/* ═══ FULL-WIDTH ACTIVITY HEATMAP ═══ */}
          <section className="mp-card p-5 mb-5">
            <header className="flex items-baseline justify-between mb-4">
              <h3 className="mp-h3">
                {lang === "de" ? "Aktivitätskalender" : "Activity Calendar"}
              </h3>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mp-fg-subtle)] font-bold">
                {lang === "de" ? "letzte 4 Wochen · 28 Tage" : "last 4 weeks · 28 days"}
              </span>
            </header>
            <ActivityHeatmap lang={lang} />
          </section>

          {/* ═══ FULL-WIDTH TOPIC STRENGTH RAIL ═══ */}
          <section className="mp-card p-5 mb-5">
            <header className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="mp-h3">{t("topic_progress", lang)}</h3>
              <div className="mp-tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={sortBy === "accuracy"}
                  onClick={() => setSortBy("accuracy")}
                  className={`mp-tabs__tab ${
                    sortBy === "accuracy" ? "mp-tabs__tab--active" : ""
                  }`}
                >
                  {t("sort_by_accuracy", lang)}
                </button>
                <button
                  role="tab"
                  aria-selected={sortBy === "count"}
                  onClick={() => setSortBy("count")}
                  className={`mp-tabs__tab ${
                    sortBy === "count" ? "mp-tabs__tab--active" : ""
                  }`}
                >
                  {t("sort_by_count", lang)}
                </button>
              </div>
            </header>

            <div className="space-y-3">
              {sortedAllTopics.map(({ topic, total, answered, correct }) => {
                const config = getTopicConfig(topic);
                const progressPct = total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;
                const acc = answered > 0 ? Math.round((correct / answered) * 100) : 0;
                const barColor =
                  acc >= 70
                    ? "var(--mp-viridian)"
                    : acc >= 40
                    ? "var(--mp-status-warning)"
                    : answered > 0
                    ? "var(--mp-error)"
                    : config.color;
                return (
                  <div key={topic} className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${config.color}15` }}
                    >
                      <TopicIcon name={config.icon} className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-[var(--mp-fg)] truncate">
                          {topic}
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          <span
                            className="text-xs font-bold font-mono px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: answered > 0 ? `${barColor}15` : "var(--mp-border-subtle)",
                              color: answered > 0 ? barColor : "var(--mp-fg-subtle)",
                            }}
                          >
                            {answered > 0 ? `${acc}%` : "--"}
                          </span>
                          <span className="text-[10px] text-[var(--mp-fg-subtle)] font-mono w-14 text-right">
                            {answered}/{total}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 bg-[var(--mp-surface-sunken)] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${progressPct}%`, background: barColor }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ═══ SAVED ITEMS (Bookmarks / Notes) ═══ */}
          <section className="mp-card p-5 mb-5">
            <div className="mp-tabs mb-4" role="tablist" style={{ display: "flex", width: "100%" }}>
              <button
                role="tab"
                aria-selected={savedTab === "bookmarks"}
                onClick={() => setSavedTab("bookmarks")}
                className={`mp-tabs__tab flex-1 flex items-center justify-center gap-1.5 ${
                  savedTab === "bookmarks" ? "mp-tabs__tab--active" : ""
                }`}
              >
                <Star className="w-3.5 h-3.5" />
                {t("bookmarked_questions", lang)} ({bookmarkIds.length})
              </button>
              <button
                role="tab"
                aria-selected={savedTab === "notes"}
                onClick={() => setSavedTab("notes")}
                className={`mp-tabs__tab flex-1 flex items-center justify-center gap-1.5 ${
                  savedTab === "notes" ? "mp-tabs__tab--active" : ""
                }`}
              >
                <StickyNote className="w-3.5 h-3.5" />
                {t("my_notes", lang)} ({noteEntries.length})
              </button>
            </div>

            {savedTab === "bookmarks" && (
              <div>
                {bookmarksLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-2 border-[var(--mp-viridian)] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : bookmarkQuestions.length === 0 ? (
                  // Pro-gated empty state: free users should see "this
                  // is a Pro feature" with an upsell, not a bare
                  // "nothing here" line. Pro users genuinely with no
                  // bookmarks get the neutral copy.
                  userRole === "admin" || userTier === "pro" || userTier === "admin" ? (
                    <div className="text-center py-8">
                      <Star className="w-8 h-8 text-[var(--mp-border-subtle)] mx-auto mb-2" />
                      <p className="text-sm text-[var(--mp-fg-subtle)]">
                        {t("no_bookmarks", lang)}
                      </p>
                    </div>
                  ) : (
                    <div className="text-center py-8 px-4">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[var(--mp-status-warning)]/12 mb-3">
                        <Star className="w-6 h-6 text-[var(--mp-status-warning)]" />
                      </div>
                      <h4 className="text-sm font-semibold text-[var(--mp-fg)] mb-1">
                        {lang === "de"
                          ? "Lesezeichen sind ein Pro-Feature"
                          : "Bookmarks are a Pro feature"}
                      </h4>
                      <p className="text-xs text-[var(--mp-fg-muted)] mb-4 max-w-sm mx-auto leading-relaxed">
                        {lang === "de"
                          ? "Markiere schwierige Fragen mit einem Klick und komm später gezielt zurück — inklusive für alle Pro-Nutzer:innen."
                          : "Flag tricky questions with one click and jump back to them anytime — included with every Pro plan."}
                      </p>
                      <Link
                        href="/pricing?gate=bookmarks&utm_source=progress_bookmarks_tab"
                        className="mp-btn mp-btn--primary inline-flex items-center gap-1.5"
                      >
                        {lang === "de" ? "Pro ansehen" : "See Pro"}
                      </Link>
                    </div>
                  )
                ) : (
                  <div className="space-y-2">
                    {bookmarkQuestions
                      .slice(0, showAllBookmarks ? undefined : 20)
                      .map((q) => {
                        const config = getTopicConfig(q.topic);
                        const examSource = getStoredExamSource();
                        return (
                          <div
                            key={q.id}
                            className="flex items-start gap-3 p-3 rounded-lg bg-[var(--mp-surface-sunken)] hover:bg-[var(--mp-border-subtle)] transition-colors group"
                          >
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                              style={{ backgroundColor: `${config.color}15` }}
                            >
                              <TopicIcon name={config.icon} className="w-3 h-3" />
                            </div>
                            {q.image_url && (
                              <img
                                src={q.image_url}
                                alt=""
                                className="w-10 h-10 rounded object-cover flex-shrink-0 border border-[var(--mp-border-subtle)]"
                              />
                            )}
                            <Link
                              href={`/quiz?questionId=${q.id}&topic=${encodeURIComponent(q.topic)}&examSource=${examSource}`}
                              className="flex-1 min-w-0"
                            >
                              <p className="text-sm text-[var(--mp-fg)] line-clamp-2">
                                {q.question.slice(0, 120)}
                                {q.question.length > 120 ? "..." : ""}
                              </p>
                              <p className="text-[10px] text-[var(--mp-fg-subtle)] mt-1 font-mono">
                                {q.topic}
                              </p>
                            </Link>
                            <button
                              onClick={() => removeBookmark(q.id)}
                              className="text-[var(--mp-status-warning)] hover:text-[var(--mp-error)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                              title={lang === "de" ? "Entfernen" : "Remove"}
                            >
                              <Star className="w-4 h-4 fill-current" />
                            </button>
                          </div>
                        );
                      })}
                    {bookmarkQuestions.length > 20 && !showAllBookmarks && (
                      <button
                        onClick={() => setShowAllBookmarks(true)}
                        className="w-full text-center text-sm text-[var(--mp-viridian)] font-medium py-2 hover:underline"
                      >
                        {lang === "de"
                          ? `Alle ${bookmarkQuestions.length} anzeigen`
                          : `Show all ${bookmarkQuestions.length}`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {savedTab === "notes" && (
              <div>
                {notesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-2 border-[var(--mp-viridian)] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : noteEntries.length === 0 ? (
                  userRole === "admin" || userTier === "pro" || userTier === "admin" ? (
                    <div className="text-center py-8">
                      <StickyNote className="w-8 h-8 text-[var(--mp-border-subtle)] mx-auto mb-2" />
                      <p className="text-sm text-[var(--mp-fg-subtle)]">{t("no_notes", lang)}</p>
                    </div>
                  ) : (
                    <div className="text-center py-8 px-4">
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[var(--mp-accent-teal)]/12 mb-3">
                        <StickyNote className="w-6 h-6 text-[var(--mp-accent-teal)]" />
                      </div>
                      <h4 className="text-sm font-semibold text-[var(--mp-fg)] mb-1">
                        {lang === "de"
                          ? "Notizen sind ein Pro-Feature"
                          : "Notes are a Pro feature"}
                      </h4>
                      <p className="text-xs text-[var(--mp-fg-muted)] mb-4 max-w-sm mx-auto leading-relaxed">
                        {lang === "de"
                          ? "Schreib dir Merkhilfen zu einzelnen Fragen — sie bleiben an der Frage hängen und kommen beim nächsten Versuch automatisch wieder hoch."
                          : "Jot down memory aids per question — they stay attached and reappear the next time you see it."}
                      </p>
                      <Link
                        href="/pricing?gate=notes&utm_source=progress_notes_tab"
                        className="mp-btn mp-btn--primary inline-flex items-center gap-1.5"
                      >
                        {lang === "de" ? "Pro ansehen" : "See Pro"}
                      </Link>
                    </div>
                  )
                ) : (
                  <div className="space-y-2">
                    {noteEntries.slice(0, showAllNotes ? undefined : 20).map((entry) => {
                      const q = noteQuestions.find((nq) => nq.id === entry.id);
                      const topic = q?.topic || "";
                      const config = getTopicConfig(topic);
                      const examSource = getStoredExamSource();
                      return (
                        <Link
                          key={entry.id}
                          href={`/quiz?questionId=${entry.id}&topic=${encodeURIComponent(topic)}&examSource=${examSource}`}
                          className="flex items-start gap-3 p-3 rounded-lg bg-[var(--mp-surface-sunken)] hover:bg-[var(--mp-border-subtle)] transition-colors"
                        >
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                            style={{ backgroundColor: `${config.color}15` }}
                          >
                            <TopicIcon name={config.icon} className="w-3 h-3" />
                          </div>
                          <div className="flex-1 min-w-0">
                            {q && (
                              <p className="text-sm text-[var(--mp-fg)] line-clamp-1">
                                {q.question.slice(0, 120)}
                              </p>
                            )}
                            <p className="text-xs text-[var(--mp-fg-subtle)] italic mt-1 line-clamp-1">
                              {entry.note.slice(0, 80)}
                            </p>
                            {topic && (
                              <p className="text-[10px] text-[var(--mp-fg-subtle)] mt-1 font-mono">
                                {topic}
                              </p>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                    {noteEntries.length > 20 && !showAllNotes && (
                      <button
                        onClick={() => setShowAllNotes(true)}
                        className="w-full text-center text-sm text-[var(--mp-viridian)] font-medium py-2 hover:underline"
                      >
                        {lang === "de"
                          ? `Alle ${noteEntries.length} anzeigen`
                          : `Show all ${noteEntries.length}`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ═══ EXAM READINESS (countdown + weak topics + CTAs) ═══ */}
          <section className="mp-card p-5 space-y-4">
            <h3 className="mp-h3">{t("exam_readiness", lang)}</h3>

            {daysUntilExam !== null && (
              <div className="flex items-center gap-4 p-4 rounded-xl bg-[var(--mp-cta-blue)]/[0.04] border border-[var(--mp-cta-blue)]/10">
                <div className="text-center">
                  <span className="block font-display font-black text-[32px] leading-none tracking-tight text-[var(--mp-cta-blue)] font-mono">
                    {daysUntilExam}
                  </span>
                  <p className="text-xs text-[var(--mp-fg-subtle)] mt-1">
                    {t("days_until_exam", lang)}
                  </p>
                </div>
                <div className="flex-1">
                  <div className="h-2 bg-[var(--mp-border-subtle)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--mp-cta-blue)] rounded-full transition-all"
                      style={{
                        width: `${Math.max(5, Math.min(100, 100 - (daysUntilExam / 180) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {weakTopics.length > 0 && (
              <div className="p-3 rounded-xl bg-[var(--mp-status-warning)]/[0.06] border border-[var(--mp-status-warning)]/15">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-[var(--mp-status-warning)] flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-[var(--mp-fg)] mb-1">
                      {lang === "de"
                        ? "Fachgebiete unter 60% Genauigkeit"
                        : "Topics below 60% accuracy"}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {weakTopics.map((wt) => {
                        const config = getTopicConfig(wt.topic);
                        const acc = Math.round((wt.correct / wt.answered) * 100);
                        return (
                          <span
                            key={wt.topic}
                            className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full border"
                            style={{
                              borderColor: `${config.color}30`,
                              backgroundColor: `${config.color}08`,
                              color: config.color,
                            }}
                          >
                            <TopicIcon name={config.icon} className="w-3 h-3" />
                            {wt.topic.split("/")[0]} ({acc}%)
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Link
                href="/exam"
                className="mp-btn mp-btn--success mp-btn--lg justify-center"
              >
                <GraduationCap className="w-5 h-5" />
                {lang === "de" ? "Prüfungssimulation starten" : "Start Exam Simulation"}
              </Link>
              {weakTopics.length > 0 && (
                <Link
                  href={`/quiz?topic=${encodeURIComponent(weakTopics[0].topic)}&userId=${userId}`}
                  className="mp-btn mp-btn--secondary mp-btn--lg justify-center"
                  style={{
                    borderColor: "var(--mp-viridian)",
                    color: "var(--mp-viridian)",
                  }}
                >
                  <TrendingUp className="w-5 h-5" />
                  {t("practice_weak", lang)}
                </Link>
              )}
            </div>
          </section>

          {/* No user fallback */}
          {!userId && (
            <div className="mp-card p-8 text-center mt-5">
              <TrendingUp className="w-10 h-10 text-[var(--mp-border-subtle)] mx-auto mb-3" />
              <p className="text-sm text-[var(--mp-fg-subtle)] mb-4">
                {t("sign_in_for_stats", lang)}
              </p>
              <Link href="/" className="mp-btn mp-btn--success">
                {t("back_home", lang)}
              </Link>
            </div>
          )}
        </div>
      </main>

      <BottomNav lang={lang} userId={userId} />
    </div>
  );
}
