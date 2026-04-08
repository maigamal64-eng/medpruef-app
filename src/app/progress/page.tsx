"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getLevelFromXP } from "@/lib/xp";
import { getTopicConfig } from "@/lib/topics";
import { t, getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { getStoredExamSource } from "@/lib/topics";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import TopicIcon from "@/components/TopicIcon";
import { TrendingUp, Star, StickyNote, GraduationCap, AlertTriangle } from "lucide-react";
import { SkeletonCard } from "@/components/Skeleton";
import { ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

/** Spider chart showing accuracy by topic */
function StudyRadar({ topics, lang }: { topics: { topic: string; answered: number; correct: number }[]; lang: string }) {
  const data = topics
    .filter((t) => t.answered > 0)
    .map((t) => ({
      subject: t.topic.split("/")[0].replace("- und ", "/").substring(0, 16),
      accuracy: Math.round((t.correct / t.answered) * 100),
      fullMark: 100,
    }));

  if (data.length < 3) return <p className="text-sm text-[#A0AEC0] text-center py-8">{lang === "de" ? "Löse mehr Fragen für den Radar" : "Answer more questions to see the radar"}</p>;

  return (
    <ResponsiveContainer width="100%" height={320}>
      <RadarChart data={data} outerRadius="75%">
        <PolarGrid stroke="#E4E9F0" />
        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: "#4A5568" }} />
        <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 9, fill: "#A0AEC0" }} axisLine={false} />
        <Radar name="Accuracy" dataKey="accuracy" stroke="#007B5F" fill="#007B5F" fillOpacity={0.2} strokeWidth={2} />
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
      const dayNames = lang === "de"
        ? ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]
        : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

      // Initialize last 7 days
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
      <p className="text-sm text-[#A0AEC0] text-center py-8">
        {lang === "de" ? "Beginne zu lernen, um deinen Wochentrend zu sehen" : "Start practicing to see your weekly trend"}
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E4E9F0" />
        <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#A0AEC0" }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#A0AEC0" }} axisLine={false} tickLine={false} width={30} />
        <Tooltip
          contentStyle={{ background: "#fff", border: "1px solid #E4E9F0", borderRadius: 8, fontSize: 12 }}
          formatter={(value: unknown, name: unknown) => [
            `${value}${name === "accuracy" ? "%" : ""}`,
            name === "accuracy" ? (lang === "de" ? "Genauigkeit" : "Accuracy") : (lang === "de" ? "Fragen" : "Questions"),
          ]}
        />
        <Line type="monotone" dataKey="accuracy" stroke="#007B5F" strokeWidth={2} dot={{ r: 4, fill: "#007B5F" }} activeDot={{ r: 6 }} />
        <Line type="monotone" dataKey="questions" stroke="#003A8C" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Activity heatmap — GitHub-style 7x4 grid */
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
      // 28 days (4 weeks)
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
    if (count === 0) return "bg-[#F7F9FC]";
    if (count <= 5) return "bg-[#007B5F]/20";
    if (count <= 15) return "bg-[#007B5F]/40";
    if (count <= 30) return "bg-[#007B5F]/60";
    return "bg-[#007B5F]";
  };

  if (cells.length === 0) return null;

  // Arrange into 4 rows x 7 columns (weeks as rows)
  const weeks: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  const dayLabels = lang === "de"
    ? ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div>
      {/* Day labels */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {dayLabels.map((d) => (
          <span key={d} className="text-[9px] text-[#A0AEC0] text-center">{d}</span>
        ))}
      </div>
      {/* Grid */}
      <div className="space-y-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((cell) => (
              <div
                key={cell.date}
                className={`calendar-cell ${getColor(cell.count)} rounded-sm transition-colors`}
                title={`${cell.label}: ${cell.count} ${lang === "de" ? "Fragen" : "questions"}`}
              />
            ))}
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="flex items-center justify-end gap-1 mt-2">
        <span className="text-[9px] text-[#A0AEC0]">{lang === "de" ? "Weniger" : "Less"}</span>
        <div className="calendar-cell bg-[#F7F9FC] rounded-sm" />
        <div className="calendar-cell bg-[#007B5F]/20 rounded-sm" />
        <div className="calendar-cell bg-[#007B5F]/40 rounded-sm" />
        <div className="calendar-cell bg-[#007B5F]/60 rounded-sm" />
        <div className="calendar-cell bg-[#007B5F] rounded-sm" />
        <span className="text-[9px] text-[#A0AEC0]">{lang === "de" ? "Mehr" : "More"}</span>
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

const TOTAL_QUESTIONS = 7725;

export default function ProgressPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
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

  // Init: load session, lang, localStorage data
  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
      setTotalXp(session.gamification.total_xp || 0);
      setStreak(session.gamification.current_streak || 0);
      setTotalAnswered(session.gamification.total_questions_answered || 0);
      setTotalCorrect(session.gamification.total_correct || 0);
      const ans = session.gamification.total_questions_answered || 0;
      const cor = session.gamification.total_correct || 0;
      setAccuracy(ans > 0 ? Math.round((cor / ans) * 100) : 0);
    }

    // Read bookmarks from localStorage
    try {
      const favs = JSON.parse(localStorage.getItem("medpruef_favorites") || "[]");
      if (Array.isArray(favs)) setBookmarkIds(favs.map((id: number | string) => Number(id)));
    } catch { /* empty */ }

    // Read notes from localStorage
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

    // Read target exam date from profile
    try {
      const profile = JSON.parse(localStorage.getItem("medpruef_profile") || "{}");
      if (profile.targetDate) setTargetDate(profile.targetDate);
    } catch { /* empty */ }
  }, []);

  // Fetch per-topic stats from API
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
            })
          );
          setTopicStats(parsed);
        }
      })
      .catch(() => { /* silent */ })
      .finally(() => setLoading(false));
  }, [userId]);

  // Fetch bookmarked questions
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
            }))
          );
        }
      })
      .catch(() => { /* silent */ })
      .finally(() => setBookmarksLoading(false));
  }, [bookmarkIds]);

  // Fetch noted questions
  useEffect(() => {
    if (noteEntries.length === 0) return;
    setNotesLoading(true);
    const examSource = getStoredExamSource();
    const idsParam = noteEntries.slice(0, 50).map((n) => n.id).join(",");
    fetch(`/api/questions?ids=${idsParam}&examSource=${examSource}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setNoteQuestions(
            data.map((q: Record<string, unknown>) => ({
              id: q.id as number,
              topic: q.topic as string,
              question: q.question as string,
            }))
          );
        }
      })
      .catch(() => { /* silent */ })
      .finally(() => setNotesLoading(false));
  }, [noteEntries]);

  const switchLang = useCallback((l: Lang) => {
    setLang(l);
    setLangState(l);
  }, []);

  const removeBookmark = useCallback((id: number) => {
    const updated = bookmarkIds.filter((bId) => bId !== id);
    setBookmarkIds(updated);
    setBookmarkQuestions((prev) => prev.filter((q) => q.id !== id));
    localStorage.setItem("medpruef_favorites", JSON.stringify(updated));
  }, [bookmarkIds]);

  const xpInfo = getLevelFromXP(totalXp);
  const completionPct = Math.min(100, Math.round((totalAnswered / TOTAL_QUESTIONS) * 100));

  // Compute weak topics (accuracy < 60%)
  const weakTopics = topicStats.filter((ts) => {
    if (ts.answered < 5) return false;
    return ts.answered > 0 && Math.round((ts.correct / ts.answered) * 100) < 60;
  });

  // Compute days until exam
  const daysUntilExam = targetDate
    ? Math.max(0, Math.ceil((new Date(targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  // Sort topic stats
  const sortedTopics = [...topicStats].sort((a, b) => {
    if (sortBy === "accuracy") {
      const accA = a.answered > 0 ? a.correct / a.answered : 0;
      const accB = b.answered > 0 ? b.correct / b.answered : 0;
      return accB - accA;
    }
    return b.answered - a.answered;
  });

  // All 10 specialties for progress bars (include those with 0 answers)
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

  // Streak dots (last 7 days, simplified: fill up to streak count)
  const streakDots = Array.from({ length: 7 }, (_, i) => i < Math.min(streak, 7));

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F7F9FC]">
        <div className="w-full max-w-xl px-4 space-y-4 animate-fade-in">
          <div className="grid grid-cols-2 gap-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <SkeletonCard />
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={userId} userName={userName} totalXp={totalXp} streak={streak} accuracy={accuracy} />

      <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#E4E9F0]">
          <Link href="/" className="text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors">
            &larr; {t("back_home", lang)}
          </Link>
          <h1 className="text-base font-bold text-[#1A2B3C]">{t("progress", lang)}</h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className="px-4 lg:px-8 py-5 max-w-3xl mx-auto space-y-6 pb-28">

          {/* ===== SECTION 1: Overview Metrics ===== */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger">
            {/* Card 1: Questions Answered */}
            <div className="card rounded-2xl p-6 bg-[#007B5F]/[0.03]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-3xl font-black font-mono font-display text-[#1A2B3C]">{totalAnswered}</span>
                <svg width="40" height="40" viewBox="0 0 40 40" className="flex-shrink-0">
                  <circle cx="20" cy="20" r="16" fill="none" stroke="#E4E9F0" strokeWidth="3" />
                  <circle
                    cx="20" cy="20" r="16" fill="none" stroke="#007B5F" strokeWidth="3"
                    strokeDasharray={`${completionPct} ${100 - completionPct}`}
                    strokeDashoffset="25" strokeLinecap="round"
                    style={{ transition: "stroke-dasharray 0.7s ease" }}
                  />
                </svg>
              </div>
              <p className="text-xs text-[#A0AEC0]">{t("questions_answered", lang)}</p>
              <p className="text-[10px] text-[#A0AEC0] font-mono mt-0.5">/ {TOTAL_QUESTIONS.toLocaleString("de-DE")} {t("of_total", lang)}</p>
            </div>

            {/* Card 2: Overall Accuracy */}
            <div className={`card rounded-2xl p-6 ${accuracy >= 70 ? "bg-[#00A896]/[0.04]" : accuracy >= 40 ? "bg-[#F4A261]/[0.04]" : "bg-[#D64545]/[0.04]"}`}>
              <span className={`text-3xl font-black font-mono font-display ${accuracy >= 70 ? "text-[#00A896]" : accuracy >= 40 ? "text-[#F4A261]" : "text-[#D64545]"}`}>
                {accuracy}%
              </span>
              <p className="text-xs text-[#A0AEC0] mt-2">{t("overall_accuracy", lang)}</p>
              <p className="text-[10px] text-[#A0AEC0] font-mono mt-0.5">
                {totalCorrect} {t("correct_of", lang)} {totalAnswered}
              </p>
            </div>

            {/* Card 3: Current Streak */}
            <div className="card rounded-2xl p-6 bg-[#D64545]/[0.03]">
              <span className="text-3xl font-black font-mono font-display text-[#1A2B3C]">{streak}</span>
              <span className="text-sm text-[#A0AEC0] ml-1">{t("days", lang)}</span>
              <p className="text-xs text-[#A0AEC0] mt-2">{t("current_streak_label", lang)}</p>
              <div className="flex gap-1 mt-2">
                {streakDots.map((filled, i) => (
                  <div
                    key={i}
                    className={`w-2.5 h-2.5 rounded-full ${filled ? "bg-[#D64545]" : "bg-[#E4E9F0]"}`}
                  />
                ))}
              </div>
            </div>

            {/* Card 4: Level & XP */}
            <div className="card rounded-2xl p-6 bg-[#6366F1]/[0.03]">
              <span className="text-lg font-bold text-[#1A2B3C]">{xpInfo.rank}</span>
              <p className="text-xs text-[#A0AEC0] mt-1 font-mono">{totalXp} XP</p>
              <p className="text-xs text-[#A0AEC0] mt-2">{t("level_and_xp", lang)}</p>
              <div className="h-1.5 bg-[#E4E9F0] rounded-full overflow-hidden mt-2">
                <div
                  className="h-full bg-[#6366F1] rounded-full transition-all duration-700"
                  style={{ width: `${xpInfo.progress}%` }}
                />
              </div>
              <p className="text-[10px] text-[#A0AEC0] font-mono mt-1">Lv.{xpInfo.level} &middot; {Math.round(xpInfo.progress)}%</p>
            </div>
          </div>

          {/* ===== Weekly Performance Chart ===== */}
          <div className="card rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-[#1A2B3C] mb-4">
              {lang === "de" ? "Wochenleistung" : "Weekly Performance"}
            </h2>
            <WeeklyChart lang={lang} />
          </div>

          {/* ===== Activity Calendar Heatmap ===== */}
          <div className="card rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-[#1A2B3C] mb-4">
              {lang === "de" ? "Aktivitätskalender" : "Activity Calendar"}
            </h2>
            <ActivityHeatmap lang={lang} />
          </div>

          {/* ===== SECTION 2: Topic Progress ===== */}
          <div className="card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[#1A2B3C]">{t("topic_progress", lang)}</h2>
              <div className="flex items-center bg-[#F7F9FC] rounded-lg p-0.5 text-xs border border-[#E4E9F0]">
                <button
                  onClick={() => setSortBy("accuracy")}
                  className={`px-2.5 py-1 rounded font-medium transition-all ${
                    sortBy === "accuracy" ? "bg-[#007B5F] text-white" : "text-[#A0AEC0] hover:text-[#4A5568]"
                  }`}
                >
                  {t("sort_by_accuracy", lang)}
                </button>
                <button
                  onClick={() => setSortBy("count")}
                  className={`px-2.5 py-1 rounded font-medium transition-all ${
                    sortBy === "count" ? "bg-[#007B5F] text-white" : "text-[#A0AEC0] hover:text-[#4A5568]"
                  }`}
                >
                  {t("sort_by_count", lang)}
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {sortedAllTopics.map(({ topic, total, answered, correct }) => {
                const config = getTopicConfig(topic);
                const progressPct = total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;
                const acc = answered > 0 ? Math.round((correct / answered) * 100) : 0;
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
                        <span className="text-sm font-medium text-[#1A2B3C] truncate">{topic}</span>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          <span
                            className={`text-xs font-bold font-mono px-1.5 py-0.5 rounded ${
                              acc >= 70
                                ? "bg-[#00A896]/10 text-[#00A896]"
                                : acc >= 40
                                ? "bg-[#F4A261]/10 text-[#F4A261]"
                                : answered > 0
                                ? "bg-[#D64545]/10 text-[#D64545]"
                                : "bg-[#E4E9F0] text-[#A0AEC0]"
                            }`}
                          >
                            {answered > 0 ? `${acc}%` : "--"}
                          </span>
                          <span className="text-[10px] text-[#A0AEC0] font-mono w-14 text-right">
                            {answered}/{total}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 bg-[#F7F9FC] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${progressPct}%`,
                            background: `linear-gradient(to right, ${config.color}, ${config.color}99)`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ===== STUDY RADAR — Spider Chart ===== */}
          {topicStats.length > 0 && (
            <div className="card rounded-2xl p-5">
              <h2 className="text-lg font-semibold text-[#1A2B3C] mb-4">
                {lang === "de" ? "Stärken-Radar" : "Study Radar"}
              </h2>
              <div className="flex justify-center">
                <StudyRadar topics={topicStats} lang={lang} />
              </div>
            </div>
          )}

          {/* ===== SECTION 3: Saved Items ===== */}
          <div className="card rounded-2xl p-5">
            {/* Tab switcher */}
            <div className="flex items-center gap-1 mb-4 bg-[#F7F9FC] rounded-lg p-0.5 border border-[#E4E9F0]">
              <button
                onClick={() => setSavedTab("bookmarks")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition-all ${
                  savedTab === "bookmarks" ? "bg-white text-[#1A2B3C] shadow-sm" : "text-[#A0AEC0] hover:text-[#4A5568]"
                }`}
              >
                <Star className="w-3.5 h-3.5" />
                {t("bookmarked_questions", lang)} ({bookmarkIds.length})
              </button>
              <button
                onClick={() => setSavedTab("notes")}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition-all ${
                  savedTab === "notes" ? "bg-white text-[#1A2B3C] shadow-sm" : "text-[#A0AEC0] hover:text-[#4A5568]"
                }`}
              >
                <StickyNote className="w-3.5 h-3.5" />
                {t("my_notes", lang)} ({noteEntries.length})
              </button>
            </div>

            {/* Bookmarks Tab */}
            {savedTab === "bookmarks" && (
              <div>
                {bookmarksLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-2 border-[#007B5F] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : bookmarkQuestions.length === 0 ? (
                  <div className="text-center py-8">
                    <Star className="w-8 h-8 text-[#E4E9F0] mx-auto mb-2" />
                    <p className="text-sm text-[#A0AEC0]">{t("no_bookmarks", lang)}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {bookmarkQuestions
                      .slice(0, showAllBookmarks ? undefined : 20)
                      .map((q) => {
                        const config = getTopicConfig(q.topic);
                        const examSource = getStoredExamSource();
                        return (
                          <div key={q.id} className="flex items-start gap-3 p-3 rounded-lg bg-[#F7F9FC] hover:bg-[#E4E9F0]/50 transition-colors group">
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                              style={{ backgroundColor: `${config.color}15` }}
                            >
                              <TopicIcon name={config.icon} className="w-3 h-3" />
                            </div>
                            <Link
                              href={`/quiz?questionId=${q.id}&topic=${encodeURIComponent(q.topic)}&examSource=${examSource}`}
                              className="flex-1 min-w-0"
                            >
                              <p className="text-sm text-[#1A2B3C] line-clamp-2">{q.question.slice(0, 120)}{q.question.length > 120 ? "..." : ""}</p>
                              <p className="text-[10px] text-[#A0AEC0] mt-1 font-mono">{q.topic}</p>
                            </Link>
                            <button
                              onClick={() => removeBookmark(q.id)}
                              className="text-[#F4A261] hover:text-[#D64545] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
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
                        className="w-full text-center text-sm text-[#007B5F] font-medium py-2 hover:underline"
                      >
                        {lang === "de" ? `Alle ${bookmarkQuestions.length} anzeigen` : `Show all ${bookmarkQuestions.length}`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Notes Tab */}
            {savedTab === "notes" && (
              <div>
                {notesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-6 h-6 border-2 border-[#007B5F] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : noteEntries.length === 0 ? (
                  <div className="text-center py-8">
                    <StickyNote className="w-8 h-8 text-[#E4E9F0] mx-auto mb-2" />
                    <p className="text-sm text-[#A0AEC0]">{t("no_notes", lang)}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {noteEntries
                      .slice(0, showAllNotes ? undefined : 20)
                      .map((entry) => {
                        const q = noteQuestions.find((nq) => nq.id === entry.id);
                        const topic = q?.topic || "";
                        const config = getTopicConfig(topic);
                        const examSource = getStoredExamSource();
                        return (
                          <Link
                            key={entry.id}
                            href={`/quiz?questionId=${entry.id}&topic=${encodeURIComponent(topic)}&examSource=${examSource}`}
                            className="flex items-start gap-3 p-3 rounded-lg bg-[#F7F9FC] hover:bg-[#E4E9F0]/50 transition-colors block"
                          >
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                              style={{ backgroundColor: `${config.color}15` }}
                            >
                              <TopicIcon name={config.icon} className="w-3 h-3" />
                            </div>
                            <div className="flex-1 min-w-0">
                              {q && (
                                <p className="text-sm text-[#1A2B3C] line-clamp-1">{q.question.slice(0, 120)}</p>
                              )}
                              <p className="text-xs text-[#A0AEC0] italic mt-1 line-clamp-1">{entry.note.slice(0, 80)}</p>
                              {topic && <p className="text-[10px] text-[#A0AEC0] mt-1 font-mono">{topic}</p>}
                            </div>
                          </Link>
                        );
                      })}
                    {noteEntries.length > 20 && !showAllNotes && (
                      <button
                        onClick={() => setShowAllNotes(true)}
                        className="w-full text-center text-sm text-[#007B5F] font-medium py-2 hover:underline"
                      >
                        {lang === "de" ? `Alle ${noteEntries.length} anzeigen` : `Show all ${noteEntries.length}`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ===== SECTION 4: Exam Readiness ===== */}
          <div className="card rounded-2xl p-5 space-y-4">
            <h2 className="text-lg font-semibold text-[#1A2B3C]">{t("exam_readiness", lang)}</h2>

            {/* Countdown */}
            {daysUntilExam !== null && (
              <div className="flex items-center gap-4 p-4 rounded-xl bg-[#003A8C]/[0.04] border border-[#003A8C]/10">
                <div className="text-center">
                  <span className="text-3xl font-black font-mono font-display text-[#003A8C]">{daysUntilExam}</span>
                  <p className="text-xs text-[#A0AEC0]">{t("days_until_exam", lang)}</p>
                </div>
                <div className="flex-1">
                  <div className="h-2 bg-[#E4E9F0] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#003A8C] rounded-full transition-all"
                      style={{ width: `${Math.max(5, Math.min(100, 100 - (daysUntilExam / 180) * 100))}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Weak topics alert */}
            {weakTopics.length > 0 && (
              <div className="p-3 rounded-xl bg-[#F4A261]/[0.06] border border-[#F4A261]/15">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#F4A261] flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-[#1A2B3C] mb-1">
                      {lang === "de" ? "Fachgebiete unter 60% Genauigkeit" : "Topics below 60% accuracy"}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {weakTopics.map((wt) => {
                        const config = getTopicConfig(wt.topic);
                        const acc = Math.round((wt.correct / wt.answered) * 100);
                        return (
                          <span
                            key={wt.topic}
                            className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full border"
                            style={{ borderColor: `${config.color}30`, backgroundColor: `${config.color}08`, color: config.color }}
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

            {/* Quick actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Link
                href="/exam"
                className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#007B5F] text-white font-semibold text-sm hover:bg-[#007B5F]/90 transition-colors"
              >
                <GraduationCap className="w-5 h-5" />
                {lang === "de" ? "Prüfungssimulation starten" : "Start Exam Simulation"}
              </Link>
              {weakTopics.length > 0 && (
                <Link
                  href={`/quiz?topic=${encodeURIComponent(weakTopics[0].topic)}&userId=${userId}`}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl border border-[#007B5F] text-[#007B5F] font-semibold text-sm hover:bg-[#007B5F]/5 transition-colors"
                >
                  <TrendingUp className="w-5 h-5" />
                  {t("practice_weak", lang)}
                </Link>
              )}
            </div>
          </div>

          {/* No user state */}
          {!userId && (
            <div className="card rounded-2xl p-8 text-center">
              <TrendingUp className="w-10 h-10 text-[#E4E9F0] mx-auto mb-3" />
              <p className="text-sm text-[#A0AEC0] mb-4">{t("sign_in_for_stats", lang)}</p>
              <Link href="/" className="inline-block px-6 py-2.5 bg-[#007B5F] text-white rounded-lg font-medium text-sm hover:bg-[#007B5F]/90 transition-colors">
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
