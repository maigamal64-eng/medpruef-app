"use client";

import { useEffect, useState, useCallback } from "react";
import { getTopicConfig } from "@/lib/topics";
import { getLevelFromXP } from "@/lib/xp";
import { t, getLang, setLang } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import TopicCard from "@/components/TopicCard";
import StatsCard from "@/components/StatsCard";
import StreakWidget from "@/components/StreakWidget";
import XPBar from "@/components/XPBar";
import DailyGoalRing from "@/components/DailyGoalRing";
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

  useEffect(() => {
    setLangState(getLang());
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const authenticate = useCallback(async () => {
    try {
      const tg = window.Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        tg.setHeaderColor("#020617");
        tg.setBackgroundColor("#020617");
      }

      const initData = tg?.initData || "";
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

      const topicRes = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "topics" }),
      });
      const topicData = await topicRes.json();
      setTopics(topicData);
    } catch (e) {
      console.error(e);
      setError(t("connection_error", lang));
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    authenticate();
  }, [authenticate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center animate-fade-in">
          <div className="w-14 h-14 border-4 border-[#0891B2] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#94A3B8] text-sm">{t("loading", lang)}</p>
        </div>
      </div>
    );
  }

  if (error === "demo" || !user) {
    return <DemoHome topics={topics} lang={lang} onLangChange={switchLang} />;
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

      <main className="main-content safe-area-top safe-area-bottom">
        {/* Mobile Header */}
        <div className="lg:hidden px-4 pt-4 pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#0891B2] to-[#065F73] flex items-center justify-center text-sm font-bold shadow-lg">
                {user.first_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">
                  {t("hello", lang)}, {user.first_name}! 👋
                </h1>
                <p className="text-xs text-[#94A3B8]">
                  {xpInfo.rank} · {t("level", lang)} {xpInfo.level}
                </p>
              </div>
            </div>
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Desktop Header */}
        <div className="hidden lg:flex items-center justify-between px-8 pt-6 pb-2">
          <div>
            <h1 className="text-2xl font-bold text-white">
              {t("hello", lang)}, {user.first_name}! 👋
            </h1>
            <p className="text-sm text-[#94A3B8]">
              {t("exam_prep", lang)}
            </p>
          </div>
          <LanguageToggle lang={lang} onChange={switchLang} />
        </div>

        <div className="px-4 lg:px-8 py-4">
          {/* Top Row: Stats + Daily Goal */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {/* Daily Goal Ring */}
            <DailyGoalRing
              current={gam?.daily_questions_today || 0}
              goal={user.daily_goal || 20}
              lang={lang}
            />

            {/* Streak Widget */}
            <StreakWidget streak={gam?.current_streak || 0} lang={lang} />

            {/* XP & Level */}
            <div className="md:col-span-2 lg:col-span-1">
              <XPBar totalXp={gam?.total_xp || 0} lang={lang} />
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <Link
              href={`/quiz?topic=random&userId=${user.id}`}
              className="flex items-center gap-3 bg-gradient-to-r from-[#0891B2] to-[#065F73] text-white px-5 py-4 rounded-xl font-semibold shadow-lg shadow-[#0891B2]/15 pulse-glow transition-transform active:scale-[0.98]"
            >
              <span className="text-xl">🚀</span>
              <span className="text-sm">{t("random_quiz", lang)}</span>
            </Link>

            {topics.length > 0 && (
              <Link
                href={`/quiz?topic=${encodeURIComponent(topics[0].topic)}&userId=${user.id}`}
                className="flex items-center gap-3 bg-[#1E293B]/60 border border-[#334155]/50 text-white px-5 py-4 rounded-xl font-medium hover:bg-[#1E293B] transition-all"
              >
                <span className="text-xl">▶️</span>
                <span className="text-sm truncate">{t("continue_where_left", lang)}</span>
              </Link>
            )}

            <div className="flex items-center gap-3 bg-[#1E293B]/30 border border-[#334155]/30 text-[#64748B] px-5 py-4 rounded-xl cursor-not-allowed relative overflow-hidden">
              <span className="text-xl opacity-50">📋</span>
              <span className="text-sm">{t("mock_exam", lang)}</span>
              <span className="absolute top-2 right-2 text-[9px] font-medium bg-[#F59E0B]/15 text-[#F59E0B] px-1.5 py-0.5 rounded-full">
                {t("coming_soon", lang)}
              </span>
            </div>
          </div>

          {/* Topics Grid */}
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-3">{t("specialties", lang)}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {topics.map((tp, i) => (
                <TopicCard
                  key={tp.topic}
                  topic={tp.topic}
                  count={tp.count}
                  userId={user.id}
                  lang={lang}
                  delay={i * 50}
                />
              ))}
            </div>
          </div>

          {/* Mini Stats Row (mobile only) */}
          <div className="grid grid-cols-4 gap-2 lg:hidden mb-6">
            <StatsCard icon="⚡" value={gam?.total_xp || 0} label="XP" color="text-[#F59E0B]" delay={0} />
            <StatsCard icon="🔥" value={gam?.current_streak || 0} label={t("streak", lang)} color="text-[#EF4444]" delay={50} />
            <StatsCard icon="✅" value={`${accuracy}%`} label={t("accuracy", lang)} color="text-[#10B981]" delay={100} />
            <StatsCard icon="📝" value={gam?.total_questions_answered || 0} label={t("answered", lang)} color="text-[#0891B2]" delay={150} />
          </div>
        </div>
      </main>

      <BottomNav lang={lang} userId={user.id} />
    </div>
  );
}

/* ============================================
   DEMO HOME (no auth / standalone web)
   ============================================ */
function DemoHome({
  topics,
  lang,
  onLangChange,
}: {
  topics: TopicCount[];
  lang: Lang;
  onLangChange: (l: Lang) => void;
}) {
  return (
    <div className="min-h-screen safe-area-top safe-area-bottom">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0891B2]/10 to-transparent" />
        <div className="relative px-4 pt-8 pb-6 text-center max-w-2xl mx-auto">
          <div className="flex justify-end mb-6">
            <LanguageToggle lang={lang} onChange={onLangChange} />
          </div>

          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#0891B2] to-[#065F73] flex items-center justify-center text-4xl mx-auto mb-4 shadow-xl shadow-[#0891B2]/20">
            🏥
          </div>
          <h1 className="text-3xl font-bold mb-2 tracking-tight">MedPrüf</h1>
          <p className="text-[#94A3B8] text-base mb-1">{t("exam_prep", lang)}</p>
          <p className="text-[#64748B] text-sm">{t("demo_description", lang)}</p>

          {topics.length > 0 && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <div className="text-center">
                <p className="text-2xl font-bold text-[#0891B2]">
                  {topics.reduce((sum, tp) => sum + tp.count, 0)}
                </p>
                <p className="text-xs text-[#64748B]">{t("questions", lang)}</p>
              </div>
              <div className="w-px h-8 bg-[#334155]" />
              <div className="text-center">
                <p className="text-2xl font-bold text-[#F59E0B]">{topics.length}</p>
                <p className="text-xs text-[#64748B]">{t("topics", lang)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Topics */}
      {topics.length > 0 && (
        <div className="px-4 pb-8 max-w-4xl mx-auto">
          <h2 className="text-lg font-semibold mb-3">{t("practice_topics", lang)}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {topics.map((tp, i) => {
              const config = getTopicConfig(tp.topic);
              return (
                <div
                  key={tp.topic}
                  className="topic-card-border bg-[#1E293B]/50 border border-[#334155]/40 rounded-xl p-4 animate-fade-in"
                  style={{
                    borderLeftColor: config.color,
                    animationDelay: `${i * 50}ms`,
                  }}
                >
                  <div className="text-2xl mb-2">{config.icon}</div>
                  <div className="text-sm font-semibold mb-1">{tp.topic}</div>
                  <div className="text-xs text-[#64748B]">
                    {tp.count} {t("questions", lang)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* CTA */}
          <div className="mt-8 text-center">
            <div className="inline-flex items-center gap-2 bg-[#2AABEE]/10 text-[#2AABEE] px-6 py-3 rounded-xl border border-[#2AABEE]/20">
              <span className="text-lg">✈️</span>
              <span className="text-sm font-medium">{t("open_in_telegram", lang)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
