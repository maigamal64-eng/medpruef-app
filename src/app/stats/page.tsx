"use client";

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
 * What this surface renders (all from `/api/stats` + `getLevelFromXP`):
 *   - Rank-ladder hero: the felt spine of statistics. Current rank glyph
 *     (`<AchievementRank>`, one of xp.ts' 8), "Stufe N von 8 · XP", and the
 *     viridian→spark XP bar to the next threshold (e.g. 740 / 1.000 → Facharzt).
 *   - Stat strip (3 tiles): Streak (warm amber flame, never red), Gelöst
 *     (viridian check), Quote (teal trend). Mono numerals; labels pinned to
 *     --mp-fg-muted (NOT the icon accent — that was the live cascade bug).
 *   - Per-topic strength rows: each fach keyed to its TOPIC_CONFIG color, a
 *     fill bar, and a Stark/Schwach badge (strong>=70=viridian, weak<40=amber).
 *   - EmptyState (signed-in, 0 answers) nudging the first quiz.
 *
 * Business logic preserved (data CONTRACT unchanged):
 *   - `userId = ?userId || getStoredSession()` + lang from `getLang()`.
 *   - `/api/stats?userId=…` → `{ gamification, topicStats }`. (Server IGNORES
 *     the query userId and pins identity to the session — kept for parity.)
 *   - PUYP pass celebration: lands on `/stats?examPassed=1`, fires a one-time
 *     `/api/track` exam_passed event, strips the query param (replace, no
 *     re-celebrate on refresh), dismissable.
 *   - No-user nudge + branded loading state preserved.
 *
 * Scope: ONLY this file. Strings are inlined (de/en) rather than added to the
 * shared i18n.ts so a parallel sibling-surface fleet can't merge-conflict.
 * No shared component (Sidebar/BottomNav/Card/ui primitives) is edited; xp.ts
 * is NOT touched — the next-threshold ladder below is a LOCAL MIRROR of its 8
 * thresholds (getLevelFromXP only returns level/rank/progress, not the next
 * threshold value).
 */

import { useEffect, useRef, useState, Suspense, type CSSProperties, type ReactNode } from "react";
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
import { getLevelFromXP } from "@/lib/xp";
import { getTopicConfig } from "@/lib/topics";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import TopicIcon from "@/components/TopicIcon";
import { AppLayout, AchievementRank, EmptyState } from "@/components/ui";
import { rankFromName, type RankTier } from "@/components/ui";
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

/**
 * LOCAL MIRROR of the 8-rank ladder in `src/lib/xp.ts` (thresholds
 * 0/100/300/600/1000/2000/4000/8000). `getLevelFromXP()` returns level + rank
 * + progress but NOT the next-threshold value or the next rank's name, which
 * the hero XP bar needs ("740 / 1.000 → Facharzt"). Keep in sync with xp.ts.
 */
const RANK_LADDER: { threshold: number; rank: string }[] = [
  { threshold: 0, rank: "Praktikant" },
  { threshold: 100, rank: "Famulant" },
  { threshold: 300, rank: "PJ-Student" },
  { threshold: 600, rank: "Assistenzarzt" },
  { threshold: 1000, rank: "Facharzt" },
  { threshold: 2000, rank: "Oberarzt" },
  { threshold: 4000, rank: "Chefarzt" },
  { threshold: 8000, rank: "Professor" },
];

/**
 * Resolve hero ladder geometry from raw XP: current threshold, the next one
 * (and its rank name), and the % fill toward it. At max rank the bar is full
 * and there is no "next".
 */
function resolveLadder(xp: number) {
  let idx = 0;
  for (let i = RANK_LADDER.length - 1; i >= 0; i--) {
    if (xp >= RANK_LADDER[i].threshold) {
      idx = i;
      break;
    }
  }
  const current = RANK_LADDER[idx];
  const next = RANK_LADDER[idx + 1] ?? null;
  const span = next ? next.threshold - current.threshold : 1;
  const into = xp - current.threshold;
  const pct = next ? Math.min(100, Math.max(0, Math.round((into / span) * 100))) : 100;
  return { idx, current, next, pct };
}

const nf = (n: number, lang: Lang) =>
  n.toLocaleString(lang === "de" ? "de-DE" : "en-US");

function StatsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawUserId = searchParams.get("userId") || "";
  const examPassed = searchParams.get("examPassed") === "1";
  const [gam, setGam] = useState<Gamification | null>(null);
  const [topicStats, setTopicStats] = useState<Record<string, TopicStat>>({});
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState(rawUserId);
  const [userName, setUserName] = useState("");
  // Pass-Until-You-Pass celebration banner. Shown the first time a user lands
  // on /stats?examPassed=1 (after submitting their pass on the PUYP page).
  // Persists in this render only — clicking dismiss or refreshing strips
  // the query param and hides it. Telegrams [name] via /api/track for KPI.
  const [celebrate, setCelebrate] = useState(examPassed);
  const trackedRef = useRef(false);

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

  // When the user lands here from the PUYP "I passed" flow, fire a one-time
  // tracking event and clean up the URL so a refresh doesn't re-celebrate.
  useEffect(() => {
    if (!examPassed || trackedRef.current) return;
    trackedRef.current = true;
    // Best-effort tracking — we don't block the render on this.
    fetch("/api/track", {
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
  }, [examPassed, router]);

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
      <div className="flex items-center justify-center min-h-screen bg-[var(--mp-bg)]">
        <BrandedLoader />
      </div>
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
              title={lang === "de" ? "Melde dich an" : "Sign in"}
              body={
                lang === "de"
                  ? "Deine Statistik (Rang, Streak, Stärke je Fach) erscheint hier, sobald du angemeldet bist und ein paar Fragen gelöst hast."
                  : "Your statistics (rank, streak, per-topic strength) appear here once you're signed in and have answered a few questions."
              }
              action={
                <Link href="/" className="mp-btn mp-btn--primary">
                  {lang === "de" ? "Zur Startseite" : "Go to home"}
                </Link>
              }
            />
          </div>
        </main>
      </AppLayout>
    );
  }

  const xpInfo = getLevelFromXP(gam?.total_xp || 0);
  const accuracy =
    gam && gam.total_questions_answered > 0
      ? Math.round((gam.total_correct / gam.total_questions_answered) * 100)
      : 0;
  const totalXp = gam?.total_xp || 0;
  const ladder = resolveLadder(totalXp);
  const tier = rankFromName(ladder.current.rank) as RankTier;
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
        <StatsTopbar
          lang={lang}
          switchLang={switchLang}
          rankChip={
            hasData
              ? { tier, rank: ladder.current.rank, xp: totalXp, lang }
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
                onClick={() => setCelebrate(false)}
                aria-label={lang === "de" ? "Banner schließen" : "Dismiss banner"}
                className="stats-celebrate__x"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-start gap-4">
                <div className="stats-celebrate__ic">
                  <Trophy className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-display font-bold text-[var(--mp-fg)] text-lg leading-tight">
                    {lang === "de"
                      ? `Glückwunsch${userName ? `, ${userName}` : ""}! 🇦🇹`
                      : `Congratulations${userName ? `, ${userName}` : ""}! 🇦🇹`}
                  </h2>
                  <p className="text-sm text-[var(--mp-fg-muted)] mt-1">
                    {lang === "de"
                      ? "Du hast deine Prüfung bestanden. Wir haben dein Ergebnis gespeichert."
                      : "You passed your exam. We've recorded your result."}
                  </p>
                  <p className="text-xs text-[var(--mp-fg-subtle)] mt-2">
                    {lang === "de"
                      ? "Falls du jemanden eingeladen hast: deren Belohnung wird in Kürze verfügbar."
                      : "If you've referred anyone, their payout will become available shortly."}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Rank-ladder hero — the spine of statistics ──────────────── */}
          <section className="rank-hero" aria-label={lang === "de" ? "Rang" : "Rank"}>
            <div className="rank-hero__top">
              <span className="rank-hero__badge">
                <AchievementRank tier={tier} size={58} aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="rank-hero__name">{ladder.current.rank}</div>
                <div className="rank-hero__lvl">
                  {lang === "de"
                    ? `Stufe ${xpInfo.level} von 8`
                    : `Level ${xpInfo.level} of 8`}
                  {" · "}
                  {nf(totalXp, lang)} XP
                </div>
              </div>
            </div>

            {ladder.next ? (
              <div className="rank-hero__xp">
                <div className="rank-hero__xptop">
                  <span>
                    {lang === "de" ? "bis " : "to "}
                    {ladder.next.rank}
                  </span>
                  <span>
                    <b>{nf(totalXp, lang)}</b> / {nf(ladder.next.threshold, lang)} XP
                  </span>
                </div>
                <div className="rank-hero__track">
                  <div
                    className="rank-hero__fill"
                    style={{ width: `${ladder.pct}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="rank-hero__xp">
                <div className="rank-hero__xptop">
                  <span>{lang === "de" ? "Höchster Rang erreicht" : "Top rank reached"}</span>
                  <span>
                    <b>{nf(totalXp, lang)}</b> XP
                  </span>
                </div>
                <div className="rank-hero__track">
                  <div className="rank-hero__fill" style={{ width: "100%" }} />
                </div>
              </div>
            )}
          </section>

          {hasData ? (
            <>
              {/* ── Stat strip (3 tiles) ──────────────────────────────── */}
              <div className="stat-strip">
                <StatTileLocal
                  tone="fire"
                  icon={<Flame className="w-[18px] h-[18px]" />}
                  label={lang === "de" ? "Streak" : "Streak"}
                  value={String(gam?.current_streak || 0)}
                  unit={lang === "de" ? " T." : " d"}
                />
                <StatTileLocal
                  tone="green"
                  icon={<CheckCircle2 className="w-[18px] h-[18px]" />}
                  label={lang === "de" ? "Gelöst" : "Solved"}
                  value={nf(totalAnswered, lang)}
                />
                <StatTileLocal
                  tone="teal"
                  icon={<TrendingUp className="w-[18px] h-[18px]" />}
                  label={lang === "de" ? "Quote" : "Accuracy"}
                  value={String(accuracy)}
                  unit="%"
                />
              </div>

              {/* ── Per-topic strength ────────────────────────────────── */}
              {topicRows.length > 0 && (
                <section>
                  <div className="sec-head">
                    <h2>{lang === "de" ? "Stärke je Fach" : "Strength by specialty"}</h2>
                    <Link href="/progress" className="sec-head__link">
                      {lang === "de" ? "Mehr" : "More"}
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
                  label={lang === "de" ? "Richtig gesamt" : "Correct total"}
                  value={nf(gam?.total_correct || 0, lang)}
                  accent="viridian"
                />
                <SummaryRow
                  label={lang === "de" ? "Längste Serie" : "Longest streak"}
                  value={`${gam?.longest_streak || 0} ${lang === "de" ? "Tage" : "days"}`}
                />
              </div>

              {/* ── Primary CTA — exam simulation ─────────────────────── */}
              <div className="pb-2">
                <Link
                  href="/exam"
                  className="mp-btn mp-btn--primary w-full justify-center gap-2"
                >
                  <GraduationCap className="w-5 h-5" />
                  {lang === "de"
                    ? "Prüfungssimulation starten"
                    : "Start exam simulation"}
                </Link>
              </div>
            </>
          ) : (
            // Signed in but 0 answers — nudge the first quiz (SPECS §4).
            <div className="pt-2">
              <EmptyState
                tone="neutral"
                icon={<BarChart3 className="w-10 h-10" aria-hidden />}
                title={
                  lang === "de"
                    ? "Noch keine Statistik"
                    : "No statistics yet"
                }
                body={
                  lang === "de"
                    ? "Löse deine ersten Fragen, dann siehst du hier deinen Rang, deine Streak und deine Stärke je Fach wachsen."
                    : "Answer your first questions and watch your rank, streak and per-topic strength grow here."
                }
                action={
                  <Link
                    href={userId ? `/quiz?topic=random&userId=${userId}` : "/quiz"}
                    className="mp-btn mp-btn--primary gap-2"
                  >
                    <GraduationCap className="w-5 h-5" />
                    {lang === "de" ? "Erstes Quiz starten" : "Start first quiz"}
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
    <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between gap-3 border-b border-[var(--mp-border-soft)]">
      <div className="flex items-center gap-3 min-w-0">
        <Link
          href="/"
          aria-label={lang === "de" ? "Zurück" : "Back"}
          className="lg:hidden w-9 h-9 rounded-[10px] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] flex items-center justify-center text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors flex-shrink-0"
        >
          <X className="w-[18px] h-[18px]" />
        </Link>
        <div className="min-w-0">
          <h1 className="font-display font-extrabold text-[var(--mp-fg)] text-[19px] leading-tight tracking-[-0.01em]">
            {lang === "de" ? "Statistik" : "Statistics"}
          </h1>
          <p className="hidden sm:block text-[12.5px] text-[var(--mp-fg-subtle)]">
            {lang === "de"
              ? "Dein Stand für die Prüfung"
              : "Your standing for the exam"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {rankChip && (
          <div className="rank-chip">
            <span className="rank-chip__badge">
              <AchievementRank tier={rankChip.tier} size={30} aria-hidden />
            </span>
            <span className="rank-chip__body">
              <span className="rank-chip__name">{rankChip.rank}</span>
              <span className="rank-chip__xp">{nf(rankChip.xp, rankChip.lang)} XP</span>
            </span>
          </div>
        )}
        <ThemeToggle />
        <LanguageToggle lang={lang} onChange={switchLang} />
        <button
          type="button"
          aria-label={lang === "de" ? "Teilen" : "Share"}
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
}: {
  tone: "fire" | "green" | "teal";
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
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
          <span className="tarow__name">{row.topic}</span>
          <span className="tarow__pct">{row.acc}%</span>
        </div>
        <div className="tarow__track">
          <div className="tarow__fill" style={{ width: `${row.acc}%` }} />
        </div>
      </div>
      {(strong || weak) && (
        <span className={`tarow__badge ${strong ? "is-strong" : "is-weak"}`}>
          {strong
            ? lang === "de"
              ? "Stark"
              : "Strong"
            : lang === "de"
              ? "Schwach"
              : "Weak"}
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
.stat-tile__val small{font-size:14px;font-weight:700;color:var(--mp-fg-muted);margin-left:1px}

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
.tarow__name{font-size:13px;font-weight:600;color:var(--mp-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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
