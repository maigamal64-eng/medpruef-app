"use client";
import PartialTranslationNote from "@/components/PartialTranslationNote";
import StudyReadError from "@/components/StudyReadError";
import { checkedJson, isRecord } from "@/lib/async-data";
import { PASS_RECEIPT_KEY, readPassReceipt } from "@/lib/study-p0";
import { DataRegion } from "@/components/ui/DataRegion";
import { buildQuizHref } from "@/lib/quiz-links";
import { useLang as useGlobalLang, renderLang } from "@/lib/i18n";

/**
 * Statistics / Statistik — MPDS v3 "Clinical Nocturne" rank-ladder surface.
 *
 * Reimplementation 2026-06-26 (build loop): rebuilt the PRESENTATION to the
 * approved `reviews/reimplementation-2026-06-26/design/05-progress-stats.html`
 * mockup + SPECS §4 (Statistik). The data layer is unchanged — only the UI is
 * new. This file reads ONLY the `/api/stats` data contract.
 *
 * SCOPE NOTE — §4 (Statistik) vs §5 (Fortschritt):
 *   The mockup file 05-progress-stats.html carries BOTH analytics surfaces.
 *   `/stats` is §4 ONLY — the rank ladder, stat strip and per-topic strength.
 *   The radar, weekly chart, calendar heatmap and pass-probability ring belong
 *   to §5 (the separate `/progress` route, owned elsewhere) and need data
 *   OUTSIDE the `/api/stats` contract (12-week heatmap, pass-prob calc). They
 *   are deliberately NOT built here. (The desktop mockup frame is labelled
 *   "Statistik" but its section divider says "Fortschritt dashboard" — a
 *   mockup artifact; the MedPrüf routes table is authoritative: /stats =
 *   streak/XP/rank/per-topic accuracy, /progress = radar/heatmap/charts.)
 *
 * What this surface renders (all from `/api/stats` + `nextLevelProgress`):
 *   - Level hero: the level as a number only, "Stufe N von 8" (UX-STU-42, no
 *     career names), the XP total and the bar to the next level.
 *   - Stat strip (3 tiles): Serie (Tage), Antworten insgesamt, Trefferquote.
 *   - Per-topic strength rows with a Stark / Mehr üben badge.
 *   - EmptyState (signed-in, 0 answers) nudging the first quiz.
 *
 * PUYP pass banner (UX-STU-41): lands on `/stats?examPassed=1`, strips the
 * query param, carries no reward line, and says the result is
 * saved only when the exam-result page left a successful write receipt
 * (study-p0 `readPassReceipt`); otherwise it offers the save again.
 *
 * Copy: src/lib/i18n-study-dash.ts (Sie, English fallback).
 */

import { Fragment, useEffect, useRef, useState, Suspense, type CSSProperties, type ReactNode } from "react";
import { BrandedLoader } from "@/components/Logo";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
// authFetch is a drop-in fetch that attaches the signed x-session-token the
// server guards verify (S-1, 2026-06-02) + a 401→/login interceptor. The
// data layer's /api/stats is `requireUser`, so a plain native fetch (no
// token) 401s for real signed-in users → empty state for everyone. Aliasing
// here (same pattern flashcards uses) is the mandated client-call convention,
// not a contract change; /api/track is resolveOptional so it's unaffected.
import { authFetch as fetch } from "@/lib/authFetch";
import { nextLevelProgress } from "@/lib/xp";
import { getStoredExamSource, getTopicConfig } from "@/lib/topics";
import { ts, studyNum, rankLabel } from "@/lib/i18n-study-dash";
import { getStoredSession } from "@/lib/auth";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import TopicIcon from "@/components/TopicIcon";
import { AppLayout, AchievementRank, EmptyState } from "@/components/ui";
import { type RankTier } from "@/components/ui";
import {
  BarChart3,
  Flame,
  CheckCircle2,
  TrendingUp,
  GraduationCap,
  Trophy,
  Share2,
  ChevronRight,
  X,
} from "lucide-react";

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

const PASS_BANNER_KEY = "medpruef_pass_banner";

function StatsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawUserId = "";
  const examPassed = searchParams.get("examPassed") === "1";
  const [gam, setGam] = useState<Gamification | null>(null);
  const [topicStats, setTopicStats] = useState<Record<string, TopicStat>>({});
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState<Lang>("de");
  const [dataError, setDataError] = useState<unknown>(null);
  const [passRecorded, setPassRecorded] = useState(false);
  const [reload, setReload] = useState(0);
  const preferredLang = useGlobalLang();
  useEffect(() => { setLangState(renderLang(preferredLang)); }, [preferredLang]);
  const [userId, setUserId] = useState(rawUserId);
  const [sessionReady, setSessionReady] = useState(Boolean(rawUserId));
  const [userName, setUserName] = useState("");
  // Pass-Until-You-Pass celebration banner. Shown the first time a user lands
  // on /stats?examPassed=1 (after submitting their pass on the PUYP page).
  // Persists in this render only — clicking dismiss or refreshing strips
  // the query param and hides it. Telegrams [name] via /api/track for KPI.
  const [celebrate, setCelebrate] = useState(examPassed);
  const trackedRef = useRef(false);

  useEffect(() => {
    const session = getStoredSession();
    if (!rawUserId && session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
    } else if (session) {
      setUserName(session.user.first_name);
    }
    // UX-STU-41: the banner survives the query strip below (the remount after
    // router.replace reads this tab-scoped flag until the learner dismisses it).
    // One-shot and account-scoped: the remount consumes the flag.
    let flagged = examPassed;
    try {
      const owner = session?.user.id ?? "";
      if (examPassed) sessionStorage.setItem(PASS_BANNER_KEY, owner);
      else {
        flagged = !!owner && sessionStorage.getItem(PASS_BANNER_KEY) === owner;
        sessionStorage.removeItem(PASS_BANNER_KEY);
      }
    } catch { /* storage blocked: the banner shows for this render only */ }
    if (flagged) setCelebrate(true);
    if (flagged && session) {
      try { setPassRecorded(!!readPassReceipt(sessionStorage.getItem(PASS_RECEIPT_KEY), session.user.id)); }
      catch { setPassRecorded(false); }
    }
    setSessionReady(true);
  }, [rawUserId, examPassed]);

  // When the user lands here from the PUYP "I passed" flow, fire a one-time
  // tracking event and clean up the URL so a refresh doesn't re-celebrate.
  useEffect(() => {
    if (!examPassed || !sessionReady || trackedRef.current) return;
    trackedRef.current = true;
    // Best-effort tracking — we don't block the render on this.
    if (passRecorded) fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: [
          {
            event_type: "exam_passed",
            timestamp: new Date().toISOString(),
            metadata: { source: "puyp_result_page" },
          },
        ],
      }),
    }).catch(() => {});
    // Strip the query param so the banner doesn't re-fire on refresh,
    // without unmounting the page (replace, not push).
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("examPassed");
      router.replace(url.pathname + (url.search ? url.search : "") + url.hash);
    }
  }, [examPassed, router, passRecorded, sessionReady]);

  const switchLang = (l: Lang) => {
    setLangState(l);
  };

  useEffect(() => {
    const uid = userId || rawUserId;
    if (!uid && !sessionReady) return;
    if (!uid) {
      setLoading(false);
      return;
    }
    let alive = true;
    const controller = new AbortController();
    setLoading(true); setDataError(null);
    fetch("/api/stats", { signal: controller.signal })
      .then(r => checkedJson(r, (value): value is { gamification: Gamification; topicStats: Record<string, TopicStat> } => {
        if (!isRecord(value) || !isRecord(value.gamification) || !isRecord(value.topicStats)) return false;
        const gam = value.gamification;
        return ["total_questions_answered", "total_correct", "total_xp", "current_streak"].every(key => typeof gam[key] === "number" && Number.isFinite(gam[key])) && Object.values(value.topicStats).every(row => isRecord(row) && typeof row.total === "number" && Number.isFinite(row.total) && typeof row.correct === "number" && Number.isFinite(row.correct));
      }))
      .then(data => { if (alive) { setGam(data.gamification); setTopicStats(data.topicStats); } })
      .catch(err => { if (alive) setDataError(err); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [userId, rawUserId, sessionReady, reload]);

  if (dataError && !gam) return <main className="min-h-screen px-4 py-12 bg-[var(--mp-surface-sunken)]"><StudyReadError page="stats" error={dataError} lang={lang} retry={() => setReload(n => n + 1)} /></main>;
  if (loading && !gam) {
    return (
      <AppLayout sidebar={<Sidebar lang={lang} userId={userId} />} bottomNav={<BottomNav lang={lang} userId={userId} />}>
        <main className="main-content px-4 py-8"><DataRegion loading retry={() => setReload(n => n + 1)} /></main>
      </AppLayout>
    );
  }

  // ── No user → sign-in nudge (shell preserved) ───────────────────────────
  if (!userId && !rawUserId) {
    return (
      <AppLayout
        sidebar={<Sidebar lang={lang} />}
        bottomNav={<BottomNav lang={lang} />}
      >
        <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-bg)]">
          <StatsTopbar lang={lang} switchLang={switchLang} />
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] px-4 text-center">
            <EmptyState
              icon={<BarChart3 className="w-10 h-10" aria-hidden />}
              title={ts("signin_title", lang)}
              body={ts("signin_body", lang)}
              action={
                <Link href="/" className="mp-btn mp-btn--primary">
                  {ts("to_home", lang)}
                </Link>
              }
            />
          </div>
        </main>
      </AppLayout>
    );
  }

  const accuracy =
    gam && gam.total_questions_answered > 0
      ? Math.round((gam.total_correct / gam.total_questions_answered) * 100)
      : 0;
  const totalXp = gam?.total_xp || 0;
  // STU-42: the level as a number only; the glyph tier follows the level.
  const ladder = nextLevelProgress(totalXp);
  const tier = Math.min(8, Math.max(1, ladder.level)) as RankTier;
  const levelText = rankLabel(ladder.level, lang);
  const totalAnswered = gam?.total_questions_answered || 0;

  // Per-topic strength rows — needs >=3 answers per topic so a single lucky/
  // unlucky answer doesn't read as "Stark"/"Schwach". Sorted strongest first.
  const topicRows = Object.entries(topicStats)
    .filter(([, s]) => s.total >= 3)
    .map(([topic, s]) => ({
      topic,
      total: s.total,
      correct: s.correct,
      acc: Math.round((s.correct / s.total) * 100),
    }))
    .sort((a, b) => b.acc - a.acc || b.total - a.total);

  const hasData = totalAnswered > 0;

  return (
    <AppLayout
      sidebar={
        <Sidebar
          lang={lang}
          userId={userId}
          userName={userName}
          totalXp={totalXp}
          streak={gam?.current_streak}
          accuracy={accuracy}
        />
      }
      bottomNav={<BottomNav lang={lang} userId={userId} />}
    >
      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-bg)] stats-surface">
        <PartialTranslationNote />
        <DataRegion loading={loading} retry={() => setReload(n => n + 1)} />
        {dataError ? <StudyReadError page="stats" error={dataError} lang={lang} retry={() => setReload(n => n + 1)} /> : null}
        <StatsTopbar
          lang={lang}
          switchLang={switchLang}
          rankChip={
            hasData
              ? { tier, rank: levelText, xp: totalXp, lang }
              : undefined
          }
        />

        <div className="px-4 lg:px-8 py-5 max-w-3xl xl:max-w-4xl mx-auto space-y-5">
          {/* PUYP pass celebration — shown once after the PUYP "I passed"
              flow (router.push to /stats?examPassed=1). Dismissable. */}
          {celebrate && (
            <div className="stats-celebrate" role="status" aria-live="polite">
              <button
                type="button"
                onClick={() => { setCelebrate(false); try { sessionStorage.removeItem(PASS_BANNER_KEY); } catch { /* optional */ } }}
                aria-label={ts("pass_dismiss", lang)}
                className="stats-celebrate__x"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
              <div className="flex items-start gap-4">
                <div className="stats-celebrate__ic" aria-hidden="true">
                  <Trophy className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0 pr-6">
                  <h2 className="font-display font-bold text-[var(--mp-fg)] text-lg leading-tight">
                    {ts("pass_title", lang)}
                  </h2>
                  {/* STU-41: the saved sentence only with a successful pass write receipt; no reward line. */}
                  {passRecorded && <p className="text-sm text-[var(--mp-fg-muted)] mt-1">{ts("pass_recorded", lang)}</p>}
                  {!passRecorded && <Link className="mp-btn mp-btn--secondary min-h-11 mt-3" href="/dashboard/exam-result">{ts("pass_retry", lang)}</Link>}
                </div>
              </div>
            </div>
          )}

          {/* ── Rank-ladder hero — the spine of statistics ──────────────── */}
          <section className="rank-hero" aria-label={ts("level_region", lang)}>
            <div className="rank-hero__top">
              <span className="rank-hero__badge">
                <AchievementRank tier={tier} size={58} aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="rank-hero__name">{levelText}</div>
                <div className="rank-hero__lvl">{studyNum(totalXp, lang)} XP</div>
              </div>
            </div>

            <div className="rank-hero__xp">
              <div className="rank-hero__xptop">
                <span>{ladder.nextLevel != null ? ts("level_next", lang, { n: ladder.nextLevel }) : ts("level_top", lang)}</span>
                <span>
                  <b>{studyNum(totalXp, lang)}</b>
                  {ladder.nextThreshold != null ? <> / {studyNum(ladder.nextThreshold, lang)}</> : null} XP
                </span>
              </div>
              <div className="rank-hero__track">
                <div className="rank-hero__fill" style={{ width: `${ladder.pct}%` }} />
              </div>
            </div>
          </section>

          {hasData ? (
            <>
              {/* ── Stat strip (3 tiles) ──────────────────────────────── */}
              <div className="stat-strip">
                <StatTileLocal
                  tone="fire"
                  icon={<Flame className="w-[18px] h-[18px]" />}
                  label={ts("tile_streak", lang)}
                  value={String(gam?.current_streak || 0)}
                  unit={` ${ts((gam?.current_streak || 0) === 1 ? "unit_day" : "unit_days", lang)}`}
                />
                <StatTileLocal
                  tone="green"
                  icon={<CheckCircle2 className="w-[18px] h-[18px]" />}
                  label={ts("tile_answers", lang)}
                  value={studyNum(totalAnswered, lang)}
                  sub={ts("tile_answers_sub", lang)}
                />
                <StatTileLocal
                  tone="teal"
                  icon={<TrendingUp className="w-[18px] h-[18px]" />}
                  label={ts("tile_hit_rate", lang)}
                  value={String(accuracy)}
                  unit="%"
                />
              </div>

              {/* ── Per-topic strength ────────────────────────────────── */}
              {topicRows.length > 0 && (
                <section>
                  <div className="sec-head">
                    <h2>{ts("strength_title", lang)}</h2>
                    <Link href="/progress" className="sec-head__link">
                      {ts("strength_more", lang)}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                  <div className="card stats-tacc">
                    {topicRows.map((row) => (
                      <TopicStrengthRow key={row.topic} row={row} lang={lang} />
                    ))}
                  </div>
                </section>
              )}

              {/* ── Longest streak + correct, calm summary ────────────── */}
              <div className="card stats-summary">
                <SummaryRow
                  label={ts("correct_total", lang)}
                  value={studyNum(gam?.total_correct || 0, lang)}
                  accent="viridian"
                />
                <SummaryRow
                  label={ts("longest_streak", lang)}
                  value={`${gam?.longest_streak || 0} ${ts((gam?.longest_streak || 0) === 1 ? "unit_day" : "unit_days", lang)}`}
                />
              </div>

              {/* ── Primary CTA — exam simulation ─────────────────────── */}
              <div className="pb-2">
                <Link
                  href="/exam"
                  className="mp-btn mp-btn--primary w-full justify-center gap-2"
                >
                  <GraduationCap className="w-5 h-5" />
                  {ts("start_simulation", lang)}
                </Link>
              </div>
            </>
          ) : (
            // Signed in but 0 answers — nudge the first quiz (SPECS §4).
            <div className="pt-2">
              <EmptyState
                tone="neutral"
                icon={<BarChart3 className="w-10 h-10" aria-hidden />}
                title={ts("empty_title", lang)}
                body={ts("empty_body", lang)}
                action={
                  <Link
                    href={userId ? buildQuizHref({ topic: "random", examSource: getStoredExamSource(), practiceMode: "unseen" }) : "/quiz?practiceMode=unseen"}
                    className="mp-btn mp-btn--primary gap-2"
                  >
                    <GraduationCap className="w-5 h-5" />
                    {ts("start_first_quiz", lang)}
                  </Link>
                }
              />
            </div>
          )}
        </div>
      </main>

      {/* Surface-scoped styling. Theme-aware (light + [data-theme="dark"]).
          Hero gradient + spark XP track use literal values from the approved
          _kit.css tokens (`--mp-hero-from/to/glow`, `--mp-accent-text`) which
          are NOT yet in globals.css — scoped here rather than touching the
          global stylesheet, per the build-loop scope rules. */}
      <style>{statsCss}</style>
    </AppLayout>
  );
}

/* ── Topbar: title + rank chip + share + theme/lang ─────────────────────── */
function StatsTopbar({
  lang,
  switchLang,
  rankChip,
}: {
  lang: Lang;
  switchLang: (l: Lang) => void;
  rankChip?: { tier: RankTier; rank: string; xp: number; lang: Lang };
}) {
  return (
    <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between gap-3 max-[375px]:flex-wrap max-[375px]:gap-y-2 border-b border-[var(--mp-border-soft)]">
      <div className="flex items-center gap-3 min-w-0">
        <Link
          href="/"
          aria-label={ts("back", lang)}
          className="lg:hidden w-9 h-9 rounded-[10px] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] flex items-center justify-center text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors flex-shrink-0"
        >
          <X className="w-[18px] h-[18px]" />
        </Link>
        <div className="min-w-0">
          <h1 className="font-display font-extrabold text-[var(--mp-fg)] text-[19px] leading-tight tracking-[-0.01em]">
            {ts("stats_title", lang)}
          </h1>
          <p className="hidden sm:block text-[12.5px] text-[var(--mp-fg-subtle)]">
            {ts("stats_subtitle", lang)}
          </p>
        </div>
      </div>

      {/* a-narrow-320: on a 320 px phone the controls wrap below the title, right-aligned. */}
      <div className="flex items-center gap-2 flex-shrink-0 max-[375px]:ml-auto">
        {rankChip && (
          <div className="rank-chip">
            <span className="rank-chip__badge">
              <AchievementRank tier={rankChip.tier} size={30} aria-hidden />
            </span>
            <span className="rank-chip__body">
              <span className="rank-chip__name">{rankChip.rank}</span>
              <span className="rank-chip__xp">{studyNum(rankChip.xp, rankChip.lang)} XP</span>
            </span>
          </div>
        )}
        <ThemeToggle />
        <LanguageToggle lang={lang} onChange={switchLang} />
        <button
          type="button"
          aria-label={ts("share", lang)}
          className="hidden sm:flex w-9 h-9 rounded-[10px] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] items-center justify-center text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors"
          onClick={() => {
            if (typeof navigator !== "undefined" && navigator.share) {
              navigator
                .share({ title: "MedPrüf", url: window.location.href })
                .catch(() => {});
            }
          }}
        >
          <Share2 className="w-[17px] h-[17px]" />
        </button>
      </div>
    </div>
  );
}

/* ── Stat tile — icon + label + mono numeral (label NEVER the icon color) ── */
function StatTileLocal({
  tone,
  icon,
  label,
  value,
  unit,
  sub,
}: {
  tone: "fire" | "green" | "teal";
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
}) {
  return (
    <div className="stat-tile">
      <div className={`stat-tile__top stat-tile__top--${tone}`}>
        {icon}
        <span className="stat-tile__label">{label}</span>
      </div>
      <div className="stat-tile__val">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {sub && <div className="stat-tile__sub">{sub}</div>}
    </div>
  );
}

/* ── Per-topic strength row — color-keyed bar + Stark/Schwach badge ──────── */
function TopicStrengthRow({
  row,
  lang,
}: {
  row: { topic: string; total: number; correct: number; acc: number };
  lang: Lang;
}) {
  const config = getTopicConfig(row.topic);
  const strong = row.acc >= 70;
  const weak = row.acc < 40;
  // `--sc` drives the icon tint + fill bar. Cast: custom props aren't in
  // the CSSProperties type. Dark-mode lift handled in the scoped CSS.
  const style = { ["--sc"]: config.color } as CSSProperties;
  return (
    <div className="tarow" style={style}>
      <span className="tarow__ic">
        {/* TopicIcon paints in currentColor; .tarow__ic sets color:var(--sc),
            so each fach gets its TOPIC_CONFIG hue (dark-lifted in the CSS). */}
        <TopicIcon name={config.icon} className="w-[17px] h-[17px]" />
      </span>
      <div className="tarow__body">
      <div className="tarow__topline">
          <span className="tarow__name" lang="de" title={row.topic}>{row.topic.split(/(?<=\/)/).map((part, i, parts) => <Fragment key={i}>{part}{i < parts.length - 1 && <wbr />}</Fragment>)}</span>
          <span className="tarow__pct">{row.acc}%</span>
        </div>
        <div className="tarow__track">
          <div className="tarow__fill" style={{ width: `${row.acc}%` }} />
        </div>
      </div>
      {(strong || weak) && (
        <span className={`tarow__badge ${strong ? "is-strong" : "is-weak"}`}>
          {ts(strong ? "badge_strong" : "badge_practice_more", lang)}
        </span>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "viridian";
}) {
  return (
    <div className="stats-summary__row">
      <span className="stats-summary__label">{label}</span>
      <span
        className={`stats-summary__value ${accent === "viridian" ? "is-viridian" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

export default function StatsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-[var(--mp-bg)]">
          <BrandedLoader />
        </div>
      }
    >
      <StatsContent />
    </Suspense>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Surface-scoped CSS. All values use existing globals.css tokens EXCEPT the
   hero gradient/glow + accent-text, which mirror the approved _kit.css tokens
   (not yet in globals.css) as light + dark literals. No global edits.
   ════════════════════════════════════════════════════════════════════════ */
const statsCss = `
.stats-surface{
  /* hero ladder + accent-text mirrors of _kit.css (light defaults) */
  --st-hero-from:#001B3D; --st-hero-to:#003A8C; --st-hero-glow:rgba(0,168,150,.18);
  --st-accent-text:#067A6B; --st-spark:var(--mp-accent-teal); --st-spark-glow:rgba(0,168,150,.30);
}
[data-theme="dark"] .stats-surface{
  --st-hero-from:#0A1A38; --st-hero-to:#123A78; --st-hero-glow:rgba(52,208,192,.22);
  --st-accent-text:#34D0C0; --st-spark:var(--mp-accent-teal); --st-spark-glow:rgba(52,208,192,.40);
}

/* PUYP celebrate */
.stats-celebrate{position:relative;border-radius:var(--mp-r-card);padding:18px;
  border:2px solid var(--mp-viridian);
  background:color-mix(in srgb,var(--mp-viridian) 6%,var(--mp-surface));box-shadow:var(--mp-shadow-card)}
.stats-celebrate__x{position:absolute;top:12px;right:12px;color:var(--mp-fg-subtle);background:none;border:0;cursor:pointer}
.stats-celebrate__x:hover{color:var(--mp-fg)}
.stats-celebrate__ic{width:48px;height:48px;border-radius:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  background:color-mix(in srgb,var(--mp-viridian) 15%,transparent);color:var(--mp-viridian)}

/* Rank-ladder hero */
.rank-hero{position:relative;overflow:hidden;border-radius:var(--mp-r-card);padding:20px;
  background:linear-gradient(118deg,var(--st-hero-from),var(--st-hero-to));box-shadow:var(--mp-shadow-hover)}
.rank-hero::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(150px 150px at 88% 14%,var(--st-hero-glow),transparent 70%)}
.rank-hero__top{display:flex;align-items:center;gap:14px;position:relative}
.rank-hero__badge{width:58px;height:58px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.1);border:2px solid var(--st-spark);color:#fff}
.rank-hero__name{font-family:var(--mp-font-display);font-weight:800;font-size:22px;color:#fff;line-height:1.1}
.rank-hero__lvl{font-size:12px;color:rgba(255,255,255,.72);margin-top:3px;font-family:var(--mp-font-mono)}
.rank-hero__xp{margin-top:16px;position:relative}
.rank-hero__xptop{display:flex;justify-content:space-between;font-size:11px;color:rgba(255,255,255,.72);margin-bottom:6px;font-weight:500}
.rank-hero__xptop b{font-family:var(--mp-font-mono);color:#fff;font-weight:700}
.rank-hero__track{height:8px;border-radius:9999px;background:rgba(255,255,255,.14);overflow:hidden}
.rank-hero__fill{height:100%;border-radius:9999px;
  background:linear-gradient(90deg,var(--mp-viridian),var(--st-spark));box-shadow:0 0 12px var(--st-spark-glow);
  transition:width .7s cubic-bezier(.22,1,.36,1)}

/* Stat strip */
.stat-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.stat-tile{background:var(--mp-surface);border:1px solid var(--mp-border-soft);border-radius:var(--mp-r-card);
  box-shadow:var(--mp-shadow-card);padding:14px}
.stat-tile__top{display:flex;align-items:center;gap:7px;margin-bottom:9px}
.stat-tile__top svg{width:18px;height:18px}
.stat-tile__top--fire{color:var(--mp-warning-dk)}
.stat-tile__top--green{color:var(--mp-viridian)}
.stat-tile__top--teal{color:var(--st-accent-text)}
.stat-tile__label{font-size:11px;font-weight:600;color:var(--mp-fg-muted)} /* never the icon accent */
.stat-tile__val{font-family:var(--mp-font-display);font-weight:900;font-size:26px;color:var(--mp-fg);line-height:1;
  font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.stat-tile__sub{font-size:11px;color:var(--mp-fg-subtle);margin-top:6px}
.stat-tile__val small{font-size:14px;font-weight:700;color:var(--mp-fg-muted);margin-left:1px}
/* a-narrow-320: three equal tiles on a 320 px phone; a long label wraps under
   its icon and hyphenates instead of pushing the strip past the screen. */
@media(max-width:374.98px){
  .stat-strip{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .stat-tile{padding:12px;min-width:0}
  .stat-tile__top{flex-wrap:wrap;gap:4px 7px}
  .stat-tile__label,.stat-tile__sub{min-width:0;overflow-wrap:break-word;hyphens:auto}
}

/* Section head */
.sec-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 12px}
.sec-head h2{font-family:var(--mp-font-display);font-weight:800;font-size:16px;color:var(--mp-fg);letter-spacing:-.01em}
.sec-head__link{display:inline-flex;align-items:center;gap:2px;font-size:12px;font-weight:600;color:var(--st-accent-text)}
.sec-head__link:hover{text-decoration:underline}

/* Per-topic accuracy rows */
.stats-tacc{display:flex;flex-direction:column;gap:11px;padding:16px}
.tarow{display:flex;align-items:center;gap:11px}
.tarow__ic{width:32px;height:32px;border-radius:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;
  background:color-mix(in srgb,var(--sc) 14%,transparent);color:var(--sc)}
[data-theme="dark"] .tarow__ic{color:color-mix(in srgb,var(--sc) 62%,white);
  background:color-mix(in srgb,var(--sc) 20%,transparent)}
.tarow__body{flex:1;min-width:0}
.tarow__topline{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;gap:8px}
.tarow__name{font-size:13px;font-weight:600;color:var(--mp-fg);white-space:normal;overflow-wrap:break-word;word-break:normal;hyphens:auto;-webkit-hyphens:auto;min-width:0}
.tarow__pct{font-family:var(--mp-font-mono);font-size:12px;font-weight:700;color:var(--mp-fg-muted);flex-shrink:0}
.tarow__track{height:6px;border-radius:9999px;background:var(--mp-surface-sunken);overflow:hidden}
.tarow__fill{height:100%;border-radius:9999px;background:var(--sc);transition:width .7s cubic-bezier(.22,1,.36,1)}
[data-theme="dark"] .tarow__fill{background:color-mix(in srgb,var(--sc) 62%,white)}
.tarow__badge{flex-shrink:0;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;
  padding:2px 7px;border-radius:9999px}
.tarow__badge.is-weak{background:var(--mp-warning-bg);color:var(--mp-warning-dk)}
.tarow__badge.is-strong{background:var(--mp-success-bg);color:var(--mp-viridian)}

/* Calm summary */
.stats-summary{padding:6px 16px}
.stats-summary__row{display:flex;align-items:center;justify-content:space-between;padding:10px 0}
.stats-summary__row + .stats-summary__row{border-top:1px solid var(--mp-border-soft)}
.stats-summary__label{font-size:13px;color:var(--mp-fg-muted)}
.stats-summary__value{font-family:var(--mp-font-mono);font-size:13px;font-weight:700;color:var(--mp-fg);font-variant-numeric:tabular-nums}
.stats-summary__value.is-viridian{color:var(--mp-viridian)}

/* Topbar rank chip (desktop) */
.rank-chip{display:none;align-items:center;gap:9px;height:38px;padding:0 12px 0 7px;border-radius:9999px;
  background:var(--mp-surface);border:1px solid var(--mp-border-soft)}
@media(min-width:1024px){.rank-chip{display:flex}}
.rank-chip__badge{display:flex;align-items:center;justify-content:center;flex-shrink:0}
.rank-chip__body{display:flex;flex-direction:column;line-height:1.15}
.rank-chip__name{font-size:12px;font-weight:700;color:var(--mp-fg)}
.rank-chip__xp{font-family:var(--mp-font-mono);font-size:10px;color:var(--st-accent-text);font-weight:600}

@media(prefers-reduced-motion:reduce){
  .rank-hero__fill,.tarow__fill{transition:none}
}
`;
