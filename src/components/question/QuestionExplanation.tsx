"use client";

/**
 * QuestionExplanation — the "Erklärung" tab pane.
 *
 * Renders the explanation text + thumb-up/down rating controls + any
 * extra explanation images. Extracted from QuestionCard.tsx as part of
 * the design-debt DD-15 burndown (split the 800+ LOC monolith).
 *
 * Props are all derived from the parent QuestionCard — this component
 * owns no state that needs to survive a parent re-render. The rating
 * value itself is lifted one level up so the parent can clear it on
 * question change and so the thumb UI reflects the latest value
 * consistently.
 */

import { useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { trackEvent } from "@/lib/tracker";
import { cleanExplanation } from "@/lib/explanation";
import { Lightbulb, ThumbsUp, ThumbsDown } from "lucide-react";
import Markdown from "@/components/Markdown";
import ExplanationTranslator from "@/components/ExplanationTranslator";

type Lang = "de" | "en";

interface Props {
  questionId: number;
  explanation: string;
  lang: Lang;
  extraImages: string[];
  onImageClick: (src: string) => void;
  /** Controlled rating — parent resets to null on question change. */
  rating: 1 | -1 | null;
  onRate: (rating: 1 | -1) => void;
  /** Optional — user tier, forwarded to the inline translation switcher so
   *  the free-tier quota copy is accurate. Defaults to "free" when omitted
   *  (backward compatible — QuestionCard need not pass it). */
  userTier?: string;
}

export default function QuestionExplanation({
  questionId,
  explanation,
  lang,
  extraImages,
  onImageClick,
  rating,
  onRate,
  userTier = "free",
}: Props) {
  const cleanedExplanation = cleanExplanation(explanation);
  const hasExplanation = !!cleanedExplanation;
  // Local submitting guard so double-clicks don't double-POST. The
  // visible state still lives in the parent via `rating`.
  const [posting, setPosting] = useState(false);

  const submitRating = async (value: 1 | -1) => {
    if (rating === value || posting) return;
    onRate(value);
    setPosting(true);
    trackEvent("feature_use", { feature: "explanation_rating", rating: value, questionId });
    try {
      await fetch("/api/explanation-rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, rating: value }),
      });
    } catch {
      /* silent — rating is best-effort */
    } finally {
      setPosting(false);
    }
  };

  return (
    <>
      {hasExplanation ? (
        /* ── Approved 02-quiz explanation drawer ──
           Clean surface card · viridian lightbulb badge · "Warum richtig"
           title · TL;DR body · rating row. NOTE: no "KI" badge here — this
           pane renders the static `explanation` source column, NOT AI text.
           The AI-generated explanation is a separate surface behind the
           "KI-Erklärung" tab (opens AIChatAssistant). Badging this as KI
           would mislabel curated source text as AI, right next to the real
           AI tab. The approved mockup's KI badge belongs on the AI surface. */
        <div className="bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] rounded-[var(--mp-r-card)] overflow-hidden shadow-[var(--mp-shadow-card)]">
          <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-[var(--mp-border-soft)]">
            <span className="w-[30px] h-[30px] rounded-[var(--mp-r-button)] bg-[var(--mp-viridian)]/12 text-[var(--mp-viridian)] flex items-center justify-center flex-shrink-0">
              <Lightbulb className="w-[17px] h-[17px]" />
            </span>
            <span className="font-display font-bold text-sm text-[var(--mp-fg)]">
              {lang === "de" ? "Warum richtig" : "Why correct"}
            </span>
          </div>
          <div className="px-4 py-3.5">
            {/* Markdown render (BUG-3): the new AI-written explanations use
                `**bold**`, lists, headings. Rendered plain-text before, so
                users saw literal `**` markers. Shared <Markdown> maps every
                element to MPDS tokens (Tailwind v4 here has no `prose`). */}
            <Markdown className="text-[var(--mp-fg)] leading-relaxed text-sm">
              {cleanedExplanation}
            </Markdown>

            {/* Inline translation (UX-6): auto-shows a saved translation in
                the user's language, German original one tap away, switch
                across the 7 saved languages, generate-on-first-view (then
                cached for everyone). Free-tier 5/day limit surfaced, not
                removed. */}
            <ExplanationTranslator
              questionId={questionId}
              lang={lang}
              field="explanation"
              germanText={cleanedExplanation}
              userTier={userTier}
            />

            <div className="flex items-center gap-2 mt-3.5 pt-3 border-t border-dashed border-[var(--mp-border)]">
              <span className="text-[11px] text-[var(--mp-fg-subtle)]">
                {lang === "de" ? "Hilfreich?" : "Helpful?"}
              </span>
              <button
                onClick={() => submitRating(1)}
                className={`p-1.5 rounded-[var(--mp-r-sm)] transition-colors ${
                  rating === 1
                    ? "text-[var(--mp-viridian)] bg-[var(--mp-viridian)]/10"
                    : "text-[var(--mp-fg-subtle)] hover:text-[var(--mp-viridian)] hover:bg-[var(--mp-viridian)]/5"
                }`}
                title={lang === "de" ? "Hilfreich" : "Helpful"}
                aria-label={lang === "de" ? "Hilfreich" : "Helpful"}
              >
                <ThumbsUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => submitRating(-1)}
                className={`p-1.5 rounded-[var(--mp-r-sm)] transition-colors ${
                  rating === -1
                    ? "text-[var(--mp-error)] bg-[var(--mp-error)]/10"
                    : "text-[var(--mp-fg-subtle)] hover:text-[var(--mp-error)] hover:bg-[var(--mp-error)]/5"
                }`}
                title={lang === "de" ? "Nicht hilfreich" : "Not helpful"}
                aria-label={lang === "de" ? "Nicht hilfreich" : "Not helpful"}
              >
                <ThumbsDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-[var(--mp-surface-sunken)] border border-dashed border-[var(--mp-border)] rounded-xl p-5 text-center">
          <Lightbulb className="w-5 h-5 mx-auto mb-2 text-[var(--mp-fg-subtle)]" />
          <p className="text-sm text-[var(--mp-fg-muted)] mb-1">
            {lang === "de" ? "Noch keine Erklärung vorhanden." : "No explanation available yet."}
          </p>
          <p className="text-xs text-[var(--mp-fg-subtle)]">
            {lang === "de"
              ? "Tippen Sie auf „KI-Erklärung“ für eine KI-generierte Erklärung."
              : "Tap \u201cAI Explanation\u201d for an AI-generated explanation."}
          </p>
        </div>
      )}

      {/* Explanation images — rendered inside Erklärung tab */}
      {extraImages.length > 0 && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {extraImages.map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => onImageClick(src)}
              className="block w-full rounded-xl overflow-hidden border border-[var(--mp-border)] hover:border-[var(--mp-viridian)]/40 transition-colors group"
              aria-label={lang === "de" ? "Bild vergrößern" : "Enlarge image"}
            >
              <img
                src={src}
                alt={lang === "de" ? `Erklärungsbild ${i + 1}` : `Explanation image ${i + 1}`}
                className="w-full max-h-72 object-contain bg-[var(--mp-surface-raised)]"
              />
              <p className="text-[10px] text-[var(--mp-fg-subtle)] text-center py-1 bg-[var(--mp-surface-raised)] group-hover:text-[var(--mp-fg-muted)] transition-colors">
                {lang === "de" ? "Erklärungsbild · Klicken zum Vergrößern" : "Explanation image · Click to enlarge"}
              </p>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
