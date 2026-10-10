"use client";

import { useEffect, useRef } from "react";
import { SendHorizontal, Square, Globe } from "lucide-react";
import { mentorT, type MentorKey, type MentorUiLang } from "@/lib/i18n-mentor";
import type { MentorLang, MentorMode } from "@/lib/mentor/contract";
import { MENTOR_MESSAGE_MAX_CHARS } from "@/lib/mentor/contract";
import { canSubmit, draftStatus } from "./chat-state";
import { MENTOR_ANSWER_LANGS, answerLangLabel } from "./view-model";

const MODE_PLACEHOLDER: Record<MentorMode, MentorKey> = {
  facts: "composer_placeholder_facts",
  explain: "composer_placeholder_explain",
  study: "composer_placeholder_study",
};
const MODE_LABEL: Record<MentorMode, MentorKey> = {
  facts: "mode_facts",
  explain: "mode_explain",
  study: "mode_study",
};

export interface ComposerProps {
  lang: MentorUiLang;
  draft: string;
  onDraft: (v: string) => void;
  mode: MentorMode;
  modes: MentorMode[];
  onMode: (m: MentorMode) => void;
  answerLang: MentorLang;
  onAnswerLang: (l: MentorLang) => void;
  busy: boolean;
  /** Composer closed by state (no credits, resting, rate-limit cooldown). */
  blocked: boolean;
  onSend: () => void;
  onStop: () => void;
  autoFocusKey?: number;
}

export default function Composer(p: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const status = draftStatus(p.draft);
  const sendable = canSubmit(p.draft, p.busy) && !p.blocked;

  // Grow with content up to a cap; shrink back after send.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [p.draft]);

  // Focus after a starter prompt fills the draft.
  useEffect(() => {
    if (p.autoFocusKey) ref.current?.focus();
  }, [p.autoFocusKey]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    // Phones keep Enter as a newline; a pointer device sends.
    const fine = typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches;
    if (fine && sendable) {
      e.preventDefault();
      p.onSend();
    }
  };

  return (
    <div className="border-t border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 pb-2 pt-2.5 sm:px-4 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-2 flex items-center gap-2">
          <div role="radiogroup" aria-label={mentorT("mode_label", p.lang)} className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
            {p.modes.map((m) => {
              const on = m === p.mode;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => p.onMode(m)}
                  className={`min-h-9 shrink-0 rounded-full border px-3 text-[12.5px] font-semibold transition-colors ${
                    on
                      ? "border-[var(--mp-viridian)] bg-[var(--mp-success-bg)] text-[var(--mp-viridian)]"
                      : "border-[var(--mp-border)] bg-transparent text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)]"
                  }`}
                >
                  {mentorT(MODE_LABEL[m], p.lang)}
                </button>
              );
            })}
          </div>
          <label className="relative inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-[var(--mp-border)] bg-transparent ps-2.5 pe-1 text-[12.5px] font-semibold text-[var(--mp-fg-muted)]">
            <Globe className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">{mentorT("lang_label", p.lang)}</span>
            <select
              value={p.answerLang}
              onChange={(e) => p.onAnswerLang(e.target.value as MentorLang)}
              className="min-h-9 cursor-pointer appearance-none bg-transparent [&&]:!bg-transparent pe-1 ps-0.5 text-[12.5px] font-semibold text-[var(--mp-fg)] outline-none"
              aria-label={mentorT("lang_label", p.lang)}
            >
              {MENTOR_ANSWER_LANGS.map((l) => (
                <option key={l} value={l}>
                  {answerLangLabel(l)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={`flex items-end gap-2 rounded-2xl border bg-[var(--mp-surface-sunken)] p-1.5 transition-colors ${status.over ? "border-[var(--mp-error)]" : "border-[var(--mp-border)] focus-within:border-[var(--mp-viridian)]"}`}>
          <textarea
            ref={ref}
            value={p.draft}
            onChange={(e) => p.onDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            dir="auto"
            disabled={p.blocked}
            aria-label={mentorT("composer_label", p.lang)}
            aria-invalid={status.over}
            placeholder={mentorT(MODE_PLACEHOLDER[p.mode], p.lang)}
            enterKeyHint="send"
            className="max-h-36 min-h-11 flex-1 resize-none bg-transparent [&&]:!bg-transparent [&&]:!border-transparent px-2.5 py-2.5 text-[15px] leading-snug text-[var(--mp-fg)] outline-none placeholder:text-[var(--mp-fg-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
          />
          {p.busy ? (
            <button type="button" onClick={p.onStop} className="mp-btn mp-btn--secondary h-11 w-11 shrink-0 !p-0" aria-label={mentorT("btn_stop", p.lang)}>
              <Square className="h-4 w-4 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={p.onSend}
              disabled={!sendable}
              className="mp-btn mp-btn--success h-11 w-11 shrink-0 !p-0 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={mentorT("btn_send", p.lang)}
            >
              <SendHorizontal className="h-[18px] w-[18px] rtl:-scale-x-100" aria-hidden />
            </button>
          )}
        </div>

        {/* pe-16 and min-h-14 keep the global feedback launcher (fixed bottom-right) clear of the send button. */}
        <div className="mt-1.5 flex min-h-14 items-start justify-between gap-3 pe-16">
          <p dir="auto" className="text-[10.5px] leading-snug text-[var(--mp-fg-subtle)]">{mentorT("disclaimer", p.lang)}</p>
          {status.nearLimit && (
            <p
              className={`shrink-0 text-[10.5px] font-semibold tabular-nums ${status.over ? "text-[var(--mp-error)]" : "text-[var(--mp-fg-muted)]"}`}
              role={status.over ? "alert" : undefined}
            >
              {status.over ? mentorT("composer_too_long", p.lang) : mentorT("composer_counter", p.lang, { n: status.count, max: MENTOR_MESSAGE_MAX_CHARS })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
