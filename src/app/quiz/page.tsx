"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { BrandedLoader } from "@/components/Logo";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { t, getLang, setLang } from "@/lib/i18n";
import { trackEvent, trackPageView } from "@/lib/tracker";
import { getStoredSession } from "@/lib/auth";
import { recordAnswer } from "@/lib/weakness";
import { Inbox, Clock, Trophy, Sparkles } from "lucide-react";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import QuestionCard from "@/components/QuestionCard";
import QuestionActions from "@/components/QuestionActions";
import QuizSetup, { type QuizConfig } from "@/components/QuizSetup";
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

function buildQueryParams(config: QuizConfig, userId: string, excludeIds?: number[]): URLSearchParams {
  const p = new URLSearchParams({ limit: "1", examSource: config.examSource });
  if (userId) p.set("userId", userId);
  if (config.topics.length === 1) p.set("topic", config.topics[0]);
  else if (config.topics.length > 1) p.set("topics", config.topics.join(","));
  if (config.tags.length > 0) p.set("tags", config.tags.join(","));
  if (config.examDateFrom) p.set("examDateFrom", config.examDateFrom);
  if (config.examDateTo) p.set("examDateTo", config.examDateTo);
  // Exclude already-seen questions to prevent repeats within a session
  if (excludeIds && excludeIds.length > 0) {
    p.set("excludeIds", excludeIds.join(","));
  }
  return p;
}

function QuizContent() {
  const searchParams = useSearchParams();
  const initialTopic = searchParams.get("topic");
  const initialQuestionId = searchParams.get("questionId");
  const examSource = searchParams.get("examSource") || "kenntnispruefung";

  const [userId, setUserId] = useState<string>("");
  const [lang, setLangState] = useState<Lang>("de");
  const [config, setConfig] = useState<QuizConfig | null>(null);

  // Quiz state
  const seenIdsRef = useRef<number[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);
  const [nextQuestion, setNextQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [questionCount, setQuestionCount] = useState(0); // answered count
  const [correctCount, setCorrectCount] = useState(0);
  const [totalXpSession, setTotalXpSession] = useState(0);
  const [xpEarned, setXpEarned] = useState<number | null>(null);
  const [showXpFloat, setShowXpFloat] = useState(false);
  const [startTime, setStartTime] = useState(Date.now());
  const [sessionHistory, setSessionHistory] = useState<Array<{ correct: boolean }>>([]);
  const [milestoneVisible, setMilestoneVisible] = useState(false);
  const [quizFinished, setQuizFinished] = useState(false);
  const [topicTotal, setTopicTotal] = useState<number>(0);

  // Time limit
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null); // seconds

  // ─── Init ───
  useEffect(() => {
    setLangState(getLang());
    trackPageView("quiz");
    const paramId = searchParams.get("userId") || "";
    if (paramId) {
      setUserId(paramId);
    } else {
      const session = getStoredSession();
      setUserId(session?.user?.id || "");
    }
  }, [searchParams]);

  // Auto-skip setup when arriving with a topic or questionId in the URL.
  // This is the "instant practice" flow: clicking "Continue" on the home page
  // or a topic card should start quizzing immediately, not show the config page.
  useEffect(() => {
    if (config) return; // already configured
    if (initialQuestionId || initialTopic) {
      setConfig({
        topics: initialTopic && initialTopic !== "random" ? [initialTopic] : [],
        tags: [],
        targetCount: 20,
        timeLimitMin: null,
        examDateFrom: null,
        examDateTo: null,
        examSource,
      });
    }
  }, [initialQuestionId, initialTopic, config, examSource]);

  // Once config exists, fetch total available pool size for the milestone card
  useEffect(() => {
    if (!config) return;
    const p = new URLSearchParams({ countOnly: "1", examSource: config.examSource });
    if (config.topics.length === 1) p.set("topic", config.topics[0]);
    else if (config.topics.length > 1) p.set("topics", config.topics.join(","));
    if (config.tags.length > 0) p.set("tags", config.tags.join(","));
    if (config.examDateFrom) p.set("examDateFrom", config.examDateFrom);
    if (config.examDateTo) p.set("examDateTo", config.examDateTo);
    fetch(`/api/questions?${p}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.count) setTopicTotal(d.count);
      })
      .catch(() => {});
  }, [config]);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  // ─── Question fetching ───
  const fetchQuestion = useCallback(async (): Promise<Question | null> => {
    if (!config) return null;
    try {
      const params = buildQueryParams(config, userId, seenIdsRef.current);
      const res = await fetch(`/api/questions?${params}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const q = data[0];
        if (q.id) seenIdsRef.current.push(q.id);
        return q;
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  }, [config, userId]);

  // Initial question load (or specific id from search deep-link)
  useEffect(() => {
    if (!config || question || quizFinished) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      let q: Question | null = null;
      if (initialQuestionId) {
        try {
          const params = new URLSearchParams({ ids: initialQuestionId, examSource: config.examSource });
          const res = await fetch(`/api/questions?${params}`);
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) q = data[0];
        } catch {}
      }
      if (!q) q = await fetchQuestion();
      if (cancelled) return;
      setQuestion(q);
      setLoading(false);
      setStartTime(Date.now());
    })();
    return () => {
      cancelled = true;
    };
  }, [config, fetchQuestion, initialQuestionId, question, quizFinished]);

  // Preload the NEXT question as soon as the current one is answered
  useEffect(() => {
    if (!answered || nextQuestion || !config || quizFinished) return;
    let cancelled = false;
    fetchQuestion().then((q) => {
      if (!cancelled) setNextQuestion(q);
    });
    return () => {
      cancelled = true;
    };
  }, [answered, nextQuestion, fetchQuestion, config, quizFinished]);

  // ─── Time limit countdown ───
  useEffect(() => {
    if (!config?.timeLimitMin) return;
    setTimeRemaining(config.timeLimitMin * 60);
    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(interval);
          setQuizFinished(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [config?.timeLimitMin]);

  // ─── Advance to next question ───
  const advance = useCallback(() => {
    if (!config) return;
    // If we've hit the target, show terminal completion card
    if (questionCount >= config.targetCount) {
      setQuizFinished(true);
      return;
    }
    if (nextQuestion) {
      setQuestion(nextQuestion);
      setNextQuestion(null);
    } else {
      // fallback: fetch synchronously if preload didn't finish
      setLoading(true);
      fetchQuestion().then((q) => {
        setQuestion(q);
        setLoading(false);
      });
    }
    setAnswered(false);
    setXpEarned(null);
    setShowXpFloat(false);
    setStartTime(Date.now());
  }, [nextQuestion, fetchQuestion, questionCount, config]);

  // ─── Keyboard: N / → for next ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === "n" || e.key === "ArrowRight") && answered && !quizFinished) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [answered, advance, quizFinished]);

  // ─── Answer handler ───
  const handleAnswer = useCallback(
    async (isCorrect: boolean) => {
      if (!question || answered) return;
      setAnswered(true);
      const newCount = questionCount + 1;
      setQuestionCount(newCount);
      if (isCorrect) setCorrectCount((c) => c + 1);
      setSessionHistory((prev) => [...prev, { correct: isCorrect }]);
      recordAnswer(question.topic, isCorrect);
      trackEvent("question_answer", {
        questionId: question.id,
        topic: question.topic,
        isCorrect,
        timeSpent: Date.now() - startTime,
        examSource: config?.examSource,
      });

      // Trigger milestone card every 20 questions (unless this is also the final)
      if (config && newCount % 20 === 0 && newCount < config.targetCount) {
        setMilestoneVisible(true);
        setTimeout(() => setMilestoneVisible(false), 8000);
      }
      // Mark finished if this answer hit the target
      if (config && newCount >= config.targetCount) {
        // Give the user a beat to see their answer feedback before showing terminal card
        setTimeout(() => setQuizFinished(true), 1200);
      }

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
        setTotalXpSession((p) => p + (data.xp || 0));
        setShowXpFloat(true);
        setTimeout(() => setShowXpFloat(false), 1500);
      } catch (e) {
        console.error(e);
      }
    },
    [question, answered, userId, startTime, config, questionCount]
  );

  const restart = () => {
    setQuestion(null);
    setNextQuestion(null);
    setAnswered(false);
    setQuestionCount(0);
    setCorrectCount(0);
    setTotalXpSession(0);
    setSessionHistory([]);
    setQuizFinished(false);
    setMilestoneVisible(false);
    setConfig(null); // back to setup
  };

  const sessionAccuracy = questionCount > 0 ? Math.round((correctCount / questionCount) * 100) : 0;

  // ─── Setup screen ───
  if (!config) {
    return (
      <div className="app-layout">
        <Sidebar lang={lang} userId={userId} />
        <main className="main-content safe-area-top safe-area-bottom min-h-screen">
          <div className="px-4 lg:px-8 pt-4 flex items-center justify-between">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-[#A0AEC0] hover:text-[#1A2B3C] dark:hover:text-[#E2E8F0] transition-colors text-sm"
            >
              ← {t("back_home", lang)}
            </Link>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageToggle lang={lang} onChange={switchLang} />
            </div>
          </div>
          <QuizSetup
            lang={lang}
            examSource={examSource}
            initialTopic={initialTopic}
            onStart={(c) => setConfig(c)}
          />
        </main>
        <BottomNav lang={lang} userId={userId} />
      </div>
    );
  }

  const progressPct = config.targetCount > 0
    ? Math.min(100, Math.round((questionCount / config.targetCount) * 100))
    : 0;

  // ─── Quiz screen ───
  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={userId} />

      <main className="main-content safe-area-top safe-area-bottom flex flex-col min-h-screen bg-[#F7F9FC] dark:bg-[#0F172A]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-3 flex items-center justify-between flex-shrink-0 border-b border-[#E4E9F0] dark:border-[#334155] bg-white/60 dark:bg-[#1E293B]/60 backdrop-blur-sm">
          <button
            onClick={restart}
            className="flex items-center gap-1.5 text-[#A0AEC0] hover:text-[#1A2B3C] dark:hover:text-[#E2E8F0] transition-colors text-sm"
            title={lang === "de" ? "Zurück zur Konfiguration" : "Back to setup"}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="opacity-60">
              <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {lang === "de" ? "Neue Konfiguration" : "New setup"}
          </button>

          <div className="flex items-center gap-3">
            {timeRemaining !== null && (
              <div className={`flex items-center gap-1.5 text-sm font-mono font-semibold ${
                timeRemaining < 60 ? "text-[#D64545] animate-pulse" : "text-[#4A5568] dark:text-[#A0AEC0]"
              }`}>
                <Clock className="w-4 h-4" />
                {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, "0")}
              </div>
            )}
            {questionCount > 0 && (
              <div className="flex items-center gap-1.5 text-sm font-mono">
                <span className="text-[#00A896] font-semibold">{correctCount}✓</span>
                <span className="text-[#E4E9F0] dark:text-[#334155]">/</span>
                <span className="text-[#4A5568] dark:text-[#A0AEC0]">{questionCount}</span>
              </div>
            )}
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Progress bar — precise reflection of custom quiz length */}
        <div className="px-4 lg:px-8 pt-3 pb-2 flex-shrink-0">
          <div className="flex items-center justify-between text-[10px] text-[#A0AEC0] mb-1.5 font-mono">
            <span>
              {questionCount} / {config.targetCount} {lang === "de" ? "Fragen" : "questions"}
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 w-full bg-[#E4E9F0] dark:bg-[#334155] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#007B5F] to-[#00A896] rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Main canvas — full available width with side rails on desktop */}
        <div className="flex-1 w-full px-4 lg:px-8 py-4">
          <div className="max-w-7xl mx-auto flex gap-6 lg:gap-8 items-start relative">
            {/* Left rail (desktop only, decorative spacer + future expansion) */}
            <aside className="hidden xl:block w-16 flex-shrink-0" />

            {/* Center column — question or final completion card */}
            <div className="flex-1 min-w-0 max-w-3xl mx-auto relative">
              {/* Floating XP */}
              {showXpFloat && xpEarned !== null && (
                <div className="absolute -top-2 right-2 z-20 pointer-events-none">
                  <span className="xp-animation inline-block text-[#F4A261] font-bold font-mono text-2xl drop-shadow">
                    +{xpEarned} XP
                  </span>
                </div>
              )}

              {quizFinished ? (
                <FinalCompletionCard
                  lang={lang}
                  correctCount={correctCount}
                  questionCount={questionCount}
                  targetCount={config.targetCount}
                  totalXp={totalXpSession}
                  topicTotal={topicTotal}
                  onRestart={restart}
                />
              ) : loading ? (
                <div className="space-y-4">
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              ) : !question ? (
                <div className="text-center py-12">
                  <Inbox className="w-12 h-12 text-[#A0AEC0] mx-auto mb-4" />
                  <p className="text-[#4A5568] dark:text-[#A0AEC0]">{t("no_questions", lang)}</p>
                </div>
              ) : (
                <>
                  <QuestionCard
                    question={question}
                    questionNumber={questionCount + (answered ? 0 : 1)}
                    totalQuestions={config.targetCount}
                    lang={lang}
                    onAnswer={handleAnswer}
                    imageUrl={question.image_url}
                    hideActions
                  />

                  {/* Mobile/tablet action row — visible on screens without side rail */}
                  <div className="xl:hidden mt-3">
                    <QuestionActions
                      question={question}
                      lang={lang}
                      layout="row"
                      unlockAfterAnswer
                      answered={answered}
                    />
                  </div>

                  {/* Next button */}
                  {answered && (
                    <div className="mt-4 space-y-2 animate-fade-in">
                      <button
                        onClick={advance}
                        className="w-full btn-primary py-4 text-base rounded-2xl"
                      >
                        {questionCount >= config.targetCount
                          ? lang === "de"
                            ? "Quiz beenden →"
                            : "Finish quiz →"
                          : `${t("next_question", lang)} →`}
                      </button>
                      <p className="text-[10px] text-[#A0AEC0] text-center">
                        {lang === "de" ? "Drücke" : "Press"}{" "}
                        <kbd className="px-1.5 py-0.5 bg-[#F7F9FC] dark:bg-[#1E293B] border border-[#E4E9F0] dark:border-[#334155] rounded text-[10px] font-mono">N</kbd>{" "}
                        {lang === "de" ? "für die nächste Frage" : "for the next question"}
                      </p>
                    </div>
                  )}

                  {/* Milestone card — appears BELOW, doesn't replace the quiz */}
                  {milestoneVisible && (
                    <div className="mt-4 card rounded-2xl p-5 animate-slide-up border-l-4 border-l-[#00A896] bg-gradient-to-br from-[#00A896]/5 to-transparent">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#00A896]/15 flex items-center justify-center flex-shrink-0">
                          <Sparkles className="w-5 h-5 text-[#00A896]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#1A2B3C] dark:text-[#E2E8F0]">
                            {lang === "de"
                              ? `${questionCount} Fragen geschafft! Weiter so 💪`
                              : `${questionCount} questions done! Keep going 💪`}
                          </p>
                          <p className="text-xs text-[#A0AEC0] mt-0.5">
                            {lang === "de"
                              ? `${sessionAccuracy}% Genauigkeit · ${topicTotal.toLocaleString("de-DE")}+ Fragen verfügbar`
                              : `${sessionAccuracy}% accuracy · ${topicTotal.toLocaleString("en-US")}+ questions available`}
                          </p>
                        </div>
                        <button
                          onClick={() => setMilestoneVisible(false)}
                          className="text-[#A0AEC0] hover:text-[#4A5568] text-xs"
                          aria-label="Dismiss"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Right rail — desktop action buttons in the negative space */}
            {question && !quizFinished && (
              <aside className="hidden xl:block w-16 flex-shrink-0">
                <QuestionActions
                  question={question}
                  lang={lang}
                  layout="rail"
                  unlockAfterAnswer
                  answered={answered}
                />
              </aside>
            )}
          </div>
        </div>

        {/* Login prompt for unauthenticated users */}
        {!userId && !quizFinished && (
          <p className="px-4 pb-2 text-center text-xs text-[#A0AEC0]">
            {lang === "de"
              ? "Nicht angemeldet — Fortschritt wird nicht gespeichert"
              : "Not signed in — progress will not be saved"}
          </p>
        )}
      </main>

      <BottomNav lang={lang} userId={userId} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Final completion card — replaces question card when quiz finishes
// ───────────────────────────────────────────────────────────

function FinalCompletionCard({
  lang,
  correctCount,
  questionCount,
  targetCount,
  totalXp,
  topicTotal,
  onRestart,
}: {
  lang: Lang;
  correctCount: number;
  questionCount: number;
  targetCount: number;
  totalXp: number;
  topicTotal: number;
  onRestart: () => void;
}) {
  const accuracy = questionCount > 0 ? Math.round((correctCount / questionCount) * 100) : 0;

  return (
    <div className="card rounded-3xl p-8 md:p-10 text-center animate-scale-in">
      <div className="mb-5">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#007B5F]/10 border border-[#007B5F]/30 mb-3">
          <Trophy className="w-8 h-8 text-[#007B5F]" />
        </div>
        <h2 className="text-2xl md:text-3xl font-bold text-[#1A2B3C] dark:text-[#E2E8F0] font-display">
          {lang === "de" ? "Quiz abgeschlossen!" : "Quiz complete!"}
        </h2>
        <p className="text-sm text-[#A0AEC0] mt-1">
          {lang === "de"
            ? `${questionCount} von ${targetCount} Fragen bearbeitet`
            : `${questionCount} of ${targetCount} questions answered`}
        </p>
      </div>

      {/* Accuracy ring */}
      <div className="mb-5">
        <div className="text-6xl md:text-7xl font-black font-display text-[#007B5F]">
          {accuracy}%
        </div>
        <p className="text-sm text-[#A0AEC0] mt-1">
          {lang === "de" ? "Genauigkeit" : "Accuracy"}
        </p>
      </div>

      {totalXp > 0 && (
        <div className="inline-flex items-center gap-2 bg-[#F4A261]/15 text-[#F4A261] font-bold px-5 py-2.5 rounded-2xl mb-5">
          +{totalXp} XP {lang === "de" ? "verdient" : "earned"}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="card rounded-xl p-3 text-center">
          <p className="text-xl font-bold font-mono text-[#1A2B3C] dark:text-[#E2E8F0]">
            {correctCount}/{questionCount}
          </p>
          <p className="text-[11px] text-[#A0AEC0]">{lang === "de" ? "Richtig" : "Correct"}</p>
        </div>
        <div className="card rounded-xl p-3 text-center">
          <p className="text-xl font-bold font-mono text-[#1A2B3C] dark:text-[#E2E8F0]">
            {topicTotal > 0 ? `${topicTotal.toLocaleString("de-DE")}+` : "—"}
          </p>
          <p className="text-[11px] text-[#A0AEC0]">{lang === "de" ? "Verfügbar" : "Available"}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button onClick={onRestart} className="flex-1 btn-primary py-3 text-sm rounded-2xl">
          {lang === "de" ? "Neues Quiz starten" : "Start new quiz"}
        </button>
        <Link href="/" className="flex-1 btn-secondary py-3 text-sm rounded-2xl text-center">
          {t("back_home", lang)}
        </Link>
      </div>
    </div>
  );
}

export default function QuizPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-[#F7F9FC] dark:bg-[#0F172A]">
          <BrandedLoader />
        </div>
      }
    >
      <QuizContent />
    </Suspense>
  );
}
