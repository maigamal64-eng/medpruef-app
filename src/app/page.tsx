"use client";

import { useEffect, useState, useCallback } from "react";
import { getTopicConfig } from "@/lib/topics";
import { getLevelFromXP } from "@/lib/xp";
import { t, getLang, setLang } from "@/lib/i18n";
import { isTelegramMiniApp, getMiniAppInitData, getStoredSession, storeSession } from "@/lib/auth";
import type { TelegramWidgetUser, StoredSession } from "@/lib/auth";
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
    onTelegramAuth?: (user: TelegramWidgetUser) => void;
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
      const isMiniApp = isTelegramMiniApp();
      const tg = window.Telegram?.WebApp;

      if (isMiniApp && tg) {
        tg.ready();
        tg.expand();
        tg.setHeaderColor("#0C1324");
        tg.setBackgroundColor("#0C1324");
      }

      // Always fetch topics
      const topicRes = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "topics" }),
      });
      const topicData = await topicRes.json();
      setTopics(topicData);

      if (isMiniApp) {
        // Mini App: authenticate via initData
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
      } else {
        // Web: check localStorage for a stored Login Widget session
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
  }, []);

  useEffect(() => {
    authenticate();
  }, [authenticate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0C1324]">
        <div className="text-center animate-fade-in">
          <div className="w-14 h-14 border-2 border-[#6BD8CB] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#879391] text-sm">{t("loading", lang)}</p>
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

      <main className="main-content safe-area-top safe-area-bottom bg-[#0C1324]">
        {/* Mobile Header */}
        <div className="lg:hidden px-4 pt-4 pb-2 border-b border-[#3D4947]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded bg-[#6BD8CB]/15 border border-[#6BD8CB]/30 flex items-center justify-center text-sm font-bold text-[#6BD8CB]">
                {user.first_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-base font-bold text-[#DCE1FB]">
                  {t("hello", lang)}, {user.first_name}
                </h1>
                <p className="text-xs text-[#879391]">
                  {xpInfo.rank} · {t("level", lang)} <span className="font-mono">{xpInfo.level}</span>
                </p>
              </div>
            </div>
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Desktop Header */}
        <div className="hidden lg:flex items-center justify-between px-8 pt-6 pb-2">
          <div>
            <h1 className="text-2xl font-bold text-[#DCE1FB]">
              {t("hello", lang)}, {user.first_name}
            </h1>
            <p className="text-sm text-[#879391]">{t("exam_prep", lang)}</p>
          </div>
          <LanguageToggle lang={lang} onChange={switchLang} />
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
              href={`/quiz?topic=random&userId=${user.id}`}
              className="flex items-center gap-3 bg-[#6BD8CB] hover:bg-[#89F5E7] text-[#003732] px-5 py-3.5 rounded font-semibold pulse-glow transition-all active:scale-[0.98]"
            >
              <span className="text-xl">🚀</span>
              <span className="text-sm">{t("random_quiz", lang)}</span>
            </Link>

            {topics.length > 0 && (
              <Link
                href={`/quiz?topic=${encodeURIComponent(topics[0].topic)}&userId=${user.id}`}
                className="flex items-center gap-3 bg-[#191F31] border border-[#3D4947] text-[#DCE1FB] px-5 py-3.5 rounded font-medium hover:border-[#6BD8CB]/40 transition-all"
              >
                <span className="text-xl">▶️</span>
                <span className="text-sm truncate">{t("continue_where_left", lang)}</span>
              </Link>
            )}

            <div className="flex items-center gap-3 bg-[#151B2D] border border-[#3D4947] text-[#879391] px-5 py-3.5 rounded cursor-not-allowed relative overflow-hidden">
              <span className="text-xl opacity-50">📋</span>
              <span className="text-sm">{t("mock_exam", lang)}</span>
              <span className="absolute top-2 right-2 text-[9px] font-medium bg-[#FFB95F]/12 text-[#FFB95F] px-1.5 py-0.5 rounded border border-[#FFB95F]/20">
                {t("coming_soon", lang)}
              </span>
            </div>
          </div>

          {/* Topics Grid */}
          <div className="mb-5">
            <h2 className="text-base font-semibold mb-3 text-[#DCE1FB]">{t("specialties", lang)}</h2>
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
          <div className="grid grid-cols-4 gap-2 lg:hidden mb-5">
            <StatsCard icon="⚡" value={gam?.total_xp || 0} label="XP" color="text-[#FFB95F]" delay={0} />
            <StatsCard icon="🔥" value={gam?.current_streak || 0} label={t("streak", lang)} color="text-[#FFB4AB]" delay={50} />
            <StatsCard icon="✅" value={`${accuracy}%`} label={t("accuracy", lang)} color="text-[#4EDEA3]" delay={100} />
            <StatsCard icon="📝" value={gam?.total_questions_answered || 0} label={t("answered", lang)} color="text-[#6BD8CB]" delay={150} />
          </div>
        </div>
      </main>

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
  onLangChange,
}: {
  topics: TopicCount[];
  lang: Lang;
  onLangChange: (l: Lang) => void;
}) {
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    // Register global callback for Telegram Login Widget
    window.onTelegramAuth = async (widgetUser: TelegramWidgetUser) => {
      setAuthLoading(true);
      setAuthError("");
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ widgetData: widgetUser }),
        });
        if (!res.ok) {
          setAuthError(lang === "de" ? "Anmeldung fehlgeschlagen" : "Login failed");
          setAuthLoading(false);
          return;
        }
        const session: StoredSession = await res.json();
        storeSession(session);
        window.location.reload();
      } catch {
        setAuthError(lang === "de" ? "Verbindungsfehler" : "Connection error");
        setAuthLoading(false);
      }
    };

    return () => {
      delete window.onTelegramAuth;
    };
  }, [lang]);

  // Inject Telegram Login Widget via DOM (Next.js <Script> doesn't pass data-* attrs correctly)
  useEffect(() => {
    const container = document.getElementById("telegram-login-container");
    if (!container || container.children.length > 0) return;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", "MedPruefBot");
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    script.async = true;
    container.appendChild(script);
  }, []);

  const totalQuestions = topics.reduce((sum, tp) => sum + tp.count, 0);

  return (
    <div className="min-h-screen bg-[#0C1324] safe-area-top safe-area-bottom">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#6BD8CB]/6 to-transparent pointer-events-none" />
        <div className="relative px-4 pt-8 pb-6 text-center max-w-2xl mx-auto">
          <div className="flex justify-end mb-6">
            <LanguageToggle lang={lang} onChange={onLangChange} />
          </div>

          <div className="w-16 h-16 rounded border border-[#6BD8CB]/30 bg-[#6BD8CB]/10 flex items-center justify-center text-3xl mx-auto mb-4">
            🏥
          </div>
          <h1 className="text-3xl font-bold mb-2 tracking-tight text-[#DCE1FB]">MedPrüf</h1>
          <p className="text-[#BCC9C6] text-base mb-1">{t("exam_prep", lang)}</p>
          <p className="text-[#879391] text-sm">{t("demo_description", lang)}</p>

          {/* Stats bar */}
          <div className="flex items-center justify-center gap-6 mt-5">
            <div className="text-center">
              <p className="text-2xl font-bold text-[#6BD8CB] font-mono">
                {totalQuestions > 0 ? totalQuestions.toLocaleString("de-DE") : "7.042"}
              </p>
              <p className="text-xs text-[#879391]">{t("questions", lang)}</p>
            </div>
            <div className="w-px h-8 bg-[#3D4947]" />
            <div className="text-center">
              <p className="text-2xl font-bold text-[#FFB95F] font-mono">{topics.length || "19"}</p>
              <p className="text-xs text-[#879391]">{t("topics", lang)}</p>
            </div>
          </div>

          {/* Primary CTA */}
          <div className="mt-6">
            <Link
              href="/quiz?topic=random"
              className="inline-flex items-center gap-3 bg-[#6BD8CB] hover:bg-[#89F5E7] text-[#003732] px-7 py-3.5 rounded font-bold text-base pulse-glow transition-all active:scale-[0.98]"
            >
              <span className="text-xl">🚀</span>
              {lang === "de" ? "Übung starten" : "Start Practice"}
            </Link>
          </div>
        </div>
      </div>

      {/* Topics — prominent, clickable, no login required */}
      {topics.length > 0 && (
        <div className="px-4 pb-6 max-w-4xl mx-auto">
          <h2 className="text-base font-semibold mb-3 text-[#DCE1FB]">{t("practice_topics", lang)}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {topics.map((tp, i) => {
              const config = getTopicConfig(tp.topic);
              return (
                <Link
                  key={tp.topic}
                  href={`/quiz?topic=${encodeURIComponent(tp.topic)}`}
                  className="topic-card-border bg-[#191F31] border border-[#3D4947] rounded p-4 animate-fade-in hover:border-[#6BD8CB]/40 hover:bg-[#1E2640] transition-all active:scale-[0.98]"
                  style={{
                    borderLeftColor: config.color,
                    animationDelay: `${i * 50}ms`,
                  }}
                >
                  <div className="text-2xl mb-2">{config.icon}</div>
                  <div className="text-sm font-semibold mb-1 text-[#DCE1FB]">{tp.topic}</div>
                  <div className="text-xs text-[#879391] font-mono">
                    {tp.count} {t("questions", lang)}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Sign-in prompt — below topics */}
      <div className="px-4 pb-10 max-w-4xl mx-auto">
        <div className="border border-[#3D4947] rounded bg-[#151B2D] p-5 text-center">
          <p className="text-sm text-[#BCC9C6] font-medium mb-1">
            {lang === "de" ? "Fortschritt speichern & Statistiken verfolgen" : "Save progress & track your stats"}
          </p>
          <p className="text-xs text-[#879391] mb-4">
            {lang === "de"
              ? "Melde dich mit Telegram an — kostenlos, keine App nötig"
              : "Sign in with Telegram — free, no app required"}
          </p>

          {authLoading ? (
            <div className="flex items-center justify-center gap-2 text-[#879391] text-sm">
              <div className="w-4 h-4 border-2 border-[#6BD8CB] border-t-transparent rounded-full animate-spin" />
              {lang === "de" ? "Wird angemeldet…" : "Signing in…"}
            </div>
          ) : (
            <div className="flex justify-center">
              <div id="telegram-login-container" />
            </div>
          )}

          {authError && (
            <p className="text-xs text-[#FFB4AB] mt-2">{authError}</p>
          )}
        </div>
      </div>
    </div>
  );
}
