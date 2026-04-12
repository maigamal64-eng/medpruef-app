"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { BrandedLoader } from "@/components/Logo";
import { t, getLang } from "@/lib/i18n";
import { trackEvent, trackPageView } from "@/lib/tracker";
import { getStoredSession } from "@/lib/auth";
import { getStoredExamSource } from "@/lib/topics";
import { Timer, Play, CheckCircle2, ArrowLeft, Clock } from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import QuestionCard from "@/components/QuestionCard";
import Link from "next/link";
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

type Phase = "setup" | "practice" | "summary";

const Q_OPTIONS = [10, 20, 30] as const;
const TIME_OPTIONS = [5, 10, 15] as const;

function TimedPracticeContent() {
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");

  const [phase, setPhase] = useState<Phase>("setup");
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [timeLimitMin, setTimeLimitMin] = useState<number>(5);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
    }
    trackPageView("timed-practice");
  }, []);

  const startPractice = useCallback(async () => {
    try {
      const examSource = getStoredExamSource();
      const res = await fetch(
        `/api/questions?limit=${questionCount}&random=true&examSource=${examSource}`
      );
      if (!res.ok) throw new Error("Failed to load questions");
      const data = await res.json();
      const qs: Question[] = data.questions || data;
      if (!qs.length) return;

      setQuestions(qs);
      setCurrentIdx(0);
      setCorrectCount(0);
      setAnsweredCount(0);
      setTimeLeft(timeLimitMin * 60);
      setStartTime(Date.now());
      setPhase("practice");

      trackEvent("feature_use", {
        feature: "timed_practice",
        questionCount,
        timeLimitMin,
      });
    } catch {
      // stay on setup
    }
  }, [questionCount, timeLimitMin]);

  // Timer countdown
  useEffect(() => {
    if (phase !== "practice") return;
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setPhase("summary");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  const handleAnswer = (isCorrect: boolean) => {
    setAnsweredCount((p) => p + 1);
    if (isCorrect) setCorrectCount((p) => p + 1);

    // Auto-advance after short delay
    setTimeout(() => {
      if (currentIdx + 1 >= questions.length) {
        if (timerRef.current) clearInterval(timerRef.current);
        setPhase("summary");
      } else {
        setCurrentIdx((p) => p + 1);
      }
    }, 1500);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;
  const elapsed = startTime ? Math.round((Date.now() - startTime) / 1000) : 0;
  const avgTime = answeredCount > 0 ? Math.round(elapsed / answeredCount) : 0;

  return (
    <div className="flex min-h-screen bg-[#F7F9FC]">
      <Sidebar lang={lang} userId={userId} userName={userName} />
      <main className="flex-1 pb-24 md:pb-8 px-4 md:px-8 pt-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-[#A0AEC0] hover:text-[#4A5568] transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-2">
              <Timer className="w-5 h-5 text-[#007B5F]" />
              <h1 className="text-xl font-bold text-[#1A2B3C]">{t("timed_practice", lang)}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle
              lang={lang}
              onChange={(l) => setLangState(l as Lang)}
            />
            <ThemeToggle />
          </div>
        </div>

        <div className="max-w-4xl mx-auto">
          {/* SETUP PHASE */}
          {phase === "setup" && (
            <div className="card rounded-2xl p-8 max-w-md mx-auto">
              <h2 className="text-lg font-bold text-[#1A2B3C] mb-6 text-center">
                {t("timed_practice", lang)}
              </h2>

              {/* Question count */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-[#4A5568] mb-3">
                  {t("questions_count", lang)}
                </label>
                <div className="flex gap-3">
                  {Q_OPTIONS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setQuestionCount(n)}
                      className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all ${
                        questionCount === n
                          ? "bg-[#007B5F] text-white shadow-md"
                          : "bg-[#F7F9FC] text-[#4A5568] border border-[#E4E9F0] hover:border-[#007B5F]"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time limit */}
              <div className="mb-8">
                <label className="block text-sm font-semibold text-[#4A5568] mb-3">
                  {t("time_limit", lang)}
                </label>
                <div className="flex gap-3">
                  {TIME_OPTIONS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setTimeLimitMin(m)}
                      className={`flex-1 py-3 rounded-xl text-sm font-semibold transition-all ${
                        timeLimitMin === m
                          ? "bg-[#003A8C] text-white shadow-md"
                          : "bg-[#F7F9FC] text-[#4A5568] border border-[#E4E9F0] hover:border-[#003A8C]"
                      }`}
                    >
                      {m} min
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={startPractice}
                className="btn-primary w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4" />
                {t("start_timed", lang)}
              </button>
            </div>
          )}

          {/* PRACTICE PHASE */}
          {phase === "practice" && questions[currentIdx] && (
            <div>
              {/* Timer bar */}
              <div className="card rounded-2xl p-4 mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#A0AEC0]" />
                  <span className="text-sm text-[#4A5568]">
                    {currentIdx + 1} / {questions.length}
                  </span>
                </div>
                <div
                  className={`text-lg font-bold font-mono ${
                    timeLeft <= 60 ? "text-[#D64545] animate-pulse" : timeLeft <= 120 ? "text-[#F4A261]" : "text-[#007B5F]"
                  }`}
                >
                  {formatTime(timeLeft)}
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 bg-[#E4E9F0] rounded-full mb-6 overflow-hidden">
                <div
                  className="h-full bg-[#007B5F] rounded-full transition-all duration-300"
                  style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
                />
              </div>

              <QuestionCard
                question={questions[currentIdx]}
                questionNumber={currentIdx + 1}
                totalQuestions={questions.length}
                lang={lang}
                onAnswer={handleAnswer}
              />
            </div>
          )}

          {/* SUMMARY PHASE */}
          {phase === "summary" && (
            <div className="card rounded-2xl p-8 max-w-md mx-auto text-center">
              <CheckCircle2 className="w-12 h-12 text-[#007B5F] mx-auto mb-4" />
              <h2 className="text-xl font-bold text-[#1A2B3C] mb-2">
                {timeLeft === 0
                  ? t("time_up_submit", lang)
                  : lang === "de" ? "Zeitübung abgeschlossen!" : "Timed Practice Complete!"}
              </h2>

              <div className="grid grid-cols-2 gap-4 mt-6 mb-8">
                <div className="bg-[#F7F9FC] rounded-xl p-4">
                  <p className="text-2xl font-bold text-[#1A2B3C] font-display">{answeredCount}</p>
                  <p className="text-xs text-[#A0AEC0]">{t("questions_answered", lang)}</p>
                </div>
                <div className="bg-[#F7F9FC] rounded-xl p-4">
                  <p className="text-2xl font-bold font-display" style={{ color: accuracy >= 60 ? "#007B5F" : "#D64545" }}>
                    {accuracy}%
                  </p>
                  <p className="text-xs text-[#A0AEC0]">{t("accuracy", lang)}</p>
                </div>
                <div className="bg-[#F7F9FC] rounded-xl p-4">
                  <p className="text-2xl font-bold text-[#003A8C] font-display">{correctCount}</p>
                  <p className="text-xs text-[#A0AEC0]">{t("correct", lang)}</p>
                </div>
                <div className="bg-[#F7F9FC] rounded-xl p-4">
                  <p className="text-2xl font-bold text-[#4A5568] font-display">{avgTime}s</p>
                  <p className="text-xs text-[#A0AEC0]">{t("avg_time_per_q", lang)}</p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setPhase("setup")}
                  className="btn-secondary flex-1 py-3 rounded-xl text-sm font-semibold"
                >
                  {lang === "de" ? "Nochmal" : "Try Again"}
                </button>
                <Link
                  href="/"
                  className="btn-primary flex-1 py-3 rounded-xl text-sm font-semibold text-center"
                >
                  {t("back_home", lang)}
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
      <BottomNav lang={lang} userId={userId} />
    </div>
  );
}

export default function TimedPracticePage() {
  return (
    <Suspense fallback={<BrandedLoader />}>
      <TimedPracticeContent />
    </Suspense>
  );
}
