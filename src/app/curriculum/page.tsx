"use client";
import PartialTranslationNote from "@/components/PartialTranslationNote";
import { DataRegion } from "@/components/ui/DataRegion";
import { buildQuizHref } from "@/lib/quiz-links";
import { useLang as useGlobalLang, renderLang } from "@/lib/i18n";

/**
 * Curriculum / Lehrplan (a25: UX-STU-43, 45, 46 on the "Clinical Nocturne"
 * card list; MPDS Curriculum-B heatmap was replaced by this list).
 *
 * DATA CONTRACT:
 *   - Signed-in learners: /api/user/topic-progress for the active exam
 *     (live totals, distinct questions seen, server Trefferquote).
 *   - Guests: the exam's topic list from /api/questions (action "topics")
 *     plus answer attempts stored on this device (no coverage ring).
 *   - Vienna (Kenntnisprüfung) groups subjects into SIP 4 / SIP 5; every other
 *     bank renders one flat subject list titled with its own exam label.
 *   - The ring is COVERAGE (gesehen), coloured by coverage bucket only
 *     (curriculum-model.ts); specialty colour stays on the icon tile.
 *   - Each card is a practice link (no userId, returnTo=/curriculum). At full
 *     coverage Pro gets due reviews and everyone else repeats all questions.
 *
 * Copy: src/lib/i18n-study-dash.ts (Sie, English fallback).
 */

import { useEffect, useState, useCallback, useMemo, Fragment } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { ts, studyNum, subjectCount } from "@/lib/i18n-study-dash";
import { getStoredSession } from "@/lib/auth";
import { VIENNA_EXAM_PARTS, getTopicConfig } from "@/lib/topics";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { useActiveExam } from "@/lib/hooks/useActiveExam";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { canUse } from "@/lib/entitlements";
import ExamSelector from "@/components/ExamSelector";
import { getAllTopicStats, type TopicStats } from "@/lib/weakness";
import TopicIcon from "@/components/TopicIcon";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { AppLayout } from "@/components/ui";
import { Map as MapIcon, GraduationCap, Shuffle, ChevronRight } from "lucide-react";
import {
  VIENNA_EXAM,
  coverageBucket,
  coveragePct,
  curriculumMode,
  curriculumTopicHref,
  slashParts,
  sortTopics,
  type CoverageBucket,
  type CurriculumMode,
  type CurriculumSort,
  type CurriculumTopic,
} from "./curriculum-model";
import styles from "./curriculum.module.css";

type Lang = "de" | "en";

/** Ring SVG uses r=16 → circumference ~100, so dashoffset = 100 - pct. */
const RING_CIRC = 100;

const BUCKET_KEY = {
  well: "cur_bucket_well",
  progress: "cur_bucket_progress",
  none: "cur_bucket_none",
} as const;

const MODE_KEY = {
  unseen: "cur_mode_unseen",
  review: "cur_mode_review",
  all: "cur_mode_all",
} as const;

const RING_CLASS: Record<CoverageBucket, string> = {
  well: styles.ringWell,
  progress: styles.ringProgress,
  none: styles.ringNone,
};

const DOT_CLASS: Record<CoverageBucket, string> = {
  well: styles.dotFull,
  progress: styles.dotPart,
  none: styles.dotNone,
};

/** Subject name: German hyphenation, a break opportunity after each slash. */
function SubjectName({ name }: { name: string }) {
  const parts = slashParts(name);
  return (
    <span lang="de" className={styles.ctName} title={name}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && <wbr />}
        </Fragment>
      ))}
    </span>
  );
}

function FachCard({
  td,
  examSource,
  lang,
  trackingAvailable,
  canReview,
}: {
  td: CurriculumTopic;
  examSource: string;
  lang: Lang;
  trackingAvailable: boolean;
  canReview: boolean;
}) {
  const config = getTopicConfig(td.topic);
  const pct = coveragePct(td.answered, td.total);
  const bucket = coverageBucket(pct);
  const dashoffset = RING_CIRC - (RING_CIRC * pct) / 100;
  const mode: CurriculumMode = trackingAvailable ? curriculumMode(td.answered, td.total, canReview) : "unseen";
  const href = curriculumTopicHref({
    topic: td.topic,
    examSource,
    answered: trackingAvailable ? td.answered : 0,
    total: td.total,
    canReview,
  });
  const modeLabel = ts(MODE_KEY[mode], lang);

  const seenLine = ts("cur_card_seen", lang, { seen: studyNum(td.answered, lang), total: studyNum(td.total, lang) });
  const correctLine = td.answered > 0 && td.accuracyPct != null ? ts("cur_card_correct", lang, { pct: td.accuracyPct }) : null;
  const meta = trackingAvailable
    ? [seenLine, correctLine].filter(Boolean).join(", ")
    : ts("cur_card_device", lang, { n: studyNum(td.answered, lang) });
  const detail = trackingAvailable
    ? [ts("cur_seen_pct", lang, { pct }), meta, ts(BUCKET_KEY[bucket], lang)].join(", ")
    : meta;

  return (
    <Link
      href={href}
      className={styles.curtop}
      style={{ ["--sc" as string]: config.color }}
      aria-label={ts("cur_card_aria", lang, { topic: td.topic, mode: modeLabel, detail })}
    >
      <div className={styles.ctIc} aria-hidden="true">
        <TopicIcon name={config.icon} className="w-[21px] h-[21px]" />
      </div>
      <div className={styles.ctBody}>
        <SubjectName name={td.topic} />
        {trackingAvailable && (
          <span className={styles.bucket}>
            <span className={`${styles.legendDot} ${DOT_CLASS[bucket]}`} aria-hidden="true" />
            {ts(BUCKET_KEY[bucket], lang)}
          </span>
        )}
        <div className={styles.ctMeta}>{meta}</div>
        {mode !== "unseen" && <div className={styles.ctMode}>{modeLabel}</div>}
      </div>
      <div className={styles.ctTrail}>
        {trackingAvailable && (
          <div className={styles.ctRing} aria-hidden="true">
            <svg viewBox="0 0 40 40">
              <circle className={`${styles.ringBg} ${pct === 0 ? styles.ringNone : ""}`} cx="20" cy="20" r="16" fill="none" strokeWidth="4" />
              {pct > 0 && (
                <circle
                  className={`${styles.ringFg} ${RING_CLASS[bucket]}`}
                  cx="20"
                  cy="20"
                  r="16"
                  fill="none"
                  strokeWidth="4"
                  strokeDasharray={RING_CIRC}
                  strokeDashoffset={dashoffset}
                />
              )}
            </svg>
            <div className={styles.pc}>{ts("cur_ring_pct", lang, { pct })}</div>
          </div>
        )}
        <span className={styles.ctAction} aria-hidden="true">
          {ts("cur_practice", lang)}
          <ChevronRight className={styles.go} />
        </span>
      </div>
    </Link>
  );
}

function FachSection({
  title,
  topics,
  examSource,
  lang,
  trackingAvailable,
  canReview,
}: {
  title: string | null;
  topics: CurriculumTopic[];
  examSource: string;
  lang: Lang;
  trackingAvailable: boolean;
  canReview: boolean;
}) {
  if (topics.length === 0) return null;
  const sectionTotal = topics.reduce((s, td) => s + td.total, 0);
  return (
    <section>
      {title && (
        <div className={styles.sectionHead}>
          <h3>{title}</h3>
          <span className={styles.ln} />
          <span className={styles.count}>
            {studyNum(sectionTotal, lang)} {t("questions", lang)}
          </span>
        </div>
      )}
      <div className={styles.grid}>
        {topics.map((td) => (
          <FachCard
            key={td.topic}
            td={td}
            examSource={examSource}
            lang={lang}
            trackingAvailable={trackingAvailable}
            canReview={canReview}
          />
        ))}
      </div>
    </section>
  );
}

function Legend({ lang }: { lang: Lang }) {
  return (
    <div className={styles.legend}>
      <span className={styles.legendLbl}>{ts("cur_legend", lang)}</span>
      <span className={styles.legendItem}>
        <span className={`${styles.legendDot} ${styles.dotFull}`} aria-hidden="true" />
        {ts("cur_legend_well", lang)}
      </span>
      <span className={styles.legendItem}>
        <span className={`${styles.legendDot} ${styles.dotPart}`} aria-hidden="true" />
        {ts("cur_legend_progress", lang)}
      </span>
      <span className={styles.legendItem}>
        <span className={`${styles.legendDot} ${styles.dotNone}`} aria-hidden="true" />
        {ts("cur_legend_none", lang)}
      </span>
    </div>
  );
}

interface TopicProgressRow {
  topic: string;
  total: number;
  answered: number;
  accuracy?: number;
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
  const [topicData, setTopicData] = useState<CurriculumTopic[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [catalogueUnavailable, setCatalogueUnavailable] = useState(false);
  const [sortOrder, setSortOrder] = useState<CurriculumSort>("default");
  // UX-GLOBAL-30: the account preference via useActiveExam, never a default exam.
  const { resolution: examResolution, switchExam } = useActiveExam(null);
  const examSource = examResolution.status === "ready" ? examResolution.exam : "";
  const [examPickError, setExamPickError] = useState(false);
  const { audience } = useUserTier();
  const canReview = canUse("spaced_repetition", audience);

  useEffect(() => {
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
    setSessionReady(true);
  }, []);

  // Sidebar engagement figures from answer attempts.
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

  // Topic list, live totals and coverage for the active exam.
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
          const rows = await response.json() as TopicProgressRow[];
          if (!Array.isArray(rows)) throw new Error("Topic progress response was invalid");
          if (controller.signal.aborted) return;
          setTopicData(rows.map((row) => {
            const answered = Number(row.answered) || 0;
            return {
              topic: row.topic,
              total: Number(row.total) || 0,
              answered,
              accuracyPct: answered > 0 && typeof row.accuracy === "number" && Number.isFinite(row.accuracy) ? row.accuracy : null,
            };
          }));
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
          // Guests: attempts stored on this device, per topic of THIS bank.
          const local = new Map<string, TopicStats>(getAllTopicStats().map((s) => [s.topic, s]));
          setTopicData(rows.map((row) => {
            const stat = local.get(row.topic);
            const attempts = stat?.total || 0;
            return {
              topic: row.topic,
              total: Number(row.count) || 0,
              answered: attempts,
              accuracyPct: attempts > 0 ? Math.round(((stat?.correct || 0) / attempts) * 100) : null,
            };
          }));
        }
        if (!controller.signal.aborted) { setCatalogueUnavailable(false); setDataError(false); setLoaded(true); }
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

  const isVienna = examSource === VIENNA_EXAM;
  const trackingAvailable = Boolean(userId && !userId.startsWith("guest_"));

  const sip4Topics = useMemo(
    () => VIENNA_EXAM_PARTS.sip4.map((name) => topicData.find((td) => td.topic === name)).filter(Boolean) as CurriculumTopic[],
    [topicData]
  );
  const sip5Topics = useMemo(
    () => VIENNA_EXAM_PARTS.sip5.map((name) => topicData.find((td) => td.topic === name)).filter(Boolean) as CurriculumTopic[],
    [topicData]
  );
  // The subjects this page shows: Vienna keeps its SIP 4 / SIP 5 set, other banks every row.
  const shownTopics = useMemo(
    () => (isVienna ? [...sip4Topics, ...sip5Topics] : topicData),
    [isVienna, sip4Topics, sip5Topics, topicData]
  );
  const flatTopics = useMemo(
    () => sortTopics(shownTopics, sortOrder),
    [shownTopics, sortOrder]
  );

  const examQuestionTotal = shownTopics.reduce((sum, td) => sum + td.total, 0);
  const uniqueQuestionCount = shownTopics.reduce((sum, td) => sum + Math.min(td.answered, td.total), 0);
  const completionPct = coveragePct(uniqueQuestionCount, examQuestionTotal);
  const examTitle = ts("cur_subjects_title", lang, { exam: getExamLabel(examSource, "full", lang) });

  // No saved exam yet: pick first, never a default exam (UX-GLOBAL-30).
  if (examResolution.status === "needs-picker") {
    return (
      <>
        <ExamSelector lang={lang} onSelect={async (id) => { setExamPickError(false); if (!(await switchExam(id))) setExamPickError(true); }} />
        {examPickError && (
          <p role="alert" className="fixed inset-x-4 bottom-6 z-[60] mx-auto max-w-md rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-3 text-center text-sm text-[var(--mp-fg)]">
            {ts("cur_pick_error", lang)}
          </p>
        )}
      </>
    );
  }

  if (!loaded && !catalogueUnavailable) {
    return (
      <AppLayout sidebar={<Sidebar lang={lang} userId={userId} />} bottomNav={<BottomNav lang={lang} userId={userId} />}>
        <main className="main-content px-4 py-8"><DataRegion loading retry={() => setReload(n => n + 1)} /></main>
      </AppLayout>
    );
  }

  // Load failure with nothing to show stays distinct from an empty curriculum.
  if (catalogueUnavailable && !loaded) return <main className="min-h-screen px-4 py-12 bg-[var(--mp-surface-sunken)]"><DataRegion error retry={() => setReload(n => n + 1)} /></main>;

  const showSipSections = isVienna && sortOrder === "default";

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
            <MapIcon className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden="true" />
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
              {ts("cur_totals_unavailable", lang)}
            </p>
          )}

          {/* Overview strip: coverage is the hero figure, numerals neutral. */}
          <div className="mp-card p-4 md:p-5">
            <div className={styles.overview}>
              {trackingAvailable ? (
                <div className={styles.ovHero}>
                  <p className={styles.ovLbl}>{ts("cur_seen_headline", lang)}</p>
                  <span className={`${styles.ovNum} ${styles.ovNumLg}`}>{ts("cur_seen_pct", lang, { pct: completionPct })}</span>
                  <div className={styles.ovBar} aria-hidden="true">
                    <span style={{ width: `${completionPct}%` }} />
                  </div>
                  <p className={styles.ovSub}>
                    {ts("cur_seen_of", lang, { seen: studyNum(uniqueQuestionCount, lang), total: studyNum(examQuestionTotal, lang) })}
                    {", "}
                    {ts("cur_seen_sub", lang)}
                  </p>
                </div>
              ) : (
                <div className={styles.ovHero}>
                  <p className={styles.ovSub}>{ts("cur_signin_track", lang)}</p>
                </div>
              )}
              <div className={styles.ovDivider} />
              <div className={styles.ovItem}>
                <span className={styles.ovNum}>{studyNum(examQuestionTotal, lang)}</span>
                <p className={styles.ovLbl}>{ts("cur_total_label", lang)}</p>
              </div>
            </div>
          </div>

          {/* Lede, legend and sort */}
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <h2 className="text-xl font-display font-black text-[var(--mp-fg)] tracking-tight">{examTitle}</h2>
              <p className="text-xs text-[var(--mp-fg-muted)] mt-1">
                {subjectCount(shownTopics.length, lang)}
                {". "}
                {trackingAvailable ? ts("cur_lede_tracked", lang) : ts("cur_lede_device", lang)}
              </p>
            </div>
            <div className="flex flex-col gap-2 md:items-end">
              {trackingAvailable && <Legend lang={lang} />}
              {shownTopics.length > 1 && (
                <label className={styles.sort}>
                  <span>{ts("cur_sort_label", lang)}</span>
                  <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value === "weakest" ? "weakest" : "default")}
                  >
                    <option value="default">{ts("cur_sort_default", lang)}</option>
                    <option value="weakest">{ts("cur_sort_weakest", lang)}</option>
                  </select>
                </label>
              )}
            </div>
          </div>

          {shownTopics.length === 0 ? (
            <p role="status" className="rounded-xl border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] p-4 text-sm text-[var(--mp-fg-muted)]">
              {ts("cur_empty", lang)}
            </p>
          ) : showSipSections ? (
            <>
              <FachSection title={t("sip4_label", lang)} topics={sip4Topics} examSource={examSource} lang={lang} trackingAvailable={trackingAvailable} canReview={canReview} />
              <FachSection title={t("sip5_label", lang)} topics={sip5Topics} examSource={examSource} lang={lang} trackingAvailable={trackingAvailable} canReview={canReview} />
            </>
          ) : (
            <FachSection
              title={isVienna ? ts("cur_all_subjects", lang) : null}
              topics={flatTopics}
              examSource={examSource}
              lang={lang}
              trackingAvailable={trackingAvailable}
              canReview={canReview}
            />
          )}

          {/* Quick actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/exam"
              className="mp-btn mp-btn--primary mp-btn--lg flex-1 inline-flex items-center justify-center gap-2"
            >
              <GraduationCap className="w-5 h-5" aria-hidden="true" />
              {t("start_exam_simulation", lang)}
            </Link>
            <Link
              href={buildQuizHref({ topic: "random", examSource: examSource, practiceMode: "unseen", returnTo: "/curriculum" })}
              className="mp-btn mp-btn--secondary mp-btn--lg flex-1 inline-flex items-center justify-center gap-2"
            >
              <Shuffle className="w-5 h-5" aria-hidden="true" />
              {t("random_practice", lang)}
            </Link>
          </div>
        </div>
      </main>
    </AppLayout>
  );
}
