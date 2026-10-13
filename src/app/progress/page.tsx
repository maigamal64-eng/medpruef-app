"use client";
import PartialTranslationNote from "@/components/PartialTranslationNote";
import { DataRegion } from "@/components/ui/DataRegion";
import { buildQuizHref } from "@/lib/quiz-links";
import { useLang as useGlobalLang, renderLang } from "@/lib/i18n";

import { startTopicProgressRequest } from "@/lib/topic-progress-request";

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
 *   - /api/stats (signed session) → gamification snapshot + per-topic stats
 *   - /api/questions?ids=…    → bookmarked + noted questions
 *   - <ReadinessSignal>       → self-fetches /api/user/readiness (consumed as-is)
 *   - account-scoped bookmark API/cache and notes; legacy quiz/profile
 *     data is read only before sign-in because it has no trustworthy owner
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
import { EXAM_SOURCES, getTopicConfig, setStoredExamSource, type ExamSourceId } from "@/lib/topics";
import { t, getLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { getStoredExamSource } from "@/lib/topics";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { canUse } from "@/lib/entitlements";
import { useSignedInRoute } from "@/lib/hooks/useSignedInRoute";
import { ts as tsx, studyDate, studyPct, studyNumber } from "@/lib/i18n-study";
import { rankLabel } from "@/lib/i18n-study-dash";
import { countdownCopy } from "@/lib/master-learning/plan-copy";
import { daysBetween } from "@/lib/master-learning/plan-target";
import { topicShortName } from "@/lib/topics";
import WeeklyProgressCard from "./_parts/WeeklyProgressCard";
import FieldReadinessCard from "./_parts/FieldReadinessCard";
import MockTrendCard from "./_parts/MockTrendCard";
import NextStepBlock from "./_parts/NextStepBlock";
import { MIN_TOPIC_SAMPLE, PRACTICE_MORE_BELOW_PCT } from "@/lib/learning-metrics";
import { listNoteQuestionIds, readNoteText } from "@/lib/notes-store";
// authFetch sends the signed session token. The bookmark/notes `/api/questions?ids=`
// lookups (and /api/stats) must be authenticated, or the route treats them as a
// guest and returns the free-tier paywall stub instead of the saved question —
// which would re-break "bookmark counted but not shown" (FEEDBACK #5a) for users
// drawing a question outside the free 150-slice.
import { authFetch } from "@/lib/authFetch";
import { BOOKMARK_EVENT, hasLegacyBookmarks, importLegacyBookmarks, loadBookmarks, readCachedBookmarks, setBookmark } from "@/lib/bookmarks";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { AppLayout, Dialog } from "@/components/ui";
import TopicIcon from "@/components/TopicIcon";
import ReadinessSignal from "@/components/ReadinessSignal";
import { AchievementRank } from "@/components/ui/AchievementRank";
import {
  TrendingUp,
  Star,
  StickyNote,
  GraduationCap,
  Flame,
  CheckCircle2,
  Radar as RadarIcon,
  Layers,
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
  lang: Lang;
}) {
  // UX-STU-37 (pick A): a fixed short-name map, never a substring cut; no
  // radius ticks; the full names and values sit in the text list below.
  const rows = topics
    .filter((tp) => tp.answered > 0)
    .map((tp) => ({ topic: tp.topic, accuracy: Math.round((tp.correct / tp.answered) * 100) }));
  const data = rows.map((r) => ({ subject: topicShortName(r.topic), accuracy: r.accuracy, fullMark: 100 }));

  if (data.length < 3) {
    return (
      <p className="text-sm text-[var(--mp-fg-subtle)] text-center py-12">
        {tsx("radar_more", lang)}
      </p>
    );
  }

  return (
    <>
      <div role="img" aria-label={tsx("radar_alt", lang)}>
        <ResponsiveContainer width="100%" height={260}>
          <RadarChart data={data} outerRadius="70%">
            <PolarGrid stroke="var(--mp-border)" />
            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12, fill: "var(--mp-fg-muted)" }} />
            <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
            <Radar name="Accuracy" dataKey="accuracy" stroke="var(--mp-spark)" fill="var(--mp-spark)" fillOpacity={0.18} strokeWidth={2} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer min-h-11 inline-flex items-center text-[13px] font-semibold text-[var(--mp-cta-blue)]">{tsx("radar_list_title", lang)}</summary>
        <ul className="mt-1 space-y-1 text-[13px] text-[var(--mp-fg)]">
          {[...rows].sort((a, b) => a.accuracy - b.accuracy).map((r) => (
            <li key={r.topic}><span lang="de">{r.topic}</span>: {studyPct(r.accuracy, lang)}</li>
          ))}
        </ul>
      </details>
    </>
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

export default function ProgressPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [hasStatsData, setHasStatsData] = useState(false);
  const [dataError, setDataError] = useState(false);
  const [reload, setReload] = useState(0);
  const preferredLang = useGlobalLang();
  useEffect(() => { setLangState(renderLang(preferredLang)); }, [preferredLang]);
  const [userId, setUserId] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
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
  const [examSource, setExamSource] = useState<ExamSourceId>("kenntnispruefung");
  const [examPreferenceReady, setExamPreferenceReady] = useState(false);
  const [coverageError, setCoverageError] = useState(false);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageRetry, setCoverageRetry] = useState(0);
  const [coverageTopics, setCoverageTopics] = useState<Array<{ topic: string; total: number; answered: number; accuracy: number }>>([]);
  const [sortBy, setSortBy] = useState<"accuracy" | "count">("count");
  const [savedTab, setSavedTab] = useState<"bookmarks" | "notes">("bookmarks");
  const [bookmarkIds, setBookmarkIds] = useState<number[]>([]);
  const [legacyBookmarksAvailable, setLegacyBookmarksAvailable] = useState(false);
  const [legacyImportBusy, setLegacyImportBusy] = useState(false);
  const [bookmarkConfirmOpen, setBookmarkConfirmOpen] = useState(false);
  const [legacyImportMessage, setLegacyImportMessage] = useState("");
  const [bookmarkQuestions, setBookmarkQuestions] = useState<QuestionItem[]>([]);
  const [noteEntries, setNoteEntries] = useState<{ id: number; note: string }[]>([]);
  const [noteQuestions, setNoteQuestions] = useState<QuestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookmarksLoading, setBookmarksLoading] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);
  const [showAllBookmarks, setShowAllBookmarks] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [accuracy, setAccuracy] = useState(0);
  const [examDate, setExamDate] = useState<string | null>(null);
  // UX-STU-40: signed-out visitors go to the sign-in page with a return path.
  const signedIn = useSignedInRoute();

  /* ─── Init: load session, lang, localStorage data ─── */
  useEffect(() => {
    setLangState(getLang());
    setExamSource(getStoredExamSource());
    const session = getStoredSession();
    setLegacyBookmarksAvailable(!!session && hasLegacyBookmarks());
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
      setUserTier(session.user.tier || "free");
      setUserRole(session.user.role || "user");
      if (session.gamification) setHasStatsData(true);
      const gm = session.gamification ?? {};
      setTotalXp(gm.total_xp || 0);
      setStreak(gm.current_streak || 0);
      setTotalAnswered(gm.total_questions_answered || 0);
      setTotalCorrect(gm.total_correct || 0);
      const ans = gm.total_questions_answered || 0;
      const cor = gm.total_correct || 0;
      setAccuracy(ans > 0 ? Math.round((cor / ans) * 100) : 0);
      if (session.user.id.startsWith("guest_")) {
        setExamPreferenceReady(true);
      } else {
        const sessionUserId = session.user.id;
        // The server owns the selected exam. A stale browser cache can
        // otherwise show coverage for Vienna after the learner selected
        // Innsbruck or Pharma on another device. Keep the cached value as
        // the offline fallback, but don't fetch a mismatched denominator.
        void authFetch("/api/user/exam-preference")
          .then(async (response) => {
            if (!response.ok) return;
            const data = await response.json().catch(() => null);
            if (getStoredSession()?.user?.id !== sessionUserId) return;
            if (EXAM_SOURCES.some((source) => source.id === data?.activeExam)) {
              const canonicalExam = data.activeExam as ExamSourceId;
              setStoredExamSource(canonicalExam);
              setExamSource(canonicalExam);
            }
            // LX-09: the countdown reads the same stored date as the plan.
            setExamDate(typeof data?.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.examDate) ? data.examDate : null);
          })
          .catch(() => {
            // Keep the local exam selection when the network is unavailable.
          })
          .finally(() => setExamPreferenceReady(true));
      }
    } else {
      setExamPreferenceReady(true);
    }

    const notes: { id: number; note: string }[] = session
      ? listNoteQuestionIds(session.user.id)
          .map((id) => ({ id, note: readNoteText(id, "\n\n", session.user.id) }))
          .filter((entry) => entry.note.trim())
      : [];
    setNoteEntries(notes);

    // This legacy browser-wide date has no reliable owner. Never show it to
    // either signed-in or signed-out visitors on a shared browser.
    setSessionReady(true);
  }, []);

  useEffect(() => {
    if (!sessionReady || !userId) {
      setBookmarkIds([]);
      return;
    }
    let cancelled = false;
    const syncCached = () => setBookmarkIds(readCachedBookmarks(userId));
    const refresh = () => {
      void loadBookmarks(userId).then((ids) => {
        if (!cancelled && ids) setBookmarkIds(ids);
      });
    };
    syncCached();
    window.addEventListener(BOOKMARK_EVENT, syncCached);
    window.addEventListener("online", refresh);
    refresh();
    return () => {
      cancelled = true;
      window.removeEventListener(BOOKMARK_EVENT, syncCached);
      window.removeEventListener("online", refresh);
    };
  }, [sessionReady, userId, reload]);

  useEffect(() => {
    setCoverageTopics([]);
    setCoverageError(false);
    setCoverageLoading(true);
    if (!sessionReady || !userId || !examPreferenceReady) return;
    const request = startTopicProgressRequest(examSource, authFetch, rows => {
      setCoverageTopics(rows);
      setCoverageLoading(false);
    }, () => {
      setCoverageError(true);
      setCoverageLoading(false);
    });
    return request.cancel;
  }, [sessionReady, userId, examPreferenceReady, examSource, coverageRetry]);

  /* ─── Fetch per-topic stats from API ─── */
  useEffect(() => {
    if (!sessionReady) return;
    if (!userId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    authFetch("/api/stats", { signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw new Error("Data unavailable"); const value = await r.json(); if (!value?.gamification || typeof value.gamification.total_questions_answered !== "number") throw new Error("Invalid statistics"); setDataError(false); return value; })
      .then((data) => {
        if (controller.signal.aborted) return;
        setHasStatsData(true);
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
        if (controller.signal.aborted) return;
        setDataError(true);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sessionReady, userId, reload]);

  /* ─── Fetch bookmarked questions ─── */
  useEffect(() => {
    if (bookmarkIds.length === 0) {
      setBookmarkQuestions([]);
      setBookmarksLoading(false);
      return;
    }
    setBookmarksLoading(true);
    // examSource=all (NOT the stored exam): a saved item must surface
    // regardless of which exam is currently active. With the per-exam
    // filter, a bookmark made in Kenntnisprüfung vanished when the user
    // switched to Stichprobentest - the count stayed 1 but the question
    // never came back, so the list read "no bookmarks". See FEEDBACK #5.
    const idsParam = bookmarkIds.slice(0, 50).join(",");
    authFetch(`/api/questions?ids=${idsParam}&examSource=all`)
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
    // examSource=all for the same cross-exam reason as bookmarks above: a
    // saved note's question stem should show no matter which exam is active.
    const idsParam = noteEntries
      .slice(0, 50)
      .map((n) => n.id)
      .join(",");
    authFetch(`/api/questions?ids=${idsParam}&examSource=all`)
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
    setLangState(l);
  }, []);

  const removeBookmark = useCallback(
    (id: number) => {
      const updated = bookmarkIds.filter((bId) => bId !== id);
      setBookmarkIds(updated);
      setBookmarkQuestions((prev) => prev.filter((q) => q.id !== id));
      if (userId) void setBookmark(userId, id, false).then(setBookmarkIds);
    },
    [bookmarkIds, userId],
  );

  const confirmLegacyBookmarkImport = useCallback(() => {
    if (!userId || legacyImportBusy) return;
    // UX-GLOBAL-14 / STU-56: confirmed in a ui/Dialog, never window.confirm.
    setBookmarkConfirmOpen(false);
    setLegacyImportBusy(true);
    setLegacyImportMessage("");
    void importLegacyBookmarks(userId)
      .then((count) => {
        setBookmarkIds(readCachedBookmarks(userId));
        setLegacyBookmarksAvailable(false);
        setLegacyImportMessage(count > 0
          ? (lang === "de" ? `${count} Lesezeichen importiert.` : `${count} bookmarks imported.`)
          : (lang === "de" ? "Keine neuen Lesezeichen zum Importieren." : "There were no new bookmarks to import."));
      })
      .catch(() => setLegacyImportMessage(lang === "de" ? "Import fehlgeschlagen. Bitte versuche es erneut." : "Import failed. Please try again."))
      .finally(() => setLegacyImportBusy(false));
  }, [userId, legacyImportBusy, lang]);

  const xpInfo = getLevelFromXP(totalXp);
  const rankTier = Math.min(8, Math.max(1, xpInfo.level)) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  const examQuestionTotal = coverageTopics.reduce((sum, topic) => sum + topic.total, 0);
  const uniqueAnswered = coverageTopics.reduce((sum, topic) => sum + topic.answered, 0);

  /* ─── Weak topics: the shared thresholds (UX-GLOBAL-06, ab 10 Fragen, unter 60 %) ─── */
  const weakTopics = topicStats.filter((ts) => {
    if (ts.answered < MIN_TOPIC_SAMPLE) return false;
    return Math.round((ts.correct / ts.answered) * 100) < PRACTICE_MORE_BELOW_PCT;
  });


  /* ─── Topic coverage rail - all 10 specialties, sorted ─── */
  const allTopics = coverageTopics.map(({ topic, total, answered, accuracy }) => {
    return {
      topic,
      total,
      answered,
      accuracy,
    };
  });
  const sortedAllTopics = [...allTopics].sort((a, b) => {
    if (sortBy === "accuracy") {
      const accA = a.accuracy / 100;
      const accB = b.accuracy / 100;
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
  const countdownLine = (() => {
    if (!examDate) return null;
    const now = new Date();
    const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return countdownCopy(daysBetween(todayISO, examDate), studyDate(examDate, lang, { day: "numeric", month: "long" }), lang);
  })();

  const isGenuinelyEmpty =
    !userId ||
    (totalAnswered === 0 && bookmarkIds.length === 0 && noteEntries.length === 0 && !legacyBookmarksAvailable);

  /* ─── Loading skeleton (also while a signed-out visitor is redirected) ─── */
  if (loading || !signedIn) {
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

  if (dataError && !hasStatsData) return <main className="min-h-screen px-4 py-12 bg-[var(--mp-surface-sunken)]"><DataRegion error retry={() => setReload(n => n + 1)} /></main>;


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
        <PartialTranslationNote />
        <DataRegion error={dataError} retry={() => setReload(n => n + 1)} />
        {/* Top bar */}
        <div className="px-4 lg:px-8 pt-4 pb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--mp-border-subtle)]">
          <Link
            href="/"
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            &larr; {t("back_home", lang)}
          </Link>
          <h1 className="ml-auto font-display text-base font-bold text-[var(--mp-fg)]">
            {t("progress", lang)}
          </h1>
          {/* a-header-375: as on /changelog, auto margins keep the one-line layout and let the controls wrap right-aligned. */}
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className={`${styles.page} px-4 lg:px-8 py-6 pb-28`}>
          {/* Page intro with the learner's own countdown (LX-09, same source as the plan) */}
          <div className="mb-6">
            <h2 className="font-display text-[28px] leading-tight font-extrabold text-[var(--mp-fg)]">
              {tsx("progress_title", lang)}
            </h2>
            <p className="text-sm text-[var(--mp-fg-muted)] mt-1" data-testid="progress-countdown">
              {countdownLine ?? (
                <Link href="/study-plan" className="inline-flex items-center min-h-11 font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2">
                  {tsx("progress_countdown_set", lang)}
                </Link>
              )}
            </p>
          </div>

          {coverageError && <div role="status" className="mp-card p-4 mb-5">
            <p>{tsx("progress_coverage_error", lang)}</p>
            <button className="mp-btn mp-btn--secondary mt-2 min-h-11" onClick={() => setCoverageRetry(n => n + 1)}>{tsx("weekly_retry", lang)}</button>
          </div>}

          {!isGenuinelyEmpty ? (
            <>
              {/* ═══ READINESS first (UX-STU-36) ═══ */}
              <div className={styles.sectionHead}>
                <h3>{t("exam_readiness", lang)}</h3>
                <div className="ln" />
              </div>
              <div className={`${styles.passbox} mb-4`}>
                <ReadinessSignal lang={lang} />
              </div>

              {/* ═══ KPI strip below readiness (UX-STU-07/36) ═══ */}
              <div className={`${styles.statStrip} mb-6`}>
                <div className={styles.stat}>
                  <div className={`${styles.sTop} ${styles.sTopBlue}`}>
                    <CheckCircle2 />
                    <span>{tsx("kpi_seen", lang)}</span>
                  </div>
                  <div className={styles.sVal}>{coverageError || coverageLoading ? "-" : studyNumber(uniqueAnswered, lang)}</div>
                  <div className={styles.sSub}>
                    {coverageError || coverageLoading ? tsx("kpi_unknown", lang) : tsx("kpi_seen_of", lang, { n: studyNumber(uniqueAnswered, lang), total: studyNumber(examQuestionTotal, lang) })}
                    <br />
                    {tsx("kpi_seen_sub", lang)}
                  </div>
                </div>
                <div className={styles.stat}>
                  <div className={`${styles.sTop} ${styles.sTopTeal}`}>
                    <TrendingUp />
                    <span>{tsx("kpi_accuracy", lang)}</span>
                  </div>
                  <div className={styles.sVal}>{totalAnswered > 0 ? studyPct(accuracy, lang) : "-"}</div>
                  <div className={styles.sSub}>{tsx("kpi_accuracy_sub", lang, { c: studyNumber(totalCorrect, lang), n: studyNumber(totalAnswered, lang) })}</div>
                </div>
                <div className={styles.stat}>
                  <div className={`${styles.sTop} ${styles.sTopBlue}`}>
                    <Layers />
                    <span>{tsx("kpi_answers", lang)}</span>
                  </div>
                  <div className={styles.sVal}>{studyNumber(totalAnswered, lang)}</div>
                  <div className={styles.sSub}>{tsx("kpi_answers_sub", lang)}</div>
                </div>
                <div className={styles.stat}>
                  <div className={`${styles.sTop} ${styles.sTopFire}`}>
                    <Flame />
                    <span>{tsx("kpi_streak", lang)}</span>
                  </div>
                  <div className={styles.sVal}>
                    {streak}
                    <small>{tsx(streak === 1 ? "kpi_day" : "kpi_days", lang)}</small>
                  </div>
                  <div className={styles.sSub}>
                    <AchievementRank tier={rankTier} variant="inline" size={12} aria-hidden /> {rankLabel(xpInfo.level, lang)}
                  </div>
                </div>
              </div>

              {/* ═══ SAVED: one line when empty (UX-STU-36/38), list otherwise ═══ */}
              <div className={styles.sectionHead}>
                <h3 id="saved">{tsx("saved_title", lang)}</h3>
                <div className="ln" />
              </div>
              {bookmarkIds.length === 0 && noteEntries.length === 0 && !legacyBookmarksAvailable ? (
                <p className="mp-card p-4 mb-6 text-[14px] text-[var(--mp-fg)] flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="saved-empty">
                  <span>{tsx("saved_empty", lang)}</span>
                  <Link href="/library" className="inline-flex items-center min-h-11 font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2">{tsx("saved_library", lang)}</Link>
                </p>
              ) : (
              <section className="mp-card p-5 mb-6 scroll-mt-24">
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
                    {tsx("saved_questions", lang)} ({bookmarkIds.length})
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
                    {tsx("saved_notes", lang)} ({noteEntries.length})
                  </button>
                </div>

                {savedTab === "bookmarks" && (
                  <div>
                    {userId && legacyBookmarksAvailable && (userRole === "admin" || userTier === "pro" || userTier === "admin") && (
                      <div className="rounded-xl border border-[var(--mp-status-warning)]/30 bg-[var(--mp-warning-bg)] p-4 mb-4">
                        <p className="text-sm font-semibold text-[var(--mp-fg)]">
                          {lang === "de" ? "Nicht zugeordnete Browser-Lesezeichen" : "Unassigned browser bookmarks"}
                        </p>
                        <p className="text-xs text-[var(--mp-fg-muted)] mt-1 mb-3">
                          {lang === "de"
                            ? "Diese älteren Lesezeichen gehören keinem Konto. Sie werden erst nach deiner Bestätigung diesem Konto hinzugefügt."
                            : "These older bookmarks are not linked to an account. They are added to this account only after you confirm."}
                        </p>
                        <Dialog
                          open={bookmarkConfirmOpen}
                          onOpenChange={setBookmarkConfirmOpen}
                          kind="confirm"
                          busy={legacyImportBusy}
                          title={t("progress_bookmark_import_title", lang)}
                          description={t("progress_bookmark_import_body", lang)}
                          footer={
                            <>
                              <button type="button" data-dialog-safe className="mp-btn mp-btn--secondary" onClick={() => setBookmarkConfirmOpen(false)}>{t("library_legacy_confirm_cancel", lang)}</button>
                              <button type="button" data-dialog-primary className="mp-btn mp-btn--primary" onClick={confirmLegacyBookmarkImport}>{t("progress_bookmark_import_ok", lang)}</button>
                            </>
                          }
                        />
                        <button type="button" className="mp-btn mp-btn--secondary" onClick={() => setBookmarkConfirmOpen(true)} disabled={legacyImportBusy}>
                          {legacyImportBusy
                            ? (lang === "de" ? "Import läuft …" : "Importing…")
                            : (lang === "de" ? "Ältere Lesezeichen prüfen und importieren" : "Review and import older bookmarks")}
                        </button>
                      </div>
                    )}
                    {legacyImportMessage && <p role="status" className="text-xs text-[var(--mp-fg-muted)] mb-3">{legacyImportMessage}</p>}
                    {bookmarksLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="w-6 h-6 border-2 border-[var(--mp-viridian)] border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : bookmarkIds.length === 0 ? (
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
                      /* Render off bookmarkIds (the localStorage truth that
                         drives the count), enriching with the fetched
                         question - mirrors the My-Notes path so the count and
                         the list can never disagree. A bookmark whose question
                         is still loading, deactivated, or otherwise unmatched
                         shows a minimal row (id + topic) rather than vanishing.
                         FEEDBACK #5. */
                      <div className="space-y-2">
                        {bookmarkIds
                          .slice(0, showAllBookmarks ? undefined : 20)
                          .map((id) => {
                            const q = bookmarkQuestions.find((bq) => bq.id === id);
                            const topic = q?.topic || "";
                            const config = getTopicConfig(topic);
                            const examSource = getStoredExamSource();
                            return (
                              <div
                                key={id}
                                className={`${styles.savedRow} group`}
                                style={{ ["--sc" as string]: config.color }}
                              >
                                <div className={styles.savedIc}>
                                  <TopicIcon name={config.icon} className="w-3 h-3" />
                                </div>
                                {q?.image_url && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={q.image_url}
                                    alt=""
                                    className="w-10 h-10 rounded object-cover flex-shrink-0 border border-[var(--mp-border-subtle)]"
                                  />
                                )}
                                <Link
                                  href={`/quiz?questionId=${id}&topic=${encodeURIComponent(topic)}&examSource=${examSource}`}
                                  className="flex-1 min-w-0"
                                >
                                  <p className="text-sm text-[var(--mp-fg)] line-clamp-2">
                                    {q
                                      ? `${q.question.slice(0, 120)}${q.question.length > 120 ? "..." : ""}`
                                      : lang === "de"
                                        ? `Frage #${id}`
                                        : `Question #${id}`}
                                  </p>
                                  {topic && (
                                    <p className="text-[12px] text-[var(--mp-fg-subtle)] mt-1 font-mono">
                                      {topic}
                                    </p>
                                  )}
                                </Link>
                                <button
                                  onClick={() => removeBookmark(id)}
                                  className="text-[var(--mp-status-warning)] hover:text-[var(--mp-error)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                  title={lang === "de" ? "Entfernen" : "Remove"}
                                >
                                  <Star className="w-4 h-4 fill-current" />
                                </button>
                              </div>
                            );
                          })}
                        {bookmarkIds.length > 20 && !showAllBookmarks && (
                          <button
                            onClick={() => setShowAllBookmarks(true)}
                            className="w-full text-center text-sm text-[var(--mp-viridian)] font-medium py-2 hover:underline"
                          >
                            {lang === "de"
                              ? `Alle ${bookmarkIds.length} anzeigen`
                              : `Show all ${bookmarkIds.length}`}
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
                                  <p className="text-[12px] text-[var(--mp-fg-subtle)] mt-1 font-mono">
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
              )}

              {/* ═══ NEXT STEP above the radar (UX-STU-35 A) ═══ */}
              <NextStepBlock weak={weakTopics} examSource={examSource} audience={tierLive.audience} lang={lang} />

              {/* ═══ RADAR with short names and a text list (UX-STU-37 A) ═══ */}
              <section className="mp-card p-5 mb-6">
                <h3 className={styles.cardH}>
                  <RadarIcon />
                  {tsx("radar_title", lang)}
                  <span className={`${styles.meta} ml-auto`}>
                    {tsx("radar_subjects", lang, { n: topicStats.filter((s) => s.answered > 0).length })}
                  </span>
                </h3>
                <div className={styles.radarWrap}>
                  <StudyRadar topics={topicStats} lang={lang} />
                </div>
              </section>

              {/* ═══ WEEKS (LX-09) ═══ */}
              <WeeklyProgressCard lang={lang} examSource={examSource} />

              {/* ═══ STATUS BY FIELD (CNT-42) ═══ */}
              <FieldReadinessCard lang={lang} examSource={examSource} />

              {/* ═══ MOCK EXAMS BY SUBJECT (INF-04, Pro) ═══ */}
              {canUse("history", tierLive.audience) && <MockTrendCard lang={lang} />}

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
                  {sortedAllTopics.map(({ topic, total, answered, accuracy }) => {
                    const config = getTopicConfig(topic);
                    const progressPct =
                      total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;
                    const acc = accuracy;
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
            </>
          ) : (
            <section className="mp-card p-8 text-center mt-2">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--mp-tint-teal)] mb-4">
                <TrendingUp className="w-8 h-8 text-[var(--mp-accent-teal)]" />
              </div>
              <h3 className="font-display text-lg font-bold text-[var(--mp-fg)] mb-2">{tsx("progress_empty_title", lang)}</h3>
              <p className="text-sm text-[var(--mp-fg-muted)] mb-5 max-w-md mx-auto leading-relaxed">{tsx("progress_empty_body", lang)}</p>
              <Link
                href={buildQuizHref({ examSource: examSource, practiceMode: "unseen", returnTo: "/progress" })}
                className="mp-btn mp-btn--success mp-btn--lg inline-flex"
              >
                <GraduationCap className="w-5 h-5" />
                {tsx("progress_empty_cta", lang)}
              </Link>
            </section>
          )}
        </div>
      </main>
    </AppLayout>
  );
}
