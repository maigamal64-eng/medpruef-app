"use client";

/**
 * Curriculum / Lehrplan — reimplemented to the approved "Clinical Nocturne"
 * design (reviews/reimplementation-2026-06-26/design/08-exam-curriculum.html,
 * the Lehrplan half).
 *
 * GRAMMAR (per SPECS §13): each top-level fach is a card with its
 * TOPIC_CONFIG color edge + a per-topic completion ring + a "geübt" coverage
 * count. Desktop lays the same nodes in a 2-col grid; mobile is one column.
 * Numbers are mono + dot-thousands.
 *
 * DATA CONTRACT (kept, not the old UI):
 *   - Topic set: VIENNA_EXAM_PARTS (SIP 4 + SIP 5) from src/lib/topics.ts.
 *   - Per-topic denominators: TOPIC_TOTALS (known catalogue counts).
 *   - Per-topic progress: localStorage getAllTopicStats() seeds instantly,
 *     then /api/stats topicStats overrides for logged-in users (authFetch —
 *     /api/stats is requireUser-gated, so plain fetch would 401; the old page
 *     used plain fetch, a latent no-op refresh — fixed here).
 *   - The ring + count are COVERAGE (answered/total), the design's signal
 *     (mockup: 1.520/1.840 = 83%), NOT accuracy (which the old heatmap used).
 *
 * SUBTOPICS DROPPED ON PURPOSE: the mockup shows expand-to-subtopics
 * (Kardiologie etc.), but MedPrüf tracks per-TOPIC only — there is no
 * per-subarea table or API. Rather than fabricate splits, each fach card is a
 * direct link to /quiz?topic= (the live interaction). When a `subarea` signal
 * ships, the card can grow an expand without touching the rest of the page.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { BrandedLoader } from "@/components/Logo";
import Link from "next/link";
import { t, getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import {
  VIENNA_EXAM_PARTS,
  getStoredExamSource,
  getTopicConfig,
} from "@/lib/topics";
import { QUESTIONS } from "@/lib/content-truth";
import { getAllTopicStats, type TopicStats } from "@/lib/weakness";
import TopicIcon from "@/components/TopicIcon";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { AppLayout } from "@/components/ui";
import { Map as MapIcon, GraduationCap, Shuffle, ChevronRight } from "lucide-react";
import styles from "./curriculum.module.css";

type Lang = "de" | "en";

// Known totals per specialty (catalogue denominators). NOTE: these are static
// known counts; the live DB count is "moving" mid content-leak repair
// (NOTES.md), so coverage % is approximate, not a live denominator.
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

// Catalog total — sourced from content-truth.ts SSoT (review-2026-04-25-B11).
const TOTAL_QUESTIONS = QUESTIONS.total;

interface TopicData {
  topic: string;
  total: number;
  answered: number;
  correct: number;
}

/** Ring SVG uses r=16 → circumference ~100, so dashoffset = 100 - pct. */
const RING_CIRC = 100;

/** Coverage dot bucket (full / part / none) from coverage %. */
function coverageDot(answered: number, pct: number): "Full" | "Part" | "None" {
  if (answered === 0 || pct === 0) return "None";
  if (pct >= 80) return "Full";
  return "Part";
}

function FachCard({
  td,
  href,
  lang,
}: {
  td: TopicData;
  href: string;
  lang: Lang;
}) {
  const config = getTopicConfig(td.topic);
  const pct =
    td.total > 0 ? Math.min(100, Math.round((td.answered / td.total) * 100)) : 0;
  const dashoffset = RING_CIRC - (RING_CIRC * pct) / 100;

  const geuebt = lang === "de" ? "geübt" : "practiced";

  return (
    <Link
      href={href}
      className={styles.curtop}
      style={{ ["--sc" as string]: config.color }}
      aria-label={`${td.topic}: ${td.answered.toLocaleString("de-DE")} / ${td.total.toLocaleString("de-DE")} ${geuebt} (${pct}%)`}
    >
      <span className={styles.edge} />
      <div className={styles.ctIc}>
        <TopicIcon name={config.icon} className="w-[21px] h-[21px]" />
      </div>
      <div className={styles.ctBody}>
        <div className={styles.ctName}>{td.topic}</div>
        <div className={styles.ctMeta}>
          <ChevronRight className={styles.go} aria-hidden="true" />
          {td.total > 0
            ? `${td.answered.toLocaleString("de-DE")} / ${td.total.toLocaleString("de-DE")} ${geuebt}`
            : geuebt}
        </div>
      </div>
      <div className={styles.ctRing}>
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <circle
            className={styles.ringBg}
            cx="20"
            cy="20"
            r="16"
            fill="none"
            strokeWidth="4"
          />
          <circle
            className={styles.ringFg}
            cx="20"
            cy="20"
            r="16"
            fill="none"
            strokeWidth="4"
            strokeDasharray={RING_CIRC}
            strokeDashoffset={dashoffset}
          />
        </svg>
        <div className={styles.pc}>{pct}%</div>
      </div>
    </Link>
  );
}

function FachSection({
  title,
  topics,
  buildHref,
  lang,
}: {
  title: string;
  topics: TopicData[];
  buildHref: (topic: string) => string;
  lang: Lang;
}) {
  if (topics.length === 0) return null;
  const sectionTotal = topics.reduce((s, td) => s + td.total, 0);
  return (
    <section>
      <div className={styles.sectionHead}>
        <h2>{title}</h2>
        <span className={styles.ln} />
        <span className={styles.count}>
          {sectionTotal.toLocaleString("de-DE")} {t("questions", lang)}
        </span>
      </div>
      <div className={styles.grid}>
        {topics.map((td) => (
          <FachCard
            key={td.topic}
            td={td}
            href={buildHref(td.topic)}
            lang={lang}
          />
        ))}
      </div>
    </section>
  );
}

function Legend({ lang }: { lang: Lang }) {
  return (
    <div className={styles.legend}>
      <span className={styles.legendLbl}>
        {lang === "de" ? "Abdeckung" : "Coverage"}
      </span>
      <span className={styles.legendItem}>
        <span className={`${styles.legendDot} ${styles.dotFull}`} />
        {lang === "de" ? "Fast fertig" : "Almost done"}
      </span>
      <span className={styles.legendItem}>
        <span className={`${styles.legendDot} ${styles.dotPart}`} />
        {lang === "de" ? "In Arbeit" : "In progress"}
      </span>
      <span className={styles.legendItem}>
        <span className={`${styles.legendDot} ${styles.dotNone}`} />
        {lang === "de" ? "Noch nicht" : "Not yet"}
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
      const gm = session.gamification ?? {};
      setTotalXp(gm.total_xp || 0);
      setStreak(gm.current_streak || 0);
      const ans = gm.total_questions_answered || 0;
      const cor = gm.total_correct || 0;
      setTotalAnswered(ans);
      setAccuracy(ans > 0 ? Math.round((cor / ans) * 100) : 0);
    }
    setExamSource(getStoredExamSource());

    // Seed topic data from known totals + localStorage quiz results.
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
        };
      }
    );

    setTopicData(data);
    setLoading(false);
  }, []);

  // Server-side stats override for logged-in users (authFetch — gated route).
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

  const buildHref = useCallback(
    (topic: string) =>
      userId
        ? `/quiz?topic=${encodeURIComponent(topic)}&userId=${userId}&examSource=${examSource}`
        : `/quiz?topic=${encodeURIComponent(topic)}&examSource=${examSource}`,
    [userId, examSource]
  );

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
      <div className="flex items-center justify-center min-h-screen bg-[var(--mp-bg)]">
        <BrandedLoader />
      </div>
    );
  }

  return (
    <AppLayout
      sidebar={
        <Sidebar
          lang={lang}
          userId={userId}
          userName={userName}
          totalXp={totalXp}
          streak={streak}
          accuracy={accuracy}
        />
      }
      bottomNav={<BottomNav lang={lang} userId={userId} />}
    >
      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-bg)]">
        {/* Header */}
        <div className="px-6 lg:px-10 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border-soft)]">
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

        <div className={`${styles.page} px-4 md:px-6 lg:px-10 py-5 space-y-6 pb-28`}>
          {/* Overview strip */}
          <div className="mp-card p-4 md:p-5">
            <div className={styles.overview}>
              <div className={styles.ovItem}>
                <span className={`${styles.ovNum} ${styles.ovNumLg}`}>
                  {TOTAL_QUESTIONS.toLocaleString("de-DE")}
                </span>
                <p className={styles.ovLbl}>{t("total_questions_label", lang)}</p>
              </div>
              <div className={styles.ovDivider} />
              <div className={styles.ovItem}>
                <span className={`${styles.ovNum} ${styles.ovNumSip4}`}>
                  {sip4Count.toLocaleString("de-DE")}
                </span>
                <p className={styles.ovLbl}>{t("sip4_label", lang)}</p>
              </div>
              <div className={styles.ovDivider} />
              <div className={styles.ovItem}>
                <span className={`${styles.ovNum} ${styles.ovNumSip5}`}>
                  {sip5Count.toLocaleString("de-DE")}
                </span>
                <p className={styles.ovLbl}>{t("sip5_label", lang)}</p>
              </div>
              <div className={styles.ovDivider} />
              <div className={styles.ovItem}>
                <span className={`${styles.ovNum} ${styles.ovNumPct}`}>
                  {completionPct}%
                </span>
                <p className={styles.ovLbl}>{t("completion", lang)}</p>
              </div>
            </div>
          </div>

          {/* Lede + legend */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-xl font-display font-black text-[var(--mp-fg)] tracking-tight">
                {lang === "de" ? "Dein Lehrplan" : "Your Curriculum"}
              </h2>
              <p className="text-xs text-[var(--mp-fg-muted)] mt-1">
                {lang === "de"
                  ? `${sip4Topics.length + sip5Topics.length} Fächer · Ring = Abdeckung · tippen zum Üben`
                  : `${sip4Topics.length + sip5Topics.length} subjects · ring = coverage · tap to practice`}
              </p>
            </div>
            <Legend lang={lang} />
          </div>

          {/* SIP 4 tree */}
          <FachSection
            title={t("sip4_label", lang)}
            topics={sip4Topics}
            buildHref={buildHref}
            lang={lang}
          />

          {/* SIP 5 tree */}
          <FachSection
            title={t("sip5_label", lang)}
            topics={sip5Topics}
            buildHref={buildHref}
            lang={lang}
          />

          {/* Quick actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/exam"
              className="mp-btn mp-btn--primary mp-btn--lg flex-1 inline-flex items-center justify-center gap-2"
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
              className="mp-btn mp-btn--secondary mp-btn--lg flex-1 inline-flex items-center justify-center gap-2"
            >
              <Shuffle className="w-5 h-5" />
              {t("random_practice", lang)}
            </Link>
          </div>
        </div>
      </main>
    </AppLayout>
  );
}
