"use client";

import { useEffect, useState, useCallback } from "react";
import { BrandedLoader } from "@/components/Logo";
import { authFetch as fetch } from "@/lib/authFetch";
import { getTopicConfig } from "@/lib/topics";
import { getLevelFromXP } from "@/lib/xp";
import { t, getLang, setLang } from "@/lib/i18n";
import TopicIcon from "@/components/TopicIcon";
import { Flame, FileText as FileTextIcon, Lightbulb, Shuffle, PlayCircle, ClipboardList, Zap, CheckCircle, User, Inbox, ChevronRight, GraduationCap, Calendar, CalendarDays, BarChart3, Search, AlertTriangle, Star, AlertCircle } from "lucide-react";
import { isTelegramMiniApp, getMiniAppInitData, getStoredSession, storeSession } from "@/lib/auth";
import {
  getStoredExamSource,
  hasSelectedExam,
  setStoredExamSource,
  VIENNA_EXAM_PARTS,
  type ExamSourceId,
} from "@/lib/topics";
import LanguageToggle from "@/components/LanguageToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import TopicCard from "@/components/TopicCard";
import StatsCard from "@/components/StatsCard";
import GamificationHero from "@/components/GamificationHero";
import ExamSelector from "@/components/ExamSelector";
import ExamSwitcherInline from "@/components/ExamSwitcherInline";
import Onboarding from "@/components/Onboarding";
import SearchBar from "@/components/SearchBar";
import SearchResults from "@/components/SearchResults";
import SearchModal from "@/components/SearchModal";
import ThemeToggle from "@/components/ThemeToggle";
import { getWeakTopics, type TopicStats } from "@/lib/weakness";
import Link from "next/link";
import WhatsNewModal from "@/components/WhatsNewModal";
import SoftLaunchWelcomeModal from "@/components/SoftLaunchWelcomeModal";
import ReferralShareFloater from "@/components/ReferralShareFloater";
import UserSurveyModal from "@/components/UserSurveyModal";
import ResumeSessionCard from "@/components/ResumeSessionCard";
import { useToast } from "@/components/ui";

type Lang = "de" | "en";

interface User {
  id: string;
  telegram_id?: number;
  first_name: string;
  last_name?: string;
  xp_total: number;
  streak_count: number;
  daily_goal: number;
}

interface Gamification {
  total_xp: number;
  current_streak: number;
  total_questions_answered: number;
  total_correct: number;
  daily_questions_today: number;
}

interface TopicCount {
  topic: string;
  count: number;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe: Record<string, unknown>;
        ready: () => void;
        expand: () => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        themeParams: Record<string, string>;
      };
    };
  }
}

/** Floating weakness toast — appears top-right, auto-dismisses after 8s */
function WeaknessToast({ weakTopics, lang, examSource }: { weakTopics: TopicStats[]; lang: string; examSource: string }) {
  const [visible, setVisible] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (weakTopics.length === 0) return;
    const timer = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(timer);
  }, [weakTopics.length]);

  if (!visible || dismissed || weakTopics.length === 0) return null;
  const wt = weakTopics[0];
  const acc = Math.min(Math.round(wt.accuracy), 100);

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm animate-slide-up">
      <div className="card rounded-xl p-4 shadow-[var(--shadow-elevated)] border-l-4 border-l-[var(--mp-status-warning)] bg-white">
        <div className="flex items-start gap-3">
          <Lightbulb className="w-5 h-5 text-[var(--mp-status-warning)] flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--mp-fg)] mb-0.5">
              {lang === "de" ? `${wt.topic} verbessern` : `Improve ${wt.topic}`}
            </p>
            <p className="text-xs text-[var(--mp-fg-subtle)]">
              {lang === "de" ? `${acc}% Genauigkeit — jetzt üben?` : `${acc}% accuracy — practice now?`}
            </p>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] transition-colors flex-shrink-0"
          >
            <span className="text-lg leading-none">&times;</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [gam, setGam] = useState<Gamification | null>(null);
  const [topics, setTopics] = useState<TopicCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lang, setLangState] = useState<Lang>("de");
  const [examSource, setExamSource] = useState<ExamSourceId>("kenntnispruefung");
  const [showExamSelector, setShowExamSelector] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [weakTopics, setWeakTopics] = useState<TopicStats[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileData, setProfileData] = useState<{ targetDate?: string } | null>(null);
  const [lastSessionInfo, setLastSessionInfo] = useState<{ totalXpSession: number; questionCount: number } | null>(null);
  // Initialize synchronously on first render: if the URL already carries
  // `?tg_token=...`, we're in the middle of a Telegram bot deep-link
  // exchange. Setting the flag NOW (not in a useEffect, which runs AFTER
  // first paint) prevents the early-return "redirect to /landing" branch
  // from firing before the exchange useEffect can claim the token.
  // Fixes C-3 Telegram deep-link race (was: commit `86caf6b` — unverified).
  const [processingTgToken, setProcessingTgToken] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return new URLSearchParams(window.location.search).has("tg_token");
    } catch {
      return false;
    }
  });
  const [showCohortConfetti, setShowCohortConfetti] = useState(false);
  const toast = useToast();

  // Juni-26-Kohorte post-checkout greeting — fires when the NOWPayments
  // success redirect lands on /?welcome=cohort (or the legacy
  // /?welcome=founder alias that older invoices may still carry).
  // Shows a one-time toast + pure-CSS confetti burst, then cleans the
  // URL so the greeting does NOT replay on refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const welcome = url.searchParams.get("welcome");
    if (welcome !== "cohort" && welcome !== "founder") return;

    // Small delay so the ToastProvider is mounted (layout wraps us).
    const timer = setTimeout(() => {
      const lng = getLang();
      toast.success(
        lng === "de"
          ? "Willkommen in der Juni-26-Kohorte!"
          : "Welcome to the June 26 Cohort!",
        lng === "de"
          ? "Dein Vollzugang ist 6 Monate lang aktiv — inkl. Pass-Until-You-Pass. Viel Erfolg bei der Prüfung!"
          : "Your full access is active for 6 months — with Pass-Until-You-Pass. Good luck with the exam!"
      );
      setShowCohortConfetti(true);
      // Clean the URL so refresh doesn't retrigger.
      url.searchParams.delete("welcome");
      window.history.replaceState({}, "", url.pathname + url.search);
      // Remove confetti from the DOM once the animation finishes.
      setTimeout(() => setShowCohortConfetti(false), 3000);
    }, 200);

    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setLangState(getLang());
    const src = getStoredExamSource();
    setExamSource(src);
    // Onboarding only shows AFTER login, not before (non-logged-in users go to /landing)
    // Checked after authenticate() resolves — see below
  }, []);

  // Bot deep-link login: if URL carries ?tg_token=..., exchange it for a session.
  // This runs BEFORE the redirect-to-landing check so we don't lose the token.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const tgToken = url.searchParams.get("tg_token");
    if (!tgToken) return;
    setProcessingTgToken(true);
    (async () => {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenExchange: tgToken }),
        });
        if (res.ok) {
          const data = await res.json();
          storeSession({ user: data.user, gamification: data.gamification });
          // Remove the one-time token from the URL so a refresh can't replay it.
          url.searchParams.delete("tg_token");
          window.history.replaceState({}, "", url.toString());
          // Reload so the rest of the app picks up the new session.
          window.location.reload();
        } else {
          // Clear the bad token from the URL and fall through to normal flow
          url.searchParams.delete("tg_token");
          window.history.replaceState({}, "", url.toString());
          setProcessingTgToken(false);
        }
      } catch {
        setProcessingTgToken(false);
      }
    })();
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const fetchTopics = useCallback(async (src: ExamSourceId) => {
    const res = await fetch("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "topics", examSource: src }),
    });
    const data = await res.json();
    setTopics(data);
  }, []);

  const authenticate = useCallback(async () => {
    try {
      const isMiniApp = isTelegramMiniApp();
      const tg = window.Telegram?.WebApp;

      if (isMiniApp && tg) {
        tg.ready();
        tg.expand();
        tg.setHeaderColor("#F7F9FC");
        tg.setBackgroundColor("#F7F9FC");
      }

      const src = getStoredExamSource();
      setExamSource(src);
      await fetchTopics(src);

      if (isMiniApp) {
        const initData = getMiniAppInitData();
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });
        if (!res.ok) {
          setError("demo");
          setLoading(false);
          return;
        }
        const data = await res.json();
        setUser(data.user);
        setGam(data.gamification);
        // Mini App: auto-select exam if not set
        if (!hasSelectedExam()) {
          setStoredExamSource("kenntnispruefung");
          setExamSource("kenntnispruefung");
        }
      } else {
        const stored = getStoredSession();
        if (stored) {
          setUser(stored.user);
          setGam(stored.gamification);
          // Show onboarding ONLY for logged-in users who haven't completed it
          try {
            const onboardingData = localStorage.getItem("medpruef_onboarding");
            const parsed = onboardingData ? JSON.parse(onboardingData) : null;
            if (!parsed?.completedAt) {
              setShowOnboarding(true);
            }
          } catch {}
        } else {
          setError("demo");
        }
      }
    } catch (e) {
      console.error(e);
      setError("demo");
    } finally {
      setLoading(false);
    }
  }, [fetchTopics]);

  useEffect(() => {
    authenticate();
  }, [authenticate]);

  // Refresh gamification data when returning from a quiz (page becomes visible again)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && user?.id && !user.id.startsWith('guest_')) {
        fetch(`/api/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emailLogin: { email: '', password: '' } }), // dummy — we just need to re-fetch
        }).catch(() => {}); // non-critical
        // Simpler: just re-read the stored session (which the answer API updates)
        const stored = getStoredSession();
        if (stored?.gamification) setGam(stored.gamification);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user?.id]);

  // Fetch server-side per-topic progress once user and examSource are known
  const [topicProgress, setTopicProgress] = useState<Record<string, { answered: number; correct: number; wrong: number; accuracy: number }>>({});
  useEffect(() => {
    if (!user?.id || user.id.startsWith('guest_')) {
      // For guests, fall back to localStorage weakness detection
      setWeakTopics(getWeakTopics());
      return;
    }
    fetch(`/api/user/topic-progress?userId=${user.id}&examType=${examSource}`)
      .then(r => r.json())
      .then((data: Array<{ topic: string; answered: number; correct: number; wrong: number; accuracy: number }>) => {
        const map: typeof topicProgress = {};
        const weak: TopicStats[] = [];
        for (const tp of data) {
          map[tp.topic] = { answered: tp.answered, correct: tp.correct, wrong: tp.wrong, accuracy: tp.accuracy };
          if (tp.answered > 0) {
            weak.push({ topic: tp.topic, correct: tp.correct, total: tp.answered, accuracy: tp.accuracy });
          }
        }
        setTopicProgress(map);
        setWeakTopics(weak.filter(w => w.accuracy < 80).sort((a, b) => a.accuracy - b.accuracy));
      })
      .catch(() => {
        setWeakTopics(getWeakTopics());
      });
  }, [user?.id, examSource]);

  // Load profile data (exam target date) from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("medpruef_onboarding");
      if (raw) {
        const parsed = JSON.parse(raw);
        setProfileData({ targetDate: parsed?.examDate });
      }
    } catch {}
  }, []);

  // Load last session info from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("medpruef_quiz_autosave") || "null");
      if (saved && Date.now() - saved.timestamp < 86400000) {
        setLastSessionInfo({ totalXpSession: saved.totalXpSession || 0, questionCount: saved.questionCount || 0 });
      }
    } catch { /* empty */ }
  }, []);

  // Cmd+K / Ctrl+K to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        // Focus after DOM updates
        setTimeout(() => {
          const searchInput = document.querySelector('input[placeholder*="such"], input[placeholder*="Search"]') as HTMLInputElement;
          if (searchInput) searchInput.focus();
        }, 100);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleExamSelected = useCallback(
    async (id: ExamSourceId) => {
      setExamSource(id);
      setShowExamSelector(false);
      setLoading(true);
      await fetchTopics(id);
      setLoading(false);
    },
    [fetchTopics]
  );

  const handleSearch = useCallback(
    async (query: string) => {
      setSearchQuery(query);
      if (!query) {
        setSearchResults([]);
        return;
      }
      setSearchLoading(true);
      try {
        const params = new URLSearchParams({ search: query, examSource, limit: "20" });
        const res = await fetch(`/api/questions?${params}`);
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    },
    [examSource]
  );

  if (loading && !showExamSelector) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)]">
        <BrandedLoader size="lg" />
      </div>
    );
  }

  if (showOnboarding) {
    return <Onboarding lang={lang} onComplete={(data) => {
      setShowOnboarding(false);
      setStoredExamSource(data.examSource as ExamSourceId);
      setExamSource(data.examSource as ExamSourceId);
      fetchTopics(data.examSource as ExamSourceId);
    }} />;
  }

  if (showExamSelector) {
    return <ExamSelector lang={lang} onSelect={handleExamSelected} />;
  }

  // If we're processing a Telegram bot token, show loader instead of redirecting
  if (processingTgToken) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)] gap-4">
        <BrandedLoader size="lg" />
        <p className="text-sm text-[var(--mp-fg-muted)]">
          {lang === "de" ? "Anmeldung läuft..." : "Signing in..."}
        </p>
      </div>
    );
  }

  // Non-logged-in users → always redirect to /landing (no demo home)
  if ((error === "demo" || !user) && typeof window !== "undefined") {
    // Don't redirect if there's still a tg_token in the URL (race condition protection)
    const hasToken = new URLSearchParams(window.location.search).get("tg_token");
    if (!isTelegramMiniApp() && !hasToken) {
      window.location.href = "/landing";
      return (
        <div className="flex items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)]">
          <BrandedLoader />
        </div>
      );
    }
  }

  // Fallback for Telegram Mini App without auth
  if (error === "demo" || !user) {
    return (
      <DemoHome
        topics={topics}
        lang={lang}
        examSource={examSource}
        onLangChange={switchLang}
        onChangeExam={() => setShowExamSelector(true)}
      />
    );
  }

  const xpInfo = getLevelFromXP(gam?.total_xp || 0);
  const accuracy =
    gam && gam.total_questions_answered > 0
      ? Math.round((gam.total_correct / gam.total_questions_answered) * 100)
      : 0;

  return (
    <div className="app-layout">
      <Sidebar
        lang={lang}
        userId={user.id}
        userName={user.first_name}
        totalXp={gam?.total_xp || 0}
        streak={gam?.current_streak || 0}
        accuracy={accuracy}
      />

      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        {/* Mobile Header */}
        <div className="lg:hidden px-4 pt-4 pb-2 border-b border-[var(--mp-border)]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-9 h-9 rounded bg-[var(--mp-viridian)]/15 border border-[var(--mp-viridian)]/30 flex items-center justify-center text-sm font-bold text-[var(--mp-viridian)] flex-shrink-0">
                {user.first_name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-bold text-[var(--mp-fg)] truncate">
                  {t("hello", lang)}, {user.first_name}
                </h1>
                <p className="text-xs text-[var(--mp-fg-subtle)]">
                  {xpInfo.rank} · {t("level", lang)}{" "}
                  <span className="font-mono">{xpInfo.level}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <ExamSwitcherInline variant="compact" />
              <ThemeToggle />
              <LanguageToggle lang={lang} onChange={switchLang} />
            </div>
          </div>
        </div>

        {/* Desktop Header Bar */}
        <div className="hidden lg:flex px-8 pt-6 pb-3 items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--mp-fg)]">
              {t("hello", lang)}, {user.first_name}
            </h1>
            <p className="text-sm text-[var(--mp-fg-subtle)]">{t("exam_prep", lang)}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Exam switcher is in the sidebar on desktop — no need here.
                Search + theme + language toggles remain. */}
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-[var(--mp-border)]/50 text-[var(--mp-fg-subtle)] transition-colors"
              title="Search (Cmd+K)"
            >
              <Search className="w-[18px] h-[18px]" />
            </button>
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className="px-6 lg:px-10 py-4">
          {/*
            HOME LAYOUT (Home-A clinical minimal + Gamification-B hero).

            The old "Hero Progress Banner" (Oxford→CTA gradient with
            pass-probability + rotating social-proof pills) was removed
            2026-04-19 — it was redundant with <GamificationHero/> below.
            The unique signals it carried:
              • pass probability → moved to /progress (where users look
                for analytics)
              • social-proof rotations → not brand-appropriate for a
                clinical tool, dropped
              • exam countdown → already rendered next to the gamification
                hero as a dedicated countdown card when exam_date is set
            Net effect: one banner at the top, less visual clutter.
          */}

          {/* Last session badge — slim, above the hero */}
          {lastSessionInfo && (
            <div className="text-center mb-3">
              <span className="inline-flex items-center gap-2 text-xs text-[var(--mp-fg-subtle)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded-full px-3 py-1">
                {lang === "de" ? "Letzte Sitzung" : "Last session"}: <span className="font-semibold text-[var(--mp-viridian)]">+{lastSessionInfo.totalXpSession} XP</span> · {lastSessionInfo.questionCount} {lang === "de" ? "Fragen" : "questions"}
              </span>
            </div>
          )}

          {/* Merged gamification hero (Gamification-B): streak + XP + daily goal + rank in one card. */}
          {(() => {
            const target = profileData?.targetDate;
            const daysLeft = target ? Math.ceil((new Date(target).getTime() - Date.now()) / 86400000) : null;
            const showCountdown = daysLeft !== null && daysLeft > 0;
            return (
              <div className={`grid grid-cols-1 ${showCountdown ? "md:grid-cols-2" : ""} gap-6 mb-10`}>
                <GamificationHero
                  streak={gam?.current_streak || 0}
                  totalXp={gam?.total_xp || 0}
                  dailyCurrent={gam?.daily_questions_today || 0}
                  dailyGoal={user.daily_goal || 20}
                  lang={lang}
                />
                {showCountdown && (() => {
                  const urgency = daysLeft <= 14 ? "#D64545" : daysLeft <= 30 ? "#D68A3A" : "#007B5F";
                  return (
                    <div className="card rounded-2xl p-6 flex flex-col items-center justify-center text-center">
                      <p className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: urgency }}>
                        {t("exam_countdown", lang)}
                      </p>
                      <p className="text-5xl font-bold font-display" style={{ color: urgency }}>
                        {daysLeft}
                      </p>
                      <p className="text-sm text-[var(--mp-fg-muted)] mt-1">{t("days_until_exam", lang)}</p>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

          {/* Resume where you left off — addresses Abobaker's feedback */}
          {!user.id.startsWith("guest_") && <ResumeSessionCard userId={user.id} lang={lang} />}

          {/* Weakest Subject — urgency block */}
          {weakTopics.length > 0 && (
            <div className="bg-[var(--mp-warning-bg)] border border-[var(--mp-status-warning)]/25 border-l-4 border-l-[var(--mp-status-warning)] rounded-2xl p-6 mb-10">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-bold text-[var(--mp-fg)] mb-1 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-[var(--mp-status-warning)]" />
                    {lang === "de" ? "Smarte Empfehlung" : "Smart Recommendation"}
                  </p>
                  <p className="text-sm text-[var(--mp-fg-muted)]">
                    {lang === "de"
                      ? `${weakTopics[0]?.topic} verbessern — steigert deine Punktzahl um +${Math.min(Math.round(100 / (weakTopics.length + 1)), 15)}%`
                      : `Improving ${weakTopics[0]?.topic} increases your score by +${Math.min(Math.round(100 / (weakTopics.length + 1)), 15)}%`}
                  </p>
                </div>
                <Link
                  href={`/quiz?topic=${encodeURIComponent(weakTopics[0]?.topic || 'random')}&userId=${user.id}&examSource=${examSource}&autoStart=1`}
                  className="btn-primary text-sm px-5 py-2.5 shrink-0 font-bold"
                >
                  {lang === "de" ? "Jetzt verbessern" : "Fix now"}
                </Link>
              </div>
            </div>
          )}

          {/* Lernplan CTA — personalized study plan */}
          <Link
            href="/study-plan"
            className="card-interactive rounded-2xl p-5 mb-6 flex items-center gap-4 group"
          >
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--mp-viridian)] to-[var(--mp-cta-blue)] flex items-center justify-center flex-shrink-0 shadow-sm">
              <CalendarDays className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[var(--mp-fg)] flex items-center gap-2">
                {lang === "de" ? "Dein Lernplan" : "Your Study Plan"}
                {profileData?.targetDate && !isNaN(new Date(profileData.targetDate).getTime()) && (() => {
                  const days = Math.ceil((new Date(profileData.targetDate).getTime() - Date.now()) / 86400000);
                  return days > 0 ? (
                    <span className="inline-flex items-center gap-1 bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {lang === "de" ? `${days} Tage` : `${days} days`}
                    </span>
                  ) : null;
                })()}
              </p>
              <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
                {lang === "de"
                  ? "Tagesplan bis zur Prüfung ansehen"
                  : "See your day-by-day plan to the exam"}
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-[var(--mp-fg-subtle)] group-hover:text-[var(--mp-viridian)] group-hover:translate-x-0.5 transition-all flex-shrink-0" />
          </Link>

          {/* Quick Actions — 3-column grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
            {/* Primary: Continue */}
            <Link
              href={weakTopics.length > 0
                ? `/quiz?topic=${encodeURIComponent(weakTopics[0]?.topic || 'random')}&userId=${user.id}&examSource=${examSource}&autoStart=1`
                : topics.length > 0
                  ? `/quiz?topic=${encodeURIComponent(topics[0].topic)}&userId=${user.id}&examSource=${examSource}&autoStart=1`
                  : "#"}
              className="btn-primary flex items-center justify-center gap-2.5 py-4 text-base rounded-2xl shadow-md active:scale-[0.98] transition-transform"
            >
              <PlayCircle className="w-5 h-5" />
              {weakTopics.length > 0
                ? (lang === "de" ? "Weiterlernen" : "Continue")
                : t("continue_where_left", lang)}
            </Link>

            {/* Random Quiz */}
            <Link
              href={`/quiz?topic=random&userId=${user.id}&examSource=${examSource}`}
              className="btn-secondary flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm"
            >
              <Shuffle className="w-4 h-4 text-[var(--mp-viridian)]" />
              {t("random_quiz", lang)}
            </Link>

            {/* Mock Exam */}
            <Link
              href={`/exam?examSource=${examSource}`}
              className="btn-secondary flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm"
            >
              <GraduationCap className="w-4 h-4 text-[var(--mp-status-warning)]" />
              {lang === "de" ? "Probeprüfung" : "Mock Exam"}
            </Link>
          </div>

          {/* Quick review modes — bookmarks + wrong answers */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <Link
              href={`/progress?tab=bookmarks`}
              className="card-interactive rounded-xl p-4 flex items-center gap-3 group"
            >
              <Star className="w-5 h-5 text-[var(--mp-status-warning)]" />
              <div>
                <p className="text-sm font-medium text-[var(--mp-fg)]">
                  {lang === "de" ? "Lesezeichen" : "Bookmarks"}
                </p>
                <p className="text-[11px] text-[var(--mp-fg-subtle)]">
                  {lang === "de" ? "Gespeicherte Fragen üben" : "Practice saved questions"}
                </p>
              </div>
            </Link>
            <Link
              href={`/quiz?topic=random&userId=${user.id}&examSource=${examSource}&practiceMode=wrong&autoStart=1`}
              className="card-interactive rounded-xl p-4 flex items-center gap-3 group"
            >
              <AlertCircle className="w-5 h-5 text-[var(--mp-error)]" />
              <div>
                <p className="text-sm font-medium text-[var(--mp-fg)]">
                  {lang === "de" ? "Fehler wiederholen" : "Review Mistakes"}
                </p>
                <p className="text-[11px] text-[var(--mp-fg-subtle)]">
                  {lang === "de" ? "Falsch beantwortete Fragen" : "Questions you got wrong"}
                </p>
              </div>
            </Link>
          </div>

          {/* Search — mobile inline bar opens modal, desktop uses icon */}
          <div className="mb-10 lg:hidden">
            <button
              onClick={() => setSearchOpen(true)}
              className="w-full card rounded-2xl p-3.5 flex items-center gap-3 text-[var(--mp-fg-subtle)] hover:border-[var(--mp-viridian)]/30 transition-colors"
            >
              <Search className="w-5 h-5" />
              <span className="text-sm">{lang === "de" ? "Frage suchen..." : "Search questions..."}</span>
              <kbd className="ml-auto text-[10px] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded px-1.5 py-0.5 font-mono">⌘K</kbd>
            </button>
          </div>

          {/* Search Modal */}
          <SearchModal
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            lang={lang}
            examSource={examSource}
            userId={user.id}
          />

          {/* Topics Grid */}
          {(
            <div className="mb-10">
              <h2 className="text-lg font-bold mb-4 text-[var(--mp-fg)] border-l-[3px] border-l-[var(--mp-viridian)] pl-3">
                {t("specialties", lang)} <span className="text-sm font-normal text-[var(--mp-fg-subtle)] ml-1">({topics.length})</span>
              </h2>

              {examSource === "kenntnispruefung" ? (
                <>
                  {/* SIP quick-start buttons */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <Link
                      href={`/exam?examSource=kenntnispruefung&part=sip4`}
                      className="card-interactive rounded-2xl p-4 flex items-center justify-between text-sm transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <ClipboardList className="w-4 h-4 flex-shrink-0 text-[var(--mp-status-warning)]" />
                        <span className="truncate font-medium">{t("practice_sip4", lang)}</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[var(--mp-fg-subtle)]" />
                    </Link>
                    <Link
                      href={`/exam?examSource=kenntnispruefung&part=sip5`}
                      className="card-interactive rounded-2xl p-4 flex items-center justify-between text-sm transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <ClipboardList className="w-4 h-4 flex-shrink-0 text-[var(--mp-viridian)]" />
                        <span className="truncate font-medium">{t("practice_sip5", lang)}</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[var(--mp-fg-subtle)]" />
                    </Link>
                  </div>

                  {/* SIP 4 section */}
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--mp-status-warning)] mb-3 border-l-[3px] border-l-[var(--mp-status-warning)] pl-3">
                    {t("sip4_label", lang)}
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-6 mb-10 stagger">
                    {topics
                      .filter((tp) => VIENNA_EXAM_PARTS.sip4.includes(tp.topic))
                      .map((tp, i) => (
                        <TopicCard
                          key={tp.topic}
                          topic={tp.topic}
                          count={tp.count}
                          userId={user.id}
                          lang={lang}
                          delay={i * 50}
                          examSource={examSource}
                          accuracy={topicProgress[tp.topic]?.accuracy}
                          answered={topicProgress[tp.topic]?.answered}
                        />
                      ))}
                  </div>

                  {/* SIP 5 section */}
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--mp-viridian)] mb-3 border-l-[3px] border-l-[var(--mp-viridian)] pl-3">
                    {t("sip5_label", lang)}
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-6 stagger">
                    {topics
                      .filter((tp) => VIENNA_EXAM_PARTS.sip5.includes(tp.topic))
                      .map((tp, i) => (
                        <TopicCard
                          key={tp.topic}
                          topic={tp.topic}
                          count={tp.count}
                          userId={user.id}
                          lang={lang}
                          delay={i * 50}
                          examSource={examSource}
                          accuracy={topicProgress[tp.topic]?.accuracy}
                          answered={topicProgress[tp.topic]?.answered}
                        />
                      ))}
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4 stagger">
                  {topics.map((tp, i) => (
                    <TopicCard
                      key={tp.topic}
                      topic={tp.topic}
                      count={tp.count}
                      userId={user.id}
                      lang={lang}
                      delay={i * 50}
                      examSource={examSource}
                      accuracy={weakTopics.find(w => w.topic === tp.topic)?.accuracy}
                      answered={weakTopics.find(w => w.topic === tp.topic)?.total}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* View Progress Link */}
          <Link href="/progress" className="card rounded-2xl p-4 flex items-center justify-between hover:shadow-[var(--shadow-card-hover)] transition-all">
            <span className="text-sm font-medium text-[var(--mp-viridian)]">
              {lang === "de" ? "Fortschritt ansehen" : "View Full Progress"}
            </span>
            <ChevronRight className="w-5 h-5 text-[var(--mp-fg-subtle)]" />
          </Link>

          {/* Mini Stats Row (mobile only — 2x2 grid) */}
          <div className="grid grid-cols-2 gap-3 lg:hidden mb-10 mt-4 stagger">
            <div className="card rounded-xl">
              <StatsCard icon={<Zap className="w-4 h-4" />} value={gam?.total_xp || 0} label="XP" color="text-[var(--mp-status-warning)]" delay={0} />
            </div>
            <div className="card rounded-xl">
              <StatsCard icon={<Flame className="w-4 h-4" />} value={gam?.current_streak || 0} label={t("streak", lang)} color="text-[var(--mp-error)]" delay={50} />
            </div>
            <div className="card rounded-xl">
              <StatsCard icon={<CheckCircle className="w-4 h-4" />} value={`${accuracy}%`} label={t("accuracy", lang)} color="text-[var(--mp-accent-teal)]" delay={100} />
            </div>
            <div className="card rounded-xl">
              <StatsCard icon={<FileTextIcon className="w-4 h-4" />} value={gam?.total_questions_answered || 0} label={t("answered", lang)} color="text-[var(--mp-viridian)]" delay={150} />
            </div>
          </div>
        </div>
      </main>


      {/* Weakness toast — floating top-right, auto-dismiss */}
      <WhatsNewModal />
      <SoftLaunchWelcomeModal />
      <UserSurveyModal />
      <ReferralShareFloater />
      <WeaknessToast weakTopics={weakTopics} lang={lang} examSource={examSource} />
      {showCohortConfetti && <CohortConfetti />}

      <BottomNav lang={lang} userId={user.id} />
    </div>
  );
}

/**
 * Pure-CSS confetti burst for the Juni-26-Kohorte welcome handshake.
 * Same animation pattern as UserSurveyModal's step-4 celebration —
 * no new npm deps, scoped <style> tag, auto-cleans after 3s.
 */
function CohortConfetti() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center"
      aria-hidden
    >
      <div className="relative">
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            key={i}
            className="absolute w-2 h-2 rounded-full"
            style={{
              backgroundColor: [
                "#007B5F",
                "#00A896",
                "#003A8C",
                "#D68A3A",
                "#D64545",
              ][i % 5],
              top: 0,
              left: 0,
              animation: `cohort-confetti-burst 2.4s cubic-bezier(0.22, 1, 0.36, 1) ${i * 0.03}s forwards`,
              opacity: 0,
              transform: `rotate(${(i * 15) % 360}deg) translateY(0)`,
            }}
          />
        ))}
      </div>
      <style
        dangerouslySetInnerHTML={{
          __html: `
          @keyframes cohort-confetti-burst {
            0%   { opacity: 1; transform: rotate(var(--r, 0deg)) translateY(0) scale(1); }
            70%  { opacity: 0.9; }
            100% { opacity: 0; transform: rotate(var(--r, 0deg)) translateY(-220px) scale(0.4); }
          }
          @media (prefers-reduced-motion: reduce) {
            [class*="cohort-confetti"] { animation: none !important; opacity: 0 !important; }
          }
        `,
        }}
      />
    </div>
  );
}

/* ============================================
   DEMO HOME — not authenticated / web browser
   ============================================ */
function DemoHome({
  topics,
  lang,
  examSource,
  onLangChange,
  onChangeExam,
}: {
  topics: TopicCount[];
  lang: Lang;
  examSource: ExamSourceId;
  onLangChange: (l: Lang) => void;
  onChangeExam: () => void;
}) {
  const totalQuestions = topics.reduce((sum, tp) => sum + tp.count, 0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const handleDemoSearch = useCallback(
    async (query: string) => {
      setSearchQuery(query);
      if (!query) { setSearchResults([]); return; }
      setSearchLoading(true);
      try {
        const params = new URLSearchParams({ search: query, examSource, limit: "20" });
        const res = await fetch(`/api/questions?${params}`);
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    },
    [examSource]
  );

  // Widget-based Telegram login was removed Apr 10 (only bot deep-
  // link remains). Dead code removed 2026-04-15.

  const handleGuestContinue = () => {
    const guestId = `guest_${Date.now()}`;
    const session = {
      user: {
        id: guestId,
        telegram_id: 0,
        first_name: lang === "de" ? "Gast" : "Guest",
        xp_total: 0,
        streak_count: 0,
        daily_goal: 20,
      },
      gamification: {
        total_xp: 0,
        current_streak: 0,
        total_questions_answered: 0,
        total_correct: 0,
        daily_questions_today: 0,
      },
    };
    storeSession(session);
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)] safe-area-top safe-area-bottom">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--mp-viridian)]/[0.03] to-transparent pointer-events-none" />
        <div className="relative px-4 pt-8 pb-6 text-center max-w-2xl mx-auto">
          <div className="flex justify-end mb-6 gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={onLangChange} />
          </div>

          <div className="w-16 h-16 rounded border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/10 flex items-center justify-center text-3xl mx-auto mb-4">
            <img src="/brand/logomark.svg" alt="MedPrüf" className="w-12 h-12" />
          </div>
          <img src="/brand/wordmark-twotone.png" alt="MedPrüf" className="h-10 mx-auto" />
          <p className="text-[var(--mp-fg-muted)] text-base mb-1">{t("exam_prep", lang)}</p>
          <p className="text-[var(--mp-fg-subtle)] text-sm">{t("demo_description", lang)}</p>

          {/* Stats bar */}
          <div className="flex items-center justify-center gap-6 mt-5">
            <div className="text-center">
              <p className="text-2xl font-bold text-[var(--mp-viridian)] font-mono">
                {totalQuestions > 0 ? totalQuestions.toLocaleString("de-DE") : "7.042"}
              </p>
              <p className="text-xs text-[var(--mp-fg-subtle)]">{t("questions", lang)}</p>
            </div>
            <div className="w-px h-8 bg-[var(--mp-border)]" />
            <div className="text-center">
              <p className="text-2xl font-bold text-[var(--mp-status-warning)] font-mono">{topics.length || "10"}</p>
              <p className="text-xs text-[var(--mp-fg-subtle)]">{t("topics", lang)}</p>
            </div>
            <div className="w-px h-8 bg-[var(--mp-border)]" />
            {/* Exam badge — clickable to change */}
            <button onClick={onChangeExam} className="text-center group">
              <p className="text-lg font-bold text-[var(--mp-status-warning)] font-mono group-hover:text-[#FFD080] transition-colors">
                {examSource}
              </p>
              <p className="text-xs text-[var(--mp-fg-subtle)] group-hover:text-[var(--mp-fg-muted)] transition-colors">
                {lang === "de" ? "Prüfung" : "Exam"}
              </p>
            </button>
          </div>

          {/* Primary CTA */}
          <div className="mt-6">
            <Link
              href={`/quiz?topic=random&examSource=${examSource}`}
              className="btn-primary inline-flex items-center gap-3 px-7 py-3.5 text-base shadow-md pulse-glow active:scale-[0.98]"
            >
              <Shuffle className="w-5 h-5" />
              {lang === "de" ? "Übung starten" : "Start Practice"}
            </Link>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-6 pb-6 max-w-4xl mx-auto">
        <SearchBar lang={lang} onSearch={handleDemoSearch} />
        {searchQuery && (
          <SearchResults
            results={searchResults as unknown as Parameters<typeof SearchResults>[0]["results"]}
            query={searchQuery}
            loading={searchLoading}
            lang={lang}
            examSource={examSource}
          />
        )}
      </div>

      {/* Topics — hidden while searching */}
      {topics.length > 0 && !searchQuery && (
        <div className="px-6 pb-10 max-w-4xl mx-auto">
          <h2 className="text-lg font-bold mb-4 text-[var(--mp-fg)] border-l-[3px] border-l-[var(--mp-viridian)] pl-3">{t("practice_topics", lang)}</h2>

          {examSource === "kenntnispruefung" ? (
            <>
              {/* SIP quick-start buttons */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Link
                  href={`/exam?examSource=kenntnispruefung&part=sip4`}
                  className="btn-secondary flex items-center gap-2 rounded-xl px-4 py-3 text-sm transition-all hover:shadow-md"
                >
                  <ClipboardList className="w-4 h-4 flex-shrink-0 text-[var(--mp-status-warning)]" />
                  <span className="truncate">{t("practice_sip4", lang)}</span>
                </Link>
                <Link
                  href={`/exam?examSource=kenntnispruefung&part=sip5`}
                  className="btn-secondary flex items-center gap-2 rounded-xl px-4 py-3 text-sm transition-all hover:shadow-md"
                >
                  <ClipboardList className="w-4 h-4 flex-shrink-0 text-[var(--mp-viridian)]" />
                  <span className="truncate">{t("practice_sip5", lang)}</span>
                </Link>
              </div>

              {/* SIP 4 group */}
              <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--mp-status-warning)] mb-3 border-l-[3px] border-l-[var(--mp-status-warning)] pl-3">
                {t("sip4_label", lang)}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-10 stagger">
                {topics.filter((tp) => VIENNA_EXAM_PARTS.sip4.includes(tp.topic)).map((tp, i) => {
                  const config = getTopicConfig(tp.topic);
                  return (
                    <Link
                      key={tp.topic}
                      href={`/quiz?topic=${encodeURIComponent(tp.topic)}&examSource=${examSource}`}
                      className="card-interactive rounded-2xl p-6 active:scale-[0.98] group"
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      <TopicIcon name={config.icon} className="w-7 h-7 mb-3 transition-transform duration-200 group-hover:scale-110" style={{ color: config.color }} />
                      <div className="text-[15px] font-semibold leading-snug mb-1 text-[var(--mp-fg)] line-clamp-2 min-h-[2.5rem]" title={tp.topic}>{tp.topic}</div>
                      <div className="text-xs text-[var(--mp-fg-subtle)] font-mono">{tp.count.toLocaleString("de-DE")} {t("questions", lang)}</div>
                    </Link>
                  );
                })}
              </div>

              {/* SIP 5 group */}
              <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--mp-viridian)] mb-3 border-l-[3px] border-l-[var(--mp-viridian)] pl-3">
                {t("sip5_label", lang)}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 stagger">
                {topics.filter((tp) => VIENNA_EXAM_PARTS.sip5.includes(tp.topic)).map((tp, i) => {
                  const config = getTopicConfig(tp.topic);
                  return (
                    <Link
                      key={tp.topic}
                      href={`/quiz?topic=${encodeURIComponent(tp.topic)}&examSource=${examSource}`}
                      className="card-interactive rounded-2xl p-6 active:scale-[0.98] group"
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      <TopicIcon name={config.icon} className="w-7 h-7 mb-3 transition-transform duration-200 group-hover:scale-110" style={{ color: config.color }} />
                      <div className="text-[15px] font-semibold leading-snug mb-1 text-[var(--mp-fg)] line-clamp-2 min-h-[2.5rem]" title={tp.topic}>{tp.topic}</div>
                      <div className="text-xs text-[var(--mp-fg-subtle)] font-mono">{tp.count.toLocaleString("de-DE")} {t("questions", lang)}</div>
                    </Link>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 stagger">
              {topics.map((tp, i) => {
                const config = getTopicConfig(tp.topic);
                return (
                  <Link
                    key={tp.topic}
                    href={`/quiz?topic=${encodeURIComponent(tp.topic)}&examSource=${examSource}`}
                    className="card-interactive rounded-2xl p-6 active:scale-[0.98] group"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <TopicIcon name={config.icon} className="w-7 h-7 mb-3 transition-transform duration-200 group-hover:scale-110" style={{ color: config.color }} />
                    <div className="text-sm font-semibold mb-1 text-[var(--mp-fg)]">{tp.topic}</div>
                    <div className="text-xs text-[var(--mp-fg-subtle)] font-mono">{tp.count} {t("questions", lang)}</div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Login + Guest prompt */}
      <div className="px-4 pb-10 max-w-4xl mx-auto">
        <div className="card p-5">
          <div className="text-center mb-4">
            <img src="/brand/wordmark-twotone.png" alt="MedPrüf" className="h-8 mx-auto" />
          </div>
          <p className="text-sm text-[var(--mp-fg-muted)] font-medium mb-1 text-center">
            {lang === "de"
              ? "Fortschritt speichern & Statistiken verfolgen"
              : "Save progress & track your stats"}
          </p>
          <p className="text-xs text-[var(--mp-fg-subtle)] mb-5 text-center">
            {lang === "de"
              ? "Melde dich mit Telegram an oder fahre als Gast fort"
              : "Sign in with Telegram or continue as guest"}
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            {/* Telegram login */}
            <a
              href="https://t.me/MedPruefBot?start=web_login"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-3 bg-[#229ED9] hover:bg-[#1e8fc0] text-[var(--mp-fg)] px-5 py-3 rounded font-semibold text-sm transition-all active:scale-[0.98]"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
              </svg>
              {lang === "de" ? "Mit Telegram anmelden" : "Sign in with Telegram"}
            </a>

            {/* Guest continue */}
            <button
              onClick={handleGuestContinue}
              className="flex-1 flex items-center justify-center gap-2 bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] hover:border-[var(--mp-viridian)]/40 text-[var(--mp-fg-muted)] px-5 py-3 rounded font-medium text-sm transition-all active:scale-[0.98]"
            >
              <User className="w-4 h-4 flex-shrink-0" />
              {lang === "de" ? "Als Gast fortfahren" : "Continue as guest"}
            </button>
          </div>

          <p className="text-center text-[10px] text-[var(--mp-fg-subtle)]/60 mt-3">
            {lang === "de"
              ? "Gastmodus speichert Fortschritt lokal – kein Konto nötig"
              : "Guest mode saves progress locally — no account needed"}
          </p>
        </div>
      </div>
    </div>
  );
}
