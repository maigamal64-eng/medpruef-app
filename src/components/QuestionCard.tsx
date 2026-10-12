"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getTopicConfig } from "@/lib/topics";
import { t } from "@/lib/i18n";
import { shouldIgnoreGlobalKey } from "@/lib/keyboard-guard";
import Link from "next/link";
import StudyShortcutHelp from "@/components/StudyShortcutHelp";
import { studyShortcutsEnabled } from "@/lib/study-shortcuts";
import { safeStorage } from "@/lib/safe-storage";
import { answerShortcut, gradeSelection } from "@/lib/practice-exam-state";
import { useId } from "react";
import type { MCQOption } from "@/lib/mcq";
import ImageLightbox from "@/components/ImageLightbox";
import { trackEvent } from "@/lib/tracker";
import { getStoredSession } from "@/lib/auth";
import { BOOKMARK_EVENT, loadBookmarks, readCachedBookmarks, setBookmark } from "@/lib/bookmarks";
import TopicIcon from "@/components/TopicIcon";
import { cleanExplanation } from "@/lib/explanation";
import { intervalLabel } from "@/lib/master-learning/srs";
import { Lightbulb, FileText, Bot, Flag, CheckCircle2, Languages, ListChecks } from "lucide-react";
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
import { optionStateFor } from "@/components/ui/Option";
import { QuestionImage } from "@/components/ui/QuestionImage";
import { MentorQuestionEntry } from "@/components/mentor/entries/MentorQuestionEntry";

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
  totalQuestions: number | null;
  lang: Lang;
  onAnswer?: (isCorrect: boolean, selected?: number[]) => void;
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
  /** True when this response is only queued locally and not server-confirmed. */
  offlineAnswerPending?: boolean;
  answerSaveState?: "pending" | "saved" | "queued" | "auth-expired";
  /** Controlled-mode: fired alongside onAnswer when the user finalizes a selection — gives the parent the actual indices so external state (e.g. an exam answers dict) can be updated. */
  onCommit?: (selected: number[], isCorrect: boolean) => void;
  /** Hide the "+10 XP · Correct!" feedback strip (used by exam mode where there is no XP per-question). */
  hideFeedbackStrip?: boolean;
  /** Exam simulation mode: selections are tracked but never graded.
   *  Hides "Antwort prüfen" button, auto-commits on every toggle,
   *  and never reveals correct/wrong coloring. */
  examMode?: boolean;
  /** UX-PRA-26: XP the server returned for this answer (shown only after the save). */
  xpAwarded?: number | null;
  /** UX-PRA-26: stored review interval in days (Pro, saved, not queued). */
  reviewDays?: number | null;
  /** UX-PRA-18: fired once a report for this question is stored. */
  onReported?: () => void;
  /** KAF recall-first training (2026-07-03): the real Kenntnisprüfung asks
   *  open short-answer questions (Kurzantwortfragen), so this hides the MCQ
   *  options behind a free-recall step (optional ungraded scratch answer)
   *  until the user reveals them. Grading/XP flow unchanged after reveal. */
  recallFirst?: boolean;
  /** MUX-89: offer "Mit dem Mentor besprechen" once answered. Practice only, never set by /exam. */
  mentorEntry?: boolean;
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
  offlineAnswerPending = false,
  answerSaveState = "saved",
  onCommit,
  hideFeedbackStrip = false,
  examMode = false,
  recallFirst = false,
  xpAwarded = null,
  reviewDays = null,
  onReported,
  mentorEntry = false,
}: QuestionCardProps) {
  const stemId = useId();
  const userId = getStoredSession()?.user?.id || "";
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
  const handleToggleFavRef = useRef<() => void>(() => {});

  const [showAnswer, setShowAnswer] = useState(false);
  // UX-4: the AI panel is an inline tab; once the ki tab has been visited it
  // stays mounted (hidden) so the conversation survives tab switches.
  const [aiEverOpened, setAiEverOpened] = useState(false);
  // KAF recall-first: options stay covered until revealed (reset per question).
  const [optionsRevealed, setOptionsRevealed] = useState(false);
  const [recallScratch, setRecallScratch] = useState("");
  // Flag/edit report modal
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportPreset, setReportPreset] = useState<{ reason: "missing_image" | "ai_explanation_wrong" } | null>(null);
  const [suggestionSubmitted, setSuggestionSubmitted] = useState(false);
  const [explanationRating, setExplanationRating] = useState<1 | -1 | null>(null);

  // Text-selection → highlight layer (extracted to its own hook).
  const highlightApi = useQuestionHighlights(question.id);

  // Quiz-B tabbed post-answer context. Tabs: erklaerung | ki | notizen | uebersetzen
  // ("quelle"/Source dropped per IA plan — FEEDBACK #4e — until guideline refs exist).
  type PostAnswerTab = "erklaerung" | "ki" | "notizen" | "uebersetzen";
  const [activeTab, setActiveTab] = useState<PostAnswerTab>("erklaerung");
  const isOpenAnswer = !question.options || question.options.length < 2;
  // Revealing an open-answer prompt completes the card for navigation, but it
  // is not a correct response and must never award answer XP.
  const answered = submitted || (showAnswer && isOpenAnswer);

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

  const options: MCQOption[] = question.options || [];
  const nCorrect = question.n_correct ?? options.filter(o => o.correct).length;
  const isMulti = nCorrect >= 2;
  const [firstMultiHint, setFirstMultiHint] = useState(false);
  useEffect(() => { setFirstMultiHint(isMulti && !!userId && safeStorage.getItem(`practice_multi_seen:${userId}`) !== "1"); }, [isMulti, userId, question.id]);
  const markMultiSeen = useCallback(() => { if (isMulti && userId) { safeStorage.setItem(`practice_multi_seen:${userId}`, "1"); setFirstMultiHint(false); } }, [isMulti, userId]);

  // UX-PRA-16 A: single-select grades on the first tap, so the first three
  // answers per account carry one quiet line saying so (no dead button).
  const instantHintId = useId();
  const [instantHint, setInstantHint] = useState(false);
  useEffect(() => {
    const seen = Number(safeStorage.getItem(`practice_instant_hint:${userId || "anon"}`) || "0");
    setInstantHint(!examMode && !isMulti && Number.isFinite(seen) && seen < 3);
  }, [userId, examMode, isMulti, question.id]);
  const countInstantAnswer = useCallback(() => {
    if (examMode || isMulti) return;
    const key = `practice_instant_hint:${userId || "anon"}`;
    const seen = Number(safeStorage.getItem(key) || "0");
    safeStorage.setItem(key, String((Number.isFinite(seen) ? seen : 0) + 1));
  }, [examMode, isMulti, userId]);

  // UX-PRA-17 B: on touch, a tap that ends a scroll or a drag is not an
  // answer. Ignore option taps within 150 ms of a scroll and after the finger
  // moved more than 10 px.
  const touchGuard = useRef({ x: 0, y: 0, moved: false, lastScroll: 0, touchAt: 0 });
  useEffect(() => {
    const onScroll = () => { touchGuard.current.lastScroll = Date.now(); };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
  }, []);
  const onOptionTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchGuard.current.x = touch?.clientX ?? 0;
    touchGuard.current.y = touch?.clientY ?? 0;
    touchGuard.current.moved = false;
    touchGuard.current.touchAt = Date.now();
  };
  const onOptionTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    if (Math.abs(touch.clientX - touchGuard.current.x) > 10 || Math.abs(touch.clientY - touchGuard.current.y) > 10) touchGuard.current.moved = true;
  };
  // Only a click that a touch produced is checked; mouse, wheel and keyboard
  // activation are never swallowed.
  const tapIsAccidental = () => {
    const g = touchGuard.current;
    if (Date.now() - g.touchAt > 1000) return false;
    return g.moved || g.touchAt - g.lastScroll < 150;
  };


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
    // initialSelected/initiallyAnswered are intentionally read at render time but
    // only re-applied on question change — adding them as deps would wipe user
    // interactions on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  useEffect(() => {
    if (!userId) {
      setIsFav(false);
      return;
    }
    let cancelled = false;
    const sync = () => setIsFav(readCachedBookmarks(userId).includes(question.id));
    sync();
    window.addEventListener(BOOKMARK_EVENT, sync);
    const onStorage = (event: StorageEvent) => {
      if (event.key === `medpruef_favorites:${userId}`) sync();
    };
    const onOnline = () => {
      void loadBookmarks(userId).then((ids) => {
        if (!cancelled && ids) setIsFav(ids.includes(question.id));
      });
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", onOnline);
    void loadBookmarks(userId).then((ids) => {
      if (!cancelled && ids) setIsFav(ids.includes(question.id));
    });
    return () => {
      cancelled = true;
      window.removeEventListener(BOOKMARK_EVENT, sync);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", onOnline);
    };
  }, [question.id, userId]);

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
      if (shouldIgnoreGlobalKey(e) || !studyShortcutsEnabled()) return;

      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();

      // A-E to select answer options
      if (!answered && options.length > 0) {
        const idx = answerShortcut(e, options.length);
        if (idx !== null) {
          e.preventDefault();
          markMultiSeen();
          if (examMode) {
            // Exam mode: select/toggle without grading
            if (isMulti) {
              const next = new Set(selectedIdxs);
              if (next.has(idx)) next.delete(idx); else next.add(idx);
              setSelectedIdxs(next);
              onCommit?.([...next].sort((a, b) => a - b), false);
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
            countInstantAnswer();
            setSelectedIdxs(new Set([idx]));
            setSubmitted(true);
            onAnswer?.(options[idx].correct, [idx]);
            onCommit?.([idx], options[idx].correct);
          }
        }
      }

      // F to toggle bookmark (UX-PRA-06): one action with the star, never a
      // navigation. Free accounts: F does nothing (the star explains Pro).
      if (key === 'f' && !e.metaKey && !e.ctrlKey) {
        const isPro = userRole === "admin" || userTier === "pro" || userTier === "admin";
        if (!isPro || !userId) return;
        e.preventDefault();
        if (hideActions) {
          window.dispatchEvent(new CustomEvent("medpruef-toggle-bookmark", { detail: { questionId: question.id } }));
        } else {
          handleToggleFavRef.current();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [answered, examMode, options, isMulti, onAnswer, onCommit, selectedIdxs, markMultiSeen, userRole, userTier, userId, hideActions, question.id, countInstantAnswer]);

  const handleSelect = (idx: number) => {
    if (answered) return;
    markMultiSeen();
    if (examMode) {
      // Exam mode: select/toggle without grading, auto-commit
      if (isMulti) {
        const next = new Set(selectedIdxs);
        if (next.has(idx)) next.delete(idx); else next.add(idx);
        setSelectedIdxs(next);
        onCommit?.([...next].sort((a, b) => a - b), false);
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
      countInstantAnswer();
      setSelectedIdxs(new Set([idx]));
      setSubmitted(true);
      onAnswer?.(options[idx].correct, [idx]);
      onCommit?.([idx], options[idx].correct);
    }
  };

  const handleSubmitMulti = () => {
    // UX-PRA-15: the check arms only with exactly the stated number of picks.
    if (answered || selectedIdxs.size !== nCorrect) return;
    setSubmitted(true);
    // Strict grading: selected set must equal correct set exactly
    const isCorrect = gradeSelection(options, [...selectedIdxs]).isCorrect;
    const selected = [...selectedIdxs].sort((a, b) => a - b);
    onAnswer?.(isCorrect, selected);
    onCommit?.(selected, isCorrect);
  };

  const handleToggleFav = () => {
    const isPro = userRole === "admin" || userTier === "pro" || userTier === "admin";
    // UX-PRA-06: a bookmark tap never leaves the question.
    if (!isPro || !userId) return;
    const nextState = !isFav;
    setIsFav(nextState);
    trackEvent("bookmark", { questionId: question.id, topic: question.topic });
    void setBookmark(userId, question.id, nextState).then((ids) => {
      setIsFav(ids.includes(question.id));
    });
  };
  handleToggleFavRef.current = handleToggleFav;

  // Map the parent-owned selection/grading state to the <Option> primitive's
  // `state` prop. Parent still decides everything; Option is presentational.
  //   pre-answer:  selected → 'selected', else → 'idle'
  //   post-answer: correct option → 'correct'; a chosen-wrong → 'wrong';
  //                everything else → 'disabled'
  const getOptionState = (idx: number, opt: MCQOption) =>
    optionStateFor({ answered, selected: selectedIdxs.has(idx), correct: !!opt.correct });

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
      <div className="card rounded-[var(--mp-r-card)] p-6 md:p-8 animate-slide-up" data-question-id={question.id}>
        {/* Top row: topic badge + question counter + bookmark */}
        <div className="flex items-center justify-between mb-4">
          <span
            className="topic-text inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--mp-r-button)] text-xs font-medium"
            style={{ backgroundColor: `${config.color}18`, ["--topic-color" as string]: config.color }}
          >
            <TopicIcon name={config.icon} className="w-4 h-4" />
            <span className="max-w-[140px] truncate" lang="de" dir="ltr">{question.topic}</span>
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
              {t("q", lang)}{questionNumber}{totalQuestions === null ? "" : ` / ${totalQuestions}`}
            </span>
          </div>
        </div>

        {!examMode && isMulti && <span className="mp-badge mb-3">{t("practice_multi_label", lang)}</span>}

        {/* Optional image (UX-GLOBAL-26): reserved box, retry, report. */}
        {effectiveImageUrl && (
          <QuestionImage
            src={effectiveImageUrl}
            alt={lang === "de" ? "Medizinische Abbildung" : "Medical illustration"}
            onOpen={() => setLightboxSrc(effectiveImageUrl)}
            onReport={hideActions ? undefined : () => { setReportPreset({ reason: "missing_image" }); setShowReportForm(true); }}
          />
        )}

        {/* Question text (selectable for highlighting) */}
        <h2 id={stemId} tabIndex={-1} data-question-heading lang="de" dir="ltr" className="text-lg md:text-xl leading-relaxed font-medium text-[var(--mp-fg)] mb-4" style={{ userSelect: 'text' }} data-question-text>
          {highlightApi.renderHighlightedText(question.question)}
        </h2>

        {/* Floating highlight button — appears on text selection */}
        <HighlightSelectionButton
          visible={highlightApi.showButton}
          position={highlightApi.buttonPos}
          onCommit={highlightApi.commitSelection}
        />

        {/* UX-PRA-14: no year chips or importer tags before answering; the
            readable context line appears inside the result below. */}

        {/* MCQ Options */}
        {instantHint && !answered && !isOpenAnswer && (!recallFirst || optionsRevealed) && (
          <p id={instantHintId} className="text-[13px] text-[var(--mp-fg-muted)] mb-2">{t("a23_quiz_instant_hint", lang)}</p>
        )}
        <div
          className="space-y-3"
          role="group"
          aria-labelledby={stemId}
          aria-describedby={instantHint && !answered && !isMulti ? instantHintId : undefined}
          lang="de"
          dir="ltr"
          onTouchStart={onOptionTouchStart}
          onTouchMove={onOptionTouchMove}
        >
          {isOpenAnswer && !showAnswer && (
            <button
              onClick={() => {
                setShowAnswer(true);
                onAnswer?.(false);
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
              <p className="text-[var(--mp-fg)] text-sm leading-relaxed" lang="de" dir="ltr">{question.answer}</p>
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
            <p className="mp-multi-chip">
              <ListChecks className="w-4 h-4 flex-shrink-0" aria-hidden />
              <span>
                {firstMultiHint && <span className="block">{t("practice_first_multi", lang)}</span>}
                {t("practice_multi_rule", lang).replace("{n}", String(nCorrect))} <span>{t("practice_selected_count", lang).replace("{n}", String(selectedIdxs.size)).replace("{total}", String(nCorrect))}</span>
              </span>
            </p>
          )}
          {!isOpenAnswer && (!recallFirst || optionsRevealed || answered) && options.map((opt, idx) => (
            <Option
              key={idx}
              state={getOptionState(idx, opt)}
              letter={String.fromCharCode(65 + idx)}
              multiSelect={isMulti}
              checked={selectedIdxs.has(idx)}
              disabled={answered}
              onClick={() => { if (!answered && !examMode && tapIsAccidental()) return; handleSelect(idx); }}
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
              type="button"
              onClick={handleSubmitMulti}
              aria-disabled={selectedIdxs.size !== nCorrect}
              className="mp-btn mp-btn--primary mp-btn--cta w-full mt-2 aria-disabled:opacity-60"
            >
              {t("a23_quiz_check", lang)}
            </button>
          )}
        </div>

        {/* Post-answer feedback strip */}
        {answered && !hideFeedbackStrip && (() => {
          const outcome = gradeSelection(options, [...selectedIdxs]);
          const queued = offlineAnswerPending || answerSaveState === "queued" || answerSaveState === "auth-expired";
          const pending = answerSaveState === "pending";
          const message = answerSaveState === "auth-expired" ? t("practice_auth_queued", lang) : queued ? t("practice_queued", lang) : pending ? t("practice_saving", lang)
            : isOpenAnswer ? t("practice_unscored", lang)
            : outcome.state === "correct" ? t("practice_correct", lang)
            : outcome.state === "partial" ? t("practice_partial", lang).replace("{found}", String(outcome.found)).replace("{total}", String(outcome.required)).replace("{wrong}", String(outcome.wrong))
            : t("practice_wrong", lang) + " " + options.filter(o => o.correct).map(o => o.text).join("; ");
          const saved = !queued && !pending && answerSaveState === "saved";
          // UX-PRA-26: only what the server returned; nothing while pending,
          // queued or after a rollback, and no number on an unscored reveal.
          const xpChip = saved && !isOpenAnswer && typeof xpAwarded === "number" && xpAwarded > 0 ? xpAwarded : null;
          const reviewLine = saved && typeof reviewDays === "number" && Number.isFinite(reviewDays) ? intervalLabel(reviewDays, lang) : null;
          return <AnswerReveal correct={!queued && !pending && outcome.isCorrect} partial={outcome.state === "partial" || queued || pending} className="mt-3 text-sm">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span>{message}</span>
              {xpChip !== null && <span aria-hidden className="text-[12px] font-mono text-[var(--mp-fg-muted)]">+{xpChip} XP</span>}
            </span>
            {reviewLine && <span className="block text-[13px] text-[var(--mp-fg-muted)] mt-1">{reviewLine}</span>}
            {answerSaveState === "auth-expired" && <Link href="/login?next=/quiz" className="mp-btn mp-btn--secondary min-h-11">{t("home_sign_in", lang)}</Link>}
          </AnswerReveal>;
        })()}

        {/* UX-PRA-14: one readable, non-interactive context line after grading. */}
        {answered && !examMode && (() => {
          const years = [...new Set((question.exam_dates ?? []).map((d) => String(d).slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort().reverse().slice(0, 3);
          const sitting = years.length ? t("a23_quiz_context_sitting", lang).replace("{years}", years.join(", ")) : t("a23_quiz_context_undated", lang);
          return (
            <p className="mt-2 text-[12px] text-[var(--mp-fg-muted)]">
              {t("a23_quiz_context_topic", lang)} <span lang="de" dir="ltr">{question.topic}</span> · {sitting}
            </p>
          );
        })()}
        {mentorEntry && answered && <MentorQuestionEntry placement="answer" questionId={question.id} answered examMode={examMode} lang={lang} className="mt-3" wasCorrect={isOpenAnswer ? null : gradeSelection(options, [...selectedIdxs]).isCorrect} selectedOptionText={[...selectedIdxs].sort((a, b) => a - b).map(i => options[i]?.text).filter(Boolean).join("; ") || undefined} />}

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
                      onReport={hideActions ? () => window.dispatchEvent(new CustomEvent("medpruef-open-report", { detail: { questionId: question.id } })) : () => setShowReportForm(true)}
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
                      onReport={() => { setReportPreset({ reason: "ai_explanation_wrong" }); setShowReportForm(true); }}
                    />
                    {mentorEntry && <MentorQuestionEntry placement="explanation" questionId={question.id} answered examMode={examMode} lang={lang} className="mt-3" wasCorrect={isOpenAnswer ? null : gradeSelection(options, [...selectedIdxs]).isCorrect} selectedOptionText={[...selectedIdxs].sort((a, b) => a - b).map(i => options[i]?.text).filter(Boolean).join("; ") || undefined} />}
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

      {/* Report / flag / edit form — now a Dialog (focus trap, escape, aria-modal).
          Pages that hide the card's own actions still get it for the AI tab's
          one-tap "Falsch? Frage melden" (TR-30). */}
      {(!hideActions || showReportForm) && (
        <QuestionReportForm
          open={showReportForm}
          questionId={question.id}
          lang={lang}
          initialQuestion={question.question}
          initialExplanation={question.explanation || ""}
          initialTopic={question.topic}
          preset={reportPreset}
          onClose={() => { setShowReportForm(false); setReportPreset(null); }}
          onSubmitted={() => { setSuggestionSubmitted(true); onReported?.(); }}
        />
      )}

      {/* UX-4 (2026-07-04): the overlay-drawer AIChatAssistant mount that
          lived here was removed — the assistant now renders INLINE inside the
          "KI-Erklärung" tab panel above, where the tab is. */}

      <StudyShortcutHelp lang={lang} />

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
