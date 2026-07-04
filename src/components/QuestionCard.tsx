"use client";

import { useState, useEffect } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { getTopicConfig } from "@/lib/topics";
import { t } from "@/lib/i18n";
import { shouldIgnoreGlobalKey } from "@/lib/keyboard-guard";
import type { MCQOption } from "@/lib/mcq";
import ImageLightbox from "@/components/ImageLightbox";
import { trackEvent } from "@/lib/tracker";
import TopicIcon from "@/components/TopicIcon";
import { cleanExplanation } from "@/lib/explanation";
import { Lightbulb, FileText, Bot, Flag, CheckCircle2, Languages } from "lucide-react";
import AIChatAssistant from "@/components/AIChatAssistant";
import TranslateButton from "@/components/TranslateButton";
import QuestionReportForm from "@/components/question/QuestionReportForm";
import QuestionNotesPanel from "@/components/question/QuestionNotesPanel";
import QuestionNotes from "@/components/QuestionNotes";
import QuestionExplanation from "@/components/question/QuestionExplanation";
import {
  useQuestionHighlights,
  HighlightSelectionButton,
} from "@/components/question/QuestionHighlightLayer";
import { Option, AnswerReveal, ContextTabs, type ContextTab } from "@/components/ui";

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
  /** Session `user.role` — must be passed alongside `userTier` so admins
   * whose tier is `'free'` / `null` still get Pro-level feature access
   * (bookmarks, AI chat, translate). Added 2026-04-24. */
  userRole?: string;
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
  /** KAF recall-first training (2026-07-03): the real Kenntnisprüfung asks
   *  open short-answer questions (Kurzantwortfragen), so this hides the MCQ
   *  options behind a free-recall step (optional ungraded scratch answer)
   *  until the user reveals them. Grading/XP flow unchanged after reveal. */
  recallFirst?: boolean;
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
  userRole = "user",
  hideActions = false,
  initialSelected,
  initiallyAnswered = false,
  onCommit,
  hideFeedbackStrip = false,
  examMode = false,
  recallFirst = false,
}: QuestionCardProps) {
  const config = getTopicConfig(question.topic);
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(
    () => new Set(initialSelected ?? [])
  );
  const [submitted, setSubmitted] = useState(initiallyAnswered);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  // Notes are owned entirely by QuestionNotesPanel via the shared notes-store
  // now (FEEDBACK #4c — one synced, multi-note home); QuestionCard no longer
  // holds note state.
  const [isFav, setIsFav] = useState(false);

  const [showAnswer, setShowAnswer] = useState(false);
  // UX-4: the AI panel is an inline tab; once the ki tab has been visited it
  // stays mounted (hidden) so the conversation survives tab switches.
  const [aiEverOpened, setAiEverOpened] = useState(false);
  // KAF recall-first: options stay covered until revealed (reset per question).
  const [optionsRevealed, setOptionsRevealed] = useState(false);
  const [recallScratch, setRecallScratch] = useState("");
  // Flag/edit report modal
  const [showReportForm, setShowReportForm] = useState(false);
  const [suggestionSubmitted, setSuggestionSubmitted] = useState(false);
  const [explanationRating, setExplanationRating] = useState<1 | -1 | null>(null);

  // Text-selection → highlight layer (extracted to its own hook).
  const highlightApi = useQuestionHighlights(question.id);

  // Quiz-B tabbed post-answer context. Tabs: erklaerung | ki | notizen | uebersetzen
  // ("quelle"/Source dropped per IA plan — FEEDBACK #4e — until guideline refs exist).
  type PostAnswerTab = "erklaerung" | "ki" | "notizen" | "uebersetzen";
  const [activeTab, setActiveTab] = useState<PostAnswerTab>("erklaerung");
  const answered = submitted || showAnswer;

  // UX-4: mark the AI panel as visited when the ki tab activates (keeps it
  // mounted afterwards), and let the external QuestionActions rail focus the
  // ki tab via a window event (its Bot button used to open a second, separate
  // drawer instance — one AI home now).
  useEffect(() => {
    if (activeTab === "ki") setAiEverOpened(true);
  }, [activeTab]);
  useEffect(() => {
    const openAiTab = () => {
      if (!answered || hideExplanation) return;
      setActiveTab("ki");
      setAiEverOpened(true);
      trackEvent("feature_use", { feature: "ai_chat_open", source: "rail", questionId: question.id });
    };
    window.addEventListener("medpruef-open-ai-tab", openAiTab);
    return () => window.removeEventListener("medpruef-open-ai-tab", openAiTab);
  }, [answered, hideExplanation, question.id]);

  const isOpenAnswer = !question.options || question.options.length < 2;
  const options: MCQOption[] = question.options || [];
  const nCorrect = question.n_correct ?? options.filter(o => o.correct).length;
  const isMulti = nCorrect >= 2;

  // Load persisted note + favorite state on question change
  useEffect(() => {
    setSelectedIdxs(new Set(initialSelected ?? []));
    setSubmitted(initiallyAnswered);
    setShowAnswer(false);
    setAiEverOpened(false);
    setOptionsRevealed(false);
    setRecallScratch("");
    setShowReportForm(false);
    setSuggestionSubmitted(false);
    setExplanationRating(null);
    setActiveTab("erklaerung");
    if (typeof window !== "undefined") {
      setIsFav(getFavorites().includes(question.id));
    }
    // initialSelected/initiallyAnswered are intentionally read at render time but
    // only re-applied on question change — adding them as deps would wipe user
    // interactions on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  // Keyboard shortcuts for answer selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when typing in an input/textarea OR anywhere
      // inside a dialog overlay (FeedbackWidget, Flag modal, trust
      // dialog, etc.). The previous narrow `instanceof` check missed
      // portaled inputs and let typing in the FeedbackWidget close
      // the dialog by accidentally selecting an answer (review-
      // 2026-04-26-A1). The shared helper walks the DOM tree so a
      // portaled input whose event target is a slot wrapper still
      // resolves correctly.
      if (shouldIgnoreGlobalKey(e)) return;

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

  const handleToggleFav = () => {
    setIsFav(toggleFavorite(question.id));
    trackEvent("bookmark", { questionId: question.id, topic: question.topic });
  };

  // Map the parent-owned selection/grading state to the <Option> primitive's
  // `state` prop. Parent still decides everything; Option is presentational.
  //   pre-answer:  selected → 'selected', else → 'idle'
  //   post-answer: correct option → 'correct'; a chosen-wrong → 'wrong';
  //                everything else → 'disabled'
  const getOptionState = (idx: number, opt: MCQOption) => {
    const isSelected = selectedIdxs.has(idx);
    if (!answered) return isSelected ? "selected" : "idle";
    if (opt.correct) return "correct";
    if (isSelected) return "wrong";
    return "disabled";
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
      <div className="card rounded-[var(--mp-r-card)] p-6 md:p-8 animate-slide-up">
        {/* Top row: topic badge + question counter + bookmark */}
        <div className="flex items-center justify-between mb-4">
          <span
            className="topic-text inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--mp-r-button)] text-xs font-medium"
            style={{ backgroundColor: `${config.color}18`, ["--topic-color" as string]: config.color }}
          >
            <TopicIcon name={config.icon} className="w-4 h-4" />
            <span className="max-w-[140px] truncate">{question.topic}</span>
          </span>
          <div className="flex items-center gap-2">
            {!hideActions && !suggestionSubmitted && (
              <button
                onClick={() => setShowReportForm(true)}
                title={lang === "de" ? "Problem melden" : "Report issue"}
                className={`transition-colors ${showReportForm ? "text-[var(--mp-error)]" : "text-[var(--mp-border)] hover:text-[var(--mp-error)]"}`}
              >
                <Flag className="w-4 h-4" />
              </button>
            )}
            {!hideActions && suggestionSubmitted && (
              <CheckCircle2 className="w-4 h-4 text-[var(--mp-accent-teal)]" />
            )}
            {!hideActions && (
              <button
                onClick={handleToggleFav}
                title={isFav ? t("bookmarked", lang) : t("bookmark", lang)}
                className={`text-base transition-colors ${isFav ? "text-[var(--mp-status-warning)] animate-bookmark" : "text-[var(--mp-border)] hover:text-[var(--mp-status-warning)]"}`}
              >
                {isFav ? "★" : "☆"}
              </button>
            )}
            <span className="text-xs text-[var(--mp-fg-subtle)] font-mono">
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
                className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/8 text-[var(--mp-viridian)] font-medium"
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
            className="block w-full mb-4 rounded-[var(--mp-r-input)] overflow-hidden border border-[var(--mp-border)] hover:border-[var(--mp-viridian)]/40 transition-colors group"
            aria-label={lang === "de" ? "Bild vergrößern" : "Enlarge image"}
          >
            <img
              src={effectiveImageUrl}
              alt={lang === "de" ? "Medizinische Abbildung" : "Medical illustration"}
              className="w-full max-h-64 object-contain bg-[var(--mp-surface-raised)]"
            />
            <p className="text-[10px] text-[var(--mp-fg-subtle)] text-center py-1 bg-[var(--mp-surface-raised)] group-hover:text-[var(--mp-fg-muted)] transition-colors">
              {lang === "de" ? "Zum Vergrößern klicken" : "Click to enlarge"}
            </p>
          </button>
        )}

        {/* Question text (selectable for highlighting) */}
        <p className="text-lg md:text-xl leading-relaxed font-medium text-[var(--mp-fg)] mb-4" style={{ userSelect: 'text' }} data-question-text>
          {highlightApi.renderHighlightedText(question.question)}
        </p>

        {/* Floating highlight button — appears on text selection */}
        <HighlightSelectionButton
          visible={highlightApi.showButton}
          position={highlightApi.buttonPos}
          onCommit={highlightApi.commitSelection}
        />

        {/* Exam date chips */}
        {question.exam_dates && question.exam_dates.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-1.5">
            {question.exam_dates.slice(0, 5).map((d) => (
              <span
                key={d}
                className="text-[10px] bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)] px-2 py-0.5 rounded-[var(--mp-r-input)] border border-[var(--mp-border)] font-mono"
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
              className="w-full p-4 rounded-[var(--mp-r-button)] border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/5 hover:bg-[var(--mp-viridian)]/10 transition-all text-center"
            >
              <span className="text-[var(--mp-viridian)] font-medium">
                {lang === "de" ? "Antwort anzeigen" : "Show Answer"}
              </span>
            </button>
          )}
          {isOpenAnswer && showAnswer && (
            <div className="p-4 rounded-[var(--mp-r-card)] border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/10">
              <p className="text-xs text-[var(--mp-viridian)] uppercase tracking-wider mb-1 font-medium">
                {lang === "de" ? "Richtige Antwort" : "Correct Answer"}
              </p>
              <p className="text-[var(--mp-fg)] text-sm leading-relaxed">{question.answer}</p>
            </div>
          )}
          {/* KAF recall-first cover: the real Kenntnisprüfung asks open
              short-answer questions, so options stay hidden until the user
              has tried a free recall (scratch answer is optional, ungraded). */}
          {!isOpenAnswer && recallFirst && !optionsRevealed && !answered && (
            <div className="p-4 rounded-[var(--mp-r-card)] border border-[var(--mp-info)]/30 bg-[var(--mp-info)]/5 space-y-3">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-[var(--mp-info)]">
                {t("kaf_badge", lang)}
              </p>
              <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed">
                {t("kaf_hint", lang)}
              </p>
              <textarea
                value={recallScratch}
                onChange={(e) => setRecallScratch(e.target.value)}
                placeholder={t("kaf_scratch_placeholder", lang)}
                rows={3}
                className="w-full p-3 rounded-[var(--mp-r-input)] border border-[var(--mp-border)] bg-[var(--mp-surface)] text-sm text-[var(--mp-fg)] outline-none focus:border-[var(--mp-viridian)] resize-y"
              />
              <button
                onClick={() => setOptionsRevealed(true)}
                className="w-full py-3 bg-[var(--mp-viridian)] hover:opacity-90 text-white rounded-[var(--mp-r-button)] font-bold text-sm transition-all active:scale-[0.98]"
              >
                {t("kaf_reveal", lang)}
              </button>
            </div>
          )}
          {!isOpenAnswer && (!recallFirst || optionsRevealed || answered) && isMulti && !answered && (
            <p className="text-[11px] text-[var(--mp-status-warning)] font-semibold mb-1">
              ⓘ {lang === "de" ? `Mehrfachantwort (${nCorrect} richtig)` : `Multi-select (${nCorrect} correct)`}
            </p>
          )}
          {!isOpenAnswer && (!recallFirst || optionsRevealed || answered) && options.map((opt, idx) => (
            <Option
              key={idx}
              state={getOptionState(idx, opt)}
              letter={String.fromCharCode(65 + idx)}
              multiSelect={isMulti}
              checked={selectedIdxs.has(idx)}
              onClick={() => handleSelect(idx)}
            >
              <span className="flex flex-col items-start gap-1.5">
                {opt.image_url && (
                  <img src={opt.image_url} alt="" className="max-h-24 object-contain rounded-[var(--mp-r-input)] border border-[var(--mp-border)]" />
                )}
                <span>{opt.text}</span>
              </span>
            </Option>
          ))}
          {!isOpenAnswer && (!recallFirst || optionsRevealed) && isMulti && !answered && !examMode && (
            <button
              onClick={handleSubmitMulti}
              disabled={selectedIdxs.size === 0}
              className="w-full mt-2 py-3 bg-[var(--mp-status-warning)] hover:bg-[#FFC97A] text-[#1A0E00] rounded-[var(--mp-r-button)] font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {lang === "de" ? "Antwort prüfen" : "Check Answer"}
            </button>
          )}
        </div>

        {/* Post-answer feedback strip */}
        {answered && !hideFeedbackStrip && (() => {
          const answeredCorrectly =
            nCorrect > 0 && selectedIdxs.size > 0 && [...selectedIdxs].some(i => options[i]?.correct);
          return (
            <AnswerReveal
              correct={answeredCorrectly}
              className="mt-3 flex items-center justify-between text-sm animate-fade-in border-l-0"
            >
              <div className="flex items-center gap-3">
                <span className="font-semibold text-[var(--mp-viridian)]">+10 XP</span>
                <span className="text-[var(--mp-fg-subtle)]">&middot;</span>
                <span className="text-[var(--mp-fg-muted)]">
                  {answeredCorrectly
                    ? (lang === "de" ? "Richtig!" : "Correct!")
                    : (lang === "de" ? "Netter Versuch!" : "Nice try!")}
                </span>
              </div>
              <span className="text-xs text-[var(--mp-fg-subtle)]">
                N &rarr; {lang === "de" ? "Nächste" : "Next"}
              </span>
            </AnswerReveal>
          );
        })()}

        {/* UX-5 (2026-07-04): the standalone "save this question as a flash-note"
            button was removed from here. It repeated the note-creation that now
            lives in the single Notizen tab (UX-3), so having it float after the
            answer too was part of the "flash-note button is everywhere" problem.
            Note creation for a question now has ONE home: the Notizen tab. */}

        {/* UX-3 (2026-07-04): the curated/community notes (QuestionNotes) used
            to render as a SEPARATE collapsible section here, above the Notizen
            tab — two homes for "notes on this question." They are now unified
            INTO the Notizen tab below (personal + curated + community in one
            place), so this standalone section was removed. */}

        {/* ──────────────────────────────────────────────────────────
            Quiz-B: Tabbed post-answer context
            Shown only when answered && !hideExplanation. Re-organises
            the legacy [explanation] → [translate] → [notes] vertical
            scroll into sibling tabs. Tabs: Erklärung / KI-Chat /
            Notizen / Übersetzen / Quelle.
            KI-Chat is an action-style tab that opens the existing
            AIChatAssistant modal (kept as modal — not inlined).
            ────────────────────────────────────────────────────────── */}
        {answered && !hideExplanation && (() => {
          const hasExplanation = !!cleanExplanation(question.explanation);
          const tabs: ContextTab<PostAnswerTab>[] = [
            { id: "erklaerung", label: lang === "de" ? "Erklärung" : "Explanation", icon: <Lightbulb className="w-3.5 h-3.5" /> },
            {
              id: "ki",
              // Renamed from "KI-Chat" → "KI-Erklärung" (DE) / "AI Chat" → "AI Explanation" (EN)
              // so free users don't mistake this for a Pro-locked chat. The surface IS an
              // explanation; the Pro gate only applies to interactive follow-up questions.
              label: lang === "de" ? "KI-Erklärung" : "AI Explanation",
              // UX-4 (2026-07-04): a REAL tab panel now — the AI explanation
              // renders inline where the tab is (the desktop side-drawer was
              // the rejected pattern; content appears where the user clicked).
              icon: <Bot className="w-3.5 h-3.5" />,
            },
            { id: "notizen", label: lang === "de" ? "Notizen" : "Notes", icon: <FileText className="w-3.5 h-3.5" /> },
            { id: "uebersetzen", label: lang === "de" ? "Übersetzen" : "Translate", icon: <Languages className="w-3.5 h-3.5" /> },
            // "Quelle" (Source) tab dropped per IA plan (FEEDBACK #4e): it was a
            // permanent "no source references yet" placeholder. Re-add only once
            // guideline references actually exist on the data contract.
          ];
          // Hide the Translate tab when there is nothing to translate
          const visibleTabs = tabs.filter((tab) => (tab.id === "uebersetzen" ? hasExplanation : true));
          // If the current active tab is no longer visible, fall back to notizen
          const activeVisible: PostAnswerTab = visibleTabs.find((tb) => tb.id === activeTab)
            ? activeTab
            : "notizen";

          return (
            <div className="mt-4 animate-slide-reveal">
              <ContextTabs
                variant="underline"
                tabs={visibleTabs}
                activeTab={activeVisible}
                onTabChange={setActiveTab}
                ariaLabel={lang === "de" ? "Zusatzinformationen" : "Additional information"}
              >
                {/* Erklärung pane */}
                {activeVisible === "erklaerung" && (
                  <div className="pt-4 animate-fade-in">
                    <QuestionExplanation
                      questionId={question.id}
                      explanation={question.explanation}
                      lang={lang}
                      extraImages={extraImages}
                      onImageClick={setLightboxSrc}
                      rating={explanationRating}
                      onRate={setExplanationRating}
                    />
                  </div>
                )}

                {/* KI-Erklärung pane (UX-4, 2026-07-04) — the AI assistant
                    renders INLINE here (no overlay drawer). Kept mounted after
                    the first visit (hidden on other tabs) so the conversation
                    and a draft follow-up survive tab switches; it resets only
                    when the question changes. */}
                {aiEverOpened && (
                  <div className={activeVisible === "ki" ? "pt-4 animate-fade-in" : "hidden"}>
                    <AIChatAssistant
                      active={activeVisible === "ki"}
                      lang={lang}
                      questionId={question.id}
                      questionText={question.question}
                      answerText={question.answer}
                      explanation={question.explanation}
                      topic={question.topic}
                      options={options.map(o => ({ text: o.text, correct: o.correct }))}
                      userTier={userTier}
                      userRole={userRole}
                    />
                  </div>
                )}

                {/* Notizen pane — the SINGLE notes home (UX-3, 2026-07-04):
                    the user's own notes (QuestionNotesPanel) PLUS the curated
                    "MedPrüf Team" + community notes for this question
                    (QuestionNotes), unified in one place instead of two. */}
                {activeVisible === "notizen" && (
                  <div className="pt-4 animate-fade-in space-y-3">
                    <QuestionNotesPanel lang={lang} questionId={question.id} />
                    <QuestionNotes questionId={question.id} lang={lang} />
                  </div>
                )}

                {/* Übersetzen pane */}
                {activeVisible === "uebersetzen" && (
                  <div className="pt-4 animate-fade-in">
                    <p className="text-xs text-[var(--mp-fg-muted)] mb-3">
                      {lang === "de"
                        ? "Übersetze die Erklärung in deine Sprache."
                        : "Translate the explanation into your language."}
                    </p>
                    <TranslateButton
                      questionId={question.id}
                      lang={lang}
                      userTier={userTier}
                      field="explanation"
                    />
                  </div>
                )}

              </ContextTabs>
            </div>
          );
        })()}
      </div>

      {/* Report / flag / edit form — now a Dialog (focus trap, escape, aria-modal). */}
      {!hideActions && (
        <QuestionReportForm
          open={showReportForm}
          questionId={question.id}
          lang={lang}
          initialQuestion={question.question}
          initialExplanation={question.explanation || ""}
          initialTopic={question.topic}
          onClose={() => setShowReportForm(false)}
          onSubmitted={() => setSuggestionSubmitted(true)}
        />
      )}

      {/* UX-4 (2026-07-04): the overlay-drawer AIChatAssistant mount that
          lived here was removed — the assistant now renders INLINE inside the
          "KI-Erklärung" tab panel above, where the tab is. */}

      {/* Lightbox — opens for whichever image was clicked (question or extra) */}
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          alt={lang === "de" ? "Medizinische Abbildung" : "Medical illustration"}
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </>
  );
}
