"use client";

/**
 * Flashcards — MPDS v2 "Flashcards-B" deck stack + history rail.
 *
 * Phase B.3 rebuild (2026-06-26):
 *   - MCQ-native recall→verify model: FRONT = stem as cue (with
 *     "(N richtige Antworten)" stripped to a format badge); BACK =
 *     correct choices from `options` array (never the legacy pipe-
 *     joined `answer` string) + explanation via <AnswerReveal> when
 *     present; graceful no-explanation state for the ~69% without one.
 *   - All 18 inline-style color blocks replaced: 4 confidence buttons
 *     → <RatingButton intensity>; rail dots/text, retention %, leaks
 *     value → Tailwind token classes; session pill → bg/text token.
 *   - Ghost-card transforms + topic-color chips + progress-bar width
 *     + history maxHeight remain inline (geometry/data-driven, not
 *     static color tokens).
 *   - <AppLayout> wrapper from Phase B.2 (commit 3635f7e) preserved.
 *
 * Business logic unchanged:
 *   - `getStoredSession()` hydrates user/xp/streak/accuracy
 *   - `/api/questions?topic=…&limit=1&examSource=…&userId=…`
 *     fetches the next card (spaced-rep prioritization server-side)
 *   - `/api/answer` POST records answer with binary `isCorrect`
 *     mapping (again/hard=false, good/easy=true). SM-2 engine intact.
 *     NOTE: additive grade 0-3 (Option B, spec §4.2) would require
 *     a route change to /api/answer — flagged, not done here.
 *   - `medpruef_flashcard_daily` localStorage counter untouched
 *   - Keyboard shortcuts: Space/Enter flip, 1-4 rate
 *
 * The history rail is purely client-side session state — no new
 * network calls, no new tracking events.
 */

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { BrandedLoader } from "@/components/Logo";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { authFetch as fetch } from "@/lib/authFetch";
import { shouldIgnoreGlobalKey } from "@/lib/keyboard-guard";
import { getLang, setLang, t } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { getStoredExamSource } from "@/lib/topics";
import { getTopicConfig } from "@/lib/topics";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import {
  AppLayout,
  RatingButton,
  Option,
  AnswerReveal,
  EmptyState,
} from "@/components/ui";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import TopicIcon from "@/components/TopicIcon";
import {
  Layers,
  RotateCcw,
  History,
  Check,
  ShieldCheck,
  Lock,
  Sparkles,
} from "lucide-react";
import { getPaywallCopy } from "@/lib/paywall-copy";
import type { MCQOption } from "@/lib/mcq";

type Lang = "de" | "en";
type Confidence = "again" | "hard" | "good" | "easy";

interface Question {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  ai_explanation?: string;
  image_url?: string;
  /** Structured options from the `choices` JSONB column, attached by
   *  attachOptions() on the API route. null = open-answer mode. */
  options?: MCQOption[] | null;
  /** How many options are correct (set by attachOptions()). */
  n_correct?: number;
}

interface HistoryEntry {
  id: number;
  topic: string;
  question: string;
  rating: Confidence;
}

/* ─── Rating colour class maps — replaces ratingColor() ─────────── */
const RATING_DOT_BG: Record<Confidence, string> = {
  again: "bg-[var(--mp-warning)]",
  hard: "bg-[var(--mp-status-warning)]",
  good: "bg-[var(--mp-viridian)]",
  easy: "bg-[var(--mp-cta-blue)]",
};

const RATING_TEXT: Record<Confidence, string> = {
  again: "text-[var(--mp-warning)]",
  hard: "text-[var(--mp-status-warning)]",
  good: "text-[var(--mp-viridian)]",
  easy: "text-[var(--mp-cta-blue)]",
};

/** Maps Confidence to RatingButton intensity (0=again, 1=hard, 2=good, 3=easy). */
const CONFIDENCE_INTENSITY: Record<Confidence, 0 | 1 | 2 | 3> = {
  again: 0,
  hard: 1,
  good: 2,
  easy: 3,
};

/* ─── Helpers ────────────────────────────────────────────────────── */

/** Strip "(N richtige Antwort/en)" from the stem — shown as a badge instead. */
function stripMultiCorrectHint(q: string): string {
  return q.replace(/\s*\(\d+ richtige? Antworten?\)/gi, "").trim();
}

/** Extract N from "(N richtige Antworten)" if present. Returns null if absent. */
function extractCorrectCount(q: string): number | null {
  const m = q.match(/\((\d+) richtige? Antworten?\)/i);
  return m ? parseInt(m[1], 10) : null;
}

function ratingLabel(r: Confidence, lang: Lang): string {
  if (r === "again") return lang === "de" ? "Nochmal" : "Again";
  if (r === "hard") return lang === "de" ? "Schwer" : "Hard";
  if (r === "good") return lang === "de" ? "Gut" : "Good";
  return lang === "de" ? "Einfach" : "Easy";
}

const FLASHCARD_COUNT_KEY = "medpruef_flashcard_daily";
const HISTORY_CAP = 10;

function getTodayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function getDailyCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const data = JSON.parse(localStorage.getItem(FLASHCARD_COUNT_KEY) || "{}");
    const today = getTodayKey();
    return data[today] || 0;
  } catch {
    return 0;
  }
}

function incrementDailyCount(): void {
  try {
    const data = JSON.parse(localStorage.getItem(FLASHCARD_COUNT_KEY) || "{}");
    const today = getTodayKey();
    data[today] = (data[today] || 0) + 1;
    localStorage.setItem(FLASHCARD_COUNT_KEY, JSON.stringify(data));
  } catch {
    /* silent */
  }
}

/* ─── Flashcard component ────────────────────────────────────────── */

interface FlashcardProps {
  question: Question;
  flipped: boolean;
  animatingOut: boolean;
  onFlip: () => void;
  lang: Lang;
  topicConfig: { color: string; icon: string };
}

/**
 * <Flashcard> renders the 3D-flip card pair (front + back) for one
 * question. Front = stem as cue. Back = correct choices via <Option>
 * + explanation via <AnswerReveal> when present.
 *
 * Extracted from the 859-line monolith per Phase B.3 spec. Stays in
 * this file (scope is ONLY flashcards/page.tsx).
 */
function Flashcard({
  question,
  flipped,
  animatingOut,
  onFlip,
  lang,
  topicConfig,
}: FlashcardProps) {
  const stem = stripMultiCorrectHint(question.question);
  const hintCount = extractCorrectCount(question.question);
  const isMulti = (question.n_correct ?? 1) > 1 || (hintCount ?? 0) > 1;

  /* Correct options for the back. Prefer structured options; fall back
   * to the pipe-joined answer string split into a list so the back
   * is never blank even for open-answer cards. */
  const correctOptions: string[] = question.options
    ? question.options.filter((o) => o.correct).map((o) => o.text)
    : question.answer
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);

  /* Explanation — treat whitespace-only as absent (69% no-explanation
   * path must feel complete, not broken). */
  const explanation = (
    question.explanation?.trim() ||
    question.ai_explanation?.trim() ||
    ""
  );
  const hasExplanation = explanation.length > 0;

  return (
    <div
      className={`relative w-full h-full transition-all duration-300 ${
        animatingOut ? "opacity-0 translate-x-8" : "opacity-100 translate-x-0"
      }`}
      style={{ zIndex: 3 }}
    >
      <div
        className="flip-card w-full h-full cursor-pointer"
        onClick={() => {
          if (!flipped) onFlip();
        }}
      >
        <div
          className={`flip-card-inner w-full min-h-[340px] h-full ${
            flipped ? "flipped" : ""
          }`}
        >
          {/* ── FRONT ────────────────────────────────────────────── */}
          <div
            className="flip-card-front w-full min-h-[340px] mp-card p-6 flex flex-col"
            aria-hidden={flipped}
          >
            {/* Topic chip */}
            <div className="flex items-center gap-2 mb-4">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${topicConfig.color}15` }}
              >
                <TopicIcon name={topicConfig.icon} className="w-3.5 h-3.5" />
              </div>
              <span
                className="text-[10px] font-mono uppercase tracking-wider font-bold px-2 py-0.5 rounded"
                style={{
                  backgroundColor: `${topicConfig.color}10`,
                  color: topicConfig.color,
                }}
              >
                {question.topic}
              </span>
              {/* Format badge — replaces the inline "(N richtige)" hint */}
              {isMulti && (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)]">
                  {hintCount !== null
                    ? lang === "de"
                      ? `${hintCount} richtig`
                      : `${hintCount} correct`
                    : lang === "de"
                      ? "Mehrfach"
                      : "Multi"}
                </span>
              )}
              {!isMulti && (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)]">
                  {lang === "de" ? "Einfach" : "Single"}
                </span>
              )}
            </div>

            {/* Stem */}
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[var(--mp-fg)] text-base leading-relaxed text-center whitespace-pre-line font-display font-bold">
                {stem}
              </p>
            </div>

            {question.image_url && (
              <div className="mt-4 flex justify-center">
                <img
                  src={question.image_url}
                  alt=""
                  className="max-h-40 rounded-lg object-contain"
                />
              </div>
            )}

            <div className="mt-4 text-center">
              <p className="text-xs text-[var(--mp-fg-subtle)] flex items-center justify-center gap-1.5 font-mono">
                <RotateCcw className="w-3.5 h-3.5" />
                {t("tap_to_flip", lang)}
              </p>
            </div>
          </div>

          {/* ── BACK ─────────────────────────────────────────────── */}
          <div
            className="flip-card-back w-full min-h-[340px] mp-card p-6 flex flex-col"
            aria-hidden={!flipped}
          >
            {/* Topic chip (same as front for visual continuity) */}
            <div className="flex items-center gap-2 mb-4">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${topicConfig.color}15` }}
              >
                <TopicIcon name={topicConfig.icon} className="w-3.5 h-3.5" />
              </div>
              <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--mp-viridian)]">
                {t("correct_answer", lang)}
              </span>
            </div>

            {/* Correct choices via <Option state="correct"> */}
            <div className="flex-1 flex flex-col gap-2">
              {correctOptions.length > 0 ? (
                correctOptions.map((text, idx) => (
                  <Option
                    key={idx}
                    state="correct"
                    letter={
                      correctOptions.length > 1
                        ? String.fromCharCode(65 + idx)
                        : undefined
                    }
                  >
                    {text}
                  </Option>
                ))
              ) : (
                /* Fallback: no structured options and no parseable answer */
                <p className="text-[var(--mp-viridian)] text-lg font-bold whitespace-pre-line font-display">
                  {question.answer}
                </p>
              )}
            </div>

            {/* Explanation via <AnswerReveal> — only when non-empty */}
            {hasExplanation && (
              <div className="mt-4">
                <AnswerReveal correct>
                  <p className="text-xs font-semibold text-[var(--mp-fg-subtle)] uppercase tracking-wider mb-1 font-mono">
                    {t("explanation", lang)}
                  </p>
                  <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed whitespace-pre-line">
                    {explanation.length > 400
                      ? explanation.slice(0, 400) + "..."
                      : explanation}
                  </p>
                </AnswerReveal>
              </div>
            )}

            {/* No-explanation state — clean, not broken */}
            {!hasExplanation && (
              <p className="mt-4 text-xs text-[var(--mp-fg-subtle)] text-center font-mono italic">
                {lang === "de"
                  ? "Keine Erklarung vorhanden"
                  : "No explanation available"}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Main page content ──────────────────────────────────────────── */

function FlashcardContent() {
  const searchParams = useSearchParams();
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [totalXp, setTotalXp] = useState(0);
  const [streak, setStreak] = useState(0);
  const [accuracy, setAccuracy] = useState(0);

  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [flipped, setFlipped] = useState(false);
  const [dailyCount, setDailyCount] = useState(0);
  const [animatingOut, setAnimatingOut] = useState(false);
  // Set when the free-tier gate returns `paywallHit: true` — the API
  // returned 200 with no question because the user has exhausted their
  // 150-question free slice. We render an upgrade prompt instead of
  // spinning forever on the loading state.
  const [paywallHit, setPaywallHit] = useState(false);

  // Session-only history rail (most recent first, capped)
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Current question reference for async rating calls
  const currentRef = useRef<Question | null>(null);

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
      // Guard against sessions without a gamification snapshot — those
      // crash here otherwise with "Cannot read properties of undefined".
      const gm = session.gamification ?? {};
      setTotalXp(gm.total_xp || 0);
      setStreak(gm.current_streak || 0);
      const ans = gm.total_questions_answered || 0;
      const cor = gm.total_correct || 0;
      setAccuracy(ans > 0 ? Math.round((cor / ans) * 100) : 0);
    }
    setDailyCount(getDailyCount());
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const fetchCard = useCallback(async () => {
    setLoading(true);
    setFlipped(false);
    setAnimatingOut(false);
    setPaywallHit(false);

    try {
      const examSource = getStoredExamSource();
      const topic = searchParams.get("topic") || "random";
      const params = new URLSearchParams({ topic, limit: "1", examSource });
      if (userId) params.set("userId", userId);
      const res = await fetch(`/api/questions?${params}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setQuestion(data[0]);
        currentRef.current = data[0];
      } else if (
        data &&
        typeof data === "object" &&
        (data as { paywallHit?: boolean }).paywallHit
      ) {
        // Free-tier slice exhausted for this exam. Surface the upgrade
        // prompt rather than trapping the user in a loading spinner.
        setPaywallHit(true);
        setQuestion(null);
        currentRef.current = null;
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [userId, searchParams]);

  // Fetch first card
  useEffect(() => {
    fetchCard();
  }, [fetchCard]);

  const handleConfidence = useCallback(
    async (level: Confidence) => {
      const q = currentRef.current;
      if (!q) return;

      // Animate out + log history
      setAnimatingOut(true);
      incrementDailyCount();
      setDailyCount((c) => c + 1);
      setHistory((prev) =>
        [
          { id: q.id, topic: q.topic, question: q.question, rating: level },
          ...prev,
        ].slice(0, HISTORY_CAP),
      );

      // If logged in, report answer with binary confidence mapping.
      // NOTE: the spec (§4.2, Option B) recommends extending this to
      // pass a numeric `grade: 0|1|2|3` for real 4-grade SM-2. That
      // requires a route change to /api/answer — flagged for the lead.
      if (userId) {
        const isCorrect = level === "good" || level === "easy";
        try {
          await fetch("/api/answer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              questionId: q.id,
              isCorrect,
              userAnswer: q.answer,
              timeSpentMs: 0,
            }),
          });
        } catch {
          /* silent */
        }
      }

      setTimeout(() => {
        fetchCard();
      }, 300);
    },
    [userId, fetchCard],
  );

  // Keyboard shortcuts (Space/Enter flip, 1-4 rate)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Shared keyboard guard — ignores typing in dialogs (Feedback,
      // Flag, etc.) so Space/Enter inside a textarea doesn't flip
      // the flashcard behind it (review-2026-04-26-A1).
      if (shouldIgnoreGlobalKey(e)) return;

      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!flipped) {
          setFlipped(true);
        }
      }
      if (e.key === "1" && flipped) handleConfidence("again");
      if (e.key === "2" && flipped) handleConfidence("hard");
      if (e.key === "3" && flipped) handleConfidence("good");
      if (e.key === "4" && flipped) handleConfidence("easy");
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [flipped, handleConfidence]);

  /* ─── Session retention = (good + easy) / total rated × 100 ─── */
  const retention =
    history.length === 0
      ? null
      : Math.round(
          (history.filter(
            (h) => h.rating === "good" || h.rating === "easy",
          ).length /
            history.length) *
            100,
        );
  const leaks = history.filter((h) => h.rating === "again").length;

  /* ─── Retention colour class (Tailwind token) ─────────────────── */
  const retentionClass =
    retention === null
      ? ""
      : retention >= 70
        ? "text-[var(--mp-viridian)]"
        : retention >= 40
          ? "text-[var(--mp-status-warning)]"
          : "text-[var(--mp-warning)]";

  if (loading && !question) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)]">
        <BrandedLoader />
      </div>
    );
  }

  if (paywallHit) {
    // Free user exhausted the 150-question slice for this exam. Nudge
    // to /pricing instead of showing the generic "no questions" state
    // — they didn't run out of content, they ran out of free tier.
    //
    // Copy pulled from src/lib/paywall-copy.ts so this surface and the
    // `PaywallUpgradeModal` present the identical offer, same bullet
    // order, same reassurance line (post-soft-launch §1.4.7).
    const paywallCopy = getPaywallCopy({ lang });
    const pricingHref =
      "/pricing?utm_source=flashcards_paywall&utm_medium=fullbleed&utm_campaign=paywall_v1";
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 py-12 bg-[var(--mp-surface-sunken)]">
        <div className="mp-card text-center animate-fade-in max-w-md w-full p-6 sm:p-8">
          <Layers
            className="w-12 h-12 text-[var(--mp-viridian)] mx-auto mb-4"
            aria-hidden
          />
          <h2 className="mp-h2 mb-2">{paywallCopy.title}</h2>
          <p className="text-[var(--mp-fg-muted)] mb-6">
            {paywallCopy.description}
          </p>

          <div className="flex items-start gap-3 p-3 mb-5 rounded-[var(--mp-r-card)] bg-[var(--mp-surface-sunken)] text-left">
            <Lock
              className="w-5 h-5 text-[var(--mp-cta-blue)] flex-shrink-0 mt-0.5"
              aria-hidden
            />
            <p className="text-sm text-[var(--mp-fg)]">
              {paywallCopy.milestoneIntro}{" "}
              <span className="text-[var(--mp-fg-subtle)]">
                {paywallCopy.milestoneFollowup}
              </span>
            </p>
          </div>

          <ul className="space-y-2 mb-6 text-left">
            {paywallCopy.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Check
                  className="w-4 h-4 text-[var(--mp-accent-teal)] flex-shrink-0 mt-0.5"
                  aria-hidden
                />
                <span className="text-[var(--mp-fg)]">{b}</span>
              </li>
            ))}
          </ul>

          <Link
            href={pricingHref}
            className="mp-btn mp-btn--primary mp-btn--lg inline-flex items-center justify-center gap-2 w-full"
          >
            {paywallCopy.primaryCta}
          </Link>

          <div className="flex items-center justify-center gap-2 text-xs text-[var(--mp-fg-subtle)] pt-4">
            <ShieldCheck
              className="w-3.5 h-3.5 text-[var(--mp-accent-teal)]"
              aria-hidden
            />
            <span>{paywallCopy.reassurance}</span>
          </div>
        </div>
      </div>
    );
  }

  if (!question) {
    // "No questions" covers two real-world cases: (1) a new user with
    // nothing in their SM-2 queue yet, (2) an existing user who's
    // cleared every due card for the day. Both deserve a warm "all
    // caught up" nudge, not a blank "no questions" verdict.
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 bg-[var(--mp-surface-sunken)]">
        <div className="max-w-md w-full animate-fade-in">
          <EmptyState
            tone="success"
            icon={<Sparkles className="w-10 h-10" aria-hidden />}
            title={
              lang === "de"
                ? "Heute alles erledigt."
                : "All caught up for today."
            }
            body={
              lang === "de"
                ? "Du hast alle falligen Karten durchgearbeitet. Neue Wiederholungen freischalten sich automatisch, oder starte ein kurzes Zufalls-Quiz, um weiter zu uben."
                : "You've cleared every card due right now. New reviews unlock automatically, or start a quick random quiz to keep the momentum."
            }
            action={
              <div className="flex flex-col sm:flex-row gap-2 justify-center mt-2">
                <Link href="/quiz" className="mp-btn mp-btn--primary">
                  {lang === "de" ? "Zufalls-Quiz starten" : "Start random quiz"}
                </Link>
                <Link href="/" className="mp-btn mp-btn--ghost">
                  {t("back_home", lang)}
                </Link>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  const topicConfig = getTopicConfig(question.topic);

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
      <main className="main-content safe-area-top safe-area-bottom flex flex-col min-h-screen bg-[var(--mp-surface-sunken)]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between flex-shrink-0 border-b border-[var(--mp-border-subtle)]">
          <Link
            href="/"
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            &larr; {t("back_home", lang)}
          </Link>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[var(--mp-viridian)]" />
            <h1 className="text-base font-bold text-[var(--mp-fg)]">
              {t("flashcards", lang)}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--mp-fg-subtle)] font-mono hidden sm:inline">
              {dailyCount} {t("cards_today", lang)}
            </span>
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Card area + history rail */}
        <div className="flex-1 px-4 lg:px-8 py-5">
          <div className="max-w-[960px] mx-auto grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-5 h-full">
            {/* ═══ MAIN COLUMN: deck stack + rating buttons ═══ */}
            <div className="flex flex-col gap-4 min-w-0">
              {/* Compact rail for mobile (hidden on lg+) */}
              {history.length > 0 && (
                <div className="mp-card p-3 lg:hidden">
                  <div className="flex items-center gap-2 overflow-x-auto">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mp-fg-subtle)] font-bold flex-shrink-0 flex items-center gap-1">
                      <History className="w-3 h-3" />
                      {lang === "de" ? "Verlauf" : "History"}
                    </span>
                    {retention !== null && (
                      <span
                        className={`text-[10px] font-mono font-bold flex-shrink-0 ${retentionClass}`}
                      >
                        {retention}%{" "}
                        {lang === "de" ? "Retention" : "retention"}
                      </span>
                    )}
                    <div className="flex items-center gap-1 overflow-x-auto">
                      {history.map((h) => (
                        <div
                          key={`${h.id}-${h.rating}`}
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${RATING_DOT_BG[h.rating]}`}
                          title={ratingLabel(h.rating, lang)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Due/progress top bar */}
              <div className="flex items-center justify-between text-[11px] font-mono text-[var(--mp-fg-muted)]">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold text-[10px] uppercase tracking-wider bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)]">
                  <Layers className="w-3 h-3" />
                  {lang === "de" ? "Session" : "Session"} · {dailyCount}
                </span>
                <div className="flex-1 mx-3 h-1 bg-[var(--mp-border-subtle)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--mp-viridian)] rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (dailyCount / 20) * 100)}%`,
                    }}
                  />
                </div>
                <span>
                  {dailyCount} / 20 {t("cards_today", lang)}
                </span>
              </div>

              {/* ═══ DECK STACK — 2 ghost cards fan behind front card ═══ */}
              <div className="relative flex-1 min-h-[340px]">
                {/* Ghost card 3 — furthest back */}
                <div
                  aria-hidden
                  className="mp-card absolute pointer-events-none"
                  style={{
                    inset: 0,
                    transform:
                      "translate(14px, 14px) rotate(-1.6deg) scale(0.97)",
                    opacity: 0.4,
                    zIndex: 1,
                  }}
                />
                {/* Ghost card 2 — middle layer */}
                <div
                  aria-hidden
                  className="mp-card absolute pointer-events-none"
                  style={{
                    inset: 0,
                    transform:
                      "translate(7px, 7px) rotate(0.6deg) scale(0.985)",
                    opacity: 0.7,
                    zIndex: 2,
                  }}
                />

                {/* Active (3D-flip) card — extracted as <Flashcard> */}
                <Flashcard
                  question={question}
                  flipped={flipped}
                  animatingOut={animatingOut}
                  onFlip={() => setFlipped(true)}
                  lang={lang}
                  topicConfig={topicConfig}
                />
              </div>

              {/* Confidence buttons — visible only when flipped */}
              {flipped && (
                <div className="animate-fade-in">
                  <p className="text-xs text-[var(--mp-fg-subtle)] text-center mb-2">
                    {t("flashcard_hint", lang)}
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    <RatingButton
                      intensity={CONFIDENCE_INTENSITY.again}
                      sublabel={lang === "de" ? "< 10 Min." : "< 10 min"}
                      onClick={() => handleConfidence("again")}
                      aria-label={`${t("again", lang)}, < 10 ${lang === "de" ? "Minuten" : "minutes"}`}
                    >
                      {t("again", lang)}
                    </RatingButton>
                    <RatingButton
                      intensity={CONFIDENCE_INTENSITY.hard}
                      sublabel={lang === "de" ? "1 Tag" : "1 day"}
                      onClick={() => handleConfidence("hard")}
                      aria-label={`${t("hard", lang)}, 1 ${lang === "de" ? "Tag" : "day"}`}
                    >
                      {t("hard", lang)}
                    </RatingButton>
                    <RatingButton
                      intensity={CONFIDENCE_INTENSITY.good}
                      sublabel={lang === "de" ? "4 Tage" : "4 days"}
                      onClick={() => handleConfidence("good")}
                      aria-label={`${t("good", lang)}, 4 ${lang === "de" ? "Tage" : "days"}`}
                    >
                      {t("good", lang)}
                    </RatingButton>
                    <RatingButton
                      intensity={CONFIDENCE_INTENSITY.easy}
                      sublabel={lang === "de" ? "12 Tage" : "12 days"}
                      onClick={() => handleConfidence("easy")}
                      aria-label={`${t("easy", lang)}, 12 ${lang === "de" ? "Tage" : "days"}`}
                    >
                      {t("easy", lang)}
                    </RatingButton>
                  </div>

                  {/* Keyboard shortcut hint */}
                  <p className="text-[10px] text-[var(--mp-fg-subtle)] text-center mt-3 font-mono">
                    <kbd className="px-1 py-0.5 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)] rounded text-[10px]">
                      1
                    </kbd>
                    -
                    <kbd className="px-1 py-0.5 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)] rounded text-[10px]">
                      4
                    </kbd>{" "}
                    {lang === "de" ? "oder" : "or"}{" "}
                    <kbd className="px-1 py-0.5 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)] rounded text-[10px]">
                      Space
                    </kbd>{" "}
                    {lang === "de" ? "zum Umdrehen" : "to flip"}
                  </p>
                </div>
              )}
            </div>

            {/* ═══ HISTORY RAIL (desktop) ═══ */}
            <aside className="mp-card p-4 hidden lg:flex flex-col gap-4 h-fit sticky top-5">
              {/* "Today" stats — mission-control tiles, not bottom-of-
                  form greys. Big tabular-num values, 10px label below,
                  two-column grid so they scan as data, not as prose. */}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mp-fg-subtle)] font-bold mb-2.5">
                  {lang === "de" ? "Heute" : "Today"}
                </div>
                <div className="grid grid-cols-2 gap-2 mb-1">
                  <div className="rounded-xl bg-[var(--mp-surface-sunken)] px-3 py-2.5">
                    <div className="text-xl font-black font-mono font-display tabular-nums text-[var(--mp-fg)] leading-none">
                      {dailyCount}
                    </div>
                    <div className="mt-1 text-[10px] font-mono uppercase tracking-wider text-[var(--mp-fg-subtle)]">
                      {lang === "de" ? "Erledigt" : "Done"}
                    </div>
                  </div>
                  <div className="rounded-xl bg-[var(--mp-surface-sunken)] px-3 py-2.5">
                    <div className="text-xl font-black font-mono font-display tabular-nums text-[var(--mp-fg)] leading-none">
                      {history.length}
                    </div>
                    <div className="mt-1 text-[10px] font-mono uppercase tracking-wider text-[var(--mp-fg-subtle)]">
                      {lang === "de" ? "Session" : "Session"}
                    </div>
                  </div>
                </div>
                {leaks > 0 && (
                  <div className="mt-2 rounded-xl bg-[var(--mp-surface-sunken)] px-3 py-2 flex items-baseline justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--mp-fg-subtle)]">
                      Leaks ({lang === "de" ? "Nochmal" : "again"})
                    </span>
                    <span
                      className={`font-mono font-black text-lg tabular-nums ${RATING_TEXT.again}`}
                    >
                      {leaks}
                    </span>
                  </div>
                )}
              </div>

              {/* Retention — only shown after at least one rating */}
              {retention !== null && (
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mp-fg-subtle)] font-bold mb-2">
                    {lang === "de"
                      ? "Retention (Session)"
                      : "Retention (session)"}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`font-display font-black text-[32px] leading-none tracking-tight font-mono ${retentionClass}`}
                    >
                      {retention}%
                    </span>
                    <span className="text-[10px] font-mono text-[var(--mp-fg-subtle)]">
                      {
                        history.filter(
                          (h) =>
                            h.rating === "good" || h.rating === "easy",
                        ).length
                      }
                      /{history.length}{" "}
                      {lang === "de" ? "korrekt" : "correct"}
                    </span>
                  </div>
                </div>
              )}

              {/* History list */}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mp-fg-subtle)] font-bold mb-2 flex items-center gap-1.5">
                  <History className="w-3 h-3" />
                  {lang === "de" ? "Verlauf" : "History"}
                </div>
                {history.length === 0 ? (
                  <p className="text-xs text-[var(--mp-fg-subtle)] italic">
                    {lang === "de"
                      ? "Noch keine Karten bewertet"
                      : "No cards rated yet"}
                  </p>
                ) : (
                  <div
                    className="flex flex-col gap-1.5 overflow-auto"
                    style={{ maxHeight: 280 }}
                  >
                    {history.map((h, i) => (
                      <div
                        key={`${h.id}-${i}`}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] bg-[var(--mp-surface-sunken)]"
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${RATING_DOT_BG[h.rating]}`}
                        />
                        <span className="flex-1 min-w-0 truncate text-[var(--mp-fg-muted)]">
                          {h.question.slice(0, 40)}
                          {h.question.length > 40 ? "..." : ""}
                        </span>
                        <span
                          className={`text-[9px] font-mono uppercase tracking-wider font-bold flex-shrink-0 ${RATING_TEXT[h.rating]}`}
                        >
                          {ratingLabel(h.rating, lang)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>

        {/* Session bar */}
        <div className="px-4 lg:px-8 py-3 border-t border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] flex-shrink-0">
          <div className="max-w-[960px] mx-auto flex items-center justify-between text-sm">
            <span className="text-[var(--mp-fg-muted)]">
              <Layers className="w-4 h-4 inline mr-1 opacity-60" />
              {dailyCount} {t("cards_today", lang)}
            </span>
            {!userId && (
              <span className="text-xs text-[var(--mp-fg-subtle)]">
                {lang === "de"
                  ? "Nicht angemeldet, Fortschritt wird nicht gespeichert"
                  : "Not signed in, progress not saved"}
              </span>
            )}
          </div>
        </div>
      </main>
    </AppLayout>
  );
}

export default function FlashcardsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)]">
          <BrandedLoader />
        </div>
      }
    >
      <FlashcardContent />
    </Suspense>
  );
}
