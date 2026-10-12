"use client";
import { t } from "@/lib/i18n";
import { tl } from "@/lib/i18n-library";

/**
 * TurnIntoNoteButton — the "Save as flash-note" control (Notes feature 4b, revamped).
 *
 * One clear, LABELLED primary action ("Als Lernnotiz speichern") with a success
 * TOAST so the result is unmistakable (the old icon-only button read as
 * unrecognisable + silent). An optional "Anpassen / Customize" panel lets the
 * user pick the note's LANGUAGE and a FOCUS sentence; when an answer context is
 * available (a question the user just answered) it is passed too, so the note
 * targets their gaps. Sane one-tap default = current UI language, no focus,
 * answer-context auto-attached.
 *
 * POST /api/notes/transform. The 10-note lifetime free cap (402) surfaces the
 * plans link inline; AI-off (503) surfaces an error. Never tier-gated
 * client-side. Nouns follow the shared glossary (Lernnotiz / study note);
 * a25 strings live in src/lib/i18n-library.ts (Sie).
 *
 * `embedded` (the Library composer, UX-STU-55): the parent owns the success
 * toast and the reset, so the button returns to idle and reports the created
 * notes through onCreated.
 */

import { useState } from "react";
import Link from "next/link";
import { authFetch as fetch } from "@/lib/authFetch";
import { useToast } from "@/components/ui";
import {
  Sparkles,
  Loader2,
  Check,
  Crown,
  RotateCcw,
  Settings2,
  ChevronDown,
} from "lucide-react";

type Lang = "de" | "en";
type TransformKind = "question" | "user_note" | "ai_explanation";
type State = "idle" | "working" | "done" | "cap" | "error";

const NOTE_LANG_OPTIONS: { code: string; de: string; en: string }[] = [
  { code: "de", de: "Deutsch", en: "German" },
  { code: "en", de: "Englisch", en: "English" },
  { code: "ar", de: "Arabisch", en: "Arabic" },
  { code: "ru", de: "Russisch", en: "Russian" },
  { code: "fr", de: "Französisch", en: "French" },
  { code: "tr", de: "Türkisch", en: "Turkish" },
  { code: "uk", de: "Ukrainisch", en: "Ukrainian" },
  { code: "sr", de: "Serbisch", en: "Serbian" },
];

interface Props {
  kind: TransformKind;
  lang: Lang;
  sourceRef?: { question_id?: number; message_id?: string };
  text?: string;
  examType?: string;
  topic?: string;
  /** Answer context (for a question the user just answered) → sharper notes. */
  userAnswer?: string;
  wasCorrect?: boolean | null;
  allowCustomize?: boolean;
  size?: "sm" | "md";
  className?: string;
  onCreated?: (notes: { id: string }[]) => void;
  /** Idle label override (the Library composer says "Lernnotiz erstellen"). */
  label?: string;
  /** Disabled until the parent has input (shown from the start, UX-STU-55). */
  disabled?: boolean;
  /** Parent owns success toast and reset (see header). */
  embedded?: boolean;
}

export default function TurnIntoNoteButton({
  kind,
  lang,
  sourceRef,
  text,
  examType,
  topic,
  userAnswer,
  wasCorrect,
  allowCustomize = true,
  size = "md",
  className = "",
  onCreated,
  label,
  disabled = false,
  embedded = false,
}: Props) {
  const toast = useToast();
  const [state, setState] = useState<State>("idle");
  const [open, setOpen] = useState(false);
  const [noteLang, setNoteLang] = useState<string>(lang);
  const [focus, setFocus] = useState("");
  const de = lang === "de";

  const create = async () => {
    if (state === "working" || disabled) return;
    setState("working");
    try {
      const res = await fetch("/api/notes/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          source_ref: sourceRef,
          text,
          exam_type: examType,
          topic,
          lang: noteLang,
          focus: focus.trim() || undefined,
          user_answer: userAnswer || undefined,
          was_correct: typeof wasCorrect === "boolean" ? wasCorrect : undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const created = Array.isArray(data?.notes)
          ? (data.notes as { id?: unknown }[]).filter((n): n is { id: string } => typeof n?.id === "string")
          : [];
        setState(embedded ? "idle" : "done");
        setOpen(false);
        onCreated?.(created);
        // UX-PRA-36 naming: "Lernnotiz" for Library notes, "Karteikarte" only for /flashcards.
        if (!embedded) toast.success(t("a23_note_saved_title", lang), t("a23_note_saved_body", lang));
      } else if (res.status === 402) {
        setState("cap");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <Link
        href="/library"
        className={`inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mp-viridian)] ${className}`}
      >
        <Check className="w-4 h-4" aria-hidden /> {t("a23_note_open_library", lang)}
      </Link>
    );
  }
  if (state === "cap") {
    return (
      <Link
        href="/pricing?gate=notes"
        className={`inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mp-status-warning)] ${className}`}
      >
        <Crown className="w-4 h-4" aria-hidden />{" "}
        {tl("turn_cap", lang)}
      </Link>
    );
  }

  const btnSize = size === "sm" ? "text-xs px-3 py-1.5" : "text-sm px-4 py-2";

  return (
    <div className={className}>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={create}
          disabled={state === "working" || disabled}
          className={`inline-flex items-center gap-1.5 ${btnSize} rounded-lg font-semibold border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] hover:bg-[var(--mp-viridian)]/20 transition-colors disabled:opacity-60`}
        >
          {state === "working" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : state === "error" ? (
            <RotateCcw className="w-4 h-4" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {state === "working"
            ? tl("turn_working", lang)
            : state === "error"
              ? t("a23_note_retry", lang)
              : label ?? t("a23_note_save", lang)}
        </button>

        {allowCustomize && state !== "working" && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-xs text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" />
            {tl("turn_customize", lang)}
            <ChevronDown
              className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>

      {allowCustomize && open && (
        <div className="mt-2 p-3 rounded-lg bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-soft)] space-y-2 max-w-sm">
          <label className="block text-[11px] font-semibold text-[var(--mp-fg-muted)]">
            {tl("turn_lang", lang)}
            <select
              value={noteLang}
              onChange={(e) => setNoteLang(e.target.value)}
              className="mt-1 w-full text-sm px-2 py-1.5 rounded bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg)] focus:outline-none focus:border-[var(--mp-viridian)]"
            >
              {NOTE_LANG_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {de ? o.de : o.en}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] font-semibold text-[var(--mp-fg-muted)]">
            {tl("turn_focus", lang)}
            <input
              type="text"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              maxLength={300}
              placeholder={tl("turn_focus_placeholder", lang)}
              className="mt-1 w-full text-sm px-2 py-1.5 rounded bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] text-[var(--mp-fg)] placeholder-[var(--mp-fg-subtle)] focus:outline-none focus:border-[var(--mp-viridian)]"
            />
          </label>
          {userAnswer ? (
            <p className="text-[10px] text-[var(--mp-fg-subtle)] leading-snug">
              {tl("turn_answer_hint", lang)}
            </p>
          ) : null}
        </div>
      )}

      {state === "error" && (
        <p role="alert" className="text-xs text-[var(--mp-error-text)] mt-1">
          {tl("turn_error", lang)}
        </p>
      )}
    </div>
  );
}
