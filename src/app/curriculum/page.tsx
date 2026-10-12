"use client";
import PartialTranslationNote from "@/components/PartialTranslationNote";
import { DataRegion } from "@/components/ui/DataRegion";
import { buildQuizHref } from "@/lib/quiz-links";
import { useLang as useGlobalLang, renderLang } from "@/lib/i18n";

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
import Link from "next/link";
import { t, getLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import {
  VIENNA_EXAM_PARTS,
  getTopicConfig,
} from "@/lib/topics";
import { useActiveExam } from "@/lib/hooks/useActiveExam";
import ExamSelector from "@/components/ExamSelector";
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

// Guest-only fallback. Signed-in learners receive live counts and coverage
// from /api/user/topic-progress for the currently selected exam.
const TOPIC_TOTALS_FALLBACK: Record<string, number> = {
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
  trackingAvailable,
}: {
  td: TopicData;
  href: string;
  lang: Lang;
  trackingAvailable: boolean;
}) {
  const config = getTopicConfig(td.topic);
  const pct =
    td.total > 0 ? Math.min(100, Math.round((td.answered / td.total) * 100)) : 0;
  const dashoffset = RING_CIRC - (RING_CIRC * pct) / 100;

  const geuebt = lang === "de" ? "einzigartige Fragen gesehen" : "unique questions seen";

  return (
    <Link
      href={href}
      className={styles.curtop}
      style={{ ["--sc" as string]: config.color }}
      aria-label={trackingAvailable
        ? `${td.topic}: ${td.answered.toLocaleString("de-DE")} / ${td.total.toLocaleString("de-DE")} ${geuebt} (${pct}%)`
        : `${td.topic}: ${td.answered.toLocaleString("de-DE")} ${lang === "de" ? "Antwortversuche auf diesem Gerät" : "answer attempts on this device"}`}
    >
      <span className={styles.edge} />
      <div className={styles.ctIc}>
        <TopicIcon name={config.icon} className="w-[21px] h-[21px]" />
      </div>
      <div className={styles.ctBody}>
        <div className={styles.ctName} title={td.topic} style={{ whiteSpace: "normal", overflow: "visible", textOverflow: "clip", overflowWrap: "anywhere" }}>{td.topic}</div>
        <div className={styles.ctMeta}>
          <ChevronRight className={styles.go} aria-hidden="true" />
          {trackingAvailable
            ? `${td.answered.toLocaleString("de-DE")} / ${td.total.toLocaleString("de-DE")} ${geuebt}`
            : `${td.answered.toLocaleString("de-DE")} ${lang === "de" ? "Antwortversuche auf diesem Gerät" : "answer attempts on this device"}`}
        </div>
      </div>
      {trackingAvailable && <div className={styles.ctRing}>
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
      </div>}
    </Link>
  );
}

function FachSection({
  title,
  topics,
  buildHref,
  lang,
  trackingAvailable,
}: {
  title: string;
  topics: TopicData[];
  buildHref: (topic: string) => string;
  lang: Lang;
  trackingAvailable: boolean;
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
            trackingAvailable={trackingAvailable}
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
  const [dataError, setDataError] = useState(false);
  const [reload, setReload] = useState(0);
  const preferredLang = useGlobalLang();
  useEffect(() => { setLangState(renderLang(preferredLang)); }, [preferredLang]);
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [totalXp, setTotalXp] = useState(0);
  const [streak, setStreak] = useState(0);
  const [accuracy, setAccuracy] = useState(0);
  const [topicData, setTopicData] = useState<TopicData[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [catalogueUnavailable, setCatalogueUnavailable] = useState(false);
  // UX-GLOBAL-30: the account preference via useActiveExam, never a default exam.
  const { resolution: examResolution, switchExam } = useActiveExam(null);
  const examSource = examResolution.status === "ready" ? examResolution.exam : "";
  const [examPickError, setExamPickError] = useState(false);

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
      setAccuracy(ans > 0 ? Math.round((cor / ans) * 100) : 0);
    }

    // Seed topic data from known totals + localStorage quiz results.
    const localStats = getAllTopicStats();
    const statsMap = new Map<string, TopicStats>();
    for (const s of localStats) {
      statsMap.set(s.topic, s);
    }

    const data: TopicData[] = Object.keys(TOPIC_TOTALS_FALLBACK).map(
      (topic) => {
        const stat = statsMap.get(topic);
        return {
          topic,
          // Do not show stale static catalogue totals while live counts load.
          total: 0,
          answered: stat?.total || 0,
          correct: stat?.correct || 0,
        };
      }
    );

    setTopicData(data);
    setSessionReady(true);
  }, []);

  // Keep engagement accuracy from answer attempts, but load actual catalogue
  // size and unique coverage for this exam from the dedicated progress route.
  useEffect(() => {
    if (!sessionReady || !userId) return;
    fetch("/api/stats")
      .then(async (r) => { if (!r.ok) throw new Error("Data unavailable"); const value = await r.json(); if (!value?.gamification || typeof value.gamification.total_questions_answered !== "number") throw new Error("Invalid statistics"); setDataError(false); return value; })
      .then((data) => {
        if (data.gamification) {
          setTotalXp(data.gamification.total_xp || 0);
          setStreak(data.gamification.current_streak || 0);
          const ans = data.gamification.total_questions_answered || 0;
          const cor = data.gamification.total_correct || 0;
          setAccuracy(ans > 0 ? Math.round((cor / ans) * 100) : 0);
        }
      })
      .catch(() => setDataError(true));
  }, [sessionReady, userId, reload]);

  useEffect(() => {
    if (!sessionReady || !examSource) return;
    const controller = new AbortController();
    const loadCatalogue = async () => {
      setLoading(true);
      setCatalogueUnavailable(false);
      try {
        if (userId && !userId.startsWith("guest_")) {
          const response = await fetch(`/api/user/topic-progress?examType=${encodeURIComponent(examSource)}`, { signal: controller.signal });
          if (!response.ok) throw new Error("Topic progress request failed");
          const rows = await response.json() as Array<{ topic: string; total: number; answered: number; correct: number }>;
          if (!Array.isArray(rows)) throw new Error("Topic progress response was invalid");
          if (controller.signal.aborted) return;
          setTopicData(rows.map((row) => ({
            topic: row.topic,
            total: row.total,
            answered: row.answered,
            correct: row.correct,
          })));
        } else {
          const response = await fetch("/api/questions", {
            method: "POST", signal: controller.signal, timeoutMs: 8_000,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "topics", examSource }),
          });
          if (!response.ok) throw new Error("Question catalogue request failed");
          const rows = await response.json() as Array<{ topic: string; count: number }>;
          if (!Array.isArray(rows)) throw new Error("Question catalogue response was invalid");
          if (controller.signal.aborted) return;
          const totals = new Map(rows.map((row) => [row.topic, Number(row.count)]));
          setTopicData((current) => current.map((row) => ({ ...row, total: totals.get(row.topic) ?? 0 })));
        }
        if (!controller.signal.aborted) { setCatalogueUnavailable(false); setDataError(false); }
      } catch {
        if (controller.signal.aborted) return;
        setCatalogueUnavailable(true); setDataError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void loadCatalogue();
    return () => controller.abort();
  }, [sessionReady, userId, examSource, reload]);

  const switchLang = useCallback((l: Lang) => {
    setLangState(l);
  }, []);

  const examQuestionTotal = topicData.reduce((sum, td) => sum + td.total, 0);
  const uniqueQuestionCount = topicData.reduce((sum, td) => sum + td.answered, 0);
  const completionPct = examQuestionTotal > 0
    ? Math.min(100, Math.round((uniqueQuestionCount / examQuestionTotal) * 100))
    : 0;
  const trackingAvailable = Boolean(userId && !userId.startsWith("guest_"));

  const buildHref = useCallback(
    (topic: string) =>
      userId
        ? buildQuizHref({ topic: topic, examSource: examSource, practiceMode: "unseen" })
        : buildQuizHref({ topic: topic, examSource: examSource, practiceMode: "unseen" }),
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

  // No saved exam yet: pick first, never a default exam (UX-GLOBAL-30).
  if (examResolution.status === "needs-picker") {
    return (
      <>
        <ExamSelector lang={lang} onSelect={async (id) => { setExamPickError(false); if (!(await switchExam(id))) setExamPickError(true); }} />
        {examPickError && (
          <p role="alert" className="fixed inset-x-4 bottom-6 z-[60] mx-auto max-w-md rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-3 text-center text-sm text-[var(--mp-fg)]">
            {lang === "de" ? "Auswahl nicht gespeichert. Bitte erneut versuchen." : "Choice not saved. Please try again."}
          </p>
        )}
      </>
    );
  }

  if (loading && topicData.every(topic => topic.total === 0)) {
    return (
      <AppLayout sidebar={<Sidebar lang={lang} userId={userId} />} bottomNav={<BottomNav lang={lang} userId={userId} />}>
        <main className="main-content px-4 py-8"><DataRegion loading retry={() => setReload(n => n + 1)} /></main>
      </AppLayout>
    );
  }

  if (catalogueUnavailable && topicData.every(topic => topic.total === 0)) return <main className="min-h-screen px-4 py-12 bg-[var(--mp-surface-sunken)]"><DataRegion error retry={() => setReload(n => n + 1)} /></main>;

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
        <PartialTranslationNote />
        <DataRegion loading={loading} error={dataError} retry={() => setReload(n => n + 1)} />
        {/* Header */}
        <div className="px-4 sm:px-6 lg:px-10 pt-4 pb-3 grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-2 border-b border-[var(--mp-border-soft)] sm:flex sm:justify-between">
          <Link
            href="/"
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            &larr; {t("back_home", lang)}
          </Link>
          <h1 className="col-span-2 justify-self-center text-center text-base font-bold text-[var(--mp-fg)] flex items-center gap-2 sm:col-auto">
            <MapIcon className="w-4 h-4 text-[var(--mp-viridian)]" />
            {t("curriculum_title", lang)}
          </h1>
          <div className="flex items-center justify-self-end gap-2 sm:justify-self-auto">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className={`${styles.page} px-4 md:px-6 lg:px-10 py-5 space-y-6 pb-28`}>
          {catalogueUnavailable && (
            <p role="status" className="rounded-xl border border-[var(--mp-warning)]/30 bg-[var(--mp-warning-bg)] p-3 text-sm text-[var(--mp-fg)]">
              {lang === "de" ? "Die aktuellen Fragenzahlen konnten nicht geladen werden." : "Current question totals could not be loaded."}
            </p>
          )}
          {/* Overview strip */}
          <div className="mp-card p-4 md:p-5">
            <div className={styles.overview}>
              <div className={styles.ovItem}>
                <span className={`${styles.ovNum} ${styles.ovNumLg}`}>
                  {examQuestionTotal.toLocaleString("de-DE")}
                </span>
                <p className={styles.ovLbl}>{lang === "de" ? "Fragen im gewählten Examen" : "Questions in selected exam"}</p>
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
                  {trackingAvailable ? `${completionPct}%` : "↗"}
                </span>
                <p className={styles.ovLbl}>{trackingAvailable
                  ? lang === "de" ? "Einzigartige Fragen gesehen" : "Unique questions seen"
                  : lang === "de" ? "Anmelden, um Abdeckung zu speichern" : "Sign in to track coverage"}</p>
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
                {trackingAvailable
                  ? lang === "de"
                    ? `${sip4Topics.length + sip5Topics.length} Fächer · Ring = einzigartige Fragen gesehen`
                    : `${sip4Topics.length + sip5Topics.length} subjects · ring = unique questions seen`
                  : lang === "de"
                    ? `${sip4Topics.length + sip5Topics.length} Fächer · Versuche nur auf diesem Gerät`
                    : `${sip4Topics.length + sip5Topics.length} subjects · attempts stored on this device only`}
              </p>
            </div>
            {trackingAvailable && <Legend lang={lang} />}
          </div>

          {/* SIP 4 tree */}
          <FachSection
            title={t("sip4_label", lang)}
            topics={sip4Topics}
            buildHref={buildHref}
            lang={lang}
            trackingAvailable={trackingAvailable}
          />

          {/* SIP 5 tree */}
          <FachSection
            title={t("sip5_label", lang)}
            topics={sip5Topics}
            buildHref={buildHref}
            lang={lang}
            trackingAvailable={trackingAvailable}
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
                  ? buildQuizHref({ topic: "random", examSource: examSource, practiceMode: "unseen" })
                  : buildQuizHref({ topic: "random", examSource: examSource, practiceMode: "unseen" })
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
