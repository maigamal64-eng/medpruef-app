"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getLang, setLang, t } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { getStoredExamSource } from "@/lib/topics";
import { getTopicConfig } from "@/lib/topics";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import TopicIcon from "@/components/TopicIcon";
import { Layers, RotateCcw, Inbox } from "lucide-react";

type Lang = "de" | "en";

interface Question {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  image_url?: string;
}

const FLASHCARD_COUNT_KEY = "medpruef_flashcard_daily";

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
  } catch { /* silent */ }
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

  const handleConfidence = useCallback(async (level: "again" | "hard" | "good" | "easy") => {
    if (!question) return;

    // Animate out
    setAnimatingOut(true);
    incrementDailyCount();
    setDailyCount((c) => c + 1);

    // If logged in, report answer with confidence mapping
    if (userId) {
      const isCorrect = level === "good" || level === "easy";
      try {
        await fetch("/api/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            questionId: question.id,
            isCorrect,
            userAnswer: question.answer,
            timeSpentMs: 0,
          }),
        });
      } catch { /* silent */ }
    }

    // Short delay for animation, then fetch next
    setTimeout(() => {
      fetchCard();
    }, 300);
  }, [question, userId, fetchCard]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

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

  if (loading && !question) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F7F9FC]">
        <div className="card rounded-2xl p-8 text-center animate-scale-in">
          <div className="w-12 h-12 border-2 border-[#007B5F] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[#A0AEC0] text-sm">{t("loading", lang)}</p>
        </div>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 bg-[#F7F9FC]">
        <div className="text-center animate-fade-in">
          <Inbox className="w-12 h-12 text-[#A0AEC0] mx-auto mb-4" />
          <p className="text-[#4A5568] mb-4 text-lg">{t("no_questions", lang)}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[#007B5F] hover:text-[#00A896] transition-colors font-medium"
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
      <Sidebar lang={lang} userId={userId} userName={userName} totalXp={totalXp} streak={streak} accuracy={accuracy} />

      <main className="main-content safe-area-top safe-area-bottom flex flex-col min-h-screen bg-[#F7F9FC]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between flex-shrink-0 border-b border-[#E4E9F0]">
          <Link href="/" className="text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors">
            &larr; {t("back_home", lang)}
          </Link>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#007B5F]" />
            <h1 className="text-base font-bold text-[#1A2B3C]">{t("flashcards", lang)}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#A0AEC0] font-mono">{dailyCount} {t("cards_today", lang)}</span>
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Card area */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-6">
          <div className={`w-full max-w-xl transition-all duration-300 ${animatingOut ? "opacity-0 translate-x-8" : "opacity-100 translate-x-0"}`}>
            {/* Flashcard */}
            <div
              className="flip-card w-full cursor-pointer"
              onClick={() => { if (!flipped) setFlipped(true); }}
            >
              <div className={`flip-card-inner w-full min-h-[300px] ${flipped ? "flipped" : ""}`}>
                {/* FRONT */}
                <div className="flip-card-front w-full min-h-[300px] card rounded-2xl p-6 flex flex-col">
                  {/* Topic badge */}
                  <div className="flex items-center gap-2 mb-4">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${topicConfig.color}15` }}
                    >
                      <TopicIcon name={topicConfig.icon} className="w-3.5 h-3.5" />
                    </div>
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: `${topicConfig.color}10`, color: topicConfig.color }}
                    >
                      {question.topic}
                    </span>
                  </div>

                  {/* Question text */}
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-[#1A2B3C] text-base leading-relaxed text-center whitespace-pre-line">
                      {question.question}
                    </p>
                  </div>

                  {/* Image if present */}
                  {question.image_url && (
                    <div className="mt-4 flex justify-center">
                      <img
                        src={question.image_url}
                        alt=""
                        className="max-h-40 rounded-lg object-contain"
                      />
                    </div>
                  )}

                  {/* Hint to flip */}
                  <div className="mt-4 text-center">
                    <p className="text-xs text-[#A0AEC0] flex items-center justify-center gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5" />
                      {t("tap_to_flip", lang)}
                    </p>
                  </div>
                </div>

                {/* BACK */}
                <div className="flip-card-back w-full min-h-[300px] card rounded-2xl p-6 flex flex-col">
                  {/* Topic badge */}
                  <div className="flex items-center gap-2 mb-4">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${topicConfig.color}15` }}
                    >
                      <TopicIcon name={topicConfig.icon} className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-medium text-[#A0AEC0]">{t("correct_answer", lang)}</span>
                  </div>

                  {/* Answer */}
                  <div className="flex-1">
                    <p className="text-[#007B5F] text-lg font-bold mb-4 whitespace-pre-line">
                      {question.answer}
                    </p>

                    {/* Explanation */}
                    {question.explanation && (
                      <div className="border-t border-[#E4E9F0] pt-3 mt-3">
                        <p className="text-xs font-semibold text-[#A0AEC0] uppercase tracking-wider mb-1">
                          {t("explanation", lang)}
                        </p>
                        <p className="text-sm text-[#4A5568] leading-relaxed whitespace-pre-line">
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

            {/* Confidence buttons — shown only when flipped */}
            {flipped && (
              <div className="mt-5 animate-fade-in">
                <p className="text-xs text-[#A0AEC0] text-center mb-3">{t("flashcard_hint", lang)}</p>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={() => handleConfidence("again")}
                    className="py-3 rounded-xl text-sm font-semibold transition-all bg-[#D64545]/10 text-[#D64545] hover:bg-[#D64545]/20 active:scale-95"
                  >
                    {t("again", lang)}
                    <span className="block text-[10px] font-mono opacity-60 mt-0.5">1</span>
                  </button>
                  <button
                    onClick={() => handleConfidence("hard")}
                    className="py-3 rounded-xl text-sm font-semibold transition-all bg-[#F4A261]/10 text-[#F4A261] hover:bg-[#F4A261]/20 active:scale-95"
                  >
                    {t("hard", lang)}
                    <span className="block text-[10px] font-mono opacity-60 mt-0.5">2</span>
                  </button>
                  <button
                    onClick={() => handleConfidence("good")}
                    className="py-3 rounded-xl text-sm font-semibold transition-all bg-[#007B5F]/10 text-[#007B5F] hover:bg-[#007B5F]/20 active:scale-95"
                  >
                    {t("good", lang)}
                    <span className="block text-[10px] font-mono opacity-60 mt-0.5">3</span>
                  </button>
                  <button
                    onClick={() => handleConfidence("easy")}
                    className="py-3 rounded-xl text-sm font-semibold transition-all bg-[#003A8C]/10 text-[#003A8C] hover:bg-[#003A8C]/20 active:scale-95"
                  >
                    {t("easy", lang)}
                    <span className="block text-[10px] font-mono opacity-60 mt-0.5">4</span>
                  </button>
                </div>

                {/* Keyboard shortcut hint */}
                <p className="text-[10px] text-[#A0AEC0] text-center mt-3">
                  {lang === "de" ? "Tastatur:" : "Keyboard:"}{" "}
                  <kbd className="px-1 py-0.5 bg-[#F7F9FC] border border-[#E4E9F0] rounded text-[10px] font-mono">1</kbd>-
                  <kbd className="px-1 py-0.5 bg-[#F7F9FC] border border-[#E4E9F0] rounded text-[10px] font-mono">4</kbd>{" "}
                  {lang === "de" ? "oder" : "or"}{" "}
                  <kbd className="px-1 py-0.5 bg-[#F7F9FC] border border-[#E4E9F0] rounded text-[10px] font-mono">Space</kbd>{" "}
                  {lang === "de" ? "zum Umdrehen" : "to flip"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Session bar */}
        <div className="px-4 lg:px-8 py-3 border-t border-[#E4E9F0] bg-[#FFFFFF] flex-shrink-0">
          <div className="max-w-xl mx-auto flex items-center justify-between text-sm">
            <span className="text-[#4A5568]">
              <Layers className="w-4 h-4 inline mr-1 opacity-60" />
              {dailyCount} {t("cards_today", lang)}
            </span>
            {!userId && (
              <span className="text-xs text-[#A0AEC0]">
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
        <div className="flex items-center justify-center min-h-screen bg-[#F7F9FC]">
          <div className="w-12 h-12 border-2 border-[#007B5F] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <FlashcardContent />
    </Suspense>
  );
}
