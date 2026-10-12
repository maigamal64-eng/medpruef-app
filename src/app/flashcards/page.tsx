"use client";
import PartialTranslationNote from "@/components/PartialTranslationNote";
import { DataRegion } from "@/components/ui/DataRegion";
import { createRequestSequence } from "@/lib/async-data";

/**
 * Flashcards — MPDS v3 "Clinical Nocturne" single-card focus.
 *
 * Reimplementation 2026-06-26 (build loop): rebuilt the PRESENTATION to the
 * approved `reviews/reimplementation-2026-06-26/design/06-flashcards.html`
 * mockup + SPECS §6. The data layer is unchanged — only the UI is new.
 *
 *   - One centered card, full focus (no deck-stack, no desktop history rail).
 *     SPECS §6: "No XP/timer/streak here (calm review ritual)." The reward is
 *     the 3D flip, the specialty-keyed card, the per-button next-interval
 *     hints (transparency IS the reward), the shrinking queue, and the calm
 *     "Alles wiederholt" completion — restraint is the premium. The history
 *     rail + retention/leaks stats from the prior pass were DROPPED on purpose
 *     because they are not in the approved direction.
 *   - Top accent bar: viridian→spark on the FRONT, CTA-blue→teal on the BACK,
 *     so flip state reads instantly (the one blessed spark on this surface).
 *   - fbar: close (← Zurück), centered session progress, shuffle (re-fetch).
 *     The mockup's "/30 fällige Karten" denominator + the per-card next-review
 *     intervals are NOT in the data contract (the page fetches one card at a
 *     time, limit=1, with no due-count endpoint and no SM-2 fields on the
 *     Question type). Per "keep the data layer / no new network calls", the
 *     denominator is dropped (we show the real session count) and the interval
 *     sublabels are static/illustrative. Shuffle maps to the existing
 *     fetchCard() re-fetch.
 *   - 3D Y-flip via the existing `flip-card` CSS (reduced-motion → crossfade,
 *     handled in globals.css).
 *
 * Business logic unchanged (data CONTRACT preserved):
 *   - `getStoredSession()` hydrates user (xp/streak/accuracy still read so the
 *     Sidebar user card stays populated — they are NOT shown on the card).
 *   - `/api/questions?topic=…&limit=1&examSource=…` (signed session) fetches the next
 *     card (spaced-rep prioritization server-side).
 *   - `/api/answer` POST records answer with binary `isCorrect` mapping
 *     (again/hard=false, good/easy=true). SM-2 engine intact.
 *   - `medpruef_flashcard_daily` localStorage counter untouched.
 *   - Keyboard shortcuts: Space/Enter flip, 1-4 rate.
 *   - Paywall (`paywallHit`) + "all caught up" empty state preserved.
 *
 * Scope: ONLY this file. Strings are inlined (de/en) rather than added to the
 * shared i18n.ts so a parallel sibling-surface fleet can't merge-conflict.
 */

import { useEffect, useState, useCallback, useRef, useId, Suspense } from "react";
import { BrandedLoader } from "@/components/Logo";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { authFetch as fetch } from "@/lib/authFetch";
import StudyShortcutHelp from "@/components/StudyShortcutHelp";
import { studyShortcutsEnabled } from "@/lib/study-shortcuts";
import { shouldIgnoreGlobalKey } from "@/lib/keyboard-guard";
import { getLang, t } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { getStoredExamSource } from "@/lib/topics";
import { getTopicConfig } from "@/lib/topics";
import { addExcludedQuestionIds, rememberReviewedQuestion, requeueAfterRating, takeDueRequeue, type RequeueItem } from "@/lib/flashcardQueue";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { canUse } from "@/lib/entitlements";
import { intervalLabel } from "@/lib/master-learning/srs";
import { newActionKey } from "@/lib/mutation";
import { CONFIDENCE_GRADE } from "@/lib/answer-request";
import { cleanExplanation, cutAtSentence, EXPLANATION_PREVIEW_CHARS } from "@/lib/explanation";
import { FLASHCARD_HEADERS } from "@/lib/flashcard-eligibility";
import Markdown from "@/components/Markdown";
import ReportQuestionModal from "@/components/ReportQuestionModal";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { FlipCard } from "@/components/FlashCard";
import {
  AppLayout,
  RatingRow,
  Option,
  AnswerReveal,
  EmptyState,
  Dialog,
} from "@/components/ui";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import TopicIcon from "@/components/TopicIcon";
import {
  Layers,
  RotateCw,
  Shuffle,
  X,
  Check,
  ShieldCheck,
  Lock,
  Sparkles,
  Flag,
} from "lucide-react";
import PaywallUpgradeModal from "@/components/PaywallUpgradeModal";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import type { MCQOption } from "@/lib/mcq";
import { aiChatCopy } from "@/components/ai-chat-copy";

type Lang = "de" | "en";
type Confidence = "again" | "hard" | "good" | "easy";

interface Question {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  ai_explanation?: string;
  image_url?: string;
  /** Structured options from the `choices` JSONB column, attached by
   *  attachOptions() on the API route. null = open-answer mode. */
  options?: MCQOption[] | null;
  /** How many options are correct (set by attachOptions()). */
  n_correct?: number;
}

/* ─── Helpers ────────────────────────────────────────────────────── */

/** Strip "(N richtige Antwort/en)" from the stem — shown as a badge instead. */
function stripMultiCorrectHint(q: string): string {
  return q.replace(/\s*\(\d+ richtige? Antworten?\)/gi, "").trim();
}

/** Extract N from "(N richtige Antworten)" if present. Returns null if absent. */
function extractCorrectCount(q: string): number | null {
  const m = q.match(/\((\d+) richtige? Antworten?\)/i);
  return m ? parseInt(m[1], 10) : null;
}

const FLASHCARD_COUNT_KEY = "medpruef_flashcard_daily";

function getTodayKey(): string {
  return new Date().toISOString().split("T")[0];
}

function getDailyCount(): number {
  if (typeof window === "undefined") return 0;
  try {
    const data = JSON.parse(localStorage.getItem(FLASHCARD_COUNT_KEY) || "{}");
    const today = getTodayKey();
    return data[today] || 0;
  } catch {
    return 0;
  }
}

function incrementDailyCount(): void {
  try {
    const data = JSON.parse(localStorage.getItem(FLASHCARD_COUNT_KEY) || "{}");
    const today = getTodayKey();
    data[today] = (data[today] || 0) + 1;
    localStorage.setItem(FLASHCARD_COUNT_KEY, JSON.stringify(data));
  } catch {
    /* silent */
  }
}

/* ─── Flashcard component ────────────────────────────────────────── */

interface FlashcardProps {
  question: Question;
  flipped: boolean;
  animatingOut: boolean;
  onFlip: () => void;
  lang: Lang;
  topicConfig: { color: string; icon: string };
  onReadMore: (text: string, aiDraft: boolean) => void;
  examSource: string;
}

/** Stems longer than this read as a paragraph: 20 px, start-aligned (PRA-68). */
const LONG_STEM_CHARS = 180;

/**
 * <Flashcard> renders the centered 3D-flip card pair (front + back) for one
 * question: a top accent bar, a specialty chip, the recall cue on the front,
 * and on the back the stem preview (PRA-63), the correct answer with its
 * original letters (PRA-64) and the explanation as sanitised markdown cut at
 * a sentence boundary (PRA-62). One card, full focus (PRA-68 A).
 */
function Flashcard({
  question,
  flipped,
  animatingOut,
  onFlip,
  lang,
  topicConfig,
  onReadMore,
  examSource,
}: FlashcardProps) {
  const stemId = useId();
  const stemPreviewId = useId();
  const [stemOpen, setStemOpen] = useState(false);
  useEffect(() => { setStemOpen(false); }, [question.id]);
  const stem = stripMultiCorrectHint(question.question);
  const hintCount = extractCorrectCount(question.question);
  const isMulti = (question.n_correct ?? 1) > 1 || (hintCount ?? 0) > 1;
  const longStem = stem.length > LONG_STEM_CHARS;

  /* Correct options for the back. Prefer structured options; fall back to the
   * pipe-joined answer string split into a list so the back is never blank
   * even for open-answer cards. */
  // PRA-64: structured options keep their original letters on the back.
  const correctOptions: Array<{ text: string; letter?: string }> = question.options
    ? question.options
        .map((o, i) => ({ text: o.text, correct: o.correct, letter: String.fromCharCode(65 + i) }))
        .filter((o) => o.correct)
        .map(({ text, letter }) => ({ text, letter }))
    : question.answer
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((text) => ({ text }));

  /* Explanation: whitespace-only is absent; line breaks are kept so the
   * markdown renders (PRA-62). */
  const bankExplanation = cleanExplanation(question.explanation, { keepLines: true });
  const explanation = bankExplanation || cleanExplanation(question.ai_explanation, { keepLines: true });
  const hasExplanation = explanation.length > 0;
  // TR-30 / MUX-90 (a37): AI text is never shown as the bank's own explanation.
  const explanationIsAi = !bankExplanation && hasExplanation;
  const aiCopy = aiChatCopy(lang);
  const cut = cutAtSentence(explanation, EXPLANATION_PREVIEW_CHARS);
  const quizHref = `/quiz?${new URLSearchParams({ questionId: String(question.id), examSource })}`;

  return (
    <FlipCard
      revealLabel={t("flash_reveal", lang)}
      frontDescriptionId={stemId}
      answerLabel={t("flash_answer_region", lang)}
      flipped={flipped}
      animatingOut={animatingOut}
      onFlip={onFlip}
      chip={{
        color: topicConfig.color,
        icon: topicConfig.icon,
        label: question.topic,
      }}
      frontLabel={t("a23_fc_front", lang)}
      backLabel={t("a23_fc_back", lang)}
      front={
        <>
          {/* Format badge, replaces the inline "(N richtige)" stem hint */}
          <div className="flex justify-center">
            {isMulti ? (
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)]">
                {hintCount !== null
                  ? t("a23_fc_n_correct", lang).replace("{n}", String(hintCount))
                  : t("a23_fc_multi", lang)}
              </span>
            ) : (
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)]">
                {t("a23_fc_single", lang)}
              </span>
            )}
          </div>

          {/* Recall cue (stem). Scaled by length (PRA-68): short prompts 24 px
              centred, long ones 20 px start-aligned, never below 18 px. The
              container scrolls as the never-clip backstop. */}
          <div className={`flex-1 min-h-0 flex flex-col ${longStem ? "items-stretch text-start" : "items-center text-center"} justify-start gap-4 px-1 overflow-y-auto -mr-1 pr-1`}>
            <div className={`my-auto flex flex-col ${longStem ? "items-stretch" : "items-center"} gap-4 w-full`}>
              <p id={stemId} className={`font-display text-[var(--mp-fg)] whitespace-pre-line [overflow-wrap:anywhere] hyphens-auto ${longStem ? "text-[20px] font-semibold leading-[1.4]" : "text-[24px] font-bold leading-[1.3]"}`}>
                {stem}
              </p>
              {question.image_url && (
                <img
                  src={question.image_url}
                  alt=""
                  className="max-h-36 rounded-lg object-contain self-center"
                />
              )}
            </div>
          </div>

          {/* Flip hint */}
          <div className="flex items-center justify-center gap-2 text-xs text-[var(--mp-fg-subtle)] mt-2">
            <RotateCw className="w-[15px] h-[15px]" aria-hidden />
            {t("tap_to_flip", lang)}
          </div>
        </>
      }
      back={
        <>
          {/* One reading region; it scrolls only for very long backs and is
              then focusable and named (PRA-62). */}
          <div className="flex-1 min-h-0 flex flex-col gap-2.5 overflow-y-auto -mr-2 pr-2" tabIndex={0} role="region" aria-label={t("a23_fc_back_region", lang)}>
            {/* PRA-63: the question stays on the back, clamped to two lines. */}
            <div className="pb-2.5 border-b border-[var(--mp-border-soft)]">
              <p className="sr-only">{t("a23_fc_stem_label", lang)}</p>
              <p id={stemPreviewId} className={`text-[13px] leading-snug text-[var(--mp-fg-muted)] whitespace-pre-line [overflow-wrap:anywhere] ${stemOpen ? "" : "line-clamp-2"}`}>
                {stem}
              </p>
              <button
                type="button"
                className="mt-1 min-h-11 text-[13px] font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2"
                aria-expanded={stemOpen}
                aria-controls={stemPreviewId}
                onClick={() => setStemOpen((v) => !v)}
              >
                {stemOpen ? t("a23_fc_stem_hide", lang) : t("a23_fc_stem_show", lang)}
              </button>
            </div>

            {correctOptions.length > 0 ? (
              correctOptions.map(({ text, letter }, idx) => (
                <Option
                  key={idx}
                  static
                  state="revealed"
                  letter={letter}
                >
                  {text}
                </Option>
              ))
            ) : (
              <p className="text-[var(--mp-viridian)] text-lg font-bold whitespace-pre-line font-display">
                {question.answer}
              </p>
            )}

            {hasExplanation && (
              <AnswerReveal correct>
                <p className="text-[11px] font-semibold text-[var(--mp-fg-subtle)] uppercase tracking-wider mb-1 font-mono">
                  {explanationIsAi ? `${aiCopy.title} (${aiCopy.badge})` : t("explanation", lang)}
                </p>
                <Markdown className="text-sm text-[var(--mp-fg-muted)] leading-relaxed [overflow-wrap:anywhere]">{cut.text}</Markdown>
                {explanationIsAi && (
                  <p data-ai-trust className="mt-1.5 text-[12px] text-[var(--mp-fg-muted)]">{aiCopy.trustLine}</p>
                )}
                <div className="mt-1 flex flex-wrap gap-x-4">
                  {cut.truncated && (
                    <button type="button" className="min-h-11 text-[13px] font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2" onClick={() => onReadMore(explanation, explanationIsAi)}>
                      {t("a23_fc_read_more", lang)}
                    </button>
                  )}
                  <Link href={quizHref} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2">
                    {t("a23_fc_in_question", lang)}
                  </Link>
                </div>
              </AnswerReveal>
            )}

            {!hasExplanation && (
              <p className="text-xs text-[var(--mp-fg-subtle)] text-center font-mono italic mt-1">
                {t("a23_fc_no_explanation", lang)}
              </p>
            )}
          </div>
        </>
      }
    />
  );
}

/* ─── Confidence tray ────────────────────────────────────────────── */

/* ─── Main page content ──────────────────────────────────────────── */

function FlashcardContent() {
  const searchParams = useSearchParams();
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [totalXp, setTotalXp] = useState(0);
  const [streak, setStreak] = useState(0);
  const [accuracy, setAccuracy] = useState(0);

  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [flipped, setFlipped] = useState(false);
  const [dailyCount, setDailyCount] = useState(0);
  const [animatingOut, setAnimatingOut] = useState(false);
  // Set when the free-tier gate returns `paywallHit: true` — the API returned
  // 200 with no question because the user has exhausted their free slice. We
  // render an upgrade prompt instead of spinning forever on the loading state.
  const [paywallHit, setPaywallHit] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  // Current question reference for async rating calls
  const currentRef = useRef<Question | null>(null);
  const seenQuestionIdsRef = useRef<number[]>([]);
  const seenScopeRef = useRef("");
  // UX-GLOBAL-34: four ratings only where a schedule exists for this account;
  // free question cards get the two-button set and the Pro line.
  const tierLive = useUserTier();
  const scheduled = canUse("spaced_repetition", tierLive.audience);
  const requeueRef = useRef<RequeueItem<Question>[]>([]);
  const hardOnceRef = useRef(new Set<number>());
  const shownRef = useRef(0);
  // One idempotency key per shown card; a retry of the same rating reuses it.
  const ratingKeyRef = useRef(newActionKey());
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [dueToday, setDueToday] = useState<number | null>(null);
  // TR-09: one-tap report on every card; PRA-62: full explanation sheet;
  // PRA-64: cards kept in the quiz this session, counted from the server.
  const [reportOpen, setReportOpen] = useState(false);
  const [readMore, setReadMore] = useState<{ text: string; aiDraft: boolean } | null>(null);
  const [quizOnlyCount, setQuizOnlyCount] = useState(0);
  const skipRetries = useRef(0);

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
      // Guard against sessions without a gamification snapshot — those crash
      // here otherwise with "Cannot read properties of undefined".
      const gm = session.gamification ?? {};
      setTotalXp(gm.total_xp || 0);
      setStreak(gm.current_streak || 0);
      const ans = gm.total_questions_answered || 0;
      const cor = gm.total_correct || 0;
      setAccuracy(ans > 0 ? Math.round((cor / ans) * 100) : 0);
    }
    setDailyCount(getDailyCount());
  }, []);

  const switchLang = (l: Lang) => {
    setLangState(l);
  };

  const [cardError, setCardError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const ratingBusy = useRef(false);
  const [saving, setSaving] = useState(false);
  const cardRequest = useRef(createRequestSequence());
  const fetchCard = useCallback(async () => {
    const request = cardRequest.current.begin();
    setCardError(false);
    setLoading(true);
    setFlipped(false);
    setAnimatingOut(false);
    setPaywallHit(false);
    ratingKeyRef.current = newActionKey();

    // A card rated "Nochmal" or "Schwer" comes back later in this session.
    const requeued = takeDueRequeue(requeueRef.current, shownRef.current);
    if (requeued.card) {
      requeueRef.current = requeued.rest;
      shownRef.current += 1;
      setQuestion(requeued.card);
      currentRef.current = requeued.card;
      if (request.current()) setLoading(false);
      return;
    }

    try {
      const examSource = getStoredExamSource();
      const topic = searchParams.get("topic") || "random";
      const params = new URLSearchParams({ topic, limit: "1", examSource, flashcard: "1" });
      const scope = `${examSource}:${topic}`;
      if (seenScopeRef.current !== scope) {
        seenScopeRef.current = scope;
        seenQuestionIdsRef.current = [];
        setQuizOnlyCount(0);
      }
      addExcludedQuestionIds(params, seenQuestionIdsRef.current);
      const res = await fetch(`/api/questions?${params}`, { signal: request.signal });
      if (!request.current()) return;
      if (!res.ok && res.status !== 402) throw new Error(`Question request failed (${res.status})`);
      // PRA-64: cards that need their options stay in the quiz. Their ids
      // join excludeIds so they never cost another round trip.
      const skippedIds = (res.headers.get(FLASHCARD_HEADERS.skippedIds) || "")
        .split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0);
      const freshSkips = skippedIds.filter((id) => !seenQuestionIdsRef.current.includes(id));
      if (freshSkips.length) {
        seenQuestionIdsRef.current = [...seenQuestionIdsRef.current, ...freshSkips];
        setQuizOnlyCount((n) => n + freshSkips.length);
      }
      const data = await res.json();
      if (!request.current()) return;
      if (Array.isArray(data) && data.length === 0 && freshSkips.length > 0 && skipRetries.current < 4) {
        skipRetries.current += 1;
        void fetchCardRef.current();
        return;
      }
      skipRetries.current = 0;
      if ((!Array.isArray(data) && !data?.paywallHit) || (!res.ok && !data?.paywallHit)) throw new Error("Invalid question response");
      if (Array.isArray(data) && data.length > 0) {
        shownRef.current += 1;
        setQuestion(data[0]);
        currentRef.current = data[0];
      } else if (
        data &&
        typeof data === "object" &&
        (data as { paywallHit?: boolean }).paywallHit
      ) {
        // Free-tier slice exhausted for this exam. Surface the upgrade prompt
        // rather than trapping the user in a loading spinner.
        setPaywallHit(true);
        setPaywallOpen(true);
        setQuestion(null);
        currentRef.current = null;
      } else {
        setQuestion(null);
        currentRef.current = null;
      }
    } catch (e) {
      if (request.current()) setCardError(true);
      console.error(e);
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [searchParams]);
  const fetchCardRef = useRef(fetchCard);
  fetchCardRef.current = fetchCard;

  // Fetch first card
  useEffect(() => {
    void fetchCard();
    const sequence = cardRequest.current;
    return () => sequence.cancel();
  }, [fetchCard]);

  const lastConfidence = useRef<Confidence | null>(null);
  const handleConfidence = useCallback(
    async (level: Confidence) => {
      const q = currentRef.current;
      if (!q || ratingBusy.current) return;
      ratingBusy.current = true;
      lastConfidence.current = level;
      setSaveError(false); setSaving(true);

      // Animate out + bump the daily counter


      // If logged in, report the rating. isCorrect keeps the binary mapping
      // (again/hard wrong, good/easy right) that the server uses while the a23
      // flags are off; grade and kind let the server record a graded flashcard
      // review once SRS_GRADE_ENABLED / FLASHCARD_REVIEW_KIND_ENABLED are on.
      let serverCardsToday: number | null = null;
      if (userId) {
        const isCorrect = level === "good" || level === "easy";
        try {
          const result = await fetch("/api/answer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              questionId: q.id,
              isCorrect,
              userAnswer: q.answer,
              timeSpentMs: 0,
              requestId: ratingKeyRef.current,
              grade: CONFIDENCE_GRADE[level],
              kind: "flashcard",
            }),
          });
          if (!result.ok) throw new Error("Rating not saved");
          const saved = await result.json().catch(() => null) as { review?: { intervalDays?: number } | null; cardsToday?: number | null } | null;
          if (typeof saved?.cardsToday === "number" && Number.isFinite(saved.cardsToday)) serverCardsToday = saved.cardsToday;
          // Only the server's stored schedule is shown, never an invented interval.
          const days = saved?.review?.intervalDays;
          setLastResult(typeof days === "number" && Number.isFinite(days) ? intervalLabel(days, lang) : null);
        } catch {
          setSaveError(true); setSaving(false); ratingBusy.current = false; return;
        }
      }
      requeueRef.current = requeueAfterRating(requeueRef.current, q, level, shownRef.current, hardOnceRef.current);

      seenQuestionIdsRef.current = rememberReviewedQuestion(seenQuestionIdsRef.current, q.id);
      setSaving(false); setAnimatingOut(true);
      incrementDailyCount();
      // The server count (flashcard review kind) wins over the device counter.
      if (serverCardsToday !== null) setDailyCount(serverCardsToday); else setDailyCount(c => c + 1);
      setTimeout(() => {
        void fetchCard().finally(() => { ratingBusy.current = false; });
      }, 300);
    },
    [userId, fetchCard, lang],
  );

  // UX-PRA-51: a unique document title.
  useEffect(() => { document.title = `${t("a23_fc_title", lang)} | MedPrüf`; }, [lang]);

  // One server source for "Heute fällig" (LX-06-R); unknown renders nothing.
  useEffect(() => {
    if (!userId || !scheduled) { setDueToday(null); return; }
    const controller = new AbortController();
    fetch(`/api/user/due-summary?examType=${encodeURIComponent(getStoredExamSource())}`, { signal: controller.signal })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { entitled?: boolean; dueToday?: number } | null) => {
        if (!controller.signal.aborted) setDueToday(d?.entitled && Number.isFinite(d.dueToday) ? d.dueToday! : null);
      })
      .catch(() => { if (!controller.signal.aborted) setDueToday(null); });
    return () => controller.abort();
  }, [userId, scheduled]);

  // Keyboard shortcuts (Space/Enter flip, 1-4 rate)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Shared keyboard guard — ignores typing in dialogs (Feedback, Flag,
      // etc.) so Space/Enter inside a textarea doesn't flip the card behind it.
      if (shouldIgnoreGlobalKey(e) || !studyShortcutsEnabled() || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || ratingBusy.current) return;
      const active = document.activeElement;
      if (e.key === " " || e.key === "Enter") {
        if (active && active !== document.body && active.tagName !== "MAIN") return;
        e.preventDefault();
        if (!flipped) setFlipped(true);
      }
      const keys: Confidence[] = scheduled ? ["again", "hard", "good", "easy"] : ["again", "good"];
      const picked = keys[Number(e.key) - 1];
      if (flipped && picked) handleConfidence(picked);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [flipped, handleConfidence, scheduled]);

  if ((loading || cardError) && !question) {
    return <main className="min-h-screen px-4 py-12 bg-[var(--mp-surface-sunken)]">
        <PartialTranslationNote /><DataRegion loading={loading} error={cardError} retry={() => void fetchCard()} /></main>;
  }

  if (paywallHit) {
    // The one paywall (UX-GLOBAL-19, UX-ACC-24): the shared dialog opens in
    // place; behind it a calm state keeps a way back to the offer.
    const bank = getStoredExamSource();
    return (
      <main className="flex flex-col items-center justify-center min-h-screen px-4 py-12 bg-[var(--mp-bg)]">
        <div className="mp-card text-center max-w-md w-full p-6 sm:p-8 space-y-4">
          <Layers className="w-12 h-12 text-[var(--mp-viridian)] mx-auto" aria-hidden />
          <h1 className="mp-h2">{lang === "de" ? "Kostenlose Karten dieser Fragenbank beantwortet" : "Free cards of this bank answered"}</h1>
          <button type="button" className="mp-btn mp-btn--primary min-h-12 w-full justify-center" onClick={() => setPaywallOpen(true)}>
            {lang === "de" ? "Tarife ansehen" : "See plans"}
          </button>
          <Link href="/" className="inline-flex min-h-11 items-center underline text-sm">{lang === "de" ? "Zur Startseite" : "Go to home"}</Link>
        </div>
        <PaywallUpgradeModal
          open={paywallOpen}
          onOpenChange={setPaywallOpen}
          lang={lang}
          gate="qbank_limit"
          bankLabel={getExamLabel(bank, "full", lang === "de" ? "de" : "en")}
          surface="flashcards"
        />
      </main>
    );
  }

  if (!question) {
    // "No questions" covers two real cases: (1) a new user with nothing in
    // their SM-2 queue yet, (2) an existing user who's cleared every due card
    // for the day. Both deserve a warm "all reviewed" nudge (SPECS §6:
    // "Alles wiederholt"), not a blank verdict.
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 bg-[var(--mp-bg)]">
        <div className="max-w-md w-full animate-fade-in">
          <EmptyState
            tone="success"
            icon={<Sparkles className="w-10 h-10" aria-hidden />}
            title={
              lang === "de" ? "Alles wiederholt." : "All reviewed."
            }
            body={
              lang === "de"
                ? "Sie haben alle fälligen Karten durchgearbeitet. Neue Wiederholungen schalten sich automatisch frei, oder starten Sie ein kurzes Zufalls-Quiz, um weiter zu üben."
                : "You've cleared every card due right now. New reviews unlock automatically, or start a quick random quiz to keep the momentum."
            }
            action={
              <div className="flex flex-col sm:flex-row gap-2 justify-center mt-2">
                {seenQuestionIdsRef.current.length > 0 && (
                  <button
                    type="button"
                    className="mp-btn mp-btn--primary"
                    onClick={() => {
                      seenQuestionIdsRef.current = [];
                      void fetchCard();
                    }}
                  >
                    {lang === "de" ? "Karten erneut starten" : "Restart flashcards"}
                  </button>
                )}
                <Link href="/quiz" className="mp-btn mp-btn--primary">
                  {lang === "de" ? "Zufalls-Quiz starten" : "Start random quiz"}
                </Link>
                <Link href="/" className="mp-btn mp-btn--ghost">
                  {t("back_home", lang)}
                </Link>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  const topicConfig = getTopicConfig(question.topic);

  return (
    <AppLayout
      sidebar={
        <Sidebar
          lang={lang}
          userId={userId}
          userName={userName}
          totalXp={totalXp}
          streak={streak}
          accuracy={accuracy}
        />
      }
      bottomNav={<BottomNav lang={lang} userId={userId} />}
    >
      <main className="main-content safe-area-top safe-area-bottom flex flex-col min-h-screen bg-[var(--mp-bg)]">
        <h1 className="sr-only">{t("a23_fc_title", lang)}</h1>
        <PartialTranslationNote />
        <DataRegion error={cardError || saveError} retry={() => { if (saveError && lastConfidence.current) void handleConfidence(lastConfidence.current); else void fetchCard(); }} />
        {/* ── fbar: close · session progress · shuffle ──────────────── */}
        <div className="flex items-center gap-3 px-4 lg:px-8 pt-4 pb-3 flex-shrink-0">
          <Link
            href="/"
            aria-label={t("back_home", lang)}
            className="w-9 h-9 rounded-[10px] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] flex items-center justify-center text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors flex-shrink-0"
          >
            <X className="w-[18px] h-[18px]" />
          </Link>

          <div className="flex-1 text-center min-w-0">
            <div className="font-mono text-[13px] font-bold text-[var(--mp-fg)] flex items-center justify-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[var(--mp-viridian)]" />
              <span>
                {t("flashcards", lang)} ·{" "}
                <b className="text-[var(--mp-accent-teal)] tabular-nums">
                  {dailyCount}
                </b>
              </span>
            </div>
            <div className="text-[12px] text-[var(--mp-fg-muted)] mt-0.5 flex flex-wrap items-center justify-center gap-x-1.5">
              <span
                className="topic-text inline-flex items-center gap-1"
                style={{ ["--topic-color" as string]: topicConfig.color }}
              >
                <TopicIcon name={topicConfig.icon} className="w-3 h-3" />
                {question.topic}
              </span>
              <span className="opacity-50">·</span>
              <span>{lang === "de" ? "heute wiederholt" : "reviewed today"}</span>
              {dueToday !== null && (<>
                <span className="opacity-50">·</span>
                <span>{lang === "de" ? `Heute fällig: ${dueToday}` : `Due today: ${dueToday}`}</span>
              </>)}
            </div>
            {quizOnlyCount > 0 && (
              <p className="text-[12px] text-[var(--mp-fg-muted)] mt-0.5">
                {t("a23_fc_quiz_only", lang).replace("{n}", String(quizOnlyCount))}
              </p>
            )}
          </div>

          {/* TR-09: one-tap report on both faces, every width. */}
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            aria-label={t("a23_fc_report", lang)}
            title={t("a23_fc_report", lang)}
            className="min-w-11 min-h-11 rounded-[10px] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] flex items-center justify-center text-[var(--mp-fg-muted)] hover:text-[var(--mp-error-text)] transition-colors flex-shrink-0"
          >
            <Flag className="w-[17px] h-[17px]" aria-hidden />
          </button>

          {/* Shuffle = skip to the next card (re-fetch; no new endpoint). */}
          <button
            type="button"
            onClick={() => {
              if (question) {
                seenQuestionIdsRef.current = rememberReviewedQuestion(seenQuestionIdsRef.current, question.id);
              }
              setAnimatingOut(true);
              setTimeout(() => fetchCard(), 200);
            }}
            aria-label={lang === "de" ? "Karte überspringen" : "Skip card"}
            className="w-9 h-9 rounded-[10px] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] flex items-center justify-center text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors flex-shrink-0"
          >
            <Shuffle className="w-[17px] h-[17px]" />
          </button>

          {/* Theme + language live next to the shuffle on wide screens. */}
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* ── Card area: one centered card, full focus (PRA-68 A) ─────
            Phones: the card is fluid, full width minus the 16 px gutters and
            the remaining height between the bar and the rating tray, with a
            floor and a dvh-based ceiling. Desktop keeps its clamp. */}
        <div className="flex-1 flex items-stretch lg:items-center justify-center px-4 lg:px-8 py-2 min-h-0">
          <div className="w-full lg:max-w-[560px] flex flex-col">
            <div className="flex-1 min-h-[360px] max-h-[72dvh] lg:flex-none lg:max-h-none lg:h-[clamp(420px,62vh,620px)] w-full">
              <Flashcard
                question={question}
                flipped={flipped}
                animatingOut={animatingOut}
                onFlip={() => setFlipped(true)}
                lang={lang}
                topicConfig={topicConfig}
                onReadMore={(text, aiDraft) => setReadMore({ text, aiDraft })}
                examSource={getStoredExamSource()}
              />
            </div>
          </div>
        </div>

        {/* ── Action tray: flip CTA (front) → SM-2 buttons (back) ────── */}
        <div className="flex-shrink-0 px-4 lg:px-8 pt-3 pb-6 lg:pb-8">
          <div className="w-full lg:max-w-[520px] mx-auto">
            <p role="status" className="min-h-5 mb-2 text-center text-sm text-[var(--mp-fg)]">{lastResult ?? ""}</p>
            {!flipped ? (
              <button
                type="button"
                onClick={() => setFlipped(true)}
                className="mp-btn mp-btn--primary mp-btn--lg w-full inline-flex items-center justify-center gap-2"
              >
                <RotateCw className="w-[18px] h-[18px]" />
                {t("show_answer", lang)}
              </button>
            ) : (
              <div className="animate-fade-in">
                <RatingRow
                  id="flashcard-rating-label"
                  lang={lang}
                  scheduled={scheduled}
                  busy={saving ? lastConfidence.current : null}
                  onRate={(name) => void handleConfidence(name)}
                />

                {/* Keyboard hint */}
                <p className="text-[10px] text-[var(--mp-fg-subtle)] text-center mt-3 font-mono">
                  <kbd className="px-1 py-0.5 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)] rounded text-[10px]">
                    1
                  </kbd>
                  -
                  <kbd className="px-1 py-0.5 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)] rounded text-[10px]">
                    {scheduled ? 4 : 2}
                  </kbd>{" "}
                  {lang === "de" ? "oder" : "or"}{" "}
                  <kbd className="px-1 py-0.5 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)] rounded text-[10px]">
                    Space
                  </kbd>{" "}
                  {lang === "de" ? "zum Umdrehen" : "to flip"}
                </p>
              </div>
            )}

            {!userId && (
              <p className="text-center text-[11px] text-[var(--mp-fg-subtle)] mt-3">
                {lang === "de"
                  ? "Nicht angemeldet, Fortschritt wird nicht gespeichert"
                  : "Not signed in, progress not saved"}
              </p>
            )}
          </div>
        </div>
        <ReportQuestionModal
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          lang={lang}
          questionId={question.id}
          questionText={question.question}
          explanation={question.explanation || ""}
          topic={question.topic}
        />
        <Dialog
          open={readMore !== null}
          onOpenChange={(open) => { if (!open) setReadMore(null); }}
          title={t("explanation", lang)}
          placement="sheet"
          maxWidth="640px"
        >
          {readMore?.aiDraft && <p data-ai-trust className="text-[12px] text-[var(--mp-fg-muted)] mb-2">{aiChatCopy(lang).trustLine}</p>}
          <div lang="de" dir="ltr">
            <Markdown className="text-[15px] leading-relaxed text-[var(--mp-fg)] [overflow-wrap:anywhere]">{readMore?.text ?? ""}</Markdown>
          </div>
        </Dialog>
      </main>
    </AppLayout>
  );
}

export default function FlashcardsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-[var(--mp-bg)]">
          <BrandedLoader />
        </div>
      }
    >
      <FlashcardContent />
    </Suspense>
  );
}
