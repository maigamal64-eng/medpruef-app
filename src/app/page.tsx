"use client";

import { useEffect, useState, useCallback } from "react";
import { getTopicConfig } from "@/lib/topics";
import { getLevelFromXP } from "@/lib/xp";
import { t, getLang, setLang } from "@/lib/i18n";
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
import SearchResults from "@/components/SearchResults";
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
          <div className="w-14 h-14 border-2 border-[#129B7F] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
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
              <div className="w-9 h-9 rounded bg-[#129B7F]/15 border border-[#129B7F]/30 flex items-center justify-center text-sm font-bold text-[#129B7F]">
                {user.first_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-base font-bold text-[#152B4E]">
                  {t("hello", lang)}, {user.first_name}
                </h1>
                <p className="text-xs text-[#A0AEC0]">
                  {xpInfo.rank} · {t("level", lang)}{" "}
                  <span className="font-mono">{xpInfo.level}</span>
                </p>
              </div>
            </div>
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Desktop Header */}
        <div className="hidden lg:flex items-center justify-between px-8 pt-6 pb-2">
          <div>
            <h1 className="text-2xl font-bold text-[#152B4E]">
              {t("hello", lang)}, {user.first_name}
            </h1>
            <p className="text-sm text-[#A0AEC0]">{t("exam_prep", lang)}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Exam badge */}
            <button
              onClick={() => setShowExamSelector(true)}
              className="text-xs font-mono bg-[#129B7F]/10 text-[#129B7F] px-2.5 py-1.5 rounded border border-[#129B7F]/20 hover:bg-[#129B7F]/20 transition-colors"
            >
              {examSource}
            </button>
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className="px-4 lg:px-8 py-4">
          {/* Top Row: Stats + Daily Goal */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
            <DailyGoalRing
              current={gam?.daily_questions_today || 0}
              goal={user.daily_goal || 20}
              lang={lang}
            />
            <StreakWidget streak={gam?.current_streak || 0} lang={lang} />
            <div className="md:col-span-2 lg:col-span-1">
              <XPBar totalXp={gam?.total_xp || 0} lang={lang} />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <Link
              href={`/quiz?topic=random&userId=${user.id}&examSource=${examSource}`}
              className="flex items-center gap-3 bg-[#129B7F] hover:bg-[#00A896] text-[#003732] px-5 py-3.5 rounded font-semibold pulse-glow transition-all active:scale-[0.98]"
            >
              <span className="text-xl">🚀</span>
              <span className="text-sm">{t("random_quiz", lang)}</span>
            </Link>

            {topics.length > 0 && (
              <Link
                href={`/quiz?topic=${encodeURIComponent(topics[0].topic)}&userId=${user.id}&examSource=${examSource}`}
                className="flex items-center gap-3 bg-[#FFFFFF] border border-[#E4E9F0] text-[#152B4E] px-5 py-3.5 rounded font-medium hover:border-[#129B7F]/40 transition-all"
              >
                <span className="text-xl">▶️</span>
                <span className="text-sm truncate">{t("continue_where_left", lang)}</span>
              </Link>
            )}

            <Link
              href={`/exam?examSource=${examSource}`}
              className="flex items-center gap-3 bg-[#FFFFFF] border border-[#E4E9F0] text-[#152B4E] px-5 py-3.5 rounded font-medium hover:border-[#129B7F]/40 transition-all"
            >
              <span className="text-xl">📋</span>
              <span className="text-sm">{t("mock_exam", lang)}</span>
            </Link>
          </div>

          {/* Search */}
          <div className="mb-5">
            <SearchBar lang={lang} onSearch={handleSearch} />
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
            <div className="mb-5">
              <h2 className="text-base font-semibold mb-3 text-[#152B4E]">{t("specialties", lang)}</h2>

              {examSource === "SIP" ? (
                <>
                  {/* SIP quick-start buttons */}
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    <Link
                      href={`/exam?examSource=SIP&part=sip4`}
                      className="flex items-center gap-2 bg-[#FFFFFF] border border-[#E4E9F0] hover:border-[#129B7F]/40 rounded px-3 py-2.5 text-sm font-medium text-[#152B4E] transition-all"
                    >
                      <span>📋</span>
                      <span className="truncate">{t("practice_sip4", lang)}</span>
                    </Link>
                    <Link
                      href={`/exam?examSource=SIP&part=sip5`}
                      className="flex items-center gap-2 bg-[#FFFFFF] border border-[#E4E9F0] hover:border-[#129B7F]/40 rounded px-3 py-2.5 text-sm font-medium text-[#152B4E] transition-all"
                    >
                      <span>📋</span>
                      <span className="truncate">{t("practice_sip5", lang)}</span>
                    </Link>
                  </div>

                  {/* SIP 4 section */}
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F4A261] mb-2">
                    {t("sip4_label", lang)}
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mb-4">
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
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#129B7F] mb-2">
                    {t("sip5_label", lang)}
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
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
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
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

          {/* Mini Stats Row (mobile only) */}
          <div className="grid grid-cols-4 gap-2 lg:hidden mb-5">
            <StatsCard icon="⚡" value={gam?.total_xp || 0} label="XP" color="text-[#F4A261]" delay={0} />
            <StatsCard icon="🔥" value={gam?.current_streak || 0} label={t("streak", lang)} color="text-[#D64545]" delay={50} />
            <StatsCard icon="✅" value={`${accuracy}%`} label={t("accuracy", lang)} color="text-[#00A896]" delay={100} />
            <StatsCard icon="📝" value={gam?.total_questions_answered || 0} label={t("answered", lang)} color="text-[#129B7F]" delay={150} />
          </div>
        </div>
      </main>


      {/* Weakness prompts */}
      {weakTopics.length > 0 && (
        <div className="px-4 mb-6">
          <div className="space-y-2">
            {weakTopics.slice(0, 2).map(t => (
              <Link key={t.topic} href={`/quiz?topic=${encodeURIComponent(t.topic)}&examSource=${examSource}`}
                className="block p-4 bg-[#FFF4E6] border-l-4 border-[#F4A261] rounded-r">
                <p className="text-sm font-semibold text-[#152B4E]">
                  💡 Du bist schwach in {t.topic} ({Math.round(t.accuracy * 100)}%) — jetzt üben?
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
        <div className="absolute inset-0 bg-gradient-to-b from-[#129B7F]/6 to-transparent pointer-events-none" />
        <div className="relative px-4 pt-8 pb-6 text-center max-w-2xl mx-auto">
          <div className="flex justify-end mb-6">
            <LanguageToggle lang={lang} onChange={onLangChange} />
          </div>

          <div className="w-16 h-16 rounded border border-[#129B7F]/30 bg-[#129B7F]/10 flex items-center justify-center text-3xl mx-auto mb-4">
            <img src="/brand/logo-mark.png" alt="MedPrüf" className="w-12 h-12" />
          </div>
          <img src="/brand/wordmark-twotone.png" alt="MedPrüf" className="h-10 mx-auto" />
          <p className="text-[#4A5568] text-base mb-1">{t("exam_prep", lang)}</p>
          <p className="text-[#A0AEC0] text-sm">{t("demo_description", lang)}</p>

          {/* Stats bar */}
          <div className="flex items-center justify-center gap-6 mt-5">
            <div className="text-center">
              <p className="text-2xl font-bold text-[#129B7F] font-mono">
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
              className="inline-flex items-center gap-3 bg-[#129B7F] hover:bg-[#00A896] text-[#003732] px-7 py-3.5 rounded font-bold text-base pulse-glow transition-all active:scale-[0.98]"
            >
              <span className="text-xl">🚀</span>
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
          <h2 className="text-base font-semibold mb-3 text-[#152B4E]">{t("practice_topics", lang)}</h2>

          {examSource === "SIP" ? (
            <>
              {/* SIP quick-start buttons */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <Link
                  href={`/exam?examSource=SIP&part=sip4`}
                  className="flex items-center gap-2 bg-[#FFFFFF] border border-[#E4E9F0] hover:border-[#129B7F]/40 rounded px-3 py-2.5 text-sm font-medium text-[#152B4E] transition-all"
                >
                  <span>📋</span>
                  <span className="truncate">{t("practice_sip4", lang)}</span>
                </Link>
                <Link
                  href={`/exam?examSource=SIP&part=sip5`}
                  className="flex items-center gap-2 bg-[#FFFFFF] border border-[#E4E9F0] hover:border-[#129B7F]/40 rounded px-3 py-2.5 text-sm font-medium text-[#152B4E] transition-all"
                >
                  <span>📋</span>
                  <span className="truncate">{t("practice_sip5", lang)}</span>
                </Link>
              </div>

              {/* SIP 4 group */}
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F4A261] mb-2">
                {t("sip4_label", lang)}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
                {topics.filter((tp) => VIENNA_EXAM_PARTS.sip4.includes(tp.topic)).map((tp, i) => {
                  const config = getTopicConfig(tp.topic);
                  return (
                    <Link
                      key={tp.topic}
                      href={`/quiz?topic=${encodeURIComponent(tp.topic)}&examSource=${examSource}`}
                      className="topic-card-border bg-[#FFFFFF] border border-[#E4E9F0] rounded p-4 animate-fade-in hover:border-[#129B7F]/40 hover:bg-[#1E2640] transition-all active:scale-[0.98]"
                      style={{ borderLeftColor: config.color, animationDelay: `${i * 50}ms` }}
                    >
                      <div className="text-2xl mb-2">{config.icon}</div>
                      <div className="text-sm font-semibold mb-1 text-[#152B4E]">{tp.topic}</div>
                      <div className="text-xs text-[#A0AEC0] font-mono">{tp.count} {t("questions", lang)}</div>
                    </Link>
                  );
                })}
              </div>

              {/* SIP 5 group */}
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#129B7F] mb-2">
                {t("sip5_label", lang)}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {topics.filter((tp) => VIENNA_EXAM_PARTS.sip5.includes(tp.topic)).map((tp, i) => {
                  const config = getTopicConfig(tp.topic);
                  return (
                    <Link
                      key={tp.topic}
                      href={`/quiz?topic=${encodeURIComponent(tp.topic)}&examSource=${examSource}`}
                      className="topic-card-border bg-[#FFFFFF] border border-[#E4E9F0] rounded p-4 animate-fade-in hover:border-[#129B7F]/40 hover:bg-[#1E2640] transition-all active:scale-[0.98]"
                      style={{ borderLeftColor: config.color, animationDelay: `${i * 50}ms` }}
                    >
                      <div className="text-2xl mb-2">{config.icon}</div>
                      <div className="text-sm font-semibold mb-1 text-[#152B4E]">{tp.topic}</div>
                      <div className="text-xs text-[#A0AEC0] font-mono">{tp.count} {t("questions", lang)}</div>
                    </Link>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {topics.map((tp, i) => {
                const config = getTopicConfig(tp.topic);
                return (
                  <Link
                    key={tp.topic}
                    href={`/quiz?topic=${encodeURIComponent(tp.topic)}&examSource=${examSource}`}
                    className="topic-card-border bg-[#FFFFFF] border border-[#E4E9F0] rounded p-4 animate-fade-in hover:border-[#129B7F]/40 hover:bg-[#1E2640] transition-all active:scale-[0.98]"
                    style={{ borderLeftColor: config.color, animationDelay: `${i * 50}ms` }}
                  >
                    <div className="text-2xl mb-2">{config.icon}</div>
                    <div className="text-sm font-semibold mb-1 text-[#152B4E]">{tp.topic}</div>
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
        <div className="border border-[#E4E9F0] rounded bg-[#FFFFFF] p-5">
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

          <div className="flex flex-col sm:flex-row gap-3">
            {/* Telegram deep link button */}
            <a
              href="https://t.me/MedPruefBot?start=web_login"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-3 bg-[#229ED9] hover:bg-[#1e8fc0] text-[#152B4E] px-5 py-3 rounded font-semibold text-sm transition-all active:scale-[0.98]"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
              </svg>
              {lang === "de" ? "Mit Telegram anmelden" : "Sign in with Telegram"}
            </a>

            {/* Guest continue */}
            <button
              onClick={handleGuestContinue}
              className="flex-1 flex items-center justify-center gap-2 bg-[#FFFFFF] border border-[#E4E9F0] hover:border-[#129B7F]/40 text-[#4A5568] px-5 py-3 rounded font-medium text-sm transition-all active:scale-[0.98]"
            >
              <span>👤</span>
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
