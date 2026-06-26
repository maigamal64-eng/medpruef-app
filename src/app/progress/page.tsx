"use client";

/**
 * Progress / Fortschritt - MedPrüf reimplementation v3 ("Clinical Nocturne").
 *
 * Surface scope is SPECS §5 (Progress): pass-probability via the shared,
 * honest <ReadinessSignal> (BAND + plain-language verdict, NEVER a pass-%),
 * a spark-filled knowledge radar, a weekly performance chart, a viridian
 * activity heatmap, a per-topic COVERAGE rail (answered/total - progress,
 * not the §4 strength rail which lives on /stats), saved bookmarks/notes,
 * and the exam-readiness CTA block. Built to mockup
 * reviews/reimplementation-2026-06-26/design/05-progress-stats.html.
 *
 * THE DATA LAYER IS UNCHANGED - every source the old page read is read the
 * same way here; only the presentation is rebuilt:
 *   - /api/stats?userId=…     → gamification snapshot + per-topic stats
 *   - /api/questions?ids=…    → bookmarked + noted questions
 *   - <ReadinessSignal>       → self-fetches /api/user/readiness (consumed as-is)
 *   - localStorage            → medpruef_favorites, medpruef_notes_*,
 *                               medpruef_quiz_results, medpruef_profile.targetDate
 *   - getLevelFromXP / getTopicConfig / getStoredExamSource / useUserTier
 *
 * Gamification: a calm continuity strip (XP/streak/accuracy + the rank from
 * xp.ts, a viridian→spark XP bar), the spark radar, the viridian-ramp
 * heatmap. No arcade - restraint is the premium (SPECS). The one celebration
 * (milestone takeover) is a modal elsewhere, never embedded here.
 *
 * Mobile = single column stack; Desktop = sidebar shell + 2-col analytics
 * grid (AppLayout supplies the shell). No em dashes in DE/EN copy. Austrian.
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
import { AppLayout } from "@/components/ui";
import TopicIcon from "@/components/TopicIcon";
import ReadinessSignal from "@/components/ReadinessSignal";
import { AchievementRank } from "@/components/ui/AchievementRank";
import {
  TrendingUp,
  Star,
  StickyNote,
  GraduationCap,
  AlertTriangle,
  ArrowUpRight,
  Flame,
  CheckCircle2,
  Radar as RadarIcon,
  CalendarDays,
  BarChart3,
  Layers,
  CalendarClock,
} from "lucide-react";
import { SkeletonCard } from "@/components/Skeleton";
import {
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import styles from "./progress.module.css";

/* ─────────────────────────────────────────────────────────────
   Knowledge radar - data logic unchanged (accuracy by topic), but
   the shape is now spark-filled (the one alive accent) per SPECS §5
   "spark-filled Recharts". Labels shorten on narrow viewports.
   ───────────────────────────────────────────────────────────── */
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
    .filter((tp) => tp.answered > 0)
    .map((tp) => ({
      subject: tp.topic.split("/")[0].replace("- und ", "/").substring(0, labelLen),
      accuracy: Math.round((tp.correct / tp.answered) * 100),
      fullMark: 100,
    }));

  if (data.length < 3) {
    return (
      <p className="text-sm text-[var(--mp-fg-subtle)] text-center py-12">
        {lang === "de"
          ? "Löse mehr Fragen, um den Radar zu sehen"
          : "Answer more questions to see the radar"}
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="var(--mp-border)" />
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
          stroke="var(--mp-spark)"
          fill="var(--mp-spark)"
          fillOpacity={0.18}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

/* ─────────────────────────────────────────────────────────────
   Weekly performance - reads quiz results from localStorage (7-day
   window UNCHANGED). Now a calm CSS bar chart (mockup .wchart),
   cta-blue→teal gradient bars, mono day + value labels.
   ───────────────────────────────────────────────────────────── */
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
          ? "Beginne zu üben, um deinen Wochentrend zu sehen"
          : "Start practicing to see your weekly trend"}
      </p>
    );
  }

  return (
    <div className={styles.wchart}>
      {data.map((d, i) => (
        <div key={i} className={styles.wcol}>
          <span className={styles.wval}>{d.questions > 0 ? `${d.accuracy}%` : ""}</span>
          <div className={styles.wbarTrack}>
            <div
              className={`${styles.wbar} ${d.questions === 0 ? styles.wbarEmpty : ""}`}
              style={{ height: `${d.questions > 0 ? Math.max(6, d.accuracy) : 6}%` }}
            />
          </div>
          <span className={styles.wd}>{d.day}</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Activity heatmap - 4 weeks × 7 (28-day window UNCHANGED). Viridian
   color-mix ramp (intensity = consistency), per SPECS §5.
   ───────────────────────────────────────────────────────────── */
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

  const levelClass = (count: number): string => {
    if (count === 0) return "";
    if (count <= 5) return styles.l1;
    if (count <= 15) return styles.l2;
    if (count <= 30) return styles.l3;
    return styles.l4;
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
      <div className={styles.heatDayRow}>
        {dayLabels.map((d) => (
          <span key={d} className={styles.heatDayLbl}>
            {d}
          </span>
        ))}
      </div>
      <div className="space-y-1">
        {weeks.map((week, wi) => (
          <div key={wi} className={styles.heat}>
            {week.map((cell) => (
              <div
                key={cell.date}
                className={`${styles.cell} ${levelClass(cell.count)}`}
                title={`${cell.label}: ${cell.count} ${lang === "de" ? "Fragen" : "questions"}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className={styles.heatLegend}>
        <span>{lang === "de" ? "weniger" : "less"}</span>
        <div className={`${styles.cell} ${styles.lcell}`} />
        <div className={`${styles.cell} ${styles.l1} ${styles.lcell}`} />
        <div className={`${styles.cell} ${styles.l2} ${styles.lcell}`} />
        <div className={`${styles.cell} ${styles.l3} ${styles.lcell}`} />
        <div className={`${styles.cell} ${styles.l4} ${styles.lcell}`} />
        <span>{lang === "de" ? "mehr" : "more"}</span>
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

// Known totals per specialty for the COVERAGE denominator (answered/total).
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

// Catalog total across all 3 exam types - sourced from content-truth.ts SSoT.
const TOTAL_QUESTIONS = QUESTIONS.total;

export default function ProgressPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  // Tier + role read live from /api/auth/me via useUserTier; bookmarks +
  // notes are Pro-only, so the empty state reads "upgrade to unlock".
  const tierLive = useUserTier();
  const [userTier, setUserTier] = useState<string>("free");
  const [userRole, setUserRole] = useState<string>("user");
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
  const rankTier = Math.min(8, Math.max(1, xpInfo.level)) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
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

  /* ─── Topic coverage rail - all 10 specialties, sorted ─── */
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

  // The surface is "genuinely empty" only for a brand-new user with nothing
  // at all (no session, or 0 answers AND 0 bookmarks AND 0 notes). Keying off
  // "has anything" (not just answers) means a transient /api/stats failure
  // (its fetch has a silent catch → totalAnswered stays 0) can NEVER collapse
  // an established user to a blank page, and a user who starred questions
  // without answering still sees their saved items (a real §5 state). The
  // analytics sub-components carry their own calm "answer more" micro-empties
  // inside the full layout. bookmarkIds/noteEntries are hydrated from
  // localStorage in the mount effect before `loading` flips, so no flash.
  const isGenuinelyEmpty =
    !userId ||
    (totalAnswered === 0 && bookmarkIds.length === 0 && noteEntries.length === 0);

  /* ─── Loading skeleton ─── */
  if (loading) {
    return (
      <AppLayout
        sidebar={<Sidebar lang={lang} userId={userId} userName={userName} totalXp={totalXp} streak={streak} accuracy={accuracy} />}
        bottomNav={<BottomNav lang={lang} userId={userId} />}
      >
        <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-bg)]">
          <div className="px-4 lg:px-8 py-6 max-w-6xl mx-auto space-y-4 animate-fade-in">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
            <SkeletonCard />
          </div>
        </main>
      </AppLayout>
    );
  }

  const accuracyTrendUp = accuracy >= 65;

  return (
    <AppLayout
      sidebar={
        <Sidebar
          lang={lang}
          userId={userId}
          userName={userName}
          totalXp={totalXp}
          streak={streak}
          accuracy={accuracy}
        />
      }
      bottomNav={<BottomNav lang={lang} userId={userId} />}
    >
      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-bg)]">
        {/* Top bar */}
        <div className="px-4 lg:px-8 pt-4 pb-3 flex items-center justify-between border-b border-[var(--mp-border-subtle)]">
          <Link
            href="/"
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            &larr; {t("back_home", lang)}
          </Link>
          <h1 className="font-display text-base font-bold text-[var(--mp-fg)]">
            {t("progress", lang)}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className={`${styles.page} px-4 lg:px-8 py-6 pb-28`}>
          {/* Page intro */}
          <div className="mb-6">
            <h2 className="font-display text-[28px] leading-tight font-extrabold text-[var(--mp-fg)]">
              {lang === "de" ? "Fortschritt" : "Progress"}
            </h2>
            <p className="text-sm text-[var(--mp-fg-subtle)] mt-1">
              {lang === "de"
                ? "Dein Stand auf einen Blick: Wissensprofil, Wochentrend, Aktivität und Abdeckung je Fach."
                : "Your standing at a glance: knowledge profile, weekly trend, activity and coverage by specialty."}
            </p>
          </div>

          {/* ═══ CONTINUITY STAT STRIP (gamification, calm) ═══ */}
          <div className={`${styles.statStrip} mb-5`}>
            {/* Questions answered + coverage % */}
            <div className={styles.stat}>
              <div className={`${styles.sTop} ${styles.sTopBlue}`}>
                <CheckCircle2 />
                <span>{t("questions_answered", lang)}</span>
              </div>
              <div className={styles.sVal}>{totalAnswered.toLocaleString("de-DE")}</div>
              <div className={styles.sSub}>
                / {TOTAL_QUESTIONS.toLocaleString("de-DE")} &middot; {completionPct}%
              </div>
            </div>

            {/* Accuracy */}
            <div className={styles.stat}>
              <div className={`${styles.sTop} ${styles.sTopTeal}`}>
                <TrendingUp />
                <span>{t("overall_accuracy", lang)}</span>
              </div>
              <div className={styles.sVal}>
                {accuracy}
                <small>%</small>
              </div>
              <div className={styles.sSub} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {accuracyTrendUp ? (
                  <ArrowUpRight className="w-3 h-3 text-[var(--mp-viridian)]" />
                ) : null}
                {totalCorrect} {t("correct_of", lang)} {totalAnswered}
              </div>
            </div>

            {/* Streak */}
            <div className={styles.stat}>
              <div className={`${styles.sTop} ${styles.sTopFire}`}>
                <Flame />
                <span>{t("current_streak_label", lang)}</span>
              </div>
              <div className={styles.sVal}>
                {streak}
                <small>{lang === "de" ? "Tage" : "days"}</small>
              </div>
              <div className={styles.sSub}>{lang === "de" ? "aktiv" : "active"}</div>
            </div>

            {/* Rank + XP (xp.ts) */}
            <div className={styles.stat}>
              <div className={`${styles.sTop} ${styles.sTopGreen}`}>
                <AchievementRank tier={rankTier} variant="inline" size={14} aria-hidden />
                <span>{t("level_and_xp", lang)}</span>
              </div>
              <div className={styles.sVal} style={{ fontSize: 18 }}>
                {xpInfo.rank}
              </div>
              <div className={styles.xpTrack}>
                <div className={styles.xpFill} style={{ width: `${xpInfo.progress}%` }} />
              </div>
              <div className={styles.sSub}>
                {totalXp.toLocaleString("de-DE")} XP &middot; {lang === "de" ? "Stufe" : "Level"}{" "}
                {xpInfo.level} {lang === "de" ? "von" : "of"} 8
              </div>
            </div>
          </div>

          {!isGenuinelyEmpty ? (
            <>
              {/* ═══ READINESS (passbox shell + the honest band signal) ═══ */}
              <div className={styles.sectionHead}>
                <h3>{t("exam_readiness", lang)}</h3>
                <div className="ln" />
              </div>
              <div className={`${styles.passbox} mb-6`}>
                {/* Shared, honest readiness - BAND + verdict, never a pass-%. */}
                <ReadinessSignal lang={lang} />
              </div>

              {/* ═══ 2-COL: RADAR + WEEKLY ═══ */}
              <div className={`${styles.grid2} mb-6`}>
                <section className="mp-card p-5">
                  <h3 className={styles.cardH}>
                    <RadarIcon />
                    {lang === "de" ? "Wissensprofil" : "Knowledge Profile"}
                    <span className={`${styles.meta} ml-auto`}>
                      {topicStats.filter((s) => s.answered > 0).length}{" "}
                      {lang === "de" ? "Fächer" : "topics"}
                    </span>
                  </h3>
                  <div className={styles.radarWrap}>
                    <StudyRadar topics={topicStats} lang={lang} />
                  </div>
                </section>

                <section className="mp-card p-5">
                  <h3 className={styles.cardH}>
                    <BarChart3 />
                    {lang === "de" ? "Wochenleistung" : "Weekly Performance"}
                    <span className={`${styles.meta} ml-auto`}>
                      {lang === "de" ? "letzte 7 Tage" : "last 7 days"}
                    </span>
                  </h3>
                  <WeeklyChart lang={lang} />
                </section>
              </div>

              {/* ═══ ACTIVITY HEATMAP ═══ */}
              <section className="mp-card p-5 mb-6">
                <h3 className={styles.cardH}>
                  <CalendarDays />
                  {lang === "de" ? "Aktivität" : "Activity"}
                  <span className={`${styles.meta} ml-auto`}>
                    {lang === "de" ? "letzte 4 Wochen" : "last 4 weeks"}
                  </span>
                </h3>
                <ActivityHeatmap lang={lang} />
              </section>

              {/* ═══ TOPIC COVERAGE RAIL (answered/total - progress) ═══ */}
              <section className="mp-card p-5 mb-6">
                <header className="flex items-center justify-between mb-4 flex-wrap gap-3">
                  <h3 className={styles.cardH} style={{ margin: 0 }}>
                    <Layers />
                    {t("topic_progress", lang)}
                  </h3>
                  <div className="mp-tabs" role="tablist">
                    <button
                      role="tab"
                      aria-selected={sortBy === "count"}
                      onClick={() => setSortBy("count")}
                      className={`mp-tabs__tab ${sortBy === "count" ? "mp-tabs__tab--active" : ""}`}
                    >
                      {t("sort_by_count", lang)}
                    </button>
                    <button
                      role="tab"
                      aria-selected={sortBy === "accuracy"}
                      onClick={() => setSortBy("accuracy")}
                      className={`mp-tabs__tab ${sortBy === "accuracy" ? "mp-tabs__tab--active" : ""}`}
                    >
                      {t("sort_by_accuracy", lang)}
                    </button>
                  </div>
                </header>

                <div className={styles.tcov}>
                  {sortedAllTopics.map(({ topic, total, answered, correct }) => {
                    const config = getTopicConfig(topic);
                    const progressPct =
                      total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;
                    const acc = answered > 0 ? Math.round((correct / answered) * 100) : 0;
                    return (
                      <div key={topic} className={styles.tcRow} style={{ ["--sc" as string]: config.color }}>
                        <div className={styles.tcIc}>
                          <TopicIcon name={config.icon} className="w-[17px] h-[17px]" />
                        </div>
                        <div className={styles.tcBody}>
                          <div className={styles.tcTop}>
                            <span className={styles.tcName}>{topic}</span>
                            <div className={styles.tcNums}>
                              <span className={styles.tcPct}>
                                {answered > 0 ? `${acc}%` : "--"}
                              </span>
                              <span className={styles.tcCount}>
                                {answered}/{total}
                              </span>
                            </div>
                          </div>
                          <div className={styles.tcTrack}>
                            <div className={styles.tcFill} style={{ width: `${progressPct}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* ═══ SAVED ITEMS (Bookmarks / Notes) ═══ */}
              <section className="mp-card p-5 mb-6">
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
                      userRole === "admin" || userTier === "pro" || userTier === "admin" ? (
                        <div className="text-center py-8">
                          <Star className="w-8 h-8 text-[var(--mp-border-strong)] mx-auto mb-2" />
                          <p className="text-sm text-[var(--mp-fg-subtle)]">{t("no_bookmarks", lang)}</p>
                        </div>
                      ) : (
                        <div className="text-center py-8 px-4">
                          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[var(--mp-warning-bg)] mb-3">
                            <Star className="w-6 h-6 text-[var(--mp-status-warning)]" />
                          </div>
                          <h4 className="text-sm font-semibold text-[var(--mp-fg)] mb-1">
                            {lang === "de"
                              ? "Lesezeichen sind ein Pro-Feature"
                              : "Bookmarks are a Pro feature"}
                          </h4>
                          <p className="text-xs text-[var(--mp-fg-muted)] mb-4 max-w-sm mx-auto leading-relaxed">
                            {lang === "de"
                              ? "Markiere schwierige Fragen mit einem Klick und komm später gezielt zurück, inklusive für alle Pro-Nutzer:innen."
                              : "Flag tricky questions with one click and jump back to them anytime, included with every Pro plan."}
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
                                className={`${styles.savedRow} group`}
                                style={{ ["--sc" as string]: config.color }}
                              >
                                <div className={styles.savedIc}>
                                  <TopicIcon name={config.icon} className="w-3 h-3" />
                                </div>
                                {q.image_url && (
                                  // eslint-disable-next-line @next/next/no-img-element
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
                          <StickyNote className="w-8 h-8 text-[var(--mp-border-strong)] mx-auto mb-2" />
                          <p className="text-sm text-[var(--mp-fg-subtle)]">{t("no_notes", lang)}</p>
                        </div>
                      ) : (
                        <div className="text-center py-8 px-4">
                          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[var(--mp-tint-teal)] mb-3">
                            <StickyNote className="w-6 h-6 text-[var(--mp-accent-teal)]" />
                          </div>
                          <h4 className="text-sm font-semibold text-[var(--mp-fg)] mb-1">
                            {lang === "de" ? "Notizen sind ein Pro-Feature" : "Notes are a Pro feature"}
                          </h4>
                          <p className="text-xs text-[var(--mp-fg-muted)] mb-4 max-w-sm mx-auto leading-relaxed">
                            {lang === "de"
                              ? "Schreib dir Merkhilfen zu einzelnen Fragen. Sie bleiben an der Frage hängen und kommen beim nächsten Versuch automatisch wieder hoch."
                              : "Jot down memory aids per question. They stay attached and reappear the next time you see it."}
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
                              className={styles.savedRow}
                              style={{ ["--sc" as string]: config.color }}
                            >
                              <div className={styles.savedIc}>
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

              {/* ═══ EXAM READINESS CTAs (countdown + weak topics + actions) ═══ */}
              <section className="mp-card p-5 space-y-4">
                {daysUntilExam !== null && (
                  <div className="flex items-center gap-4 p-4 rounded-xl bg-[var(--mp-tint-brand)] border border-[var(--mp-border-soft)]">
                    <div className="text-center">
                      <span className="block font-display font-black text-[32px] leading-none tracking-tight text-[var(--mp-cta-blue)] font-mono">
                        {daysUntilExam}
                      </span>
                      <p className="text-xs text-[var(--mp-fg-subtle)] mt-1 flex items-center gap-1 justify-center">
                        <CalendarClock className="w-3 h-3" />
                        {t("days_until_exam", lang)}
                      </p>
                    </div>
                    <div className="flex-1">
                      <div className="h-2 bg-[var(--mp-surface-sunken)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--mp-spark)] rounded-full transition-all"
                          style={{
                            width: `${Math.max(5, Math.min(100, 100 - (daysUntilExam / 180) * 100))}%`,
                            boxShadow: "0 0 10px var(--mp-spark-glow)",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {weakTopics.length > 0 && (
                  <div className="p-3 rounded-xl bg-[var(--mp-warning-bg)] border border-[var(--mp-border-soft)]">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-[var(--mp-status-warning)] flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-[var(--mp-fg)] mb-1">
                          {lang === "de"
                            ? "Fächer unter 60% Genauigkeit"
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
                                  borderColor: `color-mix(in srgb, ${config.color} 35%, transparent)`,
                                  backgroundColor: `color-mix(in srgb, ${config.color} 10%, transparent)`,
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
                  <Link href="/exam" className="mp-btn mp-btn--success mp-btn--lg justify-center">
                    <GraduationCap className="w-5 h-5" />
                    {lang === "de" ? "Prüfungssimulation starten" : "Start Exam Simulation"}
                  </Link>
                  {weakTopics.length > 0 && (
                    <Link
                      href={`/quiz?topic=${encodeURIComponent(weakTopics[0].topic)}&userId=${userId}`}
                      className="mp-btn mp-btn--secondary mp-btn--lg justify-center"
                      style={{ borderColor: "var(--mp-viridian)", color: "var(--mp-viridian)" }}
                    >
                      <TrendingUp className="w-5 h-5" />
                      {t("practice_weak", lang)}
                    </Link>
                  )}
                </div>
              </section>
            </>
          ) : (
            /* ═══ EMPTY STATE - calm "not enough data yet" (no user OR 0 answers) ═══ */
            <section className="mp-card p-8 text-center mt-2">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--mp-tint-teal)] mb-4">
                <TrendingUp className="w-8 h-8 text-[var(--mp-accent-teal)]" />
              </div>
              <h3 className="font-display text-lg font-bold text-[var(--mp-fg)] mb-2">
                {userId
                  ? lang === "de"
                    ? "Noch nicht genug Daten"
                    : "Not enough data yet"
                  : lang === "de"
                    ? "Melde dich an, um deinen Fortschritt zu sehen"
                    : "Sign in to see your progress"}
              </h3>
              <p className="text-sm text-[var(--mp-fg-muted)] mb-5 max-w-md mx-auto leading-relaxed">
                {userId
                  ? lang === "de"
                    ? "Sobald du ein paar Fragen gelöst hast, erscheinen hier dein Wissensprofil, der Wochentrend und deine Aktivität."
                    : "Once you answer a few questions, your knowledge profile, weekly trend and activity show up here."
                  : lang === "de"
                    ? "Dein Wissensprofil, Wochentrend und deine Aktivität warten auf dich."
                    : "Your knowledge profile, weekly trend and activity are waiting for you."}
              </p>
              <Link
                href={userId ? `/quiz?topic=random&userId=${userId}` : "/login"}
                className="mp-btn mp-btn--success mp-btn--lg inline-flex"
              >
                <GraduationCap className="w-5 h-5" />
                {userId
                  ? lang === "de"
                    ? "Erste Fragen lösen"
                    : "Answer your first questions"
                  : lang === "de"
                    ? "Anmelden"
                    : "Sign in"}
              </Link>
            </section>
          )}
        </div>
      </main>
    </AppLayout>
  );
}
