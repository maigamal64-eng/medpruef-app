"use client";

/**
 * One question of a saved exam (UX-EXM-39): collapsed by default (number,
 * verdict, subject, first 80 characters), expands on tap. Unanswered is a
 * neutral state with a dash icon. KAF runs show the typed answers and the
 * accepted answer instead of options. Images load lazily inside a reserved
 * box; explanations offer the shared "Übersetzen" translator.
 */
import { useId, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, Minus, XCircle } from "lucide-react";
import { Option, Skeleton, optionStateFor } from "@/components/ui";
import ImageLightbox from "@/components/ImageLightbox";
import Markdown from "@/components/Markdown";
import TranslateButton from "@/components/TranslateButton";
import { cleanExplanation } from "@/lib/explanation";
import { th, historyLang } from "@/lib/i18n-history";
import { stemPreview, verdictOf, type ReviewQuestion, type Verdict } from "./history-rules";

export function VerdictLabel({ verdict, lang }: { verdict: Verdict; lang: string }) {
  if (verdict === "correct") {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--mp-success-text)]">
        <CheckCircle2 className="h-4 w-4" aria-hidden /> {th("verdict_correct", lang)}
      </span>
    );
  }
  if (verdict === "wrong") {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--mp-error-text)]">
        <XCircle className="h-4 w-4" aria-hidden /> {th("verdict_wrong", lang)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--mp-fg-muted)]">
      <Minus className="h-4 w-4" aria-hidden /> {th("verdict_open", lang)}
    </span>
  );
}

function LazyImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative mb-3 block w-full max-w-md overflow-hidden rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)]"
        style={{ aspectRatio: "4 / 3" }}
        aria-label={alt}
      >
        {!loaded && <Skeleton className="absolute inset-0 h-full w-full rounded-none" />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} className="h-full w-full object-contain" />
      </button>
      {open && <ImageLightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

export default function ReviewRow({
  question,
  number,
  kaf,
  flagged,
  lang,
}: {
  question: ReviewQuestion;
  number: number;
  kaf: boolean;
  flagged: boolean;
  lang: string;
}) {
  const [open, setOpen] = useState(false);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const panelId = useId();
  const verdict = verdictOf(question);
  const subject = question.topic || th("subject_other", lang);
  // Same cleaning and Markdown render as the quiz (QuestionExplanation).
  const bankExplanation = cleanExplanation(question.explanation ?? null) || null;
  const explanation = bankExplanation ?? question.ai_explanation ?? null;
  const selected = question.selected_texts ?? question.options.filter((o) => o.is_selected).map((o) => o.text);
  const accepted = question.correct_texts ?? [];

  return (
    <li className="card overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-14 w-full items-start gap-3 p-3.5 text-left"
      >
        <span className="w-9 shrink-0 pt-0.5 font-mono text-[13px] text-[var(--mp-fg-muted)]">
          <span className="sr-only">{th("question_number", lang, { n: number })}</span>
          <span aria-hidden>#{number}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <VerdictLabel verdict={verdict} lang={lang} />
            <span className="rounded-full bg-[var(--mp-border-subtle)] px-2 py-0.5 text-[12px] text-[var(--mp-fg-muted)]">{subject}</span>
            {flagged && <span className="text-[12px] font-semibold text-[var(--mp-warning-text)]">{th("filter_flagged", lang)}</span>}
            {question.removed && <span className="text-[12px] text-[var(--mp-fg-muted)]">{th("verdict_removed", lang)}</span>}
          </span>
          {!open && question.stem && (
            <span className="mt-1 block break-words text-[14px] text-[var(--mp-fg)]" lang="de" dir="ltr">{stemPreview(question.stem)}</span>
          )}
        </span>
        <ChevronDown className={`mt-0.5 h-5 w-5 shrink-0 text-[var(--mp-fg-subtle)] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open && (
        <div id={panelId} className="border-t border-[var(--mp-border-subtle)] px-3.5 pb-4 pt-3">
          {question.removed ? (
            <p className="text-sm text-[var(--mp-fg-muted)]">{th("verdict_removed", lang)}</p>
          ) : (
            <>
              {question.image_url && <LazyImage src={question.image_url} alt={th("image_alt", lang, { n: number })} />}
              <p className="mb-3 whitespace-pre-wrap break-words text-sm text-[var(--mp-fg)]" lang="de" dir="ltr">{question.stem}</p>

              {kaf ? (
                <div className="mb-3 space-y-3 text-sm">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--mp-fg-muted)]">{th("self_marked", lang)}</p>
                  <div>
                    <p className="font-semibold text-[var(--mp-fg)]">{th("your_answers", lang)}</p>
                    {selected.length > 0 ? (
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[var(--mp-fg)]" lang="de" dir="ltr">
                        {selected.map((text, i) => <li key={i} className="break-words">{text}</li>)}
                      </ul>
                    ) : (
                      <p className="mt-1 text-[var(--mp-fg-muted)]">{th("no_answer", lang)}</p>
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-[var(--mp-fg)]">{th("accepted_answer", lang)}</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[var(--mp-fg)]" lang="de" dir="ltr">
                      {accepted.map((text, i) => <li key={i} className="break-words">{text}</li>)}
                    </ul>
                  </div>
                </div>
              ) : (
                /* UX-GLOBAL-25: the same Option row and vocabulary as the quiz. */
                <div className="mb-3 space-y-2" lang="de" dir="ltr">
                  {question.options.map((o, oi) => (
                    <Option
                      key={oi}
                      static
                      letter={String.fromCharCode(65 + oi)}
                      state={optionStateFor({ answered: true, selected: o.is_selected, correct: o.is_correct })}
                    >
                      {o.text}
                    </Option>
                  ))}
                </div>
              )}

              {explanation && (
                <details className="mb-2 text-sm" onToggle={(e) => setExplanationOpen((e.currentTarget as HTMLDetailsElement).open)}>
                  <summary className="flex min-h-11 cursor-pointer items-center text-[var(--mp-fg)] hover:underline">{th("explanation", lang)}</summary>
                  <div lang="de" dir="ltr">
                    <Markdown className="mt-1 text-[var(--mp-fg)]">{explanation}</Markdown>
                  </div>
                  {explanationOpen && (
                    <div className="mt-3">
                      <TranslateButton
                        questionId={question.question_id}
                        lang={historyLang(lang)}
                        userTier="pro"
                        field={bankExplanation ? "explanation" : "ai_explanation"}
                      />
                    </div>
                  )}
                </details>
              )}

              <Link
                href={`/quiz?questionId=${question.question_id}`}
                className="inline-flex min-h-11 items-center text-sm text-[var(--mp-cta)] hover:underline"
              >
                {th("practise_one", lang)}
              </Link>
            </>
          )}
        </div>
      )}
    </li>
  );
}
