"use client";

/**
 * Flashcards — MPDS v2 "Flashcards-B" deck stack + history rail.
 *
 * Layout bet: the front card still 3D-flips and drives SM-2 rating
 * (Again / Hard / Good / Easy — keyboard 1-4, Space flip), but two
 * ghosted sibling cards fan out behind it to create depth, and a
 * right-hand rail surfaces the last 5-10 cards rated this session
 * plus a live retention %. Mobile collapses the rail to a compact
 * horizontal strip above the deck.
 *
 * Business logic preserved:
 *   - `getStoredSession()` hydrates user/xp/streak/accuracy
 *   - `/api/questions?topic=…&limit=1&examSource=…&userId=…`
 *     fetches the next card (spaced-rep prioritization already
 *     handled server-side)
 *   - `/api/answer` POST still records answer with
 *     `isCorrect = level === "good" || level === "easy"` so the SM-2
 *     `user_question_progress` row and XP/streak update as before
 *   - `medpruef_flashcard_daily` localStorage counter untouched
 *   - Keyboard shortcuts (Space flip, 1-4 rate) preserved
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
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import TopicIcon from "@/components/TopicIcon";
import { Layers, RotateCcw, History, Check, ShieldCheck, Lock, Sparkles } from "lucide-react";
import { getPaywallCopy } from "@/lib/paywall-copy";
import { EmptyState } from "@/components/ui";

type Lang = "de" | "en";
type Confidence = "again" | "hard" | "good" | "easy";

interface Question {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  image_url?: string;
}

interface HistoryEntry {
  id: number;
  topic: string;
  question: string;
  rating: Confidence;
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

function ratingLabel(r: Confidence, lang: Lang): string {
  if (r === "again") return lang === "de" ? "Nochmal" : "Again";
  if (r === "hard") return lang === "de" ? "Schwer" : "Hard";
  if (r === "good") return lang === "de" ? "Gut" : "Good";
  return lang === "de" ? "Einfach" : "Easy";
}

function ratingColor(r: Confidence): string {
  // SM-2 isn't "wrong → right"; it's a difficulty gradient. Using
  // `--mp-error` red for "Again" read as punishment (post-soft-launch
  // audit). Migrated to an orange→yellow→viridian→blue ramp that
  // reads as "more work needed" → "more confidence". The history-rail
  // dots, retention % threshold colours, and button borders all share
  // this scale so a glance tells the same story everywhere.
  if (r === "again") return "var(--mp-warning)";          // warm orange — "revisit soon"
  if (r === "hard") return "var(--mp-gamif-xp, #FBD38D)"; // soft gold — "getting there"
  if (r === "good") return "var(--mp-viridian)";          // brand viridian — "solid"
  return "var(--mp-cta-blue)";                             // cta blue — "mastered"
}

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

      // If logged in, report answer with confidence mapping
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

  // Keyboard shortcuts (Space flip, 1-4 rate)
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
          (history.filter((h) => h.rating === "good" || h.rating === "easy").length /
            history.length) *
            100,
        );
  const leaks = history.filter((h) => h.rating === "again").length;

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
                ? "Du hast alle fälligen Karten durchgearbeitet. Neue Wiederholungen freischalten sich automatisch — oder starte ein kurzes Zufalls-Quiz, um weiter zu üben."
                : "You've cleared every card due right now. New reviews unlock automatically — or start a quick random quiz to keep the momentum."
            }
            action={
              <div className="flex flex-col sm:flex-row gap-2 justify-center mt-2">
                <Link
                  href="/quiz"
                  className="mp-btn mp-btn--primary"
                >
                  {lang === "de" ? "Zufalls-Quiz starten" : "Start random quiz"}
                </Link>
                <Link
                  href="/"
                  className="mp-btn mp-btn--ghost"
                >
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
    <div className="app-layout">
      <Sidebar
        lang={lang}
        userId={userId}
        userName={userName}
        totalXp={totalXp}
        streak={streak}
        accuracy={accuracy}
      />

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
                      <span className="text-[10px] font-mono text-[var(--mp-viridian)] font-bold flex-shrink-0">
                        {retention}% {lang === "de" ? "Retention" : "retention"}
                      </span>
                    )}
                    <div className="flex items-center gap-1 overflow-x-auto">
                      {history.map((h) => (
                        <div
                          key={`${h.id}-${h.rating}`}
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: ratingColor(h.rating) }}
                          title={ratingLabel(h.rating, lang)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Due/progress top bar */}
              <div className="flex items-center justify-between text-[11px] font-mono text-[var(--mp-fg-muted)]">
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold text-[10px] uppercase tracking-wider"
                  style={{
                    background: "rgba(0, 168, 150, 0.1)",
                    color: "var(--mp-viridian)",
                  }}
                >
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
                    transform: "translate(14px, 14px) rotate(-1.6deg) scale(0.97)",
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
                    transform: "translate(7px, 7px) rotate(0.6deg) scale(0.985)",
                    opacity: 0.7,
                    zIndex: 2,
                  }}
                />

                {/* Active (3D-flip) card */}
                <div
                  className={`relative w-full h-full transition-all duration-300 ${
                    animatingOut
                      ? "opacity-0 translate-x-8"
                      : "opacity-100 translate-x-0"
                  }`}
                  style={{ zIndex: 3 }}
                >
                  <div
                    className="flip-card w-full h-full cursor-pointer"
                    onClick={() => {
                      if (!flipped) setFlipped(true);
                    }}
                  >
                    <div
                      className={`flip-card-inner w-full min-h-[340px] h-full ${
                        flipped ? "flipped" : ""
                      }`}
                    >
                      {/* FRONT */}
                      <div className="flip-card-front w-full min-h-[340px] mp-card p-6 flex flex-col">
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
                        </div>

                        <div className="flex-1 flex items-center justify-center">
                          <p className="text-[var(--mp-fg)] text-base leading-relaxed text-center whitespace-pre-line font-display font-bold">
                            {question.question}
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

                      {/* BACK */}
                      <div className="flip-card-back w-full min-h-[340px] mp-card p-6 flex flex-col">
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

                        <div className="flex-1">
                          <p className="text-[var(--mp-viridian)] text-lg font-bold mb-4 whitespace-pre-line font-display">
                            {question.answer}
                          </p>

                          {question.explanation && (
                            <div className="border-t border-[var(--mp-border-subtle)] pt-3 mt-3">
                              <p className="text-xs font-semibold text-[var(--mp-fg-subtle)] uppercase tracking-wider mb-1 font-mono">
                                {t("explanation", lang)}
                              </p>
                              <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed whitespace-pre-line">
                                {question.explanation.length > 400
                                  ? question.explanation.slice(0, 400) + "..."
                                  : question.explanation}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Confidence buttons — visible only when flipped */}
              {flipped && (
                <div className="animate-fade-in">
                  <p className="text-xs text-[var(--mp-fg-subtle)] text-center mb-2">
                    {t("flashcard_hint", lang)}
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    <button
                      onClick={() => handleConfidence("again")}
                      aria-label={`${t("again", lang)} — < 10 min`}
                      className="min-h-[56px] py-3 rounded-xl text-sm font-bold transition-all border-2 active:scale-95 flex flex-col items-center gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--mp-warning)]"
                      style={{
                        borderColor: ratingColor("again"),
                        color: ratingColor("again"),
                        background: "var(--mp-surface-raised)",
                      }}
                    >
                      <span>{t("again", lang)}</span>
                      <span className="text-[10px] font-mono opacity-60">
                        &lt; 10 min
                      </span>
                    </button>
                    <button
                      onClick={() => handleConfidence("hard")}
                      aria-label={`${t("hard", lang)} — 1 ${lang === "de" ? "Tag" : "day"}`}
                      className="min-h-[56px] py-3 rounded-xl text-sm font-bold transition-all border-2 active:scale-95 flex flex-col items-center gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--mp-status-warning)]"
                      style={{
                        borderColor: ratingColor("hard"),
                        color: "var(--mp-status-warning)",
                        background: "var(--mp-surface-raised)",
                      }}
                    >
                      <span>{t("hard", lang)}</span>
                      <span className="text-[10px] font-mono opacity-60">
                        1 {lang === "de" ? "Tag" : "day"}
                      </span>
                    </button>
                    <button
                      onClick={() => handleConfidence("good")}
                      aria-label={`${t("good", lang)} — 4 ${lang === "de" ? "Tage" : "days"}`}
                      className="min-h-[56px] py-3 rounded-xl text-sm font-bold transition-all border-2 active:scale-95 flex flex-col items-center gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--mp-viridian)]"
                      style={{
                        borderColor: ratingColor("good"),
                        color: ratingColor("good"),
                        background: "var(--mp-surface-raised)",
                      }}
                    >
                      <span>{t("good", lang)}</span>
                      <span className="text-[10px] font-mono opacity-60">
                        4 {lang === "de" ? "Tage" : "days"}
                      </span>
                    </button>
                    <button
                      onClick={() => handleConfidence("easy")}
                      aria-label={`${t("easy", lang)} — 12 ${lang === "de" ? "Tage" : "days"}`}
                      className="min-h-[56px] py-3 rounded-xl text-sm font-bold transition-all border-2 active:scale-95 flex flex-col items-center gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--mp-cta-blue)]"
                      style={{
                        borderColor: ratingColor("easy"),
                        color: ratingColor("easy"),
                        background: "var(--mp-surface-raised)",
                      }}
                    >
                      <span>{t("easy", lang)}</span>
                      <span className="text-[10px] font-mono opacity-60">
                        12 {lang === "de" ? "Tage" : "days"}
                      </span>
                    </button>
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
                      className="font-mono font-black text-lg tabular-nums"
                      style={{ color: ratingColor("again") }}
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
                    {lang === "de" ? "Retention (Session)" : "Retention (session)"}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span
                      className="font-display font-black text-[32px] leading-none tracking-tight font-mono"
                      style={{
                        // Calm ramp: no red. Low retention is a signal, not
                        // a failure — warm orange says "needs more reps",
                        // not "you're bad at this".
                        color:
                          retention >= 70
                            ? "var(--mp-viridian)"
                            : retention >= 40
                            ? "var(--mp-status-warning)"
                            : "var(--mp-warning)",
                      }}
                    >
                      {retention}%
                    </span>
                    <span className="text-[10px] font-mono text-[var(--mp-fg-subtle)]">
                      {history.filter((h) => h.rating === "good" || h.rating === "easy").length}
                      /{history.length} {lang === "de" ? "korrekt" : "correct"}
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
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: ratingColor(h.rating) }}
                        />
                        <span className="flex-1 min-w-0 truncate text-[var(--mp-fg-muted)]">
                          {h.question.slice(0, 40)}
                          {h.question.length > 40 ? "…" : ""}
                        </span>
                        <span
                          className="text-[9px] font-mono uppercase tracking-wider font-bold flex-shrink-0"
                          style={{ color: ratingColor(h.rating) }}
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
                  ? "Nicht angemeldet \u2014 Fortschritt wird nicht gespeichert"
                  : "Not signed in \u2014 progress not saved"}
              </span>
            )}
          </div>
        </div>
      </main>

      <BottomNav lang={lang} userId={userId} />
    </div>
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
