"use client";

import { useState, useEffect } from "react";
import { getTopicConfig } from "@/lib/topics";
import { t } from "@/lib/i18n";
import type { MCQOption } from "@/lib/mcq";
import ImageLightbox from "@/components/ImageLightbox";
import { trackEvent } from "@/lib/tracker";
import TopicIcon from "@/components/TopicIcon";
import { cleanExplanation } from "@/lib/explanation";
import { Lightbulb, FileText, Highlighter, Bot, Flag, CheckCircle2, Edit3, AlertTriangle, X, ThumbsUp, ThumbsDown } from "lucide-react";
import AIChatAssistant from "@/components/AIChatAssistant";

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
  n_correct?: number;
  image_url?: string;
  image_urls?: string[];
  tags?: string[];
}

interface QuestionCardProps {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  lang: Lang;
  onAnswer?: (isCorrect: boolean) => void;
  imageUrl?: string;
  /** Hide inline explanation (used when split-view shows explanation separately) */
  hideExplanation?: boolean;
  /** User tier for feature gating */
  userTier?: string;
  /** Hide inline favorite/flag/note/report/AI buttons — used when an external QuestionActions rail is rendered */
  hideActions?: boolean;
  /** Controlled-mode: pre-populate selection on (re)mount or question change. */
  initialSelected?: number[];
  /** Controlled-mode: render in answered/result state from the start (used for review). */
  initiallyAnswered?: boolean;
  /** Controlled-mode: fired alongside onAnswer when the user finalizes a selection — gives the parent the actual indices so external state (e.g. an exam answers dict) can be updated. */
  onCommit?: (selected: number[], isCorrect: boolean) => void;
  /** Hide the "+10 XP · Correct!" feedback strip (used by exam mode where there is no XP per-question). */
  hideFeedbackStrip?: boolean;
  /** Exam simulation mode: selections are tracked but never graded.
   *  Hides "Antwort prüfen" button, auto-commits on every toggle,
   *  and never reveals correct/wrong coloring. */
  examMode?: boolean;
}

const DE_MONTHS = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];
const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatExamDate(d: string, lang: Lang): string {
  const parts = d.split("-");
  if (parts.length < 2) return d;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const months = lang === "de" ? DE_MONTHS : EN_MONTHS;
  const monthName = months[monthIdx] ?? parts[1];
  return `${monthName} ${year}`;
}

function getNoteKey(id: number) {
  return `medpruef_notes_${id}`;
}

function getFavoritesKey() {
  return "medpruef_favorites";
}

function getFavorites(): number[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(getFavoritesKey()) || "[]");
  } catch {
    return [];
  }
}

function toggleFavorite(id: number): boolean {
  const favs = getFavorites();
  const idx = favs.indexOf(id);
  if (idx === -1) {
    favs.push(id);
    localStorage.setItem(getFavoritesKey(), JSON.stringify(favs));
    return true;
  } else {
    favs.splice(idx, 1);
    localStorage.setItem(getFavoritesKey(), JSON.stringify(favs));
    return false;
  }
}

export default function QuestionCard({
  question,
  questionNumber,
  totalQuestions,
  lang,
  onAnswer,
  imageUrl,
  hideExplanation = false,
  userTier = "free",
  hideActions = false,
  initialSelected,
  initiallyAnswered = false,
  onCommit,
  hideFeedbackStrip = false,
  examMode = false,
}: QuestionCardProps) {
  const config = getTopicConfig(question.topic);
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(
    () => new Set(initialSelected ?? [])
  );
  const [submitted, setSubmitted] = useState(initiallyAnswered);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [isFav, setIsFav] = useState(false);

  const [showAnswer, setShowAnswer] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  // Suggestion/flag state
  const [showSuggestion, setShowSuggestion] = useState(false);
  const [suggestionType, setSuggestionType] = useState<"flag" | "edit" | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [flagDetails, setFlagDetails] = useState("");
  const [editQuestion, setEditQuestion] = useState("");
  const [editExplanation, setEditExplanation] = useState("");
  const [editTopic, setEditTopic] = useState("");
  const [suggestionSubmitted, setSuggestionSubmitted] = useState(false);
  const [explanationRating, setExplanationRating] = useState<1 | -1 | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [showHighlightBtn, setShowHighlightBtn] = useState(false);
  const [highlightPos, setHighlightPos] = useState({ x: 0, y: 0 });
  const answered = submitted || showAnswer;
  const isOpenAnswer = !question.options || question.options.length < 2;
  const options: MCQOption[] = question.options || [];
  const nCorrect = question.n_correct ?? options.filter(o => o.correct).length;
  const isMulti = nCorrect >= 2;

  const highlightKey = (id: number) => `medpruef_highlights_${id}`;

  // Load persisted note, favorite, and highlight state on question change
  useEffect(() => {
    setSelectedIdxs(new Set(initialSelected ?? []));
    setSubmitted(initiallyAnswered);
    setShowAnswer(false);
    setShowAIChat(false);
    setShowNoteInput(false);
    setNoteSaved(false);
    setShowHighlightBtn(false);
    setShowSuggestion(false);
    setSuggestionType(null);
    setFlagReason("");
    setFlagDetails("");
    setSuggestionSubmitted(false);
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(getNoteKey(question.id)) || "";
      setNote(saved);
      setShowNoteInput(!!saved);
      setIsFav(getFavorites().includes(question.id));
      try {
        const hl = JSON.parse(localStorage.getItem(highlightKey(question.id)) || "[]");
        setHighlights(Array.isArray(hl) ? hl : []);
      } catch { setHighlights([]); }
    }
    // initialSelected/initiallyAnswered are intentionally read at render time but
    // only re-applied on question change — adding them as deps would wipe user
    // interactions on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  // Detect text selection on the question text for highlighting
  useEffect(() => {
    const handleMouseUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setShowHighlightBtn(false);
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 3 || text.length > 500) { setShowHighlightBtn(false); return; }
      // Check if selection is within the question text element
      const anchor = sel.anchorNode?.parentElement;
      if (!anchor?.closest("[data-question-text]")) { setShowHighlightBtn(false); return; }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setHighlightPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
      setShowHighlightBtn(true);
    };
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, []);

  const handleHighlight = () => {
    const sel = window.getSelection();
    if (!sel || !sel.toString().trim()) return;
    const text = sel.toString().trim();
    const next = [...highlights, text];
    setHighlights(next);
    localStorage.setItem(highlightKey(question.id), JSON.stringify(next));
    sel.removeAllRanges();
    setShowHighlightBtn(false);
  };

  /** Render question text with highlights applied */
  const renderHighlightedText = (text: string) => {
    if (!highlights.length) return text;
    // Build a regex that matches any highlighted phrase (escaped)
    const escaped = highlights.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
    if (!escaped.length) return text;
    const regex = new RegExp(`(${escaped.join("|")})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, i) => {
      const isHighlighted = highlights.some(h => h.toLowerCase() === part.toLowerCase());
      return isHighlighted ? (
        <mark key={i} className="rounded px-0.5" style={{ backgroundColor: 'rgba(250, 204, 21, 0.5)' }}>{part}</mark>
      ) : (
        <span key={i}>{part}</span>
      );
    });
  };

  // Keyboard shortcuts for answer selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key.toLowerCase();

      // A-E to select answer options
      if (!answered && options.length > 0) {
        const idx = key.charCodeAt(0) - 97; // 'a' = 0, 'b' = 1, etc.
        if (idx >= 0 && idx < options.length) {
          e.preventDefault();
          if (examMode) {
            // Exam mode: select/toggle without grading
            if (isMulti) {
              setSelectedIdxs(prev => {
                const next = new Set(prev);
                if (next.has(idx)) next.delete(idx); else next.add(idx);
                onCommit?.([...next].sort((a, b) => a - b), false);
                return next;
              });
            } else {
              setSelectedIdxs(new Set([idx]));
              onCommit?.([idx], false);
            }
          } else if (isMulti) {
            // Toggle checkbox selection
            setSelectedIdxs(prev => {
              const next = new Set(prev);
              if (next.has(idx)) next.delete(idx);
              else next.add(idx);
              return next;
            });
          } else {
            // Single select — immediately select and grade
            setSelectedIdxs(new Set([idx]));
            setSubmitted(true);
            onAnswer?.(options[idx].correct);
            onCommit?.([idx], options[idx].correct);
          }
        }
      }

      // F to toggle bookmark
      if (key === 'f' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleToggleFav();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [answered, options, isMulti, onAnswer, onCommit]);

  const handleSelect = (idx: number) => {
    if (answered) return;
    if (examMode) {
      // Exam mode: select/toggle without grading, auto-commit
      if (isMulti) {
        setSelectedIdxs(prev => {
          const next = new Set(prev);
          if (next.has(idx)) next.delete(idx); else next.add(idx);
          onCommit?.([...next].sort((a, b) => a - b), false);
          return next;
        });
      } else {
        setSelectedIdxs(new Set([idx]));
        onCommit?.([idx], false);
      }
      return;
    }
    if (isMulti) {
      // Checkbox behavior: toggle the index
      setSelectedIdxs(prev => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx); else next.add(idx);
        return next;
      });
    } else {
      // Radio behavior: select + immediately grade
      setSelectedIdxs(new Set([idx]));
      setSubmitted(true);
      onAnswer?.(options[idx].correct);
      onCommit?.([idx], options[idx].correct);
    }
  };

  const handleSubmitMulti = () => {
    if (answered || selectedIdxs.size === 0) return;
    setSubmitted(true);
    // Strict grading: selected set must equal correct set exactly
    const correctIdxs = new Set(options.map((o, i) => o.correct ? i : -1).filter(i => i >= 0));
    const isCorrect = selectedIdxs.size === correctIdxs.size
      && [...selectedIdxs].every(i => correctIdxs.has(i));
    onAnswer?.(isCorrect);
    onCommit?.([...selectedIdxs].sort((a, b) => a - b), isCorrect);
  };

  const handleSaveNote = () => {
    localStorage.setItem(getNoteKey(question.id), note);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 2000);
  };

  const handleToggleFav = () => {
    setIsFav(toggleFavorite(question.id));
    trackEvent("bookmark", { questionId: question.id, topic: question.topic });
  };

  const getOptionStyle = (idx: number, opt: MCQOption): string => {
    const base =
      "w-full text-left px-4 py-3 min-h-[56px] text-sm font-medium transition-all duration-200 flex items-center gap-3";
    const isSelected = selectedIdxs.has(idx);

    if (!answered) {
      return `${base} ${isSelected ? "bg-[#007B5F]/8 border border-[#007B5F]/60 text-[#1A2B3C] rounded-2xl" : "bg-[#F7F9FC] rounded-2xl border border-transparent hover:border-[#007B5F]/30 hover:bg-white hover:shadow-[var(--shadow-card)] text-[#1A2B3C]"} active:scale-[0.99]`;
    }

    if (isSelected) {
      if (opt.correct) {
        return `${base} bg-[#00A896]/12 border border-[#00A896] border-l-4 border-l-[#00A896] text-[#00A896] rounded-2xl animate-answer-correct`;
      } else {
        return `${base} bg-[#D64545]/12 border border-[#D64545] text-[#D64545] rounded-2xl animate-answer-wrong`;
      }
    }
    if (opt.correct) {
      return `${base} bg-[#00A896]/8 border border-[#00A896]/60 border-l-4 border-l-[#00A896] text-[#00A896]/80 rounded-2xl`;
    }
    return `${base} bg-[#FFFFFF] border border-[#E4E9F0]/40 text-[#A0AEC0] opacity-50 rounded-2xl`;
  };

  const getOptionIcon = (idx: number, opt: MCQOption): string => {
    const isSelected = selectedIdxs.has(idx);
    if (!answered) {
      return isSelected
        ? (isMulti ? "☑" : "●")
        : (isMulti ? "☐" : String.fromCharCode(65 + idx));
    }
    if (isSelected && opt.correct) return "✓";
    if (isSelected && !opt.correct) return "✗";
    if (opt.correct) return "✓";
    return String.fromCharCode(65 + idx);
  };

  const effectiveImageUrl = imageUrl ?? question.image_url;

  // Per Mohamed: explanation images currently appear together with the question
  // image — they should only show up AFTER answering. The Anki importer dumps
  // question, explanation, and choice images all into `image_urls`, so the
  // best heuristic without a schema change is:
  //   - image_urls[0] = the question image (always shown)
  //   - the rest, minus any URL that is already a choice image, are extras
  //     that we treat as explanation images.
  const choiceImageUrls = new Set(
    options.map((o) => o.image_url).filter((u): u is string => !!u)
  );
  const extraImages = (question.image_urls ?? [])
    .slice(1)
    .filter((u) => !!u && u !== effectiveImageUrl && !choiceImageUrls.has(u));

  return (
    <>
      <div className="card rounded-2xl p-6 md:p-8 animate-slide-up">
        {/* Top row: topic badge + question counter + bookmark */}
        <div className="flex items-center justify-between mb-4">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium"
            style={{ backgroundColor: `${config.color}18`, color: config.color }}
          >
            <TopicIcon name={config.icon} className="w-4 h-4" />
            <span className="max-w-[140px] truncate">{question.topic}</span>
          </span>
          <div className="flex items-center gap-2">
            {!hideActions && !suggestionSubmitted && (
              <button
                onClick={() => { setShowSuggestion(!showSuggestion); setSuggestionType(null); }}
                title={lang === "de" ? "Problem melden" : "Report issue"}
                className={`transition-colors ${showSuggestion ? "text-[#D64545]" : "text-[#E4E9F0] hover:text-[#D64545]"}`}
              >
                <Flag className="w-4 h-4" />
              </button>
            )}
            {!hideActions && suggestionSubmitted && (
              <CheckCircle2 className="w-4 h-4 text-[#00A896]" />
            )}
            {!hideActions && (
              <button
                onClick={handleToggleFav}
                title={isFav ? t("bookmarked", lang) : t("bookmark", lang)}
                className={`text-base transition-colors ${isFav ? "text-[#F4A261] animate-bookmark" : "text-[#E4E9F0] hover:text-[#F4A261]"}`}
              >
                {isFav ? "★" : "☆"}
              </button>
            )}
            <span className="text-xs text-[#A0AEC0] font-mono">
              {t("q", lang)}{questionNumber} / {totalQuestions}
            </span>
          </div>
        </div>

        {/* Tags — shown if available */}
        {question.tags && question.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {question.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-2 py-0.5 rounded-full border border-[#007B5F]/30 bg-[#007B5F]/8 text-[#007B5F] font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Optional image */}
        {effectiveImageUrl && (
          <button
            onClick={() => setLightboxSrc(effectiveImageUrl)}
            className="block w-full mb-4 rounded overflow-hidden border border-[#E4E9F0] hover:border-[#007B5F]/40 transition-colors group"
            aria-label="Bild vergrößern"
          >
            <img
              src={effectiveImageUrl}
              alt="Medizinische Abbildung"
              className="w-full max-h-64 object-contain bg-[#FFFFFF] rounded-sm"
            />
            <p className="text-[10px] text-[#A0AEC0] text-center py-1 bg-[#FFFFFF] group-hover:text-[#4A5568] transition-colors">
              {lang === "de" ? "Zum Vergrößern klicken" : "Click to enlarge"}
            </p>
          </button>
        )}

        {/* Question text (selectable for highlighting) */}
        <p className="text-lg md:text-xl leading-relaxed font-medium text-[#001B3D] mb-4" style={{ userSelect: 'text' }} data-question-text>
          {renderHighlightedText(question.question)}
        </p>

        {/* Floating highlight button — appears on text selection */}
        {showHighlightBtn && (
          <div
            className="fixed z-50 animate-scale-in"
            style={{ left: highlightPos.x, top: highlightPos.y, transform: "translate(-50%, -100%)" }}
          >
            <button
              onMouseDown={(e) => { e.preventDefault(); handleHighlight(); }}
              className="flex items-center gap-1.5 bg-[#001B3D] text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg hover:bg-[#003A8C] transition-colors"
            >
              <Highlighter className="w-3.5 h-3.5" />
              Highlight
            </button>
          </div>
        )}

        {/* Exam date chips */}
        {question.exam_dates && question.exam_dates.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-1.5">
            {question.exam_dates.slice(0, 5).map((d) => (
              <span
                key={d}
                className="text-[10px] bg-[#F7F9FC] text-[#A0AEC0] px-2 py-0.5 rounded border border-[#E4E9F0] font-mono"
              >
                {formatExamDate(d, lang)}
              </span>
            ))}
          </div>
        )}

        {/* MCQ Options */}
        <div className="space-y-3">
          {isOpenAnswer && !showAnswer && (
            <button
              onClick={() => {
                setShowAnswer(true);
                onAnswer?.(true);
              }}
              className="w-full p-4 rounded-lg border border-[#007B5F]/30 bg-[#007B5F]/5 hover:bg-[#007B5F]/10 transition-all text-center"
            >
              <span className="text-[#007B5F] font-medium">
                {lang === "de" ? "Antwort anzeigen" : "Show Answer"}
              </span>
            </button>
          )}
          {isOpenAnswer && showAnswer && (
            <div className="p-4 rounded-lg border border-[#007B5F]/30 bg-[#007B5F]/10">
              <p className="text-xs text-[#007B5F] uppercase tracking-wider mb-1 font-medium">
                {lang === "de" ? "Richtige Antwort" : "Correct Answer"}
              </p>
              <p className="text-[#1A2B3C] text-sm leading-relaxed">{question.answer}</p>
            </div>
          )}
          {!isOpenAnswer && isMulti && !answered && (
            <p className="text-[11px] text-[#F4A261] font-semibold mb-1">
              ⓘ {lang === "de" ? `Mehrfachantwort (${nCorrect} richtig)` : `Multi-select (${nCorrect} correct)`}
            </p>
          )}
          {!isOpenAnswer && options.map((opt, idx) => {
            const isSelected = selectedIdxs.has(idx);
            return (
              <button
                key={idx}
                onClick={() => handleSelect(idx)}
                disabled={answered}
                className={getOptionStyle(idx, opt)}
              >
                <span
                  className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center text-sm font-bold border font-mono ${
                    !answered
                      ? isSelected
                        ? "bg-[#007B5F]/15 border-[#007B5F] text-[#007B5F]"
                        : "bg-[#F7F9FC] border-[#E4E9F0] text-[#4A5568]"
                      : isSelected && opt.correct
                      ? "bg-[#00A896]/20 border-[#00A896] text-[#00A896]"
                      : isSelected && !opt.correct
                      ? "bg-[#D64545]/20 border-[#D64545] text-[#D64545]"
                      : opt.correct
                      ? "bg-[#00A896]/10 border-[#00A896]/50 text-[#00A896]"
                      : "bg-[#F7F9FC] border-[#E4E9F0]/40 text-[#A0AEC0]"
                  }`}
                >
                  {getOptionIcon(idx, opt)}
                </span>
                <div className="flex-1 flex flex-col items-start gap-1.5">
                  {opt.image_url && (
                    <img src={opt.image_url} alt="" className="max-h-24 object-contain rounded border border-[#E4E9F0]" />
                  )}
                  <span>{opt.text}</span>
                </div>
              </button>
            );
          })}
          {!isOpenAnswer && isMulti && !answered && !examMode && (
            <button
              onClick={handleSubmitMulti}
              disabled={selectedIdxs.size === 0}
              className="w-full mt-2 py-3 bg-[#F4A261] hover:bg-[#FFC97A] text-[#1A0E00] rounded font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {lang === "de" ? "Antwort prüfen" : "Check Answer"}
            </button>
          )}
        </div>

        {/* Post-answer feedback strip */}
        {answered && !hideFeedbackStrip && (
          <div className="mt-3 flex items-center justify-between bg-[#F7F9FC] rounded-xl px-4 py-2.5 text-sm animate-fade-in">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-[#007B5F]">+10 XP</span>
              <span className="text-[#A0AEC0]">&middot;</span>
              <span className="text-[#4A5568]">
                {nCorrect > 0 && selectedIdxs.size > 0 && [...selectedIdxs].some(i => options[i]?.correct)
                  ? (lang === "de" ? "Richtig!" : "Correct!")
                  : (lang === "de" ? "Netter Versuch!" : "Nice try!")}
              </span>
            </div>
            <span className="text-xs text-[#A0AEC0]">
              N &rarr; {lang === "de" ? "Nächste" : "Next"}
            </span>
          </div>
        )}

        {/* Explanation — shown after answering (hidden when split-view shows it separately) */}
        {answered && !hideExplanation && (() => {
          const cleaned = cleanExplanation(question.explanation);
          if (!cleaned) return null;
          return (
          <div className="mt-4 bg-[#F4A261]/6 border border-[#F4A261]/25 border-l-4 border-l-[#007B5F] rounded p-4 animate-slide-reveal">
            <p className="text-[10px] uppercase tracking-wider text-[#F4A261] font-semibold mb-2">
              <Lightbulb className="w-4 h-4 inline" /> {t("explanation", lang)}
            </p>
            <p className="text-[#4A5568] leading-relaxed text-sm">{cleaned}</p>
            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[#E4E9F0]">
              <span className="text-[10px] text-[#A0AEC0]">
                {lang === "de" ? "Hilfreich?" : "Helpful?"}
              </span>
              <button
                onClick={() => {
                  if (explanationRating === 1) return;
                  setExplanationRating(1);
                  trackEvent("feature_use", { feature: "explanation_rating", rating: 1, questionId: question.id });
                  fetch("/api/explanation-rating", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ questionId: question.id, rating: 1 }),
                  }).catch(() => {});
                }}
                className={`p-1 rounded transition-colors ${
                  explanationRating === 1
                    ? "text-[#007B5F] bg-[#007B5F]/10"
                    : "text-[#A0AEC0] hover:text-[#007B5F] hover:bg-[#007B5F]/5"
                }`}
                title={lang === "de" ? "Hilfreich" : "Helpful"}
              >
                <ThumbsUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  if (explanationRating === -1) return;
                  setExplanationRating(-1);
                  trackEvent("feature_use", { feature: "explanation_rating", rating: -1, questionId: question.id });
                  fetch("/api/explanation-rating", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ questionId: question.id, rating: -1 }),
                  }).catch(() => {});
                }}
                className={`p-1 rounded transition-colors ${
                  explanationRating === -1
                    ? "text-[#D64545] bg-[#D64545]/10"
                    : "text-[#A0AEC0] hover:text-[#D64545] hover:bg-[#D64545]/5"
                }`}
                title={lang === "de" ? "Nicht hilfreich" : "Not helpful"}
              >
                <ThumbsDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          );
        })()}

        {/* Explanation images — only shown after answering, per Mohamed.
            These come from the explanation field in the source Anki note and
            are imported into image_urls beyond the first entry. */}
        {answered && extraImages.length > 0 && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 animate-fade-in">
            {extraImages.map((src, i) => (
              <button
                key={src + i}
                type="button"
                onClick={() => setLightboxSrc(src)}
                className="block w-full rounded-xl overflow-hidden border border-[#E4E9F0] dark:border-[#334155] hover:border-[#007B5F]/40 transition-colors group"
                aria-label={lang === "de" ? "Bild vergrößern" : "Enlarge image"}
              >
                <img
                  src={src}
                  alt={lang === "de" ? `Erklärungsbild ${i + 1}` : `Explanation image ${i + 1}`}
                  className="w-full max-h-72 object-contain bg-white dark:bg-[#1E293B]"
                />
                <p className="text-[10px] text-[#A0AEC0] text-center py-1 bg-white dark:bg-[#1E293B] group-hover:text-[#4A5568] transition-colors">
                  {lang === "de" ? "Erklärungsbild · Klicken zum Vergrößern" : "Explanation image · Click to enlarge"}
                </p>
              </button>
            ))}
          </div>
        )}

        {/* Action buttons — visible after answering */}
        {answered && !hideActions && (
          <div className="mt-3 animate-fade-in flex items-center gap-3">
            {/* AI Explain button */}
            <button
              onClick={() => setShowAIChat(true)}
              className="flex items-center gap-1.5 text-xs text-[#003A8C] bg-[#003A8C]/8 hover:bg-[#003A8C]/15 px-3 py-1.5 rounded-lg transition-colors font-medium"
            >
              <Bot className="w-4 h-4" />
              <span>{lang === "de" ? "KI-Erklärung" : "AI Explain"}</span>
            </button>

            {/* Add Note button */}
            {!showNoteInput && (
              <button
                onClick={() => setShowNoteInput(true)}
                className="flex items-center gap-1.5 text-xs text-[#A0AEC0] hover:text-[#4A5568] transition-colors"
              >
                <FileText className="w-4 h-4" />
                <span>{t("add_note", lang)}</span>
              </button>
            )}

            {/* Flag / Suggest button */}
            {!suggestionSubmitted && (
              <button
                onClick={() => { setShowSuggestion(!showSuggestion); setSuggestionType(null); }}
                className={`flex items-center gap-1.5 text-xs transition-colors ${showSuggestion ? "text-[#D64545]" : "text-[#A0AEC0] hover:text-[#D64545]"}`}
              >
                <Flag className="w-4 h-4" />
                <span>{lang === "de" ? "Melden" : "Report"}</span>
              </button>
            )}
            {suggestionSubmitted && (
              <span className="flex items-center gap-1.5 text-xs text-[#00A896] animate-fade-in">
                <CheckCircle2 className="w-4 h-4" />
                {lang === "de" ? "Gesendet ✓" : "Submitted ✓"}
              </span>
            )}
          </div>
        )}

          {/* Note input (expanded) */}
          {answered && !hideActions && showNoteInput && (
            <div className="mt-3 animate-fade-in">
              <div className="bg-[#FFFFFF] border border-[#E4E9F0] rounded-xl shadow-[var(--shadow-xs)] p-3">
                <p className="text-[10px] uppercase tracking-wider text-[#A0AEC0] font-semibold mb-2">
                  <FileText className="w-3 h-3 inline" /> {t("add_note", lang)}
                </p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("note_placeholder", lang)}
                  rows={3}
                  className="w-full bg-[#F7F9FC] border border-[#E4E9F0] rounded px-3 py-2 text-sm text-[#1A2B3C] placeholder-[#A0AEC0] resize-none focus:outline-none focus:border-[#007B5F]/50 font-sans"
                />
                <div className="flex items-center justify-between mt-2">
                  <button
                    onClick={handleSaveNote}
                    className="px-3 py-1.5 bg-[#007B5F]/15 border border-[#007B5F]/30 text-[#007B5F] text-xs font-medium rounded hover:bg-[#007B5F]/25 transition-colors"
                  >
                    {noteSaved ? `✓ ${t("note_saved", lang)}` : t("save_note", lang)}
                  </button>
                  {note.length === 0 && (
                    <button
                      onClick={() => setShowNoteInput(false)}
                      className="text-xs text-[#A0AEC0] hover:text-[#4A5568] transition-colors"
                    >
                      {t("cancel", lang)}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Suggestion / Flag form (expanded) */}
          {answered && !hideActions && showSuggestion && !suggestionSubmitted && (
            <div className="mt-3 animate-fade-in">
              <div className="bg-[#FFFFFF] border border-[#E4E9F0] rounded-xl shadow-[var(--shadow-xs)] p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-[#1A2B3C] flex items-center gap-1.5">
                    <Flag className="w-3.5 h-3.5 text-[#D64545]" />
                    {lang === "de" ? "Problem melden" : "Report Issue"}
                  </p>
                  <button onClick={() => setShowSuggestion(false)} className="text-[#A0AEC0] hover:text-[#4A5568]">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Step 1: Choose type */}
                {!suggestionType && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setSuggestionType("flag")}
                      className="flex items-center gap-2 p-3 border border-[#E4E9F0] rounded-xl hover:border-[#D64545]/40 hover:bg-[#D64545]/5 transition-all text-left"
                    >
                      <AlertTriangle className="w-5 h-5 text-[#D64545]" />
                      <div>
                        <p className="text-sm font-medium text-[#1A2B3C]">{lang === "de" ? "Problem melden" : "Report Issue"}</p>
                        <p className="text-[10px] text-[#A0AEC0]">{lang === "de" ? "Fehler, Duplikat, unklar" : "Error, duplicate, unclear"}</p>
                      </div>
                    </button>
                    <button
                      onClick={() => {
                        setSuggestionType("edit");
                        setEditQuestion(question.question);
                        setEditExplanation(question.explanation || "");
                        setEditTopic(question.topic);
                      }}
                      className="flex items-center gap-2 p-3 border border-[#E4E9F0] rounded-xl hover:border-[#007B5F]/40 hover:bg-[#007B5F]/5 transition-all text-left"
                    >
                      <Edit3 className="w-5 h-5 text-[#007B5F]" />
                      <div>
                        <p className="text-sm font-medium text-[#1A2B3C]">{lang === "de" ? "Änderung vorschlagen" : "Suggest Edit"}</p>
                        <p className="text-[10px] text-[#A0AEC0]">{lang === "de" ? "Text, Erklärung bearbeiten" : "Edit text, explanation"}</p>
                      </div>
                    </button>
                  </div>
                )}

                {/* Step 2a: Flag form */}
                {suggestionType === "flag" && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: "incorrect_answer", de: "Falsche Antwort", en: "Incorrect Answer" },
                        { value: "malformed", de: "Fehlerhaft", en: "Malformed" },
                        { value: "duplicate", de: "Duplikat", en: "Duplicate" },
                        { value: "typo", de: "Tippfehler", en: "Typo" },
                        { value: "unclear", de: "Unklar", en: "Unclear" },
                        { value: "missing_explanation", de: "Erklärung fehlt", en: "Missing Explanation" },
                        { value: "wrong_topic", de: "Falsches Thema", en: "Wrong Topic" },
                        { value: "other", de: "Sonstiges", en: "Other" },
                      ].map((r) => (
                        <button
                          key={r.value}
                          onClick={() => setFlagReason(r.value)}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                            flagReason === r.value
                              ? "bg-[#D64545]/10 border-[#D64545]/40 text-[#D64545] font-semibold"
                              : "border-[#E4E9F0] text-[#4A5568] hover:border-[#D64545]/30"
                          }`}
                        >
                          {lang === "de" ? r.de : r.en}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={flagDetails}
                      onChange={(e) => setFlagDetails(e.target.value)}
                      placeholder={lang === "de" ? "Weitere Details (optional)..." : "Additional details (optional)..."}
                      rows={2}
                      className="w-full bg-[#F7F9FC] border border-[#E4E9F0] rounded-lg px-3 py-2 text-sm text-[#1A2B3C] placeholder-[#A0AEC0] resize-none focus:outline-none focus:border-[#D64545]/30"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          if (!flagReason) return;
                          setSuggestionLoading(true);
                          try {
                            // Capture userId from session for attribution
                            const sess = typeof window !== 'undefined'
                              ? JSON.parse(localStorage.getItem('medpruef_session') || '{}')
                              : {};
                            await fetch("/api/suggestions", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                questionId: question.id,
                                userId: sess?.user?.id || null,
                                type: "flag",
                                reason: flagReason,
                                details: flagDetails || null,
                              }),
                            });
                            setSuggestionSubmitted(true);
                            setShowSuggestion(false);
                            trackEvent("feature_use", { feature: "flag_question", reason: flagReason, questionId: question.id });
                          } catch { /* silent */ }
                          finally { setSuggestionLoading(false); }
                        }}
                        disabled={!flagReason || suggestionLoading}
                        className="btn-primary text-xs px-4 py-2 rounded-lg disabled:opacity-40"
                      >
                        {suggestionLoading ? "..." : (lang === "de" ? "Senden" : "Submit")}
                      </button>
                      <button
                        onClick={() => setSuggestionType(null)}
                        className="text-xs text-[#A0AEC0] hover:text-[#4A5568] px-3 py-2"
                      >
                        {t("cancel", lang)}
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 2b: Edit suggestion form */}
                {suggestionType === "edit" && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-[#A0AEC0] uppercase tracking-wider font-semibold mb-1 block">
                        {lang === "de" ? "Fragetext" : "Question Text"}
                      </label>
                      <textarea
                        value={editQuestion}
                        onChange={(e) => setEditQuestion(e.target.value)}
                        rows={3}
                        className="w-full bg-[#F7F9FC] border border-[#E4E9F0] rounded-lg px-3 py-2 text-sm text-[#1A2B3C] resize-none focus:outline-none focus:border-[#007B5F]/30"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#A0AEC0] uppercase tracking-wider font-semibold mb-1 block">
                        {lang === "de" ? "Erklärung" : "Explanation"}
                      </label>
                      <textarea
                        value={editExplanation}
                        onChange={(e) => setEditExplanation(e.target.value)}
                        rows={3}
                        placeholder={lang === "de" ? "Erklärung hinzufügen oder bearbeiten..." : "Add or edit explanation..."}
                        className="w-full bg-[#F7F9FC] border border-[#E4E9F0] rounded-lg px-3 py-2 text-sm text-[#1A2B3C] placeholder-[#A0AEC0] resize-none focus:outline-none focus:border-[#007B5F]/30"
                      />
                    </div>
                    <textarea
                      value={flagDetails}
                      onChange={(e) => setFlagDetails(e.target.value)}
                      placeholder={lang === "de" ? "Was hast du geändert? (optional)" : "What did you change? (optional)"}
                      rows={1}
                      className="w-full bg-[#F7F9FC] border border-[#E4E9F0] rounded-lg px-3 py-2 text-sm text-[#1A2B3C] placeholder-[#A0AEC0] resize-none focus:outline-none focus:border-[#007B5F]/30"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          const changes: Record<string, string> = {};
                          if (editQuestion !== question.question) changes.question = editQuestion;
                          if (editExplanation !== (question.explanation || "")) changes.explanation = editExplanation;
                          if (editTopic !== question.topic) changes.topic = editTopic;
                          if (Object.keys(changes).length === 0 && !flagDetails) return;
                          setSuggestionLoading(true);
                          try {
                            const editSess = typeof window !== 'undefined'
                              ? JSON.parse(localStorage.getItem('medpruef_session') || '{}')
                              : {};
                            await fetch("/api/suggestions", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                questionId: question.id,
                                userId: editSess?.user?.id || null,
                                type: "edit",
                                details: flagDetails || null,
                                suggestedChanges: Object.keys(changes).length > 0 ? changes : null,
                              }),
                            });
                            setSuggestionSubmitted(true);
                            setShowSuggestion(false);
                            trackEvent("feature_use", { feature: "suggest_edit", questionId: question.id });
                          } catch { /* silent */ }
                          finally { setSuggestionLoading(false); }
                        }}
                        disabled={suggestionLoading}
                        className="btn-primary text-xs px-4 py-2 rounded-lg disabled:opacity-40"
                      >
                        {suggestionLoading ? "..." : (lang === "de" ? "Vorschlag senden" : "Submit Suggestion")}
                      </button>
                      <button
                        onClick={() => setSuggestionType(null)}
                        className="text-xs text-[#A0AEC0] hover:text-[#4A5568] px-3 py-2"
                      >
                        {t("cancel", lang)}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
      </div>

      {/* AI Chat Assistant */}
      {!hideActions && (
        <AIChatAssistant
          open={showAIChat}
          onClose={() => setShowAIChat(false)}
          lang={lang}
          questionId={question.id}
          questionText={question.question}
          answerText={question.answer}
          explanation={question.explanation}
          topic={question.topic}
          options={options.map(o => ({ text: o.text, correct: o.correct }))}
          userTier={userTier}
        />
      )}

      {/* Lightbox — opens for whichever image was clicked (question or extra) */}
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          alt="Medizinische Abbildung"
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </>
  );
}
