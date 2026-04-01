"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getLevelFromXP } from "@/lib/xp";
import { getTopicConfig, TOPIC_CONFIG } from "@/lib/topics";
import { t, getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import LanguageToggle from "@/components/LanguageToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";

type Lang = "de" | "en";

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
  daily_questions_today?: number;
}

// Approximate total questions available per topic (from the DB)
const TOPIC_TOTALS: Record<string, number> = {
  "Innere Medizin": 1200,
  "Chirurgische Fächer": 1100,
  "Kinder- und Jugendheilkunde": 900,
  "Neurologie": 700,
  "Dermatologie und Venerologie": 600,
  "Frauenheilkunde/Gynäkologie": 650,
  "Notfall- und Intensivmedizin": 550,
  "Hals-Nasen-Ohrenheilkunde": 450,
  "Psychiatrie": 500,
  "Augenheilkunde": 400,
};

const TOTAL_AVAILABLE = 7042;

function formatStudyTime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function StatsContent() {
  const searchParams = useSearchParams();
  const rawUserId = searchParams.get("userId") || "";
  const [gam, setGam] = useState<Gamification | null>(null);
  const [topicStats, setTopicStats] = useState<Record<string, TopicStat>>({});
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState(rawUserId);
  const [userName, setUserName] = useState("");

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (!rawUserId && session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
    } else if (session) {
      setUserName(session.user.first_name);
    }
  }, [rawUserId]);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  useEffect(() => {
    const uid = userId || rawUserId;
    if (!uid) {
      setLoading(false);
      return;
    }
    fetch(`/api/stats?userId=${uid}`)
      .then((r) => r.json())
      .then((data) => {
        setGam(data.gamification);
        setTopicStats(data.topicStats || {});
      })
      .finally(() => setLoading(false));
  }, [userId, rawUserId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0C1324]">
        <div className="w-10 h-10 border-2 border-[#6BD8CB] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const xpInfo = getLevelFromXP(gam?.total_xp || 0);
  const accuracy =
    gam && gam.total_questions_answered > 0
      ? Math.round((gam.total_correct / gam.total_questions_answered) * 100)
      : 0;

  // Study time estimate: avg 1.5 min per question
  const studyMinutes = Math.round((gam?.total_questions_answered || 0) * 1.5);
  const overallCompletion = Math.min(100, Math.round(((gam?.total_questions_answered || 0) / TOTAL_AVAILABLE) * 100));

  // No user
  if (!userId && !rawUserId) {
    return (
      <div className="app-layout">
        <Sidebar lang={lang} />
        <main className="main-content safe-area-top safe-area-bottom bg-[#0C1324]">
          <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#3D4947]">
            <Link href="/" className="text-[#879391] hover:text-[#DCE1FB] transition-colors text-sm">
              ← {t("back_home", lang)}
            </Link>
            <h1 className="text-base font-bold text-[#DCE1FB]">{t("statistics", lang)}</h1>
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-60px)] px-4 text-center">
            <div className="text-5xl mb-4">📊</div>
            <p className="text-[#BCC9C6] font-medium mb-2">{t("sign_in_for_stats", lang)}</p>
            <Link href="/" className="mt-4 px-6 py-3 bg-[#6BD8CB] text-[#003732] rounded font-bold text-sm hover:bg-[#89F5E7] transition-colors">
              {t("back_home", lang)}
            </Link>
          </div>
        </main>
        <BottomNav lang={lang} />
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={userId} userName={userName} totalXp={gam?.total_xp} streak={gam?.current_streak} accuracy={accuracy} />

      <main className="main-content safe-area-top safe-area-bottom bg-[#0C1324]">
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#3D4947]">
          <Link href="/" className="text-[#879391] hover:text-[#DCE1FB] transition-colors text-sm">
            ← {t("back_home", lang)}
          </Link>
          <h1 className="text-base font-bold text-[#DCE1FB]">{t("statistics", lang)}</h1>
          <LanguageToggle lang={lang} onChange={switchLang} />
        </div>

        <div className="px-4 lg:px-8 py-5 max-w-2xl mx-auto space-y-5">

          {/* Overview Cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 text-center">
              <div className="text-3xl font-bold text-[#FFB95F] font-mono">{gam?.total_xp || 0}</div>
              <div className="text-xs text-[#879391]">{t("total_xp", lang)}</div>
            </div>
            <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 text-center">
              <div className="text-3xl font-bold text-[#6BD8CB] font-mono">Lv.{xpInfo.level}</div>
              <div className="text-xs text-[#879391]">{xpInfo.rank}</div>
            </div>
            <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 text-center">
              <div className="text-3xl font-bold text-[#FFB4AB] font-mono">🔥 {gam?.current_streak || 0}</div>
              <div className="text-xs text-[#879391]">{t("current_streak", lang)}</div>
            </div>
            <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 text-center">
              <div className="text-3xl font-bold text-[#4EDEA3] font-mono">{accuracy}%</div>
              <div className="text-xs text-[#879391]">{t("accuracy", lang)}</div>
            </div>
          </div>

          {/* Summary row */}
          <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 space-y-2.5">
            <StatRow label={t("total_answered", lang)} value={String(gam?.total_questions_answered || 0)} valueClass="text-[#DCE1FB]" />
            <StatRow label={t("correct", lang)} value={String(gam?.total_correct || 0)} valueClass="text-[#4EDEA3]" />
            <StatRow label={t("longest_streak", lang)} value={`${gam?.longest_streak || 0} ${t("days", lang)}`} valueClass="text-[#DCE1FB]" />
            <StatRow label={t("study_time_est", lang)} value={formatStudyTime(studyMinutes)} valueClass="text-[#6BD8CB]" />
          </div>

          {/* Overall progress */}
          <div className="bg-[#191F31] border border-[#3D4947] rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-[#DCE1FB]">{t("completion_pct", lang)}</span>
              <span className="text-sm font-bold font-mono text-[#6BD8CB]">{overallCompletion}%</span>
            </div>
            <div className="h-2 bg-[#23293C] rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-[#6BD8CB] rounded-full transition-all duration-700"
                style={{ width: `${overallCompletion}%` }}
              />
            </div>
            <p className="text-[10px] text-[#879391] font-mono">
              {gam?.total_questions_answered || 0} / {TOTAL_AVAILABLE.toLocaleString("de-DE")} {t("questions", lang)}
            </p>
          </div>

          {/* Daily goal */}
          {gam?.daily_questions_today !== undefined && (
            <div className="bg-[#191F31] border border-[#3D4947] rounded p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-[#DCE1FB]">
                  {lang === "de" ? "Tagesziel (heute)" : "Daily Goal (today)"}
                </span>
                <span className="text-xs text-[#879391] font-mono">
                  {gam.daily_questions_today} / 20
                </span>
              </div>
              <div className="h-2 bg-[#23293C] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, Math.round((gam.daily_questions_today / 20) * 100))}%`,
                    backgroundColor: gam.daily_questions_today >= 20 ? "#4EDEA3" : "#FFB95F",
                  }}
                />
              </div>
            </div>
          )}

          {/* Per-specialty accuracy */}
          {Object.keys(topicStats).length > 0 && (
            <div>
              <h2 className="text-base font-semibold mb-3 text-[#DCE1FB]">{t("topic_breakdown", lang)}</h2>
              <div className="space-y-2">
                {Object.entries(topicStats)
                  .sort(([, a], [, b]) => b.total - a.total)
                  .map(([topic, stat]) => {
                    const config = getTopicConfig(topic);
                    const acc = stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0;
                    return (
                      <div key={topic} className="bg-[#191F31] border border-[#3D4947] rounded p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span>{config.icon}</span>
                            <span className="text-sm font-medium text-[#DCE1FB]">{topic}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[#879391] font-mono">{stat.total} {t("answered", lang)}</span>
                            <span
                              className={`text-sm font-bold font-mono ${
                                acc >= 70 ? "text-[#4EDEA3]" : acc >= 40 ? "text-[#FFB95F]" : "text-[#FFB4AB]"
                              }`}
                            >
                              {acc}%
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-[#23293C] rounded-full h-1">
                            <div
                              className="h-1 rounded-full transition-all"
                              style={{
                                width: `${acc}%`,
                                backgroundColor: acc >= 70 ? "#4EDEA3" : acc >= 40 ? "#FFB95F" : "#FFB4AB",
                              }}
                            />
                          </div>
                          <span className="text-[10px] text-[#879391] w-16 text-right font-mono">
                            {stat.correct}/{stat.total}
                          </span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* All-specialties progress (questions practiced vs available) */}
          <div>
            <h2 className="text-base font-semibold mb-3 text-[#DCE1FB]">{t("questions_per_specialty", lang)}</h2>
            <div className="space-y-2">
              {Object.entries(TOPIC_CONFIG).map(([topic, config]) => {
                const answered = topicStats[topic]?.total || 0;
                const total = TOPIC_TOTALS[topic] || 0;
                const pct = total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;
                return (
                  <div key={topic} className="bg-[#191F31] border border-[#3D4947] rounded p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span>{config.icon}</span>
                        <span className="text-xs text-[#DCE1FB]">{topic}</span>
                      </div>
                      <span className="text-[10px] text-[#879391] font-mono">{answered}/{total}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-[#23293C] rounded-full h-1 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: config.color,
                            opacity: pct > 0 ? 1 : 0.3,
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-[#879391] font-mono w-8 text-right">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick action */}
          <div className="pb-4">
            <Link
              href={`/exam`}
              className="flex items-center justify-center gap-3 w-full py-3.5 bg-[#FFB95F]/12 border border-[#FFB95F]/25 rounded text-[#FFB95F] font-semibold text-sm hover:bg-[#FFB95F]/20 transition-colors"
            >
              🎓 {lang === "de" ? "Prüfungssimulation starten" : "Start Exam Simulation"}
            </Link>
          </div>
        </div>
      </main>

      <BottomNav lang={lang} userId={userId} />
    </div>
  );
}

function StatRow({ label, value, valueClass }: { label: string; value: string; valueClass: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-sm text-[#BCC9C6]">{label}</span>
      <span className={`font-medium font-mono text-sm ${valueClass}`}>{value}</span>
    </div>
  );
}

export default function StatsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-[#0C1324]">
          <div className="w-10 h-10 border-2 border-[#6BD8CB] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <StatsContent />
    </Suspense>
  );
}
