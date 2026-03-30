"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getTopicConfig } from "@/lib/topics";
import { t, getLang, setLang } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import QuestionCard from "@/components/QuestionCard";

type Lang = "de" | "en";

interface Question {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  difficulty: number;
  exam_dates: string[];
}

function QuizContent() {
  const searchParams = useSearchParams();
  const topic = searchParams.get("topic") || "random";
  const userId = searchParams.get("userId") || "";

  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAnswer, setShowAnswer] = useState(false);
  const [userAnswer, setUserAnswer] = useState("");
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
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const fetchQuestion = useCallback(async () => {
    setLoading(true);
    setShowAnswer(false);
    setUserAnswer("");
    setXpEarned(null);
    setAnswered(false);
    setShowXpFloat(false);
    setStartTime(Date.now());

    try {
      const params = new URLSearchParams({ topic, limit: "1" });
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
  }, [topic, userId]);

  useEffect(() => {
    fetchQuestion();
  }, [fetchQuestion]);

  const submitAnswer = async (isCorrect: boolean) => {
    if (!question || !userId || answered) return;
    setAnswered(true);
    setQuestionCount((c) => c + 1);
    if (isCorrect) setCorrectCount((c) => c + 1);

    try {
      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          questionId: question.id,
          isCorrect,
          userAnswer,
          timeSpentMs: Date.now() - startTime,
        }),
      });
      const data = await res.json();
      setXpEarned(data.xp);
      setTotalXpSession((t) => t + (data.xp || 0));
      setShowXpFloat(true);
      setTimeout(() => setShowXpFloat(false), 1500);
    } catch (e) {
      console.error(e);
    }
  };

  const sessionAccuracy = questionCount > 0 ? Math.round((correctCount / questionCount) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center animate-fade-in">
          <div className="w-12 h-12 border-4 border-[#0891B2] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[#94A3B8] text-sm">{t("loading", lang)}</p>
        </div>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4">
        <div className="text-center animate-fade-in">
          <div className="text-5xl mb-4">📭</div>
          <p className="text-[#94A3B8] mb-4 text-lg">{t("no_questions", lang)}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[#0891B2] hover:text-[#22D3EE] transition-colors font-medium"
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

      <main className="main-content safe-area-top safe-area-bottom flex flex-col min-h-screen">
        {/* Quiz Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between flex-shrink-0">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-[#94A3B8] hover:text-white transition-colors text-sm"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="opacity-60">
              <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {t("back_home", lang)}
          </Link>
          <div className="flex items-center gap-3">
            {questionCount > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-[#10B981] font-medium">{correctCount}✓</span>
                <span className="text-[#64748B]">/</span>
                <span className="text-[#94A3B8]">{questionCount}</span>
              </div>
            )}
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Main Quiz Content — centered for readability */}
        <div className="flex-1 px-4 lg:px-8 py-4 flex flex-col max-w-3xl mx-auto w-full relative">
          {/* Floating XP animation */}
          {showXpFloat && xpEarned !== null && (
            <div className="absolute top-4 right-8 z-10">
              <span className="xp-animation inline-block text-[#F59E0B] font-bold text-2xl">
                +{xpEarned} XP ⚡
              </span>
            </div>
          )}

          {/* Question Card Component */}
          <QuestionCard
            question={question}
            questionNumber={questionCount + (answered ? 0 : 1)}
            totalQuestions={20}
            lang={lang}
          />

          {/* Answer Input */}
          {!showAnswer && (
            <div className="mt-4 animate-fade-in">
              <label className="block text-xs text-[#64748B] font-medium uppercase tracking-wider mb-2">
                {t("your_answer", lang)}
              </label>
              <textarea
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                placeholder={t("type_answer", lang)}
                className="w-full bg-[#1E293B]/60 border border-[#334155]/50 rounded-xl p-4 text-white placeholder-[#64748B] resize-none transition-all duration-200 text-base"
                rows={3}
                autoFocus
              />
            </div>
          )}

          {/* Show Answer Button */}
          {!showAnswer && (
            <button
              onClick={() => setShowAnswer(true)}
              className="mt-4 w-full bg-[#0891B2] hover:bg-[#065F73] text-white py-4 rounded-xl font-semibold text-base transition-all duration-200 shadow-lg shadow-[#0891B2]/20 active:scale-[0.98]"
            >
              📖 {t("show_answer", lang)}
            </button>
          )}

          {/* Answer Reveal */}
          {showAnswer && (
            <div className="mt-4 animate-slide-up">
              {/* Correct answer */}
              <div className="bg-[#10B981]/8 border border-[#10B981]/25 rounded-xl p-5 mb-3">
                <p className="text-[10px] uppercase tracking-wider text-[#10B981] font-semibold mb-2 flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-[#10B981]/20 flex items-center justify-center text-[8px]">✓</span>
                  {t("correct_answer", lang)}
                </p>
                <p className="text-[#F1F5F9] leading-relaxed font-medium">{question.answer}</p>
              </div>

              {/* Explanation */}
              {question.explanation && (
                <div className="bg-[#F59E0B]/5 border border-[#F59E0B]/20 rounded-xl p-5 mb-4">
                  <p className="text-[10px] uppercase tracking-wider text-[#F59E0B] font-semibold mb-2 flex items-center gap-1.5">
                    <span className="w-4 h-4 rounded-full bg-[#F59E0B]/20 flex items-center justify-center text-[8px]">💡</span>
                    {t("explanation", lang)}
                  </p>
                  <p className="text-[#94A3B8] leading-relaxed text-sm">{question.explanation}</p>
                </div>
              )}

              {/* Self-assessment buttons */}
              {!answered ? (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => submitAnswer(false)}
                    className="flex items-center justify-center gap-2 bg-[#EF4444]/10 border border-[#EF4444]/30 hover:bg-[#EF4444]/20 text-[#EF4444] py-4 rounded-xl font-semibold text-base transition-all duration-200 active:scale-[0.97]"
                  >
                    ✗ {t("wrong", lang)}
                  </button>
                  <button
                    onClick={() => submitAnswer(true)}
                    className="flex items-center justify-center gap-2 bg-[#10B981]/10 border border-[#10B981]/30 hover:bg-[#10B981]/20 text-[#10B981] py-4 rounded-xl font-semibold text-base transition-all duration-200 active:scale-[0.97]"
                  >
                    ✓ {t("correct", lang)}
                  </button>
                </div>
              ) : (
                <button
                  onClick={fetchQuestion}
                  className="w-full bg-gradient-to-r from-[#0891B2] to-[#065F73] text-white py-4 rounded-xl font-semibold text-base shadow-lg shadow-[#0891B2]/15 transition-all duration-200 active:scale-[0.98]"
                >
                  {t("next_question", lang)} →
                </button>
              )}
            </div>
          )}
        </div>

        {/* Session Stats Bar (sticky bottom on desktop) */}
        {questionCount > 0 && (
          <div className="px-4 lg:px-8 py-3 border-t border-[#334155]/30 bg-[#0F172A]/80 backdrop-blur-sm flex-shrink-0">
            <div className="max-w-3xl mx-auto flex items-center justify-between text-sm">
              <div className="flex items-center gap-4">
                <span className="text-[#94A3B8]">
                  {t("session_stats", lang)}: <strong className="text-white">{questionCount}</strong> {t("answered", lang)}
                </span>
                <span className={`font-medium ${sessionAccuracy >= 70 ? "text-[#10B981]" : sessionAccuracy >= 40 ? "text-[#F59E0B]" : "text-[#EF4444]"}`}>
                  {sessionAccuracy}% {t("accuracy", lang)}
                </span>
              </div>
              <span className="text-[#F59E0B] font-medium">
                +{totalXpSession} XP
              </span>
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
        <div className="flex items-center justify-center min-h-screen">
          <div className="w-12 h-12 border-4 border-[#0891B2] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <QuizContent />
    </Suspense>
  );
}
