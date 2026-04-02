"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { t, getLang, setLang } from "@/lib/i18n";
import { trackEvent, trackPageView } from "@/lib/tracker";
import { getStoredSession } from "@/lib/auth";
import LanguageToggle from "@/components/LanguageToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import QuestionCard from "@/components/QuestionCard";
import type { MCQOption } from "@/lib/mcq";

type Lang = "de" | "en";

interface Question {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  difficulty: number;
  exam_dates: string[];
  options?: MCQOption[];
  image_url?: string;
}

function QuizContent() {
  const searchParams = useSearchParams();
  const topic = searchParams.get("topic") || "random";
  const examSource = searchParams.get("examSource") || "SIP";

  const [userId, setUserId] = useState<string>("");
  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [xpEarned, setXpEarned] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [questionCount, setQuestionCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalXpSession, setTotalXpSession] = useState(0);
  const [startTime, setStartTime] = useState(Date.now());
  const [lang, setLangState] = useState<Lang>("de");
  const [showXpFloat, setShowXpFloat] = useState(false);

  useEffect(() => {
    setLangState(getLang());
    trackPageView("quiz");
    // Resolve userId: URL param → stored session fallback
    const paramId = searchParams.get("userId") || "";
    if (paramId) {
      setUserId(paramId);
    } else {
      const session = getStoredSession();
      setUserId(session?.user?.id || "");
    }
  }, [searchParams]);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const fetchQuestion = useCallback(async () => {
    setLoading(true);
    setAnswered(false);
    setXpEarned(null);
    setShowXpFloat(false);
    setStartTime(Date.now());

    try {
      const params = new URLSearchParams({ topic, limit: "1" });
      if (userId) params.set("userId", userId);
      params.set("examSource", examSource);
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
  }, [topic, userId, examSource]);

  useEffect(() => {
    if (userId !== undefined) fetchQuestion();
  }, [fetchQuestion, userId]);

  const handleAnswer = useCallback(
    async (isCorrect: boolean) => {
      if (!question || answered) return;
      setAnswered(true);
      setQuestionCount((c) => c + 1);
      if (isCorrect) setCorrectCount((c) => c + 1);
      trackEvent("question_answer", { questionId: question?.id, topic: question?.topic, isCorrect, timeSpent: Date.now() - startTime, examSource });

      // Skip API tracking if no authenticated userId
      if (!userId) return;

      try {
        const res = await fetch("/api/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            questionId: question.id,
            isCorrect,
            userAnswer: question.answer,
            timeSpentMs: Date.now() - startTime,
          }),
        });
        const data = await res.json();
        setXpEarned(data.xp);
        setTotalXpSession((prev) => prev + (data.xp || 0));
        setShowXpFloat(true);
        setTimeout(() => setShowXpFloat(false), 1500);
      } catch (e) {
        console.error(e);
      }
    },
    [question, answered, userId, startTime]
  );

  const sessionAccuracy =
    questionCount > 0 ? Math.round((correctCount / questionCount) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0C1324]">
        <div className="text-center animate-fade-in">
          <div className="w-12 h-12 border-2 border-[#6BD8CB] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[#879391] text-sm">{t("loading", lang)}</p>
        </div>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 bg-[#0C1324]">
        <div className="text-center animate-fade-in">
          <div className="text-5xl mb-4">📭</div>
          <p className="text-[#BCC9C6] mb-4 text-lg">{t("no_questions", lang)}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[#6BD8CB] hover:text-[#89F5E7] transition-colors font-medium"
          >
            ← {t("back_home", lang)}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={userId} />

      <main className="main-content safe-area-top safe-area-bottom flex flex-col min-h-screen bg-[#0C1324]">
        {/* Quiz Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between flex-shrink-0 border-b border-[#3D4947]">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-[#879391] hover:text-[#DCE1FB] transition-colors text-sm"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="opacity-60">
              <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {t("back_home", lang)}
          </Link>
          <div className="flex items-center gap-3">
            {questionCount > 0 && (
              <div className="flex items-center gap-2 text-sm font-mono">
                <span className="text-[#4EDEA3] font-medium">{correctCount}✓</span>
                <span className="text-[#3D4947]">/</span>
                <span className="text-[#BCC9C6]">{questionCount}</span>
              </div>
            )}
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Main Quiz Content */}
        <div className="flex-1 px-4 lg:px-8 py-4 flex flex-col max-w-3xl mx-auto w-full relative">
          {/* Floating XP animation */}
          {showXpFloat && xpEarned !== null && (
            <div className="absolute top-4 right-8 z-10">
              <span className="xp-animation inline-block text-[#FFB95F] font-bold font-mono text-2xl">
                +{xpEarned} XP
              </span>
            </div>
          )}

          {/* Question Card with MCQ */}
          <QuestionCard
            question={question}
            questionNumber={questionCount + (answered ? 0 : 1)}
            totalQuestions={20}
            lang={lang}
            onAnswer={handleAnswer}
            imageUrl={question.image_url}
          />

          {/* Next question button — appears after answering */}
          {answered && (
            <button
              onClick={fetchQuestion}
              className="mt-4 w-full bg-[#6BD8CB] hover:bg-[#89F5E7] text-[#003732] py-3.5 rounded font-semibold text-base transition-all duration-200 active:scale-[0.98] animate-fade-in"
            >
              {t("next_question", lang)} →
            </button>
          )}

          {/* Login prompt for unauthenticated users */}
          {!userId && (
            <p className="mt-3 text-center text-xs text-[#879391]">
              {lang === "de"
                ? "Nicht angemeldet — Fortschritt wird nicht gespeichert"
                : "Not signed in — progress will not be saved"}
            </p>
          )}
        </div>

        {/* Session Stats Bar */}
        {questionCount > 0 && (
          <div className="px-4 lg:px-8 py-3 border-t border-[#3D4947] bg-[#151B2D] flex-shrink-0">
            <div className="max-w-3xl mx-auto flex items-center justify-between text-sm">
              <div className="flex items-center gap-4">
                <span className="text-[#BCC9C6]">
                  {t("session_stats", lang)}:{" "}
                  <strong className="text-[#DCE1FB] font-mono">{questionCount}</strong>{" "}
                  {t("answered", lang)}
                </span>
                <span
                  className={`font-medium font-mono ${
                    sessionAccuracy >= 70
                      ? "text-[#4EDEA3]"
                      : sessionAccuracy >= 40
                      ? "text-[#FFB95F]"
                      : "text-[#FFB4AB]"
                  }`}
                >
                  {sessionAccuracy}% {t("accuracy", lang)}
                </span>
              </div>
              {totalXpSession > 0 && (
                <span className="text-[#FFB95F] font-medium font-mono">
                  +{totalXpSession} XP
                </span>
              )}
            </div>
          </div>
        )}
      </main>

      <BottomNav lang={lang} userId={userId} />
    </div>
  );
}

export default function QuizPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-[#0C1324]">
          <div className="w-12 h-12 border-2 border-[#6BD8CB] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <QuizContent />
    </Suspense>
  );
}
