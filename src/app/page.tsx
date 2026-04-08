"use client";

import { useEffect, useState, useCallback } from "react";
import { getTopicConfig } from "@/lib/topics";
import { getLevelFromXP } from "@/lib/xp";
import { t, getLang, setLang } from "@/lib/i18n";
import TopicIcon from "@/components/TopicIcon";
import { Flame, FileText as FileTextIcon, Lightbulb, Shuffle, PlayCircle, ClipboardList, Zap, CheckCircle, User, Inbox, ChevronRight, GraduationCap, Calendar, BarChart3 } from "lucide-react";
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
import StreakWidget from "@/components/StreakWidget";
import XPBar from "@/components/XPBar";
import DailyGoalRing from "@/components/DailyGoalRing";
import ExamSelector from "@/components/ExamSelector";
import Onboarding from "@/components/Onboarding";
import SearchBar from "@/components/SearchBar";
import TelegramLoginWidget, { type TelegramWidgetUser } from "@/components/TelegramLoginWidget";
import SearchResults from "@/components/SearchResults";
import ThemeToggle from "@/components/ThemeToggle";
import { getWeakTopics, type TopicStats } from "@/lib/weakness";
import Link from "next/link";

type Lang = "de" | "en";

interface User {
  id: string;
  telegram_id: number;
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

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [gam, setGam] = useState<Gamification | null>(null);
  const [topics, setTopics] = useState<TopicCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lang, setLangState] = useState<Lang>("de");
  const [examSource, setExamSource] = useState<ExamSourceId>("SIP");
  const [showExamSelector, setShowExamSelector] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [weakTopics, setWeakTopics] = useState<TopicStats[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [profileData, setProfileData] = useState<{ targetDate?: string } | null>(null);
  const [lastSessionInfo, setLastSessionInfo] = useState<{ totalXpSession: number; questionCount: number } | null>(null);

  useEffect(() => {
    setLangState(getLang());
    const src = getStoredExamSource();
    setExamSource(src);
    try {
      const onboardingData = localStorage.getItem("medpruef_onboarding");
      const parsed = onboardingData ? JSON.parse(onboardingData) : null;
      if (!parsed?.completedAt && !isTelegramMiniApp()) {
        setShowOnboarding(true);
      }
    } catch {}
  }, []);

  // Bot deep-link login: if URL carries ?tg_token=..., exchange it for a session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const tgToken = url.searchParams.get("tg_token");
    if (!tgToken) return;
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
          // Clear the bad token from the URL regardless
          url.searchParams.delete("tg_token");
          window.history.replaceState({}, "", url.toString());
        }
      } catch {
        // ignore
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
          setStoredExamSource("SIP");
          setExamSource("SIP");
        }
      } else {
        const stored = getStoredSession();
        if (stored) {
          setUser(stored.user);
          setGam(stored.gamification);
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

  useEffect(() => {
    setWeakTopics(getWeakTopics());
  }, []);

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
        const searchInput = document.querySelector('input[placeholder*="such"], input[placeholder*="Search"]') as HTMLInputElement;
        if (searchInput) searchInput.focus();
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
      <div className="flex items-center justify-center min-h-screen bg-[#F7F9FC]">
        <div className="text-center animate-fade-in">
          <div className="w-14 h-14 border-2 border-[#007B5F] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#A0AEC0] text-sm">{t("loading", lang)}</p>
        </div>
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

      <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
        {/* Mobile Header */}
        <div className="lg:hidden px-4 pt-4 pb-2 border-b border-[#E4E9F0]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded bg-[#007B5F]/15 border border-[#007B5F]/30 flex items-center justify-center text-sm font-bold text-[#007B5F]">
                {user.first_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-base font-bold text-[#1A2B3C]">
                  {t("hello", lang)}, {user.first_name}
                </h1>
                <p className="text-xs text-[#A0AEC0]">
                  {xpInfo.rank} · {t("level", lang)}{" "}
                  <span className="font-mono">{xpInfo.level}</span>
                </p>
              </div>
            </div>
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Desktop Header Bar */}
        <div className="hidden lg:flex px-8 pt-6 pb-3 items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#1A2B3C]">
              {t("hello", lang)}, {user.first_name}
            </h1>
            <p className="text-sm text-[#A0AEC0]">{t("exam_prep", lang)}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowExamSelector(true)}
              className="text-xs font-mono bg-[#007B5F]/10 text-[#007B5F] px-3 py-2 rounded-lg border border-[#007B5F]/20 hover:bg-[#007B5F]/20 transition-colors"
            >
              {examSource}
            </button>
            <div className="w-px h-6 bg-[#E4E9F0]" />
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className="px-4 lg:px-8 py-4">
          {/* Hero Progress Banner */}
          <div className="bg-gradient-to-r from-[#001B3D] to-[#003A8C] rounded-2xl p-6 md:p-8 text-white relative overflow-hidden mb-6">
            {/* Subtle pattern overlay */}
            <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />
            <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-2xl md:text-3xl font-black mb-2 font-display">
                  {lang === "de"
                    ? `Du bist ${Math.round(((gam?.total_questions_answered || 0) / 7725) * 100)}% näher am Bestehen`
                    : `You're ${Math.round(((gam?.total_questions_answered || 0) / 7725) * 100)}% closer to passing`}
                  {" "}🇦🇹
                </h1>
                <p className="text-white/70 text-sm">
                  {lang === "de" ? "Geschätzte Note" : "Estimated score"}: <span className="font-bold text-white">{(gam?.total_questions_answered || 0) > 0 ? Math.round(((gam?.total_correct || 0) / (gam?.total_questions_answered || 1)) * 100) : 0}%</span>
                  {" · "}
                  {lang === "de" ? "Fortschritt" : "Completion"}: <span className="font-bold text-white">{Math.round(((gam?.total_questions_answered || 0) / 7725) * 100)}%</span>
                </p>
                {(() => {
                  const answered = gam?.total_questions_answered || 0;
                  const acc = answered > 0 ? Math.round(((gam?.total_correct || 0) / answered) * 100) : 0;
                  const completion = Math.round((answered / 7725) * 100);
                  const passProbability = answered > 10 ? Math.min(99, Math.round(acc * 0.7 + completion * 0.3)) : 0;
                  return passProbability > 0 ? (
                    <p className="text-white/70 text-sm mt-1">
                      {lang === "de" ? "Bestehenswahrscheinlichkeit" : "Pass probability"}: <span className="font-bold text-white font-display">{passProbability}%</span>
                    </p>
                  ) : null;
                })()}
              </div>
              {/* Social proof badges */}
              <div className="flex flex-wrap md:flex-col gap-2">
                {profileData?.targetDate && !isNaN(new Date(profileData.targetDate).getTime()) && (() => {
                  const days = Math.ceil((new Date(profileData.targetDate).getTime() - Date.now()) / 86400000);
                  return days > 0 ? (
                    <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full">
                      <Calendar className="w-3.5 h-3.5" /> {lang === "de" ? `Prüfung in ${days} Tagen` : `Exam in ${days} days`}
                    </span>
                  ) : null;
                })()}
                <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full">
                  <BarChart3 className="w-3.5 h-3.5" /> {lang === "de" ? "Top 32% diese Woche" : "Top 32% this week"}
                </span>
                <span className="inline-flex items-center gap-1.5 bg-[#00A896]/30 text-white text-xs font-medium px-3 py-1.5 rounded-full">
                  <span className="w-2 h-2 rounded-full bg-[#00A896] animate-pulse" /> {lang === "de" ? "1.200+ lernen jetzt" : "1,200+ studying now"}
                </span>
              </div>
            </div>
          </div>

          {/* Continue CTA */}
          {weakTopics.length > 0 && lastSessionInfo && (
            <div className="text-center mb-2">
              <span className="inline-flex items-center gap-2 text-xs text-[#A0AEC0] bg-[#F7F9FC] border border-[#E4E9F0] rounded-full px-3 py-1">
                {lang === "de" ? "Letzte Sitzung" : "Last session"}: <span className="font-semibold text-[#007B5F]">+{lastSessionInfo.totalXpSession} XP</span> · {lastSessionInfo.questionCount} {lang === "de" ? "Fragen" : "questions"}
              </span>
            </div>
          )}
          {weakTopics.length > 0 && (
            <Link
              href={`/quiz?topic=${encodeURIComponent(weakTopics[0]?.topic || 'random')}&userId=${user.id}&examSource=${examSource}`}
              className="block bg-[#007B5F] hover:bg-[#006B51] rounded-2xl p-5 text-white mb-6 transition-colors group"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-bold">
                    {lang === "de" ? `Weiter: ${weakTopics[0]?.topic}` : `Continue: ${weakTopics[0]?.topic}`}
                  </p>
                  <p className="text-white/70 text-sm">
                    {weakTopics.length} {lang === "de" ? "schwache Bereiche · +10 XP" : "weak areas remaining · +10 XP"}
                  </p>
                </div>
                <ChevronRight className="w-6 h-6 text-white/70 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          )}

          {/* Top Row: Stats + Daily Goal — single card layer, no nesting */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <div className="card rounded-2xl p-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'linear-gradient(to right, #007B5F, #00A896)' }} />
              <DailyGoalRing
                current={gam?.daily_questions_today || 0}
                goal={user.daily_goal || 20}
                lang={lang}
              />
            </div>
            <div className="card rounded-2xl p-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'linear-gradient(to right, #F4A261, #FFC97A)' }} />
              <StreakWidget streak={gam?.current_streak || 0} lang={lang} />
            </div>
            <div className="card rounded-2xl p-5 relative overflow-hidden md:col-span-2 lg:col-span-1">
              <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'linear-gradient(to right, #003A8C, #007B5F)' }} />
              <XPBar totalXp={gam?.total_xp || 0} lang={lang} />
            </div>
          </div>

          {/* Smart Recommendation */}
          {weakTopics.length > 0 && (
            <div className="bg-[#FFF4E6] border border-[#F4A261]/25 rounded-2xl p-5 mb-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-bold text-[#1A2B3C] mb-1">
                    {lang === "de" ? "Empfehlung für dich" : "Smart Recommendation"}
                  </p>
                  <p className="text-sm text-[#4A5568]">
                    {lang === "de"
                      ? `${weakTopics[0]?.topic} verbessern — steigert deine Punktzahl um ca. +${Math.min(Math.round(100 / (weakTopics.length + 1)), 15)}%`
                      : `Improve ${weakTopics[0]?.topic} — increases your score by ~+${Math.min(Math.round(100 / (weakTopics.length + 1)), 15)}%`}
                  </p>
                </div>
                <Link
                  href={`/quiz?topic=${encodeURIComponent(weakTopics[0]?.topic || 'random')}&userId=${user.id}&examSource=${examSource}`}
                  className="btn-primary text-sm px-4 py-2 shrink-0"
                >
                  {lang === "de" ? "Jetzt üben" : "Fix now"}
                </Link>
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <Link
              href={`/quiz?topic=random&userId=${user.id}&examSource=${examSource}`}
              className="btn-primary flex items-center justify-center gap-3 px-5 min-h-[56px] text-base rounded-2xl shadow-md pulse-glow active:scale-[0.98]"
            >
              <Shuffle className="w-5 h-5" />
              <span className="text-sm">{t("random_quiz", lang)}</span>
            </Link>

            <Link
              href={topics.length > 0 ? `/quiz?topic=${encodeURIComponent(topics[0].topic)}&userId=${user.id}&examSource=${examSource}` : "#"}
              className="btn-secondary flex items-center justify-center gap-3 px-5 min-h-[56px] rounded-2xl shadow-[var(--shadow-xs)] hover:shadow-md transition-all"
            >
              <PlayCircle className="w-5 h-5 flex-shrink-0 text-[#007B5F]" />
              <span className="text-sm">{t("continue_where_left", lang)}</span>
            </Link>

            <Link
              href={`/exam?examSource=${examSource}`}
              className="btn-secondary flex items-center justify-center gap-3 px-5 min-h-[56px] rounded-2xl shadow-[var(--shadow-xs)] hover:shadow-md transition-all"
            >
              <GraduationCap className="w-5 h-5 flex-shrink-0 text-[#003A8C]" />
              <span className="text-sm">{t("mock_exam", lang)}</span>
            </Link>
          </div>

          {/* Search */}
          <div className="mb-6">
            <div className="card rounded-2xl p-1">
              <SearchBar lang={lang} onSearch={handleSearch} />
            </div>
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

          {/* Topics Grid — hidden while searching */}
          {!searchQuery && (
            <div className="mb-6">
              <h2 className="text-lg font-bold mb-4 text-[#1A2B3C] border-l-[3px] border-l-[#007B5F] pl-3">
                {t("specialties", lang)} <span className="text-sm font-normal text-[#A0AEC0] ml-1">({topics.length})</span>
              </h2>

              {examSource === "SIP" ? (
                <>
                  {/* SIP quick-start buttons */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <Link
                      href={`/exam?examSource=SIP&part=sip4`}
                      className="card-interactive rounded-2xl p-4 flex items-center justify-between text-sm transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <ClipboardList className="w-4 h-4 flex-shrink-0 text-[#F4A261]" />
                        <span className="truncate font-medium">{t("practice_sip4", lang)}</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#A0AEC0]" />
                    </Link>
                    <Link
                      href={`/exam?examSource=SIP&part=sip5`}
                      className="card-interactive rounded-2xl p-4 flex items-center justify-between text-sm transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <ClipboardList className="w-4 h-4 flex-shrink-0 text-[#007B5F]" />
                        <span className="truncate font-medium">{t("practice_sip5", lang)}</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#A0AEC0]" />
                    </Link>
                  </div>

                  {/* SIP 4 section */}
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[#F4A261] mb-3 border-l-[3px] border-l-[#F4A261] pl-3">
                    {t("sip4_label", lang)}
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-5 mb-5 stagger">
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
                        />
                      ))}
                  </div>

                  {/* SIP 5 section */}
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[#007B5F] mb-3 border-l-[3px] border-l-[#007B5F] pl-3">
                    {t("sip5_label", lang)}
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-5 stagger">
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
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* View Progress Link */}
          <Link href="/progress" className="card rounded-2xl p-4 flex items-center justify-between hover:shadow-[var(--shadow-card-hover)] transition-all">
            <span className="text-sm font-medium text-[#007B5F]">
              {lang === "de" ? "Fortschritt ansehen" : "View Full Progress"}
            </span>
            <ChevronRight className="w-5 h-5 text-[#A0AEC0]" />
          </Link>

          {/* Mini Stats Row (mobile only) */}
          <div className="grid grid-cols-4 gap-2 lg:hidden mb-6 mt-4 stagger">
            <div className="rounded-xl border-t-2 border-t-[#F4A261] bg-white shadow-[var(--shadow-xs)]">
              <StatsCard icon={<Zap className="w-4 h-4" />} value={gam?.total_xp || 0} label="XP" color="text-[#F4A261]" delay={0} />
            </div>
            <div className="rounded-xl border-t-2 border-t-[#D64545] bg-white shadow-[var(--shadow-xs)]">
              <StatsCard icon={<Flame className="w-4 h-4" />} value={gam?.current_streak || 0} label={t("streak", lang)} color="text-[#D64545]" delay={50} />
            </div>
            <div className="rounded-xl border-t-2 border-t-[#00A896] bg-white shadow-[var(--shadow-xs)]">
              <StatsCard icon={<CheckCircle className="w-4 h-4" />} value={`${accuracy}%`} label={t("accuracy", lang)} color="text-[#00A896]" delay={100} />
            </div>
            <div className="rounded-xl border-t-2 border-t-[#007B5F] bg-white shadow-[var(--shadow-xs)]">
              <StatsCard icon={<FileTextIcon className="w-4 h-4" />} value={gam?.total_questions_answered || 0} label={t("answered", lang)} color="text-[#007B5F]" delay={150} />
            </div>
          </div>
        </div>
      </main>


      {/* Weakness prompts */}
      {weakTopics.length > 0 && (
        <div className="px-4 mb-6 max-w-full overflow-hidden">
          <div className="space-y-2">
            {weakTopics.slice(0, 2).map(wt => (
              <Link key={wt.topic} href={`/quiz?topic=${encodeURIComponent(wt.topic)}&examSource=${examSource}`}
                className="block p-4 bg-[#FFF4E6] border-l-4 border-[#F4A261] rounded-r max-w-full overflow-hidden">
                <p className="text-sm font-semibold text-[#1A2B3C] flex items-center gap-1.5">
                  <Lightbulb className="w-4 h-4 flex-shrink-0" /> <span className="truncate">Du bist schwach in {wt.topic} ({Math.min(Math.round(wt.accuracy * 100), 100)}%)</span> <span className="flex-shrink-0">— jetzt üben?</span>
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      <BottomNav lang={lang} userId={user.id} />
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

  const handleWidgetAuth = useCallback(async (wu: TelegramWidgetUser) => {
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgetData: wu }),
      });
      if (!res.ok) return;
      const data = await res.json();
      storeSession({ user: data.user, gamification: data.gamification });
      window.location.reload();
    } catch (e) {
      console.error("Widget auth failed", e);
    }
  }, []);

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
    <div className="min-h-screen bg-[#F7F9FC] safe-area-top safe-area-bottom">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#007B5F]/[0.03] to-transparent pointer-events-none" />
        <div className="relative px-4 pt-8 pb-6 text-center max-w-2xl mx-auto">
          <div className="flex justify-end mb-6 gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={onLangChange} />
          </div>

          <div className="w-16 h-16 rounded border border-[#007B5F]/30 bg-[#007B5F]/10 flex items-center justify-center text-3xl mx-auto mb-4">
            <img src="/brand/logo-mark.png" alt="MedPrüf" className="w-12 h-12" />
          </div>
          <img src="/brand/wordmark-twotone.png" alt="MedPrüf" className="h-10 mx-auto" />
          <p className="text-[#4A5568] text-base mb-1">{t("exam_prep", lang)}</p>
          <p className="text-[#A0AEC0] text-sm">{t("demo_description", lang)}</p>

          {/* Stats bar */}
          <div className="flex items-center justify-center gap-6 mt-5">
            <div className="text-center">
              <p className="text-2xl font-bold text-[#007B5F] font-mono">
                {totalQuestions > 0 ? totalQuestions.toLocaleString("de-DE") : "7.042"}
              </p>
              <p className="text-xs text-[#A0AEC0]">{t("questions", lang)}</p>
            </div>
            <div className="w-px h-8 bg-[#E4E9F0]" />
            <div className="text-center">
              <p className="text-2xl font-bold text-[#F4A261] font-mono">{topics.length || "10"}</p>
              <p className="text-xs text-[#A0AEC0]">{t("topics", lang)}</p>
            </div>
            <div className="w-px h-8 bg-[#E4E9F0]" />
            {/* Exam badge — clickable to change */}
            <button onClick={onChangeExam} className="text-center group">
              <p className="text-lg font-bold text-[#F4A261] font-mono group-hover:text-[#FFD080] transition-colors">
                {examSource}
              </p>
              <p className="text-xs text-[#A0AEC0] group-hover:text-[#4A5568] transition-colors">
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
      <div className="px-4 pb-4 max-w-4xl mx-auto">
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
        <div className="px-4 pb-6 max-w-4xl mx-auto">
          <h2 className="text-lg font-bold mb-4 text-[#1A2B3C] border-l-[3px] border-l-[#007B5F] pl-3">{t("practice_topics", lang)}</h2>

          {examSource === "SIP" ? (
            <>
              {/* SIP quick-start buttons */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Link
                  href={`/exam?examSource=SIP&part=sip4`}
                  className="btn-secondary flex items-center gap-2 rounded-xl px-4 py-3 text-sm transition-all hover:shadow-md"
                >
                  <ClipboardList className="w-4 h-4 flex-shrink-0 text-[#F4A261]" />
                  <span className="truncate">{t("practice_sip4", lang)}</span>
                </Link>
                <Link
                  href={`/exam?examSource=SIP&part=sip5`}
                  className="btn-secondary flex items-center gap-2 rounded-xl px-4 py-3 text-sm transition-all hover:shadow-md"
                >
                  <ClipboardList className="w-4 h-4 flex-shrink-0 text-[#007B5F]" />
                  <span className="truncate">{t("practice_sip5", lang)}</span>
                </Link>
              </div>

              {/* SIP 4 group */}
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#F4A261] mb-3 border-l-[3px] border-l-[#F4A261] pl-3">
                {t("sip4_label", lang)}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-5 stagger">
                {topics.filter((tp) => VIENNA_EXAM_PARTS.sip4.includes(tp.topic)).map((tp, i) => {
                  const config = getTopicConfig(tp.topic);
                  return (
                    <Link
                      key={tp.topic}
                      href={`/quiz?topic=${encodeURIComponent(tp.topic)}&examSource=${examSource}`}
                      className="card-interactive rounded-2xl p-5 active:scale-[0.98] relative overflow-hidden group"
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl" style={{ backgroundColor: config.color }} />
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3 transition-transform duration-200 group-hover:scale-110" style={{ backgroundColor: `${config.color}18` }}>
                        <TopicIcon name={config.icon} className="w-6 h-6" style={{ color: config.color }} />
                      </div>
                      <div className="text-[15px] font-semibold leading-snug mb-1 text-[#1A2B3C] line-clamp-2 min-h-[2.5rem]" title={tp.topic}>{tp.topic}</div>
                      <div className="text-xs text-[#A0AEC0] font-mono">{tp.count.toLocaleString("de-DE")} {t("questions", lang)}</div>
                    </Link>
                  );
                })}
              </div>

              {/* SIP 5 group */}
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#007B5F] mb-3 border-l-[3px] border-l-[#007B5F] pl-3">
                {t("sip5_label", lang)}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 stagger">
                {topics.filter((tp) => VIENNA_EXAM_PARTS.sip5.includes(tp.topic)).map((tp, i) => {
                  const config = getTopicConfig(tp.topic);
                  return (
                    <Link
                      key={tp.topic}
                      href={`/quiz?topic=${encodeURIComponent(tp.topic)}&examSource=${examSource}`}
                      className="card-interactive rounded-2xl p-5 active:scale-[0.98] relative overflow-hidden group"
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl" style={{ backgroundColor: config.color }} />
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3 transition-transform duration-200 group-hover:scale-110" style={{ backgroundColor: `${config.color}18` }}>
                        <TopicIcon name={config.icon} className="w-6 h-6" style={{ color: config.color }} />
                      </div>
                      <div className="text-[15px] font-semibold leading-snug mb-1 text-[#1A2B3C] line-clamp-2 min-h-[2.5rem]" title={tp.topic}>{tp.topic}</div>
                      <div className="text-xs text-[#A0AEC0] font-mono">{tp.count.toLocaleString("de-DE")} {t("questions", lang)}</div>
                    </Link>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 stagger">
              {topics.map((tp, i) => {
                const config = getTopicConfig(tp.topic);
                return (
                  <Link
                    key={tp.topic}
                    href={`/quiz?topic=${encodeURIComponent(tp.topic)}&examSource=${examSource}`}
                    className="card-interactive border-l-[3px] rounded-2xl p-5 active:scale-[0.98]"
                    style={{ borderLeftColor: config.color, animationDelay: `${i * 50}ms` }}
                  >
                    <div className="w-10 h-10 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: `${config.color}15` }}>
                      <TopicIcon name={config.icon} className="w-5 h-5" style={{ color: config.color }} />
                    </div>
                    <div className="text-sm font-semibold mb-1 text-[#1A2B3C]">{tp.topic}</div>
                    <div className="text-xs text-[#A0AEC0] font-mono">{tp.count} {t("questions", lang)}</div>
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
          <p className="text-sm text-[#4A5568] font-medium mb-1 text-center">
            {lang === "de"
              ? "Fortschritt speichern & Statistiken verfolgen"
              : "Save progress & track your stats"}
          </p>
          <p className="text-xs text-[#A0AEC0] mb-5 text-center">
            {lang === "de"
              ? "Melde dich mit Telegram an oder fahre als Gast fort"
              : "Sign in with Telegram or continue as guest"}
          </p>

          {/* Telegram Login Widget (web/desktop primary, iframe-based) */}
          <div className="flex justify-center mb-3">
            <TelegramLoginWidget
              botName="MedPruefBot"
              onAuth={handleWidgetAuth}
              buttonSize="large"
              cornerRadius={6}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            {/* Telegram deep link button (mobile / in-bot fallback) */}
            <a
              href="https://t.me/MedPruefBot?start=web_login"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-3 bg-[#229ED9] hover:bg-[#1e8fc0] text-[#1A2B3C] px-5 py-3 rounded font-semibold text-sm transition-all active:scale-[0.98]"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
              </svg>
              {lang === "de" ? "Mit Telegram anmelden" : "Sign in with Telegram"}
            </a>

            {/* Guest continue */}
            <button
              onClick={handleGuestContinue}
              className="flex-1 flex items-center justify-center gap-2 bg-[#FFFFFF] border border-[#E4E9F0] hover:border-[#007B5F]/40 text-[#4A5568] px-5 py-3 rounded font-medium text-sm transition-all active:scale-[0.98]"
            >
              <User className="w-4 h-4 flex-shrink-0" />
              {lang === "de" ? "Als Gast fortfahren" : "Continue as guest"}
            </button>
          </div>

          <p className="text-center text-[10px] text-[#A0AEC0]/60 mt-3">
            {lang === "de"
              ? "Gastmodus speichert Fortschritt lokal – kein Konto nötig"
              : "Guest mode saves progress locally — no account needed"}
          </p>
        </div>
      </div>
    </div>
  );
}
