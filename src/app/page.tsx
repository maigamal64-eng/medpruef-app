"use client";

import { useEffect, useState, useCallback } from "react";
import { getTopicConfig } from "@/lib/topics";
import { getLevelFromXP } from "@/lib/xp";
import Link from "next/link";

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
        // For non-Telegram access, show demo mode
        setError("demo");
        setLoading(false);
        return;
      }

      const data = await res.json();
      setUser(data.user);
      setGam(data.gamification);

      // Fetch topics
      const topicRes = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "topics" }),
      });
      const topicData = await topicRes.json();
      setTopics(topicData);
    } catch (e) {
      console.error(e);
      setError("Verbindungsfehler");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    authenticate();
  }, [authenticate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Laden...</p>
        </div>
      </div>
    );
  }

  if (error === "demo" || !user) {
    return <DemoHome topics={topics} />;
  }

  const xpInfo = getLevelFromXP(gam?.total_xp || 0);
  const accuracy = gam && gam.total_questions_answered > 0
    ? Math.round((gam.total_correct / gam.total_questions_answered) * 100)
    : 0;

  return (
    <main className="min-h-screen safe-area-top safe-area-bottom">
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold">
              Hallo, {user.first_name}! 👋
            </h1>
            <p className="text-slate-400 text-sm">
              {xpInfo.rank} · Level {xpInfo.level}
            </p>
          </div>
          <Link
            href="/stats"
            className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center"
          >
            📊
          </Link>
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatCard icon="⚡" value={gam?.total_xp || 0} label="XP" color="text-amber-400" />
          <StatCard icon="🔥" value={gam?.current_streak || 0} label="Streak" color="text-red-400" />
          <StatCard icon="✅" value={`${accuracy}%`} label="Genauigkeit" color="text-green-400" />
        </div>

        {/* XP Progress Bar */}
        <div className="bg-slate-800 rounded-full h-2 mb-1">
          <div
            className="bg-gradient-to-r from-teal-500 to-teal-400 h-2 rounded-full transition-all duration-500"
            style={{ width: `${xpInfo.progress}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 mb-4">
          {Math.round(xpInfo.progress)}% zum nächsten Level
        </p>

        {/* Daily Progress */}
        <div className="bg-slate-800/50 rounded-xl p-3 mb-6 border border-slate-700/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-300">Tagesziel</span>
            <span className="text-sm font-medium text-teal-400">
              {gam?.daily_questions_today || 0}/{user.daily_goal}
            </span>
          </div>
          <div className="bg-slate-700 rounded-full h-1.5">
            <div
              className="bg-teal-500 h-1.5 rounded-full transition-all"
              style={{ width: `${Math.min(100, ((gam?.daily_questions_today || 0) / user.daily_goal) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Quick Start */}
      <div className="px-4 mb-6">
        <Link
          href={`/quiz?topic=random&userId=${user.id}`}
          className="block w-full bg-gradient-to-r from-teal-600 to-teal-500 text-white text-center py-4 rounded-2xl font-semibold text-lg shadow-lg shadow-teal-500/20 pulse-glow"
        >
          🚀 Schnellstart — Zufälliges Thema
        </Link>
      </div>

      {/* Topics Grid */}
      <div className="px-4 pb-8">
        <h2 className="text-lg font-semibold mb-3">Fachgebiete</h2>
        <div className="grid grid-cols-2 gap-3">
          {topics.map((t) => {
            const config = getTopicConfig(t.topic);
            return (
              <Link
                key={t.topic}
                href={`/quiz?topic=${encodeURIComponent(t.topic)}&userId=${user.id}`}
                className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 hover:bg-slate-800 transition-colors active:scale-95"
              >
                <div className="text-2xl mb-2">{config.icon}</div>
                <div className="text-sm font-medium leading-tight mb-1">
                  {t.topic}
                </div>
                <div className="text-xs text-slate-400">
                  {t.count} Fragen
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function StatCard({ icon, value, label, color }: { icon: string; value: number | string; label: string; color: string }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 text-center">
      <div className="text-lg mb-0.5">{icon}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}

function DemoHome({ topics }: { topics: TopicCount[] }) {
  return (
    <main className="min-h-screen safe-area-top safe-area-bottom px-4 pt-8">
      <div className="text-center mb-8">
        <div className="text-5xl mb-4">🏥</div>
        <h1 className="text-2xl font-bold mb-2">MedPrüf</h1>
        <p className="text-slate-400">Deutsche Medizinprüfung Vorbereitung</p>
        <p className="text-slate-500 text-sm mt-2">
          Öffne diese App in Telegram für den vollen Zugang.
        </p>
      </div>
      
      {topics.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">
            {topics.reduce((sum, t) => sum + t.count, 0)} Fragen in {topics.length} Fachgebieten
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {topics.map((t) => {
              const config = getTopicConfig(t.topic);
              return (
                <div key={t.topic} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                  <div className="text-2xl mb-2">{config.icon}</div>
                  <div className="text-sm font-medium">{t.topic}</div>
                  <div className="text-xs text-slate-400">{t.count} Fragen</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
