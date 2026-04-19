"use client";

/**
 * Curriculum page — redesigned per MPDS alt Curriculum-B (2D heatmap matrix).
 *
 * Data reality (2026-04-17): MedPrüf does not track per-subarea (sub-topic)
 * accuracy — only per-topic (`questions.topic`). So the "true" 2D matrix
 * would be mostly empty. Instead we build a meaningful 2-column heatmap per
 * topic, using derived signals we already have:
 *
 *   Col 1: Accuracy       — % correct from /api/stats topicStats (the primary
 *                           mastery signal; also the color driver for the row).
 *   Col 2: Progress       — % of the topic's questions the user has answered
 *                           (coverage). Colored independently.
 *
 * Plus a rightmost average column (Accuracy, the dominant KPI).
 * Rows = all specialties in the active exam (SIP 4 + SIP 5 for Kenntnisprüfung).
 *
 * If/when per-subarea tags (e.g. `subarea` column) ship, this file can swap
 * in a wider grid without touching the rest of the page.
 *
 * Interaction:
 *   - Row label click → /quiz?topic=... (practice that topic)
 *   - Cell hover → tooltip "Topic / Column — N/M answered — X% accuracy"
 *   - Cell click → same as row label
 *   - Mobile: horizontal-scroll inside the grid container
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { BrandedLoader } from "@/components/Logo";
import Link from "next/link";
import { t, getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { VIENNA_EXAM_PARTS, getStoredExamSource } from "@/lib/topics";
import { getAllTopicStats, type TopicStats } from "@/lib/weakness";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { Map as MapIcon, GraduationCap, Shuffle } from "lucide-react";

type Lang = "de" | "en";

// Known totals per specialty
const TOPIC_TOTALS: Record<string, number> = {
  "Innere Medizin": 1615,
  "Chirurgische Fächer": 1230,
  "Dermatologie und Venerologie": 746,
  "Frauenheilkunde/Gynäkologie": 745,
  Neurologie: 725,
  Psychiatrie: 685,
  "Notfall- und Intensivmedizin": 672,
  "Kinder- und Jugendheilkunde": 503,
  "Hals-Nasen-Ohrenheilkunde": 405,
  Augenheilkunde: 399,
};

// Catalog total across all 3 exam types (2026-04-15).
const TOTAL_QUESTIONS = 10993;

interface TopicData {
  topic: string;
  total: number;
  answered: number;
  correct: number;
  accuracy: number;
}

// Short-label map — heatmap rows need tight text.
const TOPIC_SHORT: Record<string, { de: string; en: string }> = {
  "Innere Medizin": { de: "Innere", en: "Internal" },
  "Chirurgische Fächer": { de: "Chirurgie", en: "Surgery" },
  "Dermatologie und Venerologie": { de: "Derma", en: "Derma" },
  "Frauenheilkunde/Gynäkologie": { de: "Gyn", en: "Gyn" },
  Neurologie: { de: "Neuro", en: "Neuro" },
  Psychiatrie: { de: "Psych", en: "Psych" },
  "Notfall- und Intensivmedizin": { de: "Notfall", en: "Emerg." },
  "Kinder- und Jugendheilkunde": { de: "Päd", en: "Peds" },
  "Hals-Nasen-Ohrenheilkunde": { de: "HNO", en: "ENT" },
  Augenheilkunde: { de: "Augen", en: "Ophth." },
};

function shortLabel(topic: string, lang: Lang) {
  const map = TOPIC_SHORT[topic];
  if (!map) return topic;
  return lang === "de" ? map.de : map.en;
}

/** Map an accuracy % to a bucket: unseen | low | mid | good | strong. */
type Bucket = "unseen" | "low" | "mid" | "good" | "strong";
function bucketAccuracy(answered: number, accuracy: number): Bucket {
  if (answered === 0) return "unseen";
  if (accuracy < 40) return "low";
  if (accuracy < 70) return "mid";
  if (accuracy < 90) return "good";
  return "strong";
}

/** Map a coverage % (progress) to the same 5-bucket scale. */
function bucketProgress(progressPct: number, total: number): Bucket {
  if (total === 0) return "unseen";
  if (progressPct === 0) return "unseen";
  if (progressPct < 25) return "low";
  if (progressPct < 50) return "mid";
  if (progressPct < 80) return "good";
  return "strong";
}

function Cell({
  bucket,
  value,
  label,
  tooltip,
  href,
}: {
  bucket: Bucket;
  value: string;
  label: string;
  tooltip: string;
  href: string;
}) {
  // Per-bucket tone. Uses MPDS semantic tokens.
  const toneCls = {
    unseen:
      "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)] border border-dashed border-[var(--mp-border)]",
    low:
      "bg-[var(--mp-error-bg)] text-[var(--mp-status-error)] border border-[var(--mp-error-bg)]",
    mid:
      "bg-[var(--mp-warning-bg)] text-[var(--mp-status-warning)] border border-[var(--mp-warning-bg)]",
    good:
      "bg-[var(--mp-viridian)]/30 text-[var(--mp-fg)] border border-[var(--mp-viridian)]/30",
    strong:
      "bg-[var(--mp-viridian)] text-white border border-[var(--mp-viridian)]",
  }[bucket];

  return (
    <Link
      href={href}
      title={tooltip}
      aria-label={`${label}: ${tooltip}`}
      className={`group relative flex items-center justify-center rounded-md font-mono text-[10px] md:text-[11px] font-bold transition-transform duration-150 hover:scale-105 active:scale-95 min-w-[44px] h-[36px] md:min-w-[52px] md:h-[40px] ${toneCls}`}
    >
      {value}
    </Link>
  );
}

function HeatmapRow({
  td,
  userId,
  lang,
  examSource,
}: {
  td: TopicData;
  userId: string;
  lang: Lang;
  examSource: string;
}) {
  const qs = userId
    ? `/quiz?topic=${encodeURIComponent(td.topic)}&userId=${userId}&examSource=${examSource}`
    : `/quiz?topic=${encodeURIComponent(td.topic)}&examSource=${examSource}`;

  const progressPct =
    td.total > 0 ? Math.min(100, Math.round((td.answered / td.total) * 100)) : 0;

  const accBucket = bucketAccuracy(td.answered, td.accuracy);
  const progBucket = bucketProgress(progressPct, td.total);

  // Tooltip format per spec: "Topic / Column — N/M answered — X% accuracy"
  const accTooltip =
    td.answered > 0
      ? `${td.topic} / ${lang === "de" ? "Genauigkeit" : "Accuracy"} — ${td.correct}/${td.answered} ${lang === "de" ? "korrekt" : "correct"} — ${td.accuracy}%`
      : `${td.topic} / ${lang === "de" ? "Genauigkeit" : "Accuracy"} — ${lang === "de" ? "noch keine Antworten" : "no answers yet"}`;
  const progTooltip = `${td.topic} / ${lang === "de" ? "Fortschritt" : "Progress"} — ${td.answered}/${td.total} ${lang === "de" ? "bearbeitet" : "answered"} — ${progressPct}%`;

  const avgColor =
    td.answered === 0
      ? "text-[var(--mp-fg-subtle)]"
      : td.accuracy >= 70
      ? "text-[var(--mp-viridian)]"
      : td.accuracy >= 40
      ? "text-[var(--mp-status-warning)]"
      : "text-[var(--mp-status-error)]";

  return (
    <div className="grid grid-cols-[120px_1fr_1fr_52px] md:grid-cols-[160px_1fr_1fr_64px] gap-2 items-center py-1">
      <Link
        href={qs}
        className="text-xs md:text-sm font-display font-bold text-[var(--mp-fg)] hover:text-[var(--mp-viridian)] truncate"
        title={td.topic}
      >
        {shortLabel(td.topic, lang)}
      </Link>
      <Cell
        bucket={accBucket}
        value={td.answered > 0 ? `${td.accuracy}` : "—"}
        label={lang === "de" ? "Genauigkeit" : "Accuracy"}
        tooltip={accTooltip}
        href={qs}
      />
      <Cell
        bucket={progBucket}
        value={progressPct > 0 ? `${progressPct}` : "—"}
        label={lang === "de" ? "Fortschritt" : "Progress"}
        tooltip={progTooltip}
        href={qs}
      />
      <div
        className={`text-right font-mono font-bold text-[11px] md:text-xs ${avgColor}`}
        title={accTooltip}
      >
        {td.answered > 0 ? `${td.accuracy}` : "—"}
      </div>
    </div>
  );
}

function HeatmapSection({
  title,
  topics,
  userId,
  lang,
  examSource,
  accentVar,
}: {
  title: string;
  topics: TopicData[];
  userId: string;
  lang: Lang;
  examSource: string;
  accentVar: string;
}) {
  if (topics.length === 0) return null;
  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-1 h-7 rounded-full" style={{ background: accentVar }} />
        <h2 className="text-lg font-bold text-[var(--mp-fg)]">{title}</h2>
        <span className="text-xs text-[var(--mp-fg-subtle)] font-mono">
          {topics.reduce((s, t2) => s + t2.total, 0).toLocaleString("de-DE")}{" "}
          {t("questions", lang)}
        </span>
      </div>

      <div className="mp-card p-3 md:p-4 overflow-x-auto">
        {/* Header row */}
        <div className="grid grid-cols-[120px_1fr_1fr_52px] md:grid-cols-[160px_1fr_1fr_64px] gap-2 items-center pb-2 mb-2 border-b border-[var(--mp-border)]">
          <div className="mp-caption text-[var(--mp-fg-subtle)]">
            {lang === "de" ? "Thema" : "Topic"}
          </div>
          <div className="mp-caption text-[var(--mp-fg-subtle)] text-center">
            {lang === "de" ? "Genauigkeit" : "Accuracy"}
          </div>
          <div className="mp-caption text-[var(--mp-fg-subtle)] text-center">
            {lang === "de" ? "Fortschritt" : "Progress"}
          </div>
          <div className="mp-caption text-[var(--mp-fg-subtle)] text-right">
            ∅
          </div>
        </div>

        {topics.map((td) => (
          <HeatmapRow
            key={td.topic}
            td={td}
            userId={userId}
            lang={lang}
            examSource={examSource}
          />
        ))}
      </div>
    </section>
  );
}

function Legend({ lang }: { lang: Lang }) {
  return (
    <div className="flex items-center flex-wrap gap-3 text-xs text-[var(--mp-fg-muted)]">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)]">
        {lang === "de" ? "Legende" : "Legend"}:
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-4 rounded-sm bg-[var(--mp-surface-sunken)] border border-dashed border-[var(--mp-border)]" />
        {lang === "de" ? "Noch nicht" : "Unseen"}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-4 rounded-sm bg-[var(--mp-error-bg)]" />
        &lt;40%
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-4 rounded-sm bg-[var(--mp-warning-bg)]" />
        40–70%
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-4 rounded-sm bg-[var(--mp-viridian)]/30" />
        70–90%
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-4 rounded-sm bg-[var(--mp-viridian)]" />
        &gt;90%
      </span>
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
  const [examSource, setExamSource] = useState("kenntnispruefung");

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
      // Guard against sessions without a gamification snapshot.
      const gm = session.gamification ?? {};
      setTotalXp(gm.total_xp || 0);
      setStreak(gm.current_streak || 0);
      const ans = gm.total_questions_answered || 0;
      const cor = gm.total_correct || 0;
      setTotalAnswered(ans);
      setAccuracy(ans > 0 ? Math.round((cor / ans) * 100) : 0);
    }
    setExamSource(getStoredExamSource());

    // Build topic data from known totals + localStorage quiz results
    const localStats = getAllTopicStats();
    const statsMap = new Map<string, TopicStats>();
    for (const s of localStats) {
      statsMap.set(s.topic, s);
    }

    const data: TopicData[] = Object.entries(TOPIC_TOTALS).map(
      ([topic, total]) => {
        const stat = statsMap.get(topic);
        return {
          topic,
          total,
          answered: stat?.total || 0,
          correct: stat?.correct || 0,
          accuracy: stat ? Math.round(stat.accuracy) : 0,
        };
      }
    );

    setTopicData(data);
    setLoading(false);
  }, []);

  // Server-side stats for logged-in users
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
              const serverStat = (
                data.topicStats as Record<
                  string,
                  { total: number; correct: number }
                >
              )[td.topic];
              if (serverStat) {
                return {
                  ...td,
                  answered: serverStat.total,
                  correct: serverStat.correct,
                  accuracy:
                    serverStat.total > 0
                      ? Math.round((serverStat.correct / serverStat.total) * 100)
                      : 0,
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

  const completionPct = Math.min(
    100,
    Math.round((totalAnswered / TOTAL_QUESTIONS) * 100)
  );

  // Build SIP 4 and SIP 5 topic lists
  const sip4Topics = useMemo(
    () =>
      VIENNA_EXAM_PARTS.sip4
        .map((name) => topicData.find((td) => td.topic === name))
        .filter(Boolean) as TopicData[],
    [topicData]
  );
  const sip5Topics = useMemo(
    () =>
      VIENNA_EXAM_PARTS.sip5
        .map((name) => topicData.find((td) => td.topic === name))
        .filter(Boolean) as TopicData[],
    [topicData]
  );

  const sip4Count = sip4Topics.reduce((sum, td) => sum + td.total, 0);
  const sip5Count = sip5Topics.reduce((sum, td) => sum + td.total, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)]">
        <BrandedLoader />
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar
        lang={lang}
        userId={userId}
        userName={userName}
        totalXp={totalXp}
        streak={streak}
        accuracy={accuracy}
      />

      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        {/* Header */}
        <div className="px-6 lg:px-10 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border)]">
          <Link
            href="/"
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            &larr; {t("back_home", lang)}
          </Link>
          <h1 className="text-base font-bold text-[var(--mp-fg)] flex items-center gap-2">
            <MapIcon className="w-4 h-4 text-[var(--mp-viridian)]" />
            {t("curriculum_title", lang)}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className="px-4 md:px-6 lg:px-10 py-5 max-w-5xl mx-auto space-y-6 pb-28">
          {/* Overview bar */}
          <div className="mp-card p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
              <div className="text-center">
                <span className="text-2xl font-black font-mono text-[var(--mp-fg)]">
                  {TOTAL_QUESTIONS.toLocaleString("de-DE")}
                </span>
                <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
                  {t("total_questions_label", lang)}
                </p>
              </div>
              <div className="w-px h-10 bg-[var(--mp-border)] hidden sm:block" />
              <div className="text-center">
                <span className="text-lg font-bold font-mono text-[var(--mp-status-warning)]">
                  {sip4Count.toLocaleString("de-DE")}
                </span>
                <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
                  {t("sip4_label", lang)}
                </p>
              </div>
              <div className="w-px h-10 bg-[var(--mp-border)] hidden sm:block" />
              <div className="text-center">
                <span className="text-lg font-bold font-mono text-[var(--mp-viridian)]">
                  {sip5Count.toLocaleString("de-DE")}
                </span>
                <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
                  {t("sip5_label", lang)}
                </p>
              </div>
              <div className="w-px h-10 bg-[var(--mp-border)] hidden sm:block" />
              <div className="text-center">
                <span className="text-lg font-bold font-mono text-[var(--mp-cta-blue)]">
                  {completionPct}%
                </span>
                <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
                  {t("completion", lang)}
                </p>
              </div>
            </div>
          </div>

          {/* Heatmap lede + legend */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-xl font-display font-black text-[var(--mp-fg)] tracking-tight">
                {lang === "de"
                  ? "Deine Stärken-Heatmap"
                  : "Your Strengths Heatmap"}
              </h2>
              <p className="text-xs text-[var(--mp-fg-muted)] mt-1">
                {lang === "de"
                  ? `${sip4Topics.length + sip5Topics.length} Themen · Farbe = Genauigkeit · klicken zum Üben`
                  : `${sip4Topics.length + sip5Topics.length} topics · color = accuracy · click to practice`}
              </p>
            </div>
            <Legend lang={lang} />
          </div>

          {/* SIP 4 heatmap */}
          <HeatmapSection
            title={t("sip4_label", lang)}
            topics={sip4Topics}
            userId={userId}
            lang={lang}
            examSource={examSource}
            accentVar="var(--mp-status-warning)"
          />

          {/* SIP 5 heatmap */}
          <HeatmapSection
            title={t("sip5_label", lang)}
            topics={sip5Topics}
            userId={userId}
            lang={lang}
            examSource={examSource}
            accentVar="var(--mp-viridian)"
          />

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
              href={
                userId
                  ? `/quiz?topic=random&userId=${userId}`
                  : "/quiz?topic=random"
              }
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
