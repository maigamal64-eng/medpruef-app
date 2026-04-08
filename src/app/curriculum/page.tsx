"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { t, getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { getTopicConfig, VIENNA_EXAM_PARTS, getStoredExamSource } from "@/lib/topics";
import { getAllTopicStats, type TopicStats } from "@/lib/weakness";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import TopicIcon from "@/components/TopicIcon";
import { Map as MapIcon, GraduationCap, Shuffle, ArrowRight } from "lucide-react";

type Lang = "de" | "en";

// Known totals per specialty
const TOPIC_TOTALS: Record<string, number> = {
  "Innere Medizin": 1615,
  "Chirurgische Fächer": 1230,
  "Dermatologie und Venerologie": 746,
  "Frauenheilkunde/Gynäkologie": 745,
  "Neurologie": 725,
  "Psychiatrie": 685,
  "Notfall- und Intensivmedizin": 672,
  "Kinder- und Jugendheilkunde": 503,
  "Hals-Nasen-Ohrenheilkunde": 405,
  "Augenheilkunde": 399,
};

const TOTAL_QUESTIONS = 7725;

interface TopicData {
  topic: string;
  total: number;
  answered: number;
  correct: number;
  accuracy: number;
}

function SpecialtyCard({
  data,
  userId,
  lang,
}: {
  data: TopicData;
  userId: string;
  lang: Lang;
}) {
  const config = getTopicConfig(data.topic);
  const completionPct =
    data.total > 0 ? Math.min(100, Math.round((data.answered / data.total) * 100)) : 0;
  const examSource = getStoredExamSource();

  return (
    <div
      className="card-interactive rounded-2xl p-6 min-h-[200px] flex flex-col relative overflow-hidden group"
    >
      {/* Colored top accent bar */}
      <div className="absolute top-0 left-0 right-0 h-1.5 rounded-t-2xl" style={{ backgroundColor: config.color }} />

      {/* Icon + Name */}
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-110"
          style={{ backgroundColor: `${config.color}18` }}
        >
          <TopicIcon name={config.icon} className="w-6 h-6" style={{ color: config.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-[#1A2B3C] leading-snug line-clamp-2" title={data.topic}>{data.topic}</h3>
          <p className="text-xs text-[#A0AEC0] font-mono mt-1">
            {data.total.toLocaleString("de-DE")} {t("questions", lang)}
          </p>
        </div>
      </div>

      {/* Completion bar */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[#A0AEC0]">
            {data.answered}/{data.total}
          </span>
          <span className="text-xs font-mono font-semibold text-[#1A2B3C]">
            {completionPct}%
          </span>
        </div>
        <div className="h-2.5 bg-[#F7F9FC] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${completionPct}%`,
              background: `linear-gradient(to right, ${config.color}, ${config.color}99)`,
            }}
          />
        </div>
      </div>

      {/* Accuracy pill */}
      {data.answered > 0 && (
        <div className="mb-3">
          <span
            className={`inline-flex items-center text-xs font-bold font-mono px-2 py-0.5 rounded-full ${
              data.accuracy >= 70
                ? "bg-[#00A896]/10 text-[#00A896]"
                : data.accuracy >= 40
                ? "bg-[#F4A261]/10 text-[#F4A261]"
                : "bg-[#D64545]/10 text-[#D64545]"
            }`}
          >
            {data.accuracy}% {lang === "de" ? "Genauigkeit" : "Accuracy"}
          </span>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Start Practice link */}
      <Link
        href={
          userId
            ? `/quiz?topic=${encodeURIComponent(data.topic)}&userId=${userId}&examSource=${examSource}`
            : `/quiz?topic=${encodeURIComponent(data.topic)}&examSource=${examSource}`
        }
        className="flex items-center justify-center gap-2 mt-2 py-3 rounded-xl text-sm font-semibold transition-all duration-200 border shadow-sm hover:shadow-md active:scale-[0.98]"
        style={{
          backgroundColor: `${config.color}12`,
          color: config.color,
          borderColor: `${config.color}25`,
        }}
      >
        {t("start_practice_topic", lang)} <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

export default function CurriculumPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [totalXp, setTotalXp] = useState(0);
  const [streak, setStreak] = useState(0);
  const [accuracy, setAccuracy] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [topicData, setTopicData] = useState<TopicData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
      setTotalXp(session.gamification.total_xp || 0);
      setStreak(session.gamification.current_streak || 0);
      const ans = session.gamification.total_questions_answered || 0;
      const cor = session.gamification.total_correct || 0;
      setTotalAnswered(ans);
      setAccuracy(ans > 0 ? Math.round((cor / ans) * 100) : 0);
    }

    // Build topic data from known totals + localStorage quiz results
    const localStats = getAllTopicStats();
    const statsMap = new Map<string, TopicStats>();
    for (const s of localStats) {
      statsMap.set(s.topic, s);
    }

    const data: TopicData[] = Object.entries(TOPIC_TOTALS).map(([topic, total]) => {
      const stat = statsMap.get(topic);
      return {
        topic,
        total,
        answered: stat?.total || 0,
        correct: stat?.correct || 0,
        accuracy: stat ? Math.round(stat.accuracy) : 0,
      };
    });

    setTopicData(data);
    setLoading(false);
  }, []);

  // Also try to get server-side stats if user is logged in
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/stats?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.gamification) {
          setTotalXp(data.gamification.total_xp || 0);
          setStreak(data.gamification.current_streak || 0);
          const ans = data.gamification.total_questions_answered || 0;
          const cor = data.gamification.total_correct || 0;
          setTotalAnswered(ans);
          setAccuracy(ans > 0 ? Math.round((cor / ans) * 100) : 0);
        }
        if (data.topicStats) {
          setTopicData((prev) =>
            prev.map((td) => {
              const serverStat = (data.topicStats as Record<string, { total: number; correct: number }>)[td.topic];
              if (serverStat) {
                return {
                  ...td,
                  answered: serverStat.total,
                  correct: serverStat.correct,
                  accuracy: serverStat.total > 0 ? Math.round((serverStat.correct / serverStat.total) * 100) : 0,
                };
              }
              return td;
            })
          );
        }
      })
      .catch(() => {});
  }, [userId]);

  const switchLang = useCallback((l: Lang) => {
    setLang(l);
    setLangState(l);
  }, []);

  const completionPct = Math.min(100, Math.round((totalAnswered / TOTAL_QUESTIONS) * 100));

  // Build SIP 4 and SIP 5 topic lists
  const sip4Topics = VIENNA_EXAM_PARTS.sip4
    .map((name) => topicData.find((td) => td.topic === name))
    .filter(Boolean) as TopicData[];

  const sip5Topics = VIENNA_EXAM_PARTS.sip5
    .map((name) => topicData.find((td) => td.topic === name))
    .filter(Boolean) as TopicData[];

  const sip4Count = sip4Topics.reduce((sum, td) => sum + td.total, 0);
  const sip5Count = sip5Topics.reduce((sum, td) => sum + td.total, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F7F9FC]">
        <div className="w-10 h-10 border-2 border-[#007B5F] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={userId} userName={userName} totalXp={totalXp} streak={streak} accuracy={accuracy} />

      <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#E4E9F0]">
          <Link href="/" className="text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors">
            &larr; {t("back_home", lang)}
          </Link>
          <h1 className="text-base font-bold text-[#1A2B3C] flex items-center gap-2">
            <MapIcon className="w-4 h-4 text-[#007B5F]" />
            {t("curriculum_title", lang)}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className="px-4 lg:px-8 py-5 max-w-5xl mx-auto space-y-8 pb-28">
          {/* Overview bar */}
          <div className="card rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
              <div className="text-center">
                <span className="text-2xl font-black font-mono text-[#1A2B3C]">
                  {TOTAL_QUESTIONS.toLocaleString("de-DE")}
                </span>
                <p className="text-xs text-[#A0AEC0] mt-0.5">{t("total_questions_label", lang)}</p>
              </div>
              <div className="w-px h-10 bg-[#E4E9F0] hidden sm:block" />
              <div className="text-center">
                <span className="text-lg font-bold font-mono text-[#F4A261]">
                  {sip4Count.toLocaleString("de-DE")}
                </span>
                <p className="text-xs text-[#A0AEC0] mt-0.5">{t("sip4_label", lang)}</p>
              </div>
              <div className="w-px h-10 bg-[#E4E9F0] hidden sm:block" />
              <div className="text-center">
                <span className="text-lg font-bold font-mono text-[#007B5F]">
                  {sip5Count.toLocaleString("de-DE")}
                </span>
                <p className="text-xs text-[#A0AEC0] mt-0.5">{t("sip5_label", lang)}</p>
              </div>
              <div className="w-px h-10 bg-[#E4E9F0] hidden sm:block" />
              <div className="text-center">
                <span className="text-lg font-bold font-mono text-[#003A8C]">
                  {completionPct}%
                </span>
                <p className="text-xs text-[#A0AEC0] mt-0.5">{t("completion", lang)}</p>
              </div>
            </div>
          </div>

          {/* SIP 4 Section */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1 h-8 rounded-full bg-[#F4A261]" />
              <h2 className="text-xl font-bold text-[#1A2B3C]">{t("sip4_label", lang)}</h2>
              <span className="text-sm text-[#A0AEC0] font-mono">
                {sip4Count.toLocaleString("de-DE")} {t("questions", lang)}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
              {sip4Topics.map((td) => (
                <SpecialtyCard key={td.topic} data={td} userId={userId} lang={lang} />
              ))}
            </div>
          </section>

          {/* SIP 5 Section */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1 h-8 rounded-full bg-[#007B5F]" />
              <h2 className="text-xl font-bold text-[#1A2B3C]">{t("sip5_label", lang)}</h2>
              <span className="text-sm text-[#A0AEC0] font-mono">
                {sip5Count.toLocaleString("de-DE")} {t("questions", lang)}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
              {sip5Topics.map((td) => (
                <SpecialtyCard key={td.topic} data={td} userId={userId} lang={lang} />
              ))}
            </div>
          </section>

          {/* Quick Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/exam"
              className="btn-primary flex-1 py-3.5 text-center text-sm rounded-xl"
            >
              <GraduationCap className="w-5 h-5" />
              {t("start_exam_simulation", lang)}
            </Link>
            <Link
              href={userId ? `/quiz?topic=random&userId=${userId}` : "/quiz?topic=random"}
              className="btn-secondary flex-1 py-3.5 text-center text-sm rounded-xl"
            >
              <Shuffle className="w-5 h-5" />
              {t("random_practice", lang)}
            </Link>
          </div>
        </div>
      </main>

      <BottomNav lang={lang} userId={userId} />
    </div>
  );
}
