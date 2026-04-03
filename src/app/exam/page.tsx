"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getTopicConfig, VIENNA_EXAM_PARTS } from "@/lib/topics";
import { t, getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { trackEvent, trackPageView } from "@/lib/tracker";
import type { MCQOption } from "@/lib/mcq";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";

type Lang = "de" | "en";
type ExamPhase = "entry" | "loading" | "exam" | "results" | "review";
type ExamPart = "all" | "sip4" | "sip5";

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

interface TopicResult {
  topic: string;
  total: number;
  correct: number;
}

const EXAM_CONFIG = [
  { topic: "Innere Medizin", count: 30 },
  { topic: "Chirurgische Fächer", count: 30 },
  { topic: "Kinder- und Jugendheilkunde", count: 30 },
  { topic: "Neurologie", count: 25 },
  { topic: "Dermatologie und Venerologie", count: 25 },
  { topic: "Frauenheilkunde/Gynäkologie", count: 25 },
  { topic: "Notfall- und Intensivmedizin", count: 25 },
  { topic: "Hals-Nasen-Ohrenheilkunde", count: 20 },
  { topic: "Psychiatrie", count: 20 },
  { topic: "Augenheilkunde", count: 20 },
];

const EXAM_DURATION_S = 4 * 60 * 60; // 4 hours
const PASS_THRESHOLD = 0.6;

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function ExamContent() {
  const searchParams = useSearchParams();
  const examSource = searchParams.get("examSource") || "SIP";
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [selectedPart, setSelectedPart] = useState<ExamPart>(
    (searchParams.get("part") as ExamPart) || "all"
  );
  const [phase, setPhase] = useState<ExamPhase>("entry");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loadProgress, setLoadProgress] = useState(0);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({}); // questionIndex → optionIndex
  const [timeLeft, setTimeLeft] = useState(EXAM_DURATION_S);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
    }
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const loadExam = useCallback(async () => {
    setPhase("loading");
    setLoadProgress(0);
    const allQuestions: Question[] = [];

    const partTopics = selectedPart !== "all" ? VIENNA_EXAM_PARTS[selectedPart] : null;
    const configToUse = partTopics
      ? EXAM_CONFIG.filter((c) => partTopics.includes(c.topic))
      : EXAM_CONFIG;

    for (let i = 0; i < configToUse.length; i++) {
      const { topic, count } = configToUse[i];
      try {
        const params = new URLSearchParams({ topic, limit: String(count), examSource });
        const res = await fetch(`/api/questions?${params}`);
        const data: Question[] = await res.json();
        allQuestions.push(...data);
      } catch {
        // If a topic fails, continue with others
      }
      setLoadProgress(Math.round(((i + 1) / configToUse.length) * 100));
    }

    // Shuffle for realism
    for (let i = allQuestions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allQuestions[i], allQuestions[j]] = [allQuestions[j], allQuestions[i]];
    }

    setQuestions(allQuestions);
    setAnswers({});
    setCurrentIdx(0);
    setTimeLeft(EXAM_DURATION_S);
    setPhase("exam");
  }, [examSource, selectedPart]);

  // Timer management
  useEffect(() => {
    if (phase === "exam") {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            setPhase("results");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  const handleSelectOption = (optIdx: number) => {
    if (answers[currentIdx] !== undefined) return; // already answered
    setAnswers((prev) => ({ ...prev, [currentIdx]: optIdx }));
  };

  const handleSubmitExam = () => {
    setShowSubmitConfirm(false);
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase("results");
  };

  // Compute results grouped by topic
  const computeResults = (): TopicResult[] => {
    const map: Record<string, { total: number; correct: number }> = {};
    questions.forEach((q, idx) => {
      if (!map[q.topic]) map[q.topic] = { total: 0, correct: 0 };
      map[q.topic].total += 1;
      const selectedOpt = answers[idx];
      if (selectedOpt !== undefined && q.options?.[selectedOpt]?.correct) {
        map[q.topic].correct += 1;
      }
    });
    return Object.entries(map).map(([topic, v]) => ({ topic, ...v }));
  };

  const totalCorrect = Object.entries(answers).filter(([idxStr, optIdx]) => {
    const q = questions[parseInt(idxStr)];
    return q?.options?.[optIdx]?.correct;
  }).length;

  const overallPct = questions.length > 0 ? totalCorrect / questions.length : 0;
  const passed = overallPct >= PASS_THRESHOLD;

  // ── ENTRY ──
  if (phase === "entry") {
    return (
      <div className="app-layout">
        <Sidebar lang={lang} userId={userId} userName={userName} />
        <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
          <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#E4E9F0]">
            <Link href="/" className="text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors">
              ← {t("back_home", lang)}
            </Link>
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>

          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-60px)] px-4 py-8">
            <div className="max-w-lg w-full">
              <div className="text-center mb-8">
                <div className="w-20 h-20 rounded border border-[#F4A261]/30 bg-[#F4A261]/10 flex items-center justify-center text-4xl mx-auto mb-5">
                  🎓
                </div>
                <h1 className="text-2xl font-bold text-[#1A2B3C] mb-2">{t("exam_sim_title", lang)}</h1>
                <p className="text-[#A0AEC0] text-sm">{t("exam_sim_desc", lang)}</p>
              </div>

              {/* Exam info cards */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                {EXAM_CONFIG.map(({ topic, count }) => {
                  const cfg = getTopicConfig(topic);
                  return (
                    <div
                      key={topic}
                      className="bg-[#FFFFFF] border border-[#E4E9F0] rounded p-3 flex items-center gap-3"
                    >
                      <span className="text-xl">{cfg.icon}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#1A2B3C] truncate">{topic}</p>
                        <p className="text-[10px] text-[#A0AEC0] font-mono">{count} {t("questions", lang)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* SIP part selector — only shown for SIP exam source */}
              {examSource === "SIP" && (
                <div className="mb-6">
                  <p className="text-xs text-[#A0AEC0] font-semibold uppercase tracking-wider mb-2 text-center">
                    {t("exam_part_selector", lang)}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {(["all", "sip4", "sip5"] as ExamPart[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => setSelectedPart(p)}
                        className={`py-2.5 rounded text-sm font-semibold border transition-colors ${
                          selectedPart === p
                            ? "bg-[#F4A261] border-[#F4A261] text-[#1A0E00]"
                            : "bg-[#FFFFFF] border-[#E4E9F0] text-[#4A5568] hover:border-[#F4A261]/40"
                        }`}
                      >
                        {p === "all" ? t("all_parts", lang) : p === "sip4" ? "SIP 4" : "SIP 5"}
                      </button>
                    ))}
                  </div>
                  {selectedPart !== "all" && (
                    <p className="text-[10px] text-[#A0AEC0] text-center mt-2">
                      {selectedPart === "sip4" ? t("sip4_label", lang) : t("sip5_label", lang)}
                      {" · "}
                      {EXAM_CONFIG.filter((c) =>
                        VIENNA_EXAM_PARTS[selectedPart].includes(c.topic)
                      ).reduce((s, c) => s + c.count, 0)}{" "}
                      {t("questions", lang)}
                    </p>
                  )}
                </div>
              )}

              {/* Pass threshold notice */}
              <div className="bg-[#F4A261]/6 border border-[#F4A261]/25 rounded p-4 mb-6 text-center">
                <p className="text-sm text-[#F4A261]">⚠ {t("pass_threshold", lang)}</p>
              </div>

              <button
                onClick={loadExam}
                className="w-full bg-[#F4A261] hover:bg-[#FFC97A] text-[#1A0E00] py-4 rounded font-bold text-base transition-all active:scale-[0.98]"
              >
                🎓 {t("start_exam", lang)}
              </button>
            </div>
          </div>
        </main>
        <BottomNav lang={lang} userId={userId} />
      </div>
    );
  }

  // ── LOADING ──
  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#F7F9FC] px-4">
        <div className="text-center animate-fade-in max-w-sm w-full">
          <div className="text-4xl mb-4">🎓</div>
          <p className="text-[#4A5568] font-semibold mb-6">{t("exam_loading", lang)}</p>
          <div className="bg-[#F7F9FC] rounded-full h-2 mb-3 overflow-hidden">
            <div
              className="h-full bg-[#F4A261] rounded-full transition-all duration-300"
              style={{ width: `${loadProgress}%` }}
            />
          </div>
          <p className="text-[#A0AEC0] text-sm font-mono">{loadProgress}%</p>
        </div>
      </div>
    );
  }

  // ── REVIEW ──
  if (phase === "review") {
    const rq = questions[reviewIdx];
    if (!rq) return null;
    const rcfg = getTopicConfig(rq.topic);
    const userOpt = answers[reviewIdx];
    const opts = rq.options || [{ text: rq.answer, correct: true }];

    return (
      <div className="app-layout">
        <Sidebar lang={lang} userId={userId} userName={userName} />
        <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
          <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#E4E9F0]">
            <button
              onClick={() => setPhase("results")}
              className="text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors"
            >
              ← {lang === "de" ? "Ergebnisse" : "Results"}
            </button>
            <span className="text-xs text-[#A0AEC0] font-mono">
              {reviewIdx + 1} / {questions.length}
            </span>
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>

          <div className="px-4 lg:px-8 py-4 max-w-3xl mx-auto">
            {/* Progress bar */}
            <div className="h-1 bg-[#F7F9FC] rounded-full mb-6 overflow-hidden">
              <div
                className="h-full bg-[#007B5F] rounded-full transition-all"
                style={{ width: `${((reviewIdx + 1) / questions.length) * 100}%` }}
              />
            </div>

            <div className="bg-[#FFFFFF] border border-[#E4E9F0] rounded p-5 mb-4">
              <div className="flex items-center justify-between mb-3">
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium"
                  style={{ backgroundColor: `${rcfg.color}18`, color: rcfg.color }}
                >
                  {rcfg.icon} {rq.topic}
                </span>
                <span className={`text-xs font-medium font-mono px-2 py-0.5 rounded ${
                  userOpt !== undefined && opts[userOpt]?.correct
                    ? "bg-[#00A896]/15 text-[#00A896]"
                    : userOpt !== undefined
                    ? "bg-[#D64545]/15 text-[#D64545]"
                    : "bg-[#F7F9FC] text-[#A0AEC0]"
                }`}>
                  {userOpt === undefined
                    ? t("unanswered", lang)
                    : opts[userOpt]?.correct
                    ? `✓ ${t("correct", lang)}`
                    : `✗ ${t("wrong", lang)}`}
                </span>
              </div>

              <p className="text-base font-medium text-[#1A2B3C] mb-4">{rq.question}</p>

              <div className="space-y-2">
                {opts.map((opt, oi) => {
                  let style = "w-full text-left px-4 py-3 border rounded text-sm font-medium flex items-center gap-3 ";
                  if (oi === userOpt && opt.correct) style += "bg-[#00A896]/12 border-[#00A896] text-[#00A896]";
                  else if (oi === userOpt && !opt.correct) style += "bg-[#D64545]/12 border-[#D64545] text-[#D64545]";
                  else if (opt.correct) style += "bg-[#00A896]/8 border-[#00A896]/60 text-[#00A896]/80";
                  else style += "bg-[#FFFFFF] border-[#E4E9F0]/40 text-[#A0AEC0] opacity-50";

                  return (
                    <div key={oi} className={style}>
                      <span className="w-6 h-6 rounded border flex-shrink-0 flex items-center justify-center text-xs font-bold font-mono border-current">
                        {oi === userOpt && opt.correct ? "✓" : oi === userOpt ? "✗" : opt.correct ? "✓" : String.fromCharCode(65 + oi)}
                      </span>
                      <span className="flex-1">{opt.text}</span>
                    </div>
                  );
                })}
              </div>

              {rq.explanation && (
                <div className="mt-4 bg-[#F4A261]/6 border border-[#F4A261]/25 rounded p-4">
                  <p className="text-[10px] uppercase tracking-wider text-[#F4A261] font-semibold mb-2">
                    💡 {t("explanation", lang)}
                  </p>
                  <p className="text-[#4A5568] text-sm leading-relaxed">{rq.explanation}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setReviewIdx(Math.max(0, reviewIdx - 1))}
                disabled={reviewIdx === 0}
                className="flex-1 py-3 border border-[#E4E9F0] rounded text-[#4A5568] text-sm font-medium disabled:opacity-30 hover:border-[#007B5F]/40 transition-colors"
              >
                ← {lang === "de" ? "Zurück" : "Previous"}
              </button>
              <button
                onClick={() => setReviewIdx(Math.min(questions.length - 1, reviewIdx + 1))}
                disabled={reviewIdx === questions.length - 1}
                className="flex-1 py-3 border border-[#E4E9F0] rounded text-[#4A5568] text-sm font-medium disabled:opacity-30 hover:border-[#007B5F]/40 transition-colors"
              >
                {lang === "de" ? "Weiter" : "Next"} →
              </button>
            </div>
          </div>
        </main>
        <BottomNav lang={lang} userId={userId} />
      </div>
    );
  }

  // ── RESULTS ──
  if (phase === "results") {
    const topicResults = computeResults();

    return (
      <div className="app-layout">
        <Sidebar lang={lang} userId={userId} userName={userName} />
        <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
          <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#E4E9F0]">
            <Link href="/" className="text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors">
              ← {t("back_home", lang)}
            </Link>
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>

          <div className="px-4 lg:px-8 py-6 max-w-2xl mx-auto">
            <h1 className="text-xl font-bold text-[#1A2B3C] mb-6">{t("exam_finished", lang)}</h1>

            {/* Overall result */}
            <div className={`rounded p-6 border mb-6 text-center ${
              passed
                ? "bg-[#00A896]/8 border-[#00A896]/40"
                : "bg-[#D64545]/8 border-[#D64545]/40"
            }`}>
              <div className={`text-5xl font-bold font-mono mb-2 ${passed ? "text-[#00A896]" : "text-[#D64545]"}`}>
                {Math.round(overallPct * 100)}%
              </div>
              <div className={`text-lg font-bold mb-2 ${passed ? "text-[#00A896]" : "text-[#D64545]"}`}>
                {passed ? t("exam_passed", lang) : t("exam_failed", lang)}
              </div>
              <p className="text-[#A0AEC0] text-sm font-mono">
                {totalCorrect} / {questions.length} {t("correct", lang)} · {t("pass_threshold", lang)}
              </p>
            </div>

            {/* Specialty breakdown */}
            <h2 className="text-base font-semibold text-[#1A2B3C] mb-3">{t("specialty_results", lang)}</h2>
            <div className="space-y-2 mb-6">
              {topicResults
                .sort((a, b) => b.total - a.total)
                .map(({ topic, total, correct }) => {
                  const cfg = getTopicConfig(topic);
                  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
                  const topicPassed = pct >= 60;
                  return (
                    <div key={topic} className="bg-[#FFFFFF] border border-[#E4E9F0] rounded p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span>{cfg.icon}</span>
                          <span className="text-sm text-[#1A2B3C] font-medium">{topic}</span>
                        </div>
                        <span className={`text-sm font-bold font-mono ${topicPassed ? "text-[#00A896]" : "text-[#D64545]"}`}>
                          {pct}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-[#F7F9FC] rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: topicPassed ? "#00A896" : pct >= 40 ? "#F4A261" : "#D64545",
                            }}
                          />
                        </div>
                        <span className="text-[10px] text-[#A0AEC0] font-mono w-14 text-right">
                          {correct}/{total}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { setReviewIdx(0); setPhase("review"); }}
                className="w-full py-3.5 border border-[#E4E9F0] rounded text-[#1A2B3C] font-medium hover:border-[#007B5F]/40 transition-colors"
              >
                🔍 {t("review_answers", lang)}
              </button>
              <button
                onClick={() => setPhase("entry")}
                className="w-full py-3.5 bg-[#F4A261] hover:bg-[#FFC97A] text-[#1A0E00] rounded font-bold transition-all active:scale-[0.98]"
              >
                🎓 {t("exam_new", lang)}
              </button>
            </div>
          </div>
        </main>
        <BottomNav lang={lang} userId={userId} />
      </div>
    );
  }

  // ── EXAM ──
  const q = questions[currentIdx];
  if (!q) return null;
  const qCfg = getTopicConfig(q.topic);
  const qOpts = q.options || [{ text: q.answer, correct: true }];
  const selectedOpt = answers[currentIdx];
  const qAnswered = selectedOpt !== undefined;
  const answeredCount = Object.keys(answers).length;
  const timerWarning = timeLeft < 600; // last 10 minutes

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={userId} userName={userName} />
      <main className="main-content safe-area-top safe-area-bottom flex flex-col min-h-screen bg-[#F7F9FC]">
        {/* Exam header */}
        <div className="px-4 lg:px-8 pt-3 pb-2 border-b border-[#E4E9F0] flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#A0AEC0] font-mono">
                {t("q", lang)}{currentIdx + 1}/{questions.length}
              </span>
              <span className="text-xs text-[#A0AEC0]">
                ✓ {answeredCount}/{questions.length}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded border font-mono text-sm font-bold ${
                timerWarning
                  ? "bg-[#D64545]/10 border-[#D64545]/30 text-[#D64545] animate-pulse"
                  : "bg-[#F7F9FC] border-[#E4E9F0] text-[#1A2B3C]"
              }`}>
                ⏱ {formatTime(timeLeft)}
              </div>
              <LanguageToggle lang={lang} onChange={switchLang} />
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-1 bg-[#F7F9FC] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#F4A261] rounded-full transition-all duration-300"
              style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Question */}
        <div className="flex-1 px-4 lg:px-8 py-4 max-w-3xl mx-auto w-full overflow-y-auto">
          <div className="bg-[#FFFFFF] border border-[#E4E9F0] rounded p-5 md:p-6 mb-4">
            <div className="flex items-center justify-between mb-4">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium"
                style={{ backgroundColor: `${qCfg.color}18`, color: qCfg.color }}
              >
                {qCfg.icon} <span className="max-w-[140px] truncate">{q.topic}</span>
              </span>
            </div>

            <p className="text-base md:text-lg font-medium text-[#1A2B3C] mb-5 leading-relaxed">
              {q.question}
            </p>

            <div className="space-y-2">
              {qOpts.map((opt, oi) => {
                let style =
                  "w-full text-left px-4 py-3 border text-sm font-medium transition-all duration-200 flex items-center gap-3 rounded ";

                if (!qAnswered) {
                  style += "bg-[#FFFFFF] border-[#E4E9F0] text-[#1A2B3C] hover:border-[#007B5F]/50 hover:bg-[#FFFFFF] active:scale-[0.99]";
                } else if (oi === selectedOpt && opt.correct) {
                  style += "bg-[#00A896]/12 border-[#00A896] text-[#00A896]";
                } else if (oi === selectedOpt && !opt.correct) {
                  style += "bg-[#D64545]/12 border-[#D64545] text-[#D64545]";
                } else if (opt.correct) {
                  style += "bg-[#00A896]/8 border-[#00A896]/60 text-[#00A896]/80";
                } else {
                  style += "bg-[#FFFFFF] border-[#E4E9F0]/40 text-[#A0AEC0] opacity-50";
                }

                const icon = !qAnswered
                  ? String.fromCharCode(65 + oi)
                  : oi === selectedOpt && opt.correct
                  ? "✓"
                  : oi === selectedOpt
                  ? "✗"
                  : opt.correct
                  ? "✓"
                  : String.fromCharCode(65 + oi);

                return (
                  <button
                    key={oi}
                    onClick={() => handleSelectOption(oi)}
                    disabled={qAnswered}
                    className={style}
                  >
                    <span
                      className={`w-6 h-6 rounded flex-shrink-0 flex items-center justify-center text-xs font-bold border font-mono ${
                        !qAnswered
                          ? "bg-[#F7F9FC] border-[#E4E9F0] text-[#4A5568]"
                          : oi === selectedOpt && opt.correct
                          ? "bg-[#00A896]/20 border-[#00A896] text-[#00A896]"
                          : oi === selectedOpt
                          ? "bg-[#D64545]/20 border-[#D64545] text-[#D64545]"
                          : opt.correct
                          ? "bg-[#00A896]/10 border-[#00A896]/50 text-[#00A896]"
                          : "bg-[#F7F9FC] border-[#E4E9F0]/40 text-[#A0AEC0]"
                      }`}
                    >
                      {icon}
                    </span>
                    <span className="flex-1">{opt.text}</span>
                  </button>
                );
              })}
            </div>

            {/* Explanation in exam mode */}
            {qAnswered && q.explanation && (
              <div className="mt-4 bg-[#F4A261]/6 border border-[#F4A261]/25 rounded p-4 animate-fade-in">
                <p className="text-[10px] uppercase tracking-wider text-[#F4A261] font-semibold mb-2">
                  💡 {t("explanation", lang)}
                </p>
                <p className="text-[#4A5568] text-sm leading-relaxed">{q.explanation}</p>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
              disabled={currentIdx === 0}
              className="flex-1 py-3 border border-[#E4E9F0] rounded text-[#4A5568] text-sm font-medium disabled:opacity-30 hover:border-[#007B5F]/40 transition-colors"
            >
              ←
            </button>
            <button
              onClick={() => setCurrentIdx(Math.min(questions.length - 1, currentIdx + 1))}
              disabled={currentIdx === questions.length - 1}
              className="flex-2 flex-1 py-3 bg-[#007B5F]/12 border border-[#007B5F]/25 rounded text-[#007B5F] text-sm font-medium disabled:opacity-30 hover:bg-[#007B5F]/20 transition-colors"
            >
              {lang === "de" ? "Weiter" : "Next"} →
            </button>
          </div>
        </div>

        {/* Submit bar */}
        <div className="px-4 lg:px-8 py-3 border-t border-[#E4E9F0] bg-[#FFFFFF] flex-shrink-0">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <span className="text-xs text-[#A0AEC0] font-mono">
              {answeredCount}/{questions.length} {t("answered", lang)}
            </span>
            <button
              onClick={() => setShowSubmitConfirm(true)}
              className="px-5 py-2.5 bg-[#F4A261] hover:bg-[#FFC97A] text-[#1A0E00] rounded font-bold text-sm transition-all active:scale-[0.98]"
            >
              {t("exam_submit", lang)}
            </button>
          </div>
        </div>

        {/* Submit confirm modal */}
        {showSubmitConfirm && (
          <div className="fixed inset-0 z-50 bg-[#F7F9FC]/80 flex items-center justify-center px-4">
            <div className="bg-[#FFFFFF] border border-[#E4E9F0] rounded p-6 max-w-sm w-full animate-fade-in">
              <p className="text-[#1A2B3C] font-semibold mb-2">{t("exam_submit", lang)}</p>
              <p className="text-[#A0AEC0] text-sm mb-5">{t("exam_submit_confirm", lang)}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSubmitConfirm(false)}
                  className="flex-1 py-2.5 border border-[#E4E9F0] rounded text-[#4A5568] text-sm hover:border-[#007B5F]/40 transition-colors"
                >
                  {t("cancel", lang)}
                </button>
                <button
                  onClick={handleSubmitExam}
                  className="flex-1 py-2.5 bg-[#F4A261] text-[#1A0E00] rounded font-bold text-sm hover:bg-[#FFC97A] transition-colors"
                >
                  {t("exam_submit", lang)}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      <BottomNav lang={lang} userId={userId} />
    </div>
  );
}

export default function ExamPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-[#F7F9FC]">
        <div className="w-14 h-14 border-2 border-[#007B5F] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <ExamContent />
    </Suspense>
  );
}
