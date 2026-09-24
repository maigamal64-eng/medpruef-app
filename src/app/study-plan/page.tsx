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
import { EmptyState } from "@/components/ui";
import { getTopicConfig } from "@/lib/topics";
import type { StudyPlan, StudyPlanDay, StudyFocus } from "@/lib/studyPlan";
import { buildStudyPath } from "@/lib/studyPath";
import StudyPathTimeline from "@/components/StudyPathTimeline";
import {
  Calendar,
  CalendarDays,
  Check,
  ChevronRight,
  ArrowRight,
  AlertTriangle,
  Target,
  Zap,
  Flame,
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

const WEEK_DAY_LABELS_DE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WEEK_DAY_LABELS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Return ISO YYYY-MM-DD for a given date in local time. */
function toLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string into a local Date at midnight. */
function parseISO(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(n => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatExamDate(iso: string, lang: Lang): string {
  const d = parseISO(iso);
  return d.toLocaleDateString(lang === "de" ? "de-AT" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Whole days between two ISO dates (b - a), tolerant of time components. */
function diffDays(aISO: string, bISO: string): number {
  const a = parseISO(aISO).getTime();
  const b = parseISO(bISO).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Focus → tag styling. New + weak read CTA-blue ("new"); review reads
    warm amber ("Festigung"). Same color grammar as the rest of the app:
    weak is a study signal, never a red failure state. */
function focusTag(focus: StudyFocus, lang: Lang) {
  if (focus === "review") {
    return {
      cls: "bg-[var(--mp-warning-bg)] text-[var(--mp-warning-dk)]",
      label: lang === "de" ? "Festigung" : "Consolidation",
    };
  }
  if (focus === "weak") {
    return {
      cls: "bg-[var(--mp-tint-brand)] text-[var(--mp-cta-blue)]",
      label: lang === "de" ? "Schwerpunkt" : "Focus",
    };
  }
  return {
    cls: "bg-[var(--mp-tint-brand)] text-[var(--mp-cta-blue)]",
    label: lang === "de" ? "Neu" : "New",
  };
}

type BlockState = "done" | "live" | "upcoming";

export default function StudyPlanPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(null);
  const [resp, setResp] = useState<ApiResponse | null>(null);

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

  const gam = session?.gamification as Gamification | undefined;
  const user = session?.user;
  const dailyGoal = resp?.dailyGoal || user?.daily_goal || 20;
  const doneToday = gam?.daily_questions_today || 0;
  const activeExam = resp?.activeExam || "kenntnispruefung";
  const studyPath = resp?.examDate ? buildStudyPath(resp.examDate, activeExam) : null;
  const streak = user?.streak_count || 0;

  // Today's schedule + the forward window (next ~6 days incl. today).
  const todayPlan = daysByISO.get(todayISO) ?? null;
  const upcomingDays = useMemo(() => {
    if (!plan) return [] as StudyPlanDay[];
    return (plan.dailySchedule || [])
      .filter(d => d.day >= todayISO && d.totalQuestions > 0)
      .slice(0, 6);
  }, [plan, todayISO]);

  // Per-block done/live derivation. The data contract gives ONE total
  // (doneToday) + today's topics in order; there is no per-topic
  // completion field. Walk the topics accumulating targetCount: a block
  // is "done" once the cumulative target is covered by doneToday, the
  // first uncovered block is "live", the rest are "upcoming". Deterministic.
  const todayBlocks = useMemo(() => {
    const topics = todayPlan?.topics ?? [];
    let cumulative = 0;
    let liveAssigned = false;
    return topics.map(tt => {
      cumulative += tt.targetCount;
      let state: BlockState;
      if (doneToday >= cumulative) {
        state = "done";
      } else if (!liveAssigned) {
        state = "live";
        liveAssigned = true;
      } else {
        state = "upcoming";
      }
      return { tt, state };
    });
  }, [todayPlan, doneToday]);

  const doneCount = todayBlocks.filter(b => b.state === "done").length;
  const totalBlocks = todayBlocks.length;

  // Countdown ring: there is no honest "elapsed study" denominator
  // (totalDays == daysLeft at generation), so the ARC encodes today's
  // real daily-goal progress (doneToday/dailyGoal) and the numeral is the
  // honest day-count to exam. Decorative-but-true.
  const daysLeft = resp?.examDate ? Math.max(0, diffDays(todayISO, resp.examDate)) : 0;
  const goalPct = Math.min(100, Math.round((doneToday / Math.max(1, dailyGoal)) * 100));
  const RING_R = 32;
  const RING_C = 2 * Math.PI * RING_R; // ~201
  const ringOffset = RING_C * (1 - goalPct / 100);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)]">
        <BrandedLoader size="lg" />
      </div>
    );
  }

  // Gate: must be logged in
  if (error === "not_logged_in" || !user) {
    return (
      <div className="app-layout">
        <Sidebar lang={lang} />
        <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
          <div className="px-6 py-16 max-w-md mx-auto">
            <EmptyState
              icon={<Target className="w-10 h-10" aria-hidden />}
              title={lang === "de" ? "Lernplan" : "Study Plan"}
              body={
                lang === "de"
                  ? "Melde dich an, um deinen persönlichen Lernplan bis zur Prüfung zu sehen."
                  : "Sign in to see your personal study plan all the way to exam day."
              }
              action={
                <Link href="/login" className="mp-btn mp-btn--primary">
                  {lang === "de" ? "Anmelden" : "Sign in"}
                </Link>
              }
            />
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
        streak={streak}
      />

      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-3 border-b border-[var(--mp-border)] flex items-center justify-between">
          <Link
            href="/"
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            &larr; {t("back_home", lang)}
          </Link>
          <h1 className="text-base font-bold font-display text-[var(--mp-fg)]">
            {lang === "de" ? "Lernplan" : "Study Plan"}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className="px-4 lg:px-8 py-5 max-w-5xl mx-auto pb-28">
          {/* ===== No exam date → prompt ===== */}
          {resp && !resp.hasExamDate && (
            <div className="max-w-md mx-auto py-6">
              <EmptyState
                icon={<CalendarDays className="w-10 h-10" aria-hidden />}
                title={
                  lang === "de" ? "Noch kein Prüfungsdatum" : "No exam date yet"
                }
                body={
                  lang === "de"
                    ? "Setze dein Prüfungsdatum in den Einstellungen. Daraus bauen wir den ruhigen, Tag-für-Tag-Weg zur Prüfung, gewichtet nach deinen schwachen Themen."
                    : "Set your exam date in Settings. From it we build the calm, day-by-day path to your exam, weighted by your weak topics."
                }
                action={
                  <Link
                    href="/settings"
                    className="mp-btn mp-btn--primary inline-flex items-center gap-2"
                  >
                    <Calendar className="w-4 h-4" aria-hidden />
                    {lang === "de" ? "Prüfungsdatum setzen" : "Set exam date"}
                  </Link>
                }
              />
            </div>
          )}

          {/* ===== Plan ===== */}
          {plan && resp?.examDate && (
            <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 lg:gap-6 items-start">
              {/* ---- Main column ---- */}
              <div className="space-y-5 min-w-0">
                {/* Countdown hero */}
                <div
                  className="relative overflow-hidden rounded-[var(--mp-r-card)] p-5 text-white"
                  style={{
                    background:
                      "linear-gradient(118deg, var(--mp-hero-from, var(--mp-fg)), var(--mp-hero-to, var(--mp-cta-blue)))",
                    boxShadow: "var(--mp-shadow-hover)",
                  }}
                >
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "radial-gradient(130px 130px at 90% 10%, var(--mp-hero-glow, var(--mp-spark-glow)), transparent 70%)",
                    }}
                    aria-hidden
                  />
                  <div className="relative flex items-center gap-4">
                    <div className="relative w-[74px] h-[74px] flex-shrink-0">
                      <svg
                        viewBox="0 0 74 74"
                        className="w-[74px] h-[74px] -rotate-90"
                        aria-hidden
                      >
                        <circle
                          cx="37"
                          cy="37"
                          r={RING_R}
                          fill="none"
                          strokeWidth="6"
                          stroke="rgba(255,255,255,0.16)"
                        />
                        <circle
                          cx="37"
                          cy="37"
                          r={RING_R}
                          fill="none"
                          strokeWidth="6"
                          strokeLinecap="round"
                          stroke="var(--mp-spark)"
                          strokeDasharray={RING_C}
                          strokeDashoffset={ringOffset}
                          style={{
                            transition: "stroke-dashoffset 0.6s var(--mp-ease-out)",
                            filter: "drop-shadow(0 0 4px var(--mp-spark-glow))",
                          }}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <b className="font-display font-black text-2xl leading-none text-white">
                          {daysLeft}
                        </b>
                        <span className="text-[9px] uppercase tracking-wider text-white/70 mt-0.5">
                          {lang === "de"
                            ? daysLeft === 1
                              ? "Tag"
                              : "Tage"
                            : daysLeft === 1
                            ? "day"
                            : "days"}
                        </span>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--mp-spark)]">
                        {lang === "de" ? "Bis zur Prüfung" : "Until your exam"}
                      </div>
                      <h2 className="font-display font-extrabold text-lg leading-tight text-white mt-1">
                        {lang === "de"
                          ? "Dein Weg zur Prüfung"
                          : "Your path to the exam"}
                      </h2>
                      <div className="text-xs text-white/75 mt-1 flex items-center gap-1.5">
                        <CalendarDays className="w-3.5 h-3.5" aria-hidden />
                        {formatExamDate(resp.examDate, lang)}
                      </div>
                    </div>
                  </div>

                  {/* 70/30 split (the plan's learning philosophy, at a glance).
                      Hidden when tight/expired (those go full-review). */}
                  {plan.status !== "tight" && plan.status !== "expired" && (
                    <div className="relative mt-4">
                      <div className="h-1.5 rounded-full overflow-hidden bg-white/15 flex">
                        <div className="h-full bg-[var(--mp-spark)]" style={{ width: "70%" }} aria-hidden />
                        <div className="h-full bg-white/40" style={{ width: "30%" }} aria-hidden />
                      </div>
                      <div className="flex items-center justify-between mt-1.5 text-[10px] font-mono uppercase tracking-wider text-white/70">
                        <span>{lang === "de" ? "70% Neu" : "70% New"}</span>
                        <span>{lang === "de" ? "30% Festigung" : "30% Consolidation"}</span>
                      </div>
                    </div>
                  )}
                  {plan.status === "tight" && (
                    <p className="relative text-xs text-white/85 mt-3 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
                      {lang === "de"
                        ? "Wenig Zeit. Fokus auf die Wiederholung deiner Schwächen."
                        : "Tight window. Focusing on review of your weak topics."}
                    </p>
                  )}
                  {plan.status === "expired" && (
                    <p className="relative text-xs text-white/85 mt-3 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
                      {lang === "de"
                        ? "Prüfungstermin ist heute oder vorbei. Aktualisiere ihn in den Einstellungen."
                        : "Exam date is today or in the past. Update it in Settings."}
                    </p>
                  )}
                  {plan.status === "far_future" && (
                    <p className="relative text-xs text-white/70 mt-3">
                      {lang === "de"
                        ? "Plan auf ein Jahr begrenzt. Aktualisiere den Termin, wenn du näher dran bist."
                        : "Plan capped at one year. Update the date when it is closer."}
                    </p>
                  )}
                </div>

                {/* Today's focus (spark left edge) */}
                <div className="relative overflow-hidden mp-card p-4">
                  <div
                    className="absolute left-0 top-0 bottom-0 w-[3px]"
                    style={{ background: "var(--mp-spark)" }}
                    aria-hidden
                  />
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 font-display font-bold text-[15px] text-[var(--mp-fg)]">
                      <span className="w-[26px] h-[26px] rounded-lg bg-[var(--mp-tint-teal)] text-[var(--mp-accent-teal)] flex items-center justify-center">
                        <Target className="w-[15px] h-[15px]" aria-hidden />
                      </span>
                      {lang === "de" ? "Heute dran" : "Today's focus"}
                    </div>
                    {totalBlocks > 0 && (
                      <div className="font-mono text-xs font-bold text-[var(--mp-accent-teal)]">
                        {doneCount} / {totalBlocks} {lang === "de" ? "fertig" : "done"}
                      </div>
                    )}
                  </div>

                  {totalBlocks === 0 ? (
                    <p className="text-xs text-[var(--mp-fg-subtle)]">
                      {lang === "de"
                        ? "Heute ist ein Ruhetag. Freiwilliges Üben ist jederzeit möglich."
                        : "Today is a rest day. Optional practice is always available."}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {todayBlocks.map(({ tt, state }) => {
                        const tc = getTopicConfig(tt.topic);
                        const practiceMode = tt.focus === "review" ? "wrong" : "unseen";
                        const href = `/quiz?topic=${encodeURIComponent(
                          tt.topic
                        )}&userId=${user.id}&examSource=${activeExam}&practiceMode=${practiceMode}&limit=${tt.targetCount}&autoStart=1`;
                        const subText =
                          state === "done"
                            ? lang === "de"
                              ? "erledigt"
                              : "done"
                            : `~${Math.max(1, Math.round(tt.targetCount * 1.2))} ${
                                lang === "de" ? "Min." : "min"
                              }`;
                        const body = (
                          <div className="flex items-center gap-3 p-2.5 rounded-[var(--mp-r-md)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)]">
                            <span
                              className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center flex-shrink-0"
                              style={
                                state === "done"
                                  ? {
                                      backgroundColor: "var(--mp-success-bg)",
                                      color: "var(--mp-viridian)",
                                    }
                                  : {
                                      backgroundColor: tc.color + "22",
                                      color: tc.color,
                                    }
                              }
                            >
                              {state === "done" ? (
                                <Check className="w-[18px] h-[18px]" aria-hidden />
                              ) : (
                                <TopicIcon
                                  name={tc.icon}
                                  className="w-[18px] h-[18px]"
                                  style={{ color: tc.color }}
                                />
                              )}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div
                                className={`text-[13.5px] font-semibold truncate ${
                                  state === "done"
                                    ? "text-[var(--mp-fg-muted)] line-through decoration-[var(--mp-border)]"
                                    : "text-[var(--mp-fg)]"
                                }`}
                              >
                                {tt.topic}
                                <span className="font-normal text-[var(--mp-fg-subtle)]">
                                  {" · "}
                                  {tt.focus === "review"
                                    ? lang === "de"
                                      ? "Festigung"
                                      : "Consolidation"
                                    : lang === "de"
                                    ? "Neu"
                                    : "New"}
                                </span>
                              </div>
                              <div className="text-[11px] text-[var(--mp-fg-subtle)] mt-0.5 font-mono tabular-nums">
                                {tt.targetCount} {lang === "de" ? "Fragen" : "questions"}
                                {" · "}
                                {subText}
                              </div>
                            </div>
                            <span
                              className="w-[30px] h-[30px] rounded-lg flex items-center justify-center flex-shrink-0 text-white"
                              style={{
                                background:
                                  state === "done"
                                    ? "var(--mp-viridian)"
                                    : "var(--mp-cta-blue)",
                              }}
                            >
                              {state === "done" ? (
                                <Check className="w-[15px] h-[15px]" aria-hidden />
                              ) : (
                                <ArrowRight className="w-[15px] h-[15px]" aria-hidden />
                              )}
                            </span>
                          </div>
                        );
                        // Done blocks are non-interactive; live/upcoming link to the quiz.
                        return state === "done" ? (
                          <div key={tt.topic}>{body}</div>
                        ) : (
                          <Link
                            key={tt.topic}
                            href={href}
                            className="block transition-transform active:scale-[0.99]"
                          >
                            {body}
                          </Link>
                        );
                      })}
                    </div>
                  )}

                  {/* Calm daily-goal reward line */}
                  <div className="mt-3 pt-3 border-t border-[var(--mp-border)] flex items-center justify-between">
                    <span className="text-[11px] text-[var(--mp-fg-subtle)] font-mono tabular-nums">
                      {doneToday}/{dailyGoal} {lang === "de" ? "Fragen heute" : "questions today"}
                    </span>
                    {doneToday >= dailyGoal ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--mp-viridian)]">
                        <Check className="w-3.5 h-3.5" aria-hidden />
                        {lang === "de" ? "Tagesziel erreicht" : "Daily goal reached"}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[var(--mp-fg-muted)]">
                        {lang === "de"
                          ? `Noch ${Math.max(0, dailyGoal - doneToday)} bis zum Ziel`
                          : `${Math.max(0, dailyGoal - doneToday)} to go`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Upcoming days timeline */}
                <div>
                  <div className="flex items-center justify-between mb-3 px-0.5">
                    <h3 className="font-display font-bold text-base text-[var(--mp-fg)]">
                      {lang === "de" ? "Kommende Tage" : "Upcoming days"}
                    </h3>
                    {plan.status !== "tight" && plan.status !== "expired" && (
                      <div className="text-[11px] font-semibold flex items-center gap-1.5 text-[var(--mp-fg-subtle)]">
                        <span className="text-[var(--mp-cta-blue)]">
                          {lang === "de" ? "70% Neu" : "70% New"}
                        </span>
                        ·
                        <span className="text-[var(--mp-warning-dk)]">
                          {lang === "de" ? "30% Festigung" : "30% Consolidation"}
                        </span>
                      </div>
                    )}
                  </div>

                  {upcomingDays.length === 0 ? (
                    <div className="mp-card p-4 text-xs text-[var(--mp-fg-subtle)]">
                      {lang === "de"
                        ? "Keine weiteren geplanten Tage. Dein Plan ist abgeschlossen."
                        : "No further planned days. Your plan is complete."}
                    </div>
                  ) : (
                    <div className="relative">
                      {upcomingDays.map((d, i) => {
                        const date = parseISO(d.day);
                        const labels =
                          lang === "de" ? WEEK_DAY_LABELS_DE : WEEK_DAY_LABELS_EN;
                        const isActive = d.day === todayISO;
                        const isLast = i === upcomingDays.length - 1;
                        const tagTopics = d.topics.slice(0, 3);
                        const title =
                          d.topics.length > 0
                            ? d.topics[0].topic +
                              (d.topics.length > 1
                                ? lang === "de"
                                  ? " + Mix"
                                  : " + mix"
                                : "")
                            : lang === "de"
                            ? "Ruhetag"
                            : "Rest day";
                        return (
                          <div key={d.day} className="flex gap-3.5 relative pb-3.5">
                            {!isLast && (
                              <span
                                className="absolute left-[17px] top-9 bottom-0 w-0.5 bg-[var(--mp-border)]"
                                aria-hidden
                              />
                            )}
                            <div className="w-9 flex-shrink-0 flex flex-col items-center">
                              <div
                                className={`w-9 h-9 rounded-[11px] flex flex-col items-center justify-center relative z-[1] border ${
                                  isActive
                                    ? "border-transparent"
                                    : "bg-[var(--mp-surface)] border-[var(--mp-border)] text-[var(--mp-fg-muted)]"
                                }`}
                                style={
                                  isActive
                                    ? {
                                        background: "var(--mp-spark)",
                                        // Dark brand-ink (not white) on the teal spark fill:
                                        // white scored ~1.92:1 in dark mode. Inline style (not a
                                        // text-[#...] class) so the dark !important override matrix
                                        // can't flip it. Oxford ink passes >=4.5:1 in both modes.
                                        color: "var(--mp-oxford-blue)",
                                        boxShadow: "0 0 0 4px var(--mp-spark-glow)",
                                      }
                                    : undefined
                                }
                              >
                                <b className="font-mono font-bold text-[13px] leading-none">
                                  {date.getDate()}
                                </b>
                                <span className="text-[8px] uppercase tracking-wide mt-0.5">
                                  {labels[date.getDay()]}
                                </span>
                              </div>
                            </div>
                            <div
                              className={`flex-1 min-w-0 mp-card p-3 ${
                                isActive ? "border-[var(--mp-spark)]" : ""
                              }`}
                              style={
                                isActive
                                  ? { borderColor: "var(--mp-spark)" }
                                  : undefined
                              }
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[13.5px] font-bold text-[var(--mp-fg)] truncate">
                                  {isActive
                                    ? lang === "de"
                                      ? "Heute"
                                      : "Today"
                                    : title}
                                </span>
                                <span className="font-mono text-[11px] font-semibold text-[var(--mp-fg-subtle)] shrink-0">
                                  {d.totalQuestions} {lang === "de" ? "Fr." : "q"}
                                </span>
                              </div>
                              {tagTopics.length > 0 && (
                                <div className="flex gap-1.5 mt-2 flex-wrap">
                                  {tagTopics.map(tt => {
                                    const tag = focusTag(tt.focus, lang);
                                    return (
                                      <span
                                        key={tt.topic}
                                        className={`text-[10px] font-semibold px-2 py-[3px] rounded-full ${tag.cls}`}
                                      >
                                        {tt.topic}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <p className="text-center text-xs text-[var(--mp-fg-subtle)] pt-1">
                  {lang === "de"
                    ? "Der Plan passt sich täglich an deinen Fortschritt an."
                    : "The plan adapts daily to your progress."}
                </p>
              </div>

              {/* ---- Side column (desktop) / stacked (mobile) ---- */}
              <aside className="space-y-5 lg:sticky lg:top-5">
                {/* Path to exam day (milestone ladder + registration anchor).
                    Kept from the 06-25 ship (shared with home); not in the
                    03 mockup. Integrator to rule on final placement. */}
                {studyPath && <StudyPathTimeline path={studyPath} lang={lang} />}

                {/* Streak + planned-questions stat tiles */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="mp-card p-3.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--mp-fg-muted)]">
                      <Flame className="w-3.5 h-3.5 text-[var(--mp-warning-dk)]" aria-hidden />
                      {lang === "de" ? "Serie" : "Streak"}
                    </div>
                    <div className="font-mono font-black text-2xl text-[var(--mp-fg)] mt-1 tabular-nums">
                      {streak}
                    </div>
                  </div>
                  <div className="mp-card p-3.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--mp-fg-muted)]">
                      <Zap className="w-3.5 h-3.5 text-[var(--mp-cta-blue)]" aria-hidden />
                      {lang === "de" ? "Geplant" : "Planned"}
                    </div>
                    <div className="font-mono font-black text-2xl text-[var(--mp-fg)] mt-1 tabular-nums">
                      {plan.totalQuestions.toLocaleString(
                        lang === "de" ? "de-DE" : "en-US"
                      )}
                    </div>
                  </div>
                </div>

                {/* Weak topics recap */}
                {plan.weakTopics.length > 0 && (
                  <div className="mp-card p-4 border-l-4 border-l-[var(--mp-warning-dk)]">
                    <p className="font-bold text-sm text-[var(--mp-fg)] mb-1 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-[var(--mp-warning-dk)]" aria-hidden />
                      {lang === "de" ? "Deine Schwächen" : "Your weak topics"}
                    </p>
                    <p className="text-xs text-[var(--mp-fg-muted)] mb-3">
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
                          className="inline-flex items-center gap-1.5 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] text-[var(--mp-fg)] text-xs font-medium px-3 py-1.5 rounded-full hover:border-[var(--mp-warning-dk)] transition-colors"
                        >
                          {topic}
                          <ChevronRight className="w-3 h-3 text-[var(--mp-fg-subtle)]" aria-hidden />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </aside>
            </div>
          )}
        </div>
      </main>

      <BottomNav lang={lang} userId={user?.id} />
    </div>
  );
}
