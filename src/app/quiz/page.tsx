"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getTopicConfig } from "@/lib/topics";
import { t, getLang, setLang } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";

type Lang = 'de' | 'en'

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
  const [startTime, setStartTime] = useState(Date.now());
  const [lang, setLangState] = useState<Lang>('de');

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
    } catch (e) {
      console.error(e);
    }
  };

  const topicConfig = getTopicConfig(question?.topic || "");

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!question) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4">
        <p className="text-slate-400 mb-4">{t('no_questions', lang)}</p>
        <Link href="/" className="text-teal-400">← {t('back_home', lang)}</Link>
      </div>
    );
  }

  return (
    <main className="min-h-screen safe-area-top safe-area-bottom flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <Link href="/" className="text-slate-400 text-sm">← {t('back_home', lang)}</Link>
        <div className="flex items-center gap-2">
          <span className="text-sm">{topicConfig.icon}</span>
          <span className="text-sm text-slate-300 max-w-[200px] truncate">
            {topic === "random" ? t('random', lang) : question.topic}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm text-slate-400">
            {questionCount > 0 && `${correctCount}/${questionCount}`}
          </div>
          <LanguageToggle lang={lang} onChange={switchLang} />
        </div>
      </div>

      {/* Question Card */}
      <div className="flex-1 px-4 py-4 flex flex-col">
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 mb-4 flex-shrink-0">
          {/* Difficulty dots */}
          <div className="flex gap-1 mb-3">
            {[1, 2, 3, 4, 5].map((d) => (
              <div
                key={d}
                className={`w-2 h-2 rounded-full ${
                  d <= question.difficulty ? "bg-amber-400" : "bg-slate-700"
                }`}
              />
            ))}
            <span className="text-xs text-slate-500 ml-2">
              {t('difficulty', lang)} {question.difficulty}/5
            </span>
          </div>

          {/* Question — stays in German */}
          <p className="text-lg leading-relaxed font-medium">
            {question.question}
          </p>

          {/* Exam dates */}
          {question.exam_dates && question.exam_dates.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {question.exam_dates.slice(0, 5).map((d) => (
                <span key={d} className="text-xs bg-slate-700/50 text-slate-400 px-2 py-0.5 rounded-full">
                  {d}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Answer Input */}
        {!showAnswer && (
          <div className="mb-4">
            <textarea
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              placeholder={t('type_answer', lang)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl p-4 text-white placeholder-slate-500 resize-none focus:border-teal-500 focus:outline-none transition-colors"
              rows={3}
            />
          </div>
        )}

        {/* Show Answer Button */}
        {!showAnswer && (
          <button
            onClick={() => setShowAnswer(true)}
            className="w-full bg-slate-700 hover:bg-slate-600 text-white py-3.5 rounded-xl font-medium transition-colors mb-4"
          >
            📖 {t('show_answer', lang)}
          </button>
        )}

        {/* Answer Reveal */}
        {showAnswer && (
          <div className="mb-4 animate-in slide-in-from-bottom-4">
            <div className="bg-teal-950/30 border border-teal-800/50 rounded-2xl p-5 mb-4">
              <p className="text-xs text-teal-400 font-medium uppercase tracking-wide mb-2">
                {t('correct_answer', lang)}
              </p>
              {/* Answer stays in German */}
              <p className="text-white font-medium leading-relaxed">
                {question.answer}
              </p>
              {question.explanation && (
                <div className="mt-3 pt-3 border-t border-teal-800/30">
                  {/* Explanation stays in German */}
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {question.explanation}
                  </p>
                </div>
              )}
            </div>

            {/* XP Animation */}
            {xpEarned !== null && (
              <div className="text-center mb-3">
                <span className="xp-animation inline-block text-amber-400 font-bold text-xl">
                  +{xpEarned} XP ⚡
                </span>
              </div>
            )}

            {/* Self-assessment buttons */}
            {!answered ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => submitAnswer(false)}
                  className="bg-red-900/30 border border-red-800/50 hover:bg-red-900/50 text-red-300 py-3.5 rounded-xl font-medium transition-colors"
                >
                  ❌ {t('wrong', lang)}
                </button>
                <button
                  onClick={() => submitAnswer(true)}
                  className="bg-green-900/30 border border-green-800/50 hover:bg-green-900/50 text-green-300 py-3.5 rounded-xl font-medium transition-colors"
                >
                  ✅ {t('correct', lang)}
                </button>
              </div>
            ) : (
              <button
                onClick={fetchQuestion}
                className="w-full bg-gradient-to-r from-teal-600 to-teal-500 text-white py-3.5 rounded-xl font-semibold transition-colors"
              >
                {t('next_question', lang)} →
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

export default function QuizPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <QuizContent />
    </Suspense>
  );
}
