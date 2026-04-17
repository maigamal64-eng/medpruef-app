"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BrandedLoader } from "@/components/Logo";
import { authFetch as fetch } from "@/lib/authFetch";
import { getLang, setLang, t } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import TopicIcon from "@/components/TopicIcon";
import { getTopicConfig } from "@/lib/topics";
import type { StudyPlan, StudyPlanDay } from "@/lib/studyPlan";
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  PlayCircle,
  AlertTriangle,
  Sparkles,
  Target,
} from "lucide-react";

type Lang = "de" | "en";

interface Gamification {
  daily_questions_today: number;
  total_questions_answered: number;
  total_correct: number;
}

interface ApiResponse {
  plan: StudyPlan | null;
  hasExamDate: boolean;
  examDate?: string | null;
  dailyGoal?: number;
  activeExam?: string;
}

const WEEK_DAY_LABELS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WEEK_DAY_LABELS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** YYYY-MM-DD comparison of two Dates regardless of hour/tz drift. */
function sameISO(a: string, b: string) {
  return a === b;
}

/** Return ISO YYYY-MM-DD for a given date in local time. */
function toLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string into a local Date at midnight. */
function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(n => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * Produce a Monday-anchored 7-day window that contains the given day.
 * If `anchor` is a Sunday, the window is the 6 days before it + itself.
 */
function getWeekWindow(anchor: Date): Date[] {
  const day = anchor.getDay(); // 0=Sun..6=Sat
  // Shift so Monday = 0
  const fromMonday = (day + 6) % 7;
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - fromMonday);
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(d);
  }
  return out;
}

function formatLongDate(iso: string, lang: Lang): string {
  const d = parseISO(iso);
  return d.toLocaleDateString(lang === "de" ? "de-AT" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatExamDate(iso: string, lang: Lang): string {
  const d = parseISO(iso);
  return d.toLocaleDateString(lang === "de" ? "de-AT" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Colors per focus tag. */
function focusBadge(focus: "review" | "weak" | "new", lang: Lang) {
  if (focus === "weak") {
    return {
      bg: "bg-[#D64545]/10",
      text: "text-[#D64545]",
      label: lang === "de" ? "Schwach" : "Weak",
    };
  }
  if (focus === "review") {
    return {
      bg: "bg-[#F4A261]/15",
      text: "text-[#F4A261]",
      label: lang === "de" ? "Wiederholen" : "Review",
    };
  }
  return {
    bg: "bg-[#007B5F]/10",
    text: "text-[#007B5F]",
    label: lang === "de" ? "Neu" : "New",
  };
}

export default function StudyPlanPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(null);
  const [resp, setResp] = useState<ApiResponse | null>(null);
  const [weekAnchor, setWeekAnchor] = useState<Date>(new Date());

  useEffect(() => {
    setLangState(getLang());
    setSession(getStoredSession());
  }, []);

  useEffect(() => {
    let alive = true;
    const stored = getStoredSession();
    if (!stored?.user?.id || stored.user.id.startsWith("guest_")) {
      setLoading(false);
      setError("not_logged_in");
      return;
    }
    fetch("/api/user/study-plan")
      .then(r => r.json())
      .then(data => {
        if (!alive) return;
        setResp(data);
        setLoading(false);
      })
      .catch(err => {
        if (!alive) return;
        console.error("[study-plan] fetch failed", err);
        setError("fetch_failed");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const todayISO = toLocalISO(new Date());
  const plan = resp?.plan ?? null;

  // Pre-index days by ISO so lookups are O(1)
  const daysByISO = useMemo(() => {
    const m = new Map<string, StudyPlanDay>();
    for (const d of plan?.dailySchedule || []) m.set(d.day, d);
    return m;
  }, [plan]);

  const weekDays = useMemo(() => getWeekWindow(weekAnchor), [weekAnchor]);

  const gam = session?.gamification as Gamification | undefined;
  const user = session?.user;
  const dailyGoal = resp?.dailyGoal || user?.daily_goal || 20;
  const doneToday = gam?.daily_questions_today || 0;
  const activeExam = resp?.activeExam || "kenntnispruefung";

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F7F9FC]">
        <BrandedLoader size="lg" />
      </div>
    );
  }

  // Gate: must be logged in
  if (error === "not_logged_in" || !user) {
    return (
      <div className="app-layout">
        <Sidebar lang={lang} />
        <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
          <div className="px-6 py-16 flex flex-col items-center text-center max-w-md mx-auto">
            <Target className="w-10 h-10 text-[#A0AEC0] mb-4" />
            <h1 className="text-xl font-bold text-[#1A2B3C] mb-2">
              {lang === "de" ? "Lernplan" : "Study Plan"}
            </h1>
            <p className="text-sm text-[#4A5568] mb-6">
              {lang === "de"
                ? "Melde dich an, um deinen personalisierten Lernplan zu sehen."
                : "Sign in to see your personalized study plan."}
            </p>
            <Link href="/login" className="btn-primary px-5 py-2.5 rounded-xl">
              {lang === "de" ? "Anmelden" : "Sign in"}
            </Link>
          </div>
        </main>
        <BottomNav lang={lang} />
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar
        lang={lang}
        userId={user.id}
        userName={user.first_name}
        totalXp={user.xp_total || 0}
        streak={user.streak_count || 0}
      />

      <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-3 border-b border-[#E4E9F0] flex items-center justify-between">
          <Link
            href="/"
            className="text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors"
          >
            &larr; {t("back_home", lang)}
          </Link>
          <h1 className="text-base font-bold text-[#1A2B3C] flex items-center gap-2">
            <Target className="w-4 h-4 text-[#007B5F]" />
            {lang === "de" ? "Lernplan" : "Study Plan"}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className="px-4 lg:px-8 py-5 max-w-4xl mx-auto pb-28 space-y-6">
          {/* ===== No exam date → prompt ===== */}
          {resp && !resp.hasExamDate && (
            <div className="card rounded-2xl p-6 md:p-10 text-center">
              <Calendar className="w-12 h-12 mx-auto mb-4 text-[#A0AEC0]" />
              <h2 className="text-lg md:text-xl font-bold text-[#1A2B3C] mb-2">
                {lang === "de"
                  ? "Kein Prüfungsdatum gesetzt"
                  : "No exam date set"}
              </h2>
              <p className="text-sm text-[#4A5568] mb-6 max-w-md mx-auto">
                {lang === "de"
                  ? "Setze dein Prüfungsdatum in den Einstellungen, um einen personalisierten Lernplan zu erhalten."
                  : "Set your exam date in Settings to generate a personalized study plan."}
              </p>
              <Link
                href="/settings"
                className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-xl"
              >
                <Calendar className="w-4 h-4" />
                {lang === "de"
                  ? "Prüfungsdatum setzen"
                  : "Set exam date"}
              </Link>
            </div>
          )}

          {/* ===== Plan ===== */}
          {plan && resp?.examDate && (
            <>
              {/* Hero */}
              <div className="bg-gradient-to-r from-[#001B3D] to-[#003A8C] rounded-2xl p-5 md:p-7 text-white relative overflow-hidden">
                <div
                  className="absolute inset-0 opacity-[0.04]"
                  style={{
                    backgroundImage:
                      "radial-gradient(circle at 2px 2px, white 1px, transparent 0)",
                    backgroundSize: "24px 24px",
                  }}
                />
                <div className="relative">
                  <p className="text-xs uppercase tracking-wider text-white/70 font-semibold mb-1">
                    {lang === "de" ? "Dein Lernplan" : "Your Study Plan"}
                  </p>
                  <h2 className="text-xl md:text-2xl font-black font-display mb-2 leading-tight">
                    {lang === "de"
                      ? `Bis zur Prüfung am ${formatExamDate(resp.examDate, lang)}`
                      : `Until your exam on ${formatExamDate(resp.examDate, lang)}`}
                  </h2>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full">
                      <Calendar className="w-3.5 h-3.5" />
                      {plan.totalDays}{" "}
                      {lang === "de" ? "Tage" : plan.totalDays === 1 ? "day" : "days"}
                    </span>
                    <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full">
                      <Sparkles className="w-3.5 h-3.5" />
                      {plan.totalQuestions.toLocaleString(
                        lang === "de" ? "de-DE" : "en-US"
                      )}{" "}
                      {lang === "de" ? "Fragen geplant" : "questions planned"}
                    </span>
                    <span className="inline-flex items-center gap-1.5 bg-[#00A896]/30 text-white text-xs font-medium px-3 py-1.5 rounded-full">
                      <Target className="w-3.5 h-3.5" /> {dailyGoal}/
                      {lang === "de" ? "Tag" : "day"}
                    </span>
                  </div>
                  {plan.status === "tight" && (
                    <p className="text-xs text-[#F4A261] mt-3 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {lang === "de"
                        ? "Wenig Zeit — Fokus auf Wiederholung deiner Schwächen."
                        : "Tight window — focusing on review of your weak topics."}
                    </p>
                  )}
                  {plan.status === "expired" && (
                    <p className="text-xs text-[#F4A261] mt-3 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {lang === "de"
                        ? "Prüfungstermin liegt in der Vergangenheit oder ist heute — aktualisiere ihn in den Einstellungen."
                        : "Exam date is today or in the past — update it in Settings."}
                    </p>
                  )}
                  {plan.status === "far_future" && (
                    <p className="text-xs text-white/70 mt-3">
                      {lang === "de"
                        ? "Plan auf ein Jahr begrenzt — aktualisiere den Termin, wenn du näher dran bist."
                        : "Plan capped at 1 year — update the date when it's closer."}
                    </p>
                  )}
                </div>
              </div>

              {/* Today's progress */}
              <div className="card rounded-2xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-[#1A2B3C] flex items-center gap-2">
                    <Target className="w-4 h-4 text-[#007B5F]" />
                    {lang === "de" ? "Heute" : "Today"}
                  </h3>
                  <span className="text-xs font-mono text-[#4A5568]">
                    {doneToday}/{dailyGoal}{" "}
                    {lang === "de" ? "Fragen" : "questions"}
                  </span>
                </div>
                <div className="h-2 bg-[#F7F9FC] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#007B5F] rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, Math.round((doneToday / Math.max(1, dailyGoal)) * 100))}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-[#A0AEC0] mt-2">
                  {doneToday >= dailyGoal
                    ? lang === "de"
                      ? "Tagesziel erreicht — weiter so!"
                      : "Daily goal reached — great job!"
                    : lang === "de"
                    ? `Noch ${Math.max(0, dailyGoal - doneToday)} Fragen bis zum Tagesziel`
                    : `${Math.max(0, dailyGoal - doneToday)} more to hit today's goal`}
                </p>
              </div>

              {/* Weekly calendar */}
              <div className="card rounded-2xl p-4 md:p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-[#1A2B3C]">
                    {lang === "de" ? "Woche im Überblick" : "Week Overview"}
                  </h3>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        const d = new Date(weekAnchor);
                        d.setDate(d.getDate() - 7);
                        setWeekAnchor(d);
                      }}
                      className="w-8 h-8 rounded-lg border border-[#E4E9F0] flex items-center justify-center text-[#4A5568] hover:bg-[#F7F9FC] transition-colors"
                      aria-label={lang === "de" ? "Vorige Woche" : "Previous week"}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setWeekAnchor(new Date())}
                      className="px-2.5 h-8 rounded-lg border border-[#E4E9F0] text-xs text-[#4A5568] hover:bg-[#F7F9FC] transition-colors"
                    >
                      {lang === "de" ? "Heute" : "Today"}
                    </button>
                    <button
                      onClick={() => {
                        const d = new Date(weekAnchor);
                        d.setDate(d.getDate() + 7);
                        setWeekAnchor(d);
                      }}
                      className="w-8 h-8 rounded-lg border border-[#E4E9F0] flex items-center justify-center text-[#4A5568] hover:bg-[#F7F9FC] transition-colors"
                      aria-label={lang === "de" ? "Nächste Woche" : "Next week"}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-1.5 md:gap-2">
                  {weekDays.map((d, i) => {
                    const iso = toLocalISO(d);
                    const isToday = sameISO(iso, todayISO);
                    const dayPlan = daysByISO.get(iso);
                    const planned = dayPlan?.totalQuestions || 0;
                    const isRest = planned === 0 && !!dayPlan;
                    const outsidePlan = !dayPlan;
                    const labels = lang === "de" ? WEEK_DAY_LABELS_DE : WEEK_DAY_LABELS_EN;
                    const isDone =
                      isToday && doneToday >= dailyGoal && planned > 0;
                    return (
                      <div
                        key={iso}
                        className={`rounded-xl border px-1 py-2 md:px-2 md:py-3 text-center transition-all ${
                          isToday
                            ? "bg-[#007B5F]/10 border-[#007B5F]/40 ring-2 ring-[#007B5F]/30"
                            : outsidePlan
                            ? "bg-[#F7F9FC] border-[#E4E9F0] opacity-50"
                            : isRest
                            ? "bg-[#F7F9FC] border-[#E4E9F0]"
                            : "bg-white border-[#E4E9F0]"
                        }`}
                      >
                        <p className="text-[10px] uppercase font-semibold text-[#A0AEC0] tracking-wider">
                          {labels[i]}
                        </p>
                        <p
                          className={`text-base md:text-lg font-display font-bold ${
                            isToday ? "text-[#007B5F]" : "text-[#1A2B3C]"
                          }`}
                        >
                          {d.getDate()}
                        </p>
                        {isDone ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#00A896] mx-auto mt-1" />
                        ) : outsidePlan ? (
                          <p className="text-[9px] text-[#A0AEC0] mt-0.5">—</p>
                        ) : (
                          <p className="text-[10px] text-[#4A5568] font-mono mt-0.5">
                            {planned}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Day cards for the week */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-[#1A2B3C] border-l-[3px] border-l-[#007B5F] pl-3">
                  {lang === "de" ? "Deine Tage" : "Your days"}
                </h3>
                {weekDays.map(d => {
                  const iso = toLocalISO(d);
                  const isToday = sameISO(iso, todayISO);
                  const dayPlan = daysByISO.get(iso);
                  if (!dayPlan) {
                    return (
                      <div
                        key={iso}
                        className="card rounded-2xl p-4 opacity-60 border border-dashed border-[#E4E9F0]"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-wider font-semibold text-[#A0AEC0]">
                              {formatLongDate(iso, lang)}
                            </p>
                            <p className="text-sm text-[#A0AEC0] mt-1">
                              {lang === "de"
                                ? "Außerhalb des Plans"
                                : "Outside the plan window"}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const goalHit = isToday && doneToday >= dailyGoal;
                  return (
                    <div
                      key={iso}
                      className={`card rounded-2xl p-4 md:p-5 ${
                        isToday ? "ring-2 ring-[#007B5F]/30 border-[#007B5F]/40" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-xs uppercase tracking-wider font-semibold text-[#007B5F]">
                              {formatLongDate(iso, lang)}
                            </p>
                            {isToday && (
                              <span className="inline-flex items-center gap-1 bg-[#007B5F]/10 text-[#007B5F] text-[10px] font-bold px-2 py-0.5 rounded-full">
                                {lang === "de" ? "Heute" : "Today"}
                              </span>
                            )}
                            {dayPlan.phase === "consolidation" && (
                              <span className="inline-flex items-center gap-1 bg-[#F4A261]/15 text-[#F4A261] text-[10px] font-bold px-2 py-0.5 rounded-full">
                                {lang === "de" ? "Festigen" : "Consolidate"}
                              </span>
                            )}
                            {dayPlan.phase === "new" && (
                              <span className="inline-flex items-center gap-1 bg-[#003A8C]/10 text-[#003A8C] text-[10px] font-bold px-2 py-0.5 rounded-full">
                                {lang === "de" ? "Neues Material" : "New material"}
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-bold text-[#1A2B3C] mt-1 font-mono">
                            {dayPlan.totalQuestions}{" "}
                            <span className="font-normal text-[#4A5568] text-xs">
                              {lang === "de" ? "Fragen geplant" : "questions planned"}
                            </span>
                          </p>
                        </div>
                        {goalHit ? (
                          <span className="inline-flex items-center gap-1 text-[#00A896] text-xs font-semibold shrink-0">
                            <CheckCircle2 className="w-4 h-4" />{" "}
                            {lang === "de" ? "Erledigt" : "Done"}
                          </span>
                        ) : null}
                      </div>

                      {dayPlan.topics.length === 0 ? (
                        <p className="text-xs text-[#A0AEC0] italic">
                          {lang === "de"
                            ? "Ruhetag — freiwilliges Lernen möglich"
                            : "Rest day — optional practice"}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {dayPlan.topics.map(tt => {
                            const tc = getTopicConfig(tt.topic);
                            const badge = focusBadge(tt.focus, lang);
                            const practiceMode =
                              tt.focus === "review" ? "wrong" : "all";
                            const href = `/quiz?topic=${encodeURIComponent(
                              tt.topic
                            )}&userId=${user.id}&examSource=${activeExam}&practiceMode=${practiceMode}&autoStart=1`;
                            return (
                              <div
                                key={tt.topic}
                                className="flex items-center gap-3 p-2.5 rounded-xl bg-[#F7F9FC] border border-[#E4E9F0]"
                              >
                                <div
                                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                                  style={{ backgroundColor: tc.color + "15" }}
                                >
                                  <TopicIcon
                                    name={tc.icon}
                                    className="w-4 h-4"
                                    style={{ color: tc.color }}
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-[#1A2B3C] truncate">
                                    {tt.topic}
                                  </p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span
                                      className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded ${badge.bg} ${badge.text}`}
                                    >
                                      {badge.label}
                                    </span>
                                    <span className="text-[11px] text-[#4A5568] font-mono">
                                      {tt.targetCount}{" "}
                                      {lang === "de" ? "Fragen" : "q's"}
                                    </span>
                                  </div>
                                </div>
                                <Link
                                  href={href}
                                  className="btn-primary !py-1.5 !px-3 rounded-lg text-xs inline-flex items-center gap-1 shrink-0"
                                >
                                  <PlayCircle className="w-3.5 h-3.5" />
                                  {lang === "de" ? "Start" : "Start"}
                                </Link>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Weak topics recap */}
              {plan.weakTopics.length > 0 && (
                <div className="bg-[#FFF4E6] border border-[#F4A261]/25 border-l-4 border-l-[#F4A261] rounded-2xl p-5">
                  <p className="font-bold text-[#1A2B3C] mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#F4A261]" />
                    {lang === "de" ? "Deine Schwächen" : "Your weak topics"}
                  </p>
                  <p className="text-xs text-[#4A5568] mb-3">
                    {lang === "de"
                      ? "Diese Fachgebiete bekommen im Plan mehr Gewicht."
                      : "These specialties are weighted heavier in your plan."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {plan.weakTopics.map(topic => (
                      <Link
                        key={topic}
                        href={`/quiz?topic=${encodeURIComponent(
                          topic
                        )}&userId=${user.id}&examSource=${activeExam}&practiceMode=wrong&autoStart=1`}
                        className="inline-flex items-center gap-1.5 bg-white border border-[#F4A261]/30 text-[#1A2B3C] text-xs font-medium px-3 py-1.5 rounded-full hover:bg-[#F4A261]/10 transition-colors"
                      >
                        {topic}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-center text-xs text-[#A0AEC0] pt-2">
                {lang === "de"
                  ? "Plan passt sich täglich an deinen Fortschritt an."
                  : "Plan adapts daily to your progress."}
              </p>
            </>
          )}
        </div>
      </main>

      <BottomNav lang={lang} userId={user?.id} />
    </div>
  );
}
