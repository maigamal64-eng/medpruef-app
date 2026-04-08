"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { BrandedLoader } from "@/components/Logo";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { t, getLang, setLang } from "@/lib/i18n";
import { trackEvent, trackPageView } from "@/lib/tracker";
import { getStoredSession } from "@/lib/auth";
import { recordAnswer } from "@/lib/weakness";
import { Brain, Inbox, Bot, CheckCircle2 } from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import QuestionCard from "@/components/QuestionCard";
import { SkeletonCard } from "@/components/Skeleton";
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
  const initialQuestionId = searchParams.get("questionId");
  const [initialLoaded, setInitialLoaded] = useState(false);

  const [userId, setUserId] = useState<string>("");
  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [topicTotal, setTopicTotal] = useState<number>(0);
  const [xpEarned, setXpEarned] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [questionCount, setQuestionCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalXpSession, setTotalXpSession] = useState(0);
  const [startTime, setStartTime] = useState(Date.now());
  const [lang, setLangState] = useState<Lang>("de");
  const [showXpFloat, setShowXpFloat] = useState(false);
  const [showSessionComplete, setShowSessionComplete] = useState(false);
  const [sessionHistory, setSessionHistory] = useState<Array<{correct: boolean}>>([]);

  // Auto-save quiz progress to localStorage every 30 seconds
  useEffect(() => {
    const SAVE_KEY = "medpruef_quiz_autosave";
    const interval = setInterval(() => {
      if (question && questionCount > 0) {
        const state = { topic, questionCount, correctCount, totalXpSession, timestamp: Date.now() };
        localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [question, questionCount, correctCount, totalXpSession, topic]);

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
    // Fetch total question count for this topic
    const countParams = new URLSearchParams({ countOnly: "1", examSource });
    if (topic && topic !== "random") countParams.set("topic", topic);
    fetch(`/api/questions?${countParams}`)
      .then((r) => r.json())
      .then((d) => { if (d.count) setTopicTotal(d.count); })
      .catch(() => {});
  }, [searchParams, topic, examSource]);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  // Load the specific question from search result (runs ONCE, independent of userId)
  useEffect(() => {
    if (!initialQuestionId || initialLoaded) return;
    setInitialLoaded(true);
    setLoading(true);
    const params = new URLSearchParams({ ids: initialQuestionId, examSource });
    fetch(`/api/questions?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setQuestion(data[0]);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [initialQuestionId, examSource, initialLoaded]);

  const fetchQuestion = useCallback(async () => {
    setLoading(true);
    setAnswered(false);
    setXpEarned(null);
    setShowXpFloat(false);
    setShowSessionComplete(false);
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

  // For non-search loads: fetch random question once userId resolves
  useEffect(() => {
    if (initialQuestionId) return; // skip — handled by the initial-load effect above
    if (userId !== undefined) fetchQuestion();
  }, [fetchQuestion, userId, initialQuestionId]);

  // Keyboard shortcuts: N/→ for next, Esc for back
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.key === 'n' || e.key === 'ArrowRight') && answered) {
        e.preventDefault();
        fetchQuestion();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [answered, fetchQuestion]);

  const handleAnswer = useCallback(
    async (isCorrect: boolean) => {
      if (!question || answered) return;
      setAnswered(true);
      setQuestionCount((c) => c + 1);
      if (isCorrect) setCorrectCount((c) => c + 1);
      setSessionHistory(prev => [...prev, { correct: isCorrect }]);
      recordAnswer(question.topic, isCorrect);
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

  // Trigger session completion panel every 20 questions (or topicTotal if < 20)
  useEffect(() => {
    const milestone = topicTotal > 0 && topicTotal < 20 ? topicTotal : 20;
    if (questionCount > 0 && questionCount % milestone === 0 && answered) {
      setShowSessionComplete(true);
    }
  }, [questionCount, answered, topicTotal]);

  const sessionAccuracy =
    questionCount > 0 ? Math.round((correctCount / questionCount) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F7F9FC]">
        <div className="w-full max-w-xl px-4 space-y-4 animate-scale-in">
          <SkeletonCard />
          <SkeletonCard />
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
            ← {t("back_home", lang)}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={userId} />

      <main className="main-content safe-area-top safe-area-bottom flex flex-col min-h-screen bg-[#F7F9FC]">
        {/* Quiz Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between flex-shrink-0 border-b border-[#E4E9F0]">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-[#A0AEC0] hover:text-[#1A2B3C] transition-colors text-sm"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="opacity-60">
              <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {t("back_home", lang)}
          </Link>
          <div className="flex items-center gap-3">
            {questionCount > 0 && (
              <div className="flex items-center gap-2 text-sm font-mono">
                <span className="text-[#00A896] font-medium">{correctCount}✓</span>
                <span className="text-[#E4E9F0]">/</span>
                <span className="text-[#4A5568]">{questionCount}</span>
              </div>
            )}
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Session progress segments */}
        {sessionHistory.length > 0 && (
          <div className="px-4 lg:px-8 pt-2">
            <div className="flex gap-0.5 max-w-xs">
              {sessionHistory.map((h, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${h.correct ? 'bg-[#00A896]' : 'bg-[#D64545]'}`}
                />
              ))}
              {!answered && (
                <div className="h-1.5 flex-1 rounded-full bg-[#E4E9F0]" />
              )}
            </div>
          </div>
        )}

        {/* Main Quiz Content — split view on desktop after answering (UWorld-style) */}
        <div className={`flex-1 px-4 lg:px-8 py-4 w-full relative ${answered ? 'max-w-6xl' : 'max-w-3xl'} mx-auto transition-all duration-300`}>
          {/* Floating XP animation */}
          {showXpFloat && xpEarned !== null && (
            <div className="absolute top-4 right-8 z-10">
              <span className="xp-animation inline-block text-[#F4A261] font-bold font-mono text-2xl">
                +{xpEarned} XP
              </span>
            </div>
          )}

          <div className={`${answered ? 'lg:grid lg:grid-cols-[1fr,400px] lg:gap-6' : ''}`}>
            {/* LEFT: Question Card with MCQ */}
            <div>
              <QuestionCard
                question={question}
                questionNumber={questionCount + (answered ? 0 : 1)}
                totalQuestions={topicTotal || 20}
                lang={lang}
                onAnswer={handleAnswer}
                imageUrl={question.image_url}
              />
            </div>

            {/* RIGHT (desktop) / BELOW (mobile): Explanation + Next */}
            {answered && (
              <div className="mt-4 lg:mt-0 space-y-4 animate-fade-in">
                {question?.explanation ? (
                  <div className="card rounded-2xl p-5 border-l-4 border-[#3A7CA5]">
                    <p className="text-sm font-bold text-[#001B3D] mb-3 flex items-center gap-1.5">
                      <Brain className="w-4 h-4 text-[#3A7CA5]" />
                      {lang === "de" ? "Erklärung" : "Explanation"}
                    </p>
                    <p className="text-sm text-[#4A5568] leading-relaxed whitespace-pre-line">{question.explanation}</p>
                    {question.image_url && (
                      <img src={question.image_url} alt="" className="mt-3 max-h-48 rounded-lg object-contain" />
                    )}
                  </div>
                ) : (
                  <div className="card rounded-2xl p-5 border-l-4 border-[#A0AEC0] opacity-70">
                    <p className="text-sm text-[#A0AEC0] flex items-center gap-1.5">
                      <Bot className="w-4 h-4" />
                      {lang === "de" ? "KI-Erklärung wird bald verfügbar sein" : "AI explanation coming soon"}
                    </p>
                  </div>
                )}

                <button
                  onClick={fetchQuestion}
                  className="w-full btn-primary py-4 text-base rounded-xl animate-fade-in"
                >
                  {t("next_question", lang)} →
                </button>

                {/* Keyboard shortcut hint */}
                <p className="text-[10px] text-[#A0AEC0] text-center">
                  {lang === "de" ? "Drücke" : "Press"} <kbd className="px-1.5 py-0.5 bg-[#F7F9FC] border border-[#E4E9F0] rounded text-[10px] font-mono">N</kbd> {lang === "de" ? "für nächste Frage" : "for next question"}
                </p>
              </div>
            )}
          </div>

          {/* Session Completion Panel */}
          {showSessionComplete && (
            <div className="card rounded-2xl p-6 md:p-8 text-center animate-scale-in mt-4">
              <div className="mb-4">
                <CheckCircle2 className="w-12 h-12 text-[#00A896] mx-auto mb-2" />
                <h2 className="text-xl font-bold text-[#1A2B3C] font-display">
                  {lang === "de" ? "Sitzung abgeschlossen!" : "Session Complete!"}
                </h2>
                <p className="text-sm text-[#A0AEC0]">
                  {lang === "de" ? "Fantastische Arbeit!" : "Fantastic Work!"}
                </p>
              </div>

              {/* Accuracy ring */}
              <div className="mb-4">
                <span className="text-5xl font-black font-display text-[#007B5F]">
                  {questionCount > 0 ? Math.round((correctCount / questionCount) * 100) : 0}%
                </span>
                <p className="text-sm text-[#A0AEC0]">{lang === "de" ? "Genauigkeit" : "Accuracy"}</p>
              </div>

              {/* XP earned */}
              <div className="inline-flex items-center gap-2 bg-[#007B5F]/10 text-[#007B5F] font-bold px-4 py-2 rounded-xl mb-4">
                +{totalXpSession} XP {lang === "de" ? "verdient" : "earned"}
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="card rounded-xl p-3 text-center">
                  <p className="text-lg font-bold font-mono text-[#1A2B3C]">{correctCount}/{questionCount}</p>
                  <p className="text-xs text-[#A0AEC0]">{lang === "de" ? "Richtig" : "Correct"}</p>
                </div>
                <div className="card rounded-xl p-3 text-center">
                  <p className="text-lg font-bold font-mono text-[#1A2B3C]">{sessionHistory.filter(h => h.correct).length}</p>
                  <p className="text-xs text-[#A0AEC0]">{lang === "de" ? "Serie gehalten" : "Streak maintained"}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSessionComplete(false)}
                  className="flex-1 btn-secondary py-3 text-sm rounded-xl"
                >
                  {lang === "de" ? "Antworten prüfen" : "Review Answers"}
                </button>
                <button
                  onClick={() => { setShowSessionComplete(false); fetchQuestion(); }}
                  className="flex-1 btn-primary py-3 text-sm rounded-xl"
                >
                  {lang === "de" ? "Nächste Sitzung" : "Next Session"}
                </button>
              </div>
            </div>
          )}

          {/* Login prompt for unauthenticated users */}
          {!userId && (
            <p className="mt-3 text-center text-xs text-[#A0AEC0]">
              {lang === "de"
                ? "Nicht angemeldet — Fortschritt wird nicht gespeichert"
                : "Not signed in — progress will not be saved"}
            </p>
          )}
        </div>

        {/* Session Stats Bar */}
        {questionCount > 0 && (
          <div className="px-4 lg:px-8 py-3 border-t border-[#E4E9F0] bg-[#FFFFFF] flex-shrink-0">
            <div className="max-w-3xl mx-auto flex items-center justify-between text-sm">
              <div className="flex items-center gap-4">
                <span className="text-[#4A5568]">
                  {t("session_stats", lang)}:{" "}
                  <strong className="text-[#1A2B3C] font-mono">{questionCount}</strong>{" "}
                  {t("answered", lang)}
                </span>
                <span
                  className={`font-medium font-mono ${
                    sessionAccuracy >= 70
                      ? "text-[#00A896]"
                      : sessionAccuracy >= 40
                      ? "text-[#F4A261]"
                      : "text-[#D64545]"
                  }`}
                >
                  {sessionAccuracy}% {t("accuracy", lang)}
                </span>
              </div>
              {totalXpSession > 0 && (
                <span className="text-[#F4A261] font-medium font-mono">
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
        <div className="flex items-center justify-center min-h-screen bg-[#F7F9FC]">
          <BrandedLoader />
        </div>
      }
    >
      <QuizContent />
    </Suspense>
  );
}
