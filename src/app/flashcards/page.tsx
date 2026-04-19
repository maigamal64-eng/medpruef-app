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
import { getLang, setLang, t } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { getStoredExamSource } from "@/lib/topics";
import { getTopicConfig } from "@/lib/topics";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import TopicIcon from "@/components/TopicIcon";
import { Layers, RotateCcw, Inbox, History } from "lucide-react";

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
  if (r === "again") return "var(--mp-error)";
  if (r === "hard") return "var(--mp-status-warning)";
  if (r === "good") return "var(--mp-viridian)";
  return "var(--mp-cta-blue)";
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
      setTotalXp(session.gamification.total_xp || 0);
      setStreak(session.gamification.current_streak || 0);
      const ans = session.gamification.total_questions_answered || 0;
      const cor = session.gamification.total_correct || 0;
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;

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

  if (!question) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 bg-[var(--mp-surface-sunken)]">
        <div className="text-center animate-fade-in">
          <Inbox className="w-12 h-12 text-[var(--mp-fg-subtle)] mx-auto mb-4" />
          <p className="text-[var(--mp-fg-muted)] mb-4 text-lg">{t("no_questions", lang)}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[var(--mp-viridian)] hover:text-[var(--mp-accent-teal)] transition-colors font-medium"
          >
            &larr; {t("back_home", lang)}
          </Link>
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
                      className="py-3 rounded-xl text-sm font-bold transition-all border-2 active:scale-95 flex flex-col items-center gap-0.5"
                      style={{
                        borderColor: "var(--mp-error)",
                        color: "var(--mp-error)",
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
                      className="py-3 rounded-xl text-sm font-bold transition-all border-2 active:scale-95 flex flex-col items-center gap-0.5"
                      style={{
                        borderColor: "var(--mp-status-warning)",
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
                      className="py-3 rounded-xl text-sm font-bold transition-all border-2 active:scale-95 flex flex-col items-center gap-0.5"
                      style={{
                        borderColor: "var(--mp-viridian)",
                        color: "var(--mp-viridian)",
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
                      className="py-3 rounded-xl text-sm font-bold transition-all border-2 active:scale-95 flex flex-col items-center gap-0.5"
                      style={{
                        borderColor: "var(--mp-cta-blue)",
                        color: "var(--mp-cta-blue)",
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
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--mp-fg-subtle)] font-bold mb-2">
                  {lang === "de" ? "Heute" : "Today"}
                </div>
                <div className="flex justify-between text-xs text-[var(--mp-fg-muted)] py-1">
                  <span>{lang === "de" ? "Erledigt" : "Done"}</span>
                  <span className="font-mono font-bold text-[var(--mp-fg)]">
                    {dailyCount}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-[var(--mp-fg-muted)] py-1">
                  <span>{lang === "de" ? "Diese Session" : "This session"}</span>
                  <span className="font-mono font-bold text-[var(--mp-fg)]">
                    {history.length}
                  </span>
                </div>
                {leaks > 0 && (
                  <div className="flex justify-between text-xs py-1">
                    <span className="text-[var(--mp-fg-muted)]">
                      Leaks ({lang === "de" ? "Nochmal" : "again"})
                    </span>
                    <span
                      className="font-mono font-bold"
                      style={{ color: "var(--mp-error)" }}
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
                        color:
                          retention >= 70
                            ? "var(--mp-viridian)"
                            : retention >= 40
                            ? "var(--mp-status-warning)"
                            : "var(--mp-error)",
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
