"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getLevelFromXP } from "@/lib/xp";
import { getTopicConfig } from "@/lib/topics";
import { t, getLang, setLang } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";

type Lang = 'de' | 'en'

interface TopicStat {
  total: number;
  correct: number;
}

interface Gamification {
  total_xp: number;
  current_streak: number;
  longest_streak: number;
  total_questions_answered: number;
  total_correct: number;
  level: number;
  rank_name: string;
}

function StatsContent() {
  const searchParams = useSearchParams();
  const userId = searchParams.get("userId") || "";
  const [gam, setGam] = useState<Gamification | null>(null);
  const [topicStats, setTopicStats] = useState<Record<string, TopicStat>>({});
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState<Lang>('de');

  useEffect(() => {
    setLangState(getLang());
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/stats?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        setGam(data.gamification);
        setTopicStats(data.topicStats || {});
      })
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const xpInfo = getLevelFromXP(gam?.total_xp || 0);
  const accuracy = gam && gam.total_questions_answered > 0
    ? Math.round((gam.total_correct / gam.total_questions_answered) * 100)
    : 0;

  return (
    <main className="min-h-screen safe-area-top safe-area-bottom px-4 pt-4 pb-8">
      <div className="flex items-center justify-between mb-6">
        <Link href="/" className="text-slate-400">← {t('back_home', lang)}</Link>
        <h1 className="text-lg font-bold">{t('statistics', lang)}</h1>
        <LanguageToggle lang={lang} onChange={switchLang} />
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-amber-400">{gam?.total_xp || 0}</div>
          <div className="text-sm text-slate-400">{t('total_xp', lang)}</div>
        </div>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-teal-400">Lv.{xpInfo.level}</div>
          <div className="text-sm text-slate-400">{xpInfo.rank}</div>
        </div>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-red-400">🔥 {gam?.current_streak || 0}</div>
          <div className="text-sm text-slate-400">{t('current_streak', lang)}</div>
        </div>
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-green-400">{accuracy}%</div>
          <div className="text-sm text-slate-400">{t('accuracy', lang)}</div>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 mb-6">
        <div className="flex justify-between mb-2">
          <span className="text-slate-400">{t('total_answered', lang)}</span>
          <span className="font-medium">{gam?.total_questions_answered || 0}</span>
        </div>
        <div className="flex justify-between mb-2">
          <span className="text-slate-400">{t('correct', lang)}</span>
          <span className="font-medium text-green-400">{gam?.total_correct || 0}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">{t('longest_streak', lang)}</span>
          <span className="font-medium">{gam?.longest_streak || 0} {t('days', lang)}</span>
        </div>
      </div>

      {/* Topic Breakdown */}
      {Object.keys(topicStats).length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">{t('topic_breakdown', lang)}</h2>
          <div className="space-y-2">
            {Object.entries(topicStats)
              .sort(([, a], [, b]) => b.total - a.total)
              .map(([topic, stat]) => {
                const config = getTopicConfig(topic);
                const acc = stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
                return (
                  <div key={topic} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span>{config.icon}</span>
                        <span className="text-sm font-medium">{topic}</span>
                      </div>
                      <span className="text-sm text-slate-400">{stat.total} {t('questions', lang)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-700 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full transition-all"
                          style={{
                            width: `${acc}%`,
                            backgroundColor: acc >= 70 ? '#10B981' : acc >= 40 ? '#F59E0B' : '#EF4444'
                          }}
                        />
                      </div>
                      <span className="text-xs text-slate-400 w-10 text-right">{acc}%</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </main>
  );
}

export default function StatsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <StatsContent />
    </Suspense>
  );
}
