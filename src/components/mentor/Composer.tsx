"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SendHorizontal, EyeOff, Globe, Settings2, ChevronDown } from "lucide-react";
import { mentorT, type MentorKey, type MentorUiLang } from "@/lib/i18n-mentor";
import type { MentorLang, MentorMode } from "@/lib/mentor/contract";
import { MENTOR_MESSAGE_MAX_CHARS } from "@/lib/mentor/contract";
import { Dialog } from "@/components/ui";
import { r3T } from "./r3-copy";
import { canSubmit, draftStatus } from "./chat-state";
import { MENTOR_ANSWER_LANGS, answerLangLabel } from "./view-model";
import { r2AnswerCopy } from "./r2-answer-copy";
import { typedLanguage, LANGUAGE_SWITCH_COPY } from "./input-language";
import { shellT } from "./r1-shell-copy";
import { a38T } from "./a38-copy";

const MODE_PLACEHOLDER: Record<MentorMode, MentorKey> = { facts: "composer_placeholder_facts", explain: "composer_placeholder_explain", study: "composer_placeholder_study" };
const MODE_LABEL: Record<MentorMode, MentorKey> = { facts: "mode_facts", explain: "mode_explain", study: "mode_study" };

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
  blocked: boolean;
  blockedReason?: string;
  blockedActionHref?: string | null;
  onSend: () => void;
  onStop: () => void;
  /** MUX-37 A: the in-flight answer is already hidden; Hide has nothing left to do. */
  answerHidden?: boolean;
  autoFocusKey?: number;
  conversationKey?: string | number;
  hasThread?: boolean;
}

export default function Composer(p: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [languageOffer, setLanguageOffer] = useState<ReturnType<typeof typedLanguage>>(null);
  const offered = useRef(false);
  useEffect(() => { offered.current = false; setLanguageOffer(null); }, [p.conversationKey]);
  useEffect(() => {
    if (offered.current) return;
    const typed = typedLanguage(p.draft);
    if (typed && typed !== p.answerLang) { offered.current = true; setLanguageOffer(typed); }
  }, [p.draft, p.answerLang]);
  const status = draftStatus(p.draft);
  const sendable = canSubmit(p.draft, p.busy) && !p.blocked;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A wrapped placeholder must not inflate normal phone chrome.
    if (!p.draft) { el.style.height = "44px"; return; }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [p.draft]);
  useEffect(() => { if (p.autoFocusKey) { const el = ref.current; el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); } }, [p.autoFocusKey]);
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    if (window.matchMedia?.("(pointer: fine)").matches && sendable) { e.preventDefault(); p.onSend(); }
  };
  const reason = p.blockedReason ?? mentorT("credits_loading", p.lang);

  return (
    <div data-mentor-composer className="relative border-t border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 py-0 sm:px-4 lg:px-8">
      <div className="relative mx-auto w-full max-w-3xl">
        {!p.hasThread && <div className="pb-1">
          <p className="text-[12px] font-semibold">{r3T("topic", p.lang)}</p>
          <div data-mentor-scope role="radiogroup" aria-label={r3T("topic", p.lang)} className="grid gap-1" style={{gridTemplateColumns: `repeat(${p.modes.length}, minmax(0,1fr))`}}>
            {p.modes.map((m, index) => <button key={m} type="button" role="radio" tabIndex={m === p.mode ? 0 : -1} aria-checked={m === p.mode} onKeyDown={e => { if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key)) { e.preventDefault(); const next = e.key === "Home" ? 0 : e.key === "End" ? p.modes.length-1 : (index + (["ArrowLeft","ArrowUp"].includes(e.key) ? -1 : 1) + p.modes.length)%p.modes.length; p.onMode(p.modes[next]); (e.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus(); } }} onClick={() => p.onMode(m)} className={`min-h-11 min-w-0 rounded-lg px-1 text-[12px] leading-tight ${m === p.mode ? "bg-[var(--mp-success-bg)] text-[var(--mp-viridian)]" : "text-[var(--mp-fg-muted)]"}`}>{mentorT(MODE_LABEL[m], p.lang)}</button>)}
          </div>
          <p className="text-[12px] text-[var(--mp-fg-muted)]">{r3T(`${p.mode}_hint`, p.lang)}</p>
          <button type="button" onClick={() => setLanguageOpen(true)} className="flex min-h-11 items-center gap-2 text-[13px]"><Globe className="h-4 w-4" aria-hidden />{mentorT("lang_label", p.lang)}: {p.answerLang.toUpperCase()}<ChevronDown className="h-4 w-4" aria-hidden /></button>
        </div>}
        {languageOffer && <div dir="auto" data-language-offer className="mb-2 rounded-lg border border-[var(--mp-border)] p-2 text-[13px] text-[var(--mp-fg)]">
          <p>{languageOffer === "ar" ? r2AnswerCopy("arabic_later", p.lang) : LANGUAGE_SWITCH_COPY[languageOffer]}</p>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => { p.onAnswerLang(languageOffer === "ar" ? "en" : languageOffer); setLanguageOffer(null); }} className="mp-btn mp-btn--secondary min-h-11">{answerLangLabel(languageOffer === "ar" ? "en" : languageOffer)}</button><button type="button" onClick={() => setLanguageOffer(null)} className="min-h-11 px-2 underline">{r2AnswerCopy("decline", languageOffer === "ar" ? p.lang : languageOffer)}</button></div>
        </div>}
        {optionsOpen && <div className="absolute bottom-full start-0 z-30 mb-2 w-full rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-3 shadow-lg">
          <div aria-label={mentorT("mode_label", p.lang)} className="grid gap-1" style={{gridTemplateColumns:`repeat(${p.modes.length},minmax(0,1fr))`}}>
            {p.modes.map((m) => <button key={m} type="button" aria-pressed={m === p.mode} onClick={() => p.onMode(m)} className={`min-h-11 min-w-0 rounded-lg border px-1 text-[12px] leading-tight ${m === p.mode ? "border-[var(--mp-viridian)] text-[var(--mp-viridian)]" : "border-[var(--mp-border)]"}`}>{mentorT(MODE_LABEL[m], p.lang)}</button>)}
          </div>
          <button type="button" onClick={() => { setOptionsOpen(false); setLanguageOpen(true); }} className="mt-2 flex min-h-11 items-center gap-2 text-[13px]"><Globe className="h-4 w-4" aria-hidden />{mentorT("lang_label", p.lang)}: {answerLangLabel(p.answerLang)}<ChevronDown className="h-4 w-4" aria-hidden /></button>
        </div>}
        <div data-mentor-state-bar={p.blocked ? "blocked" : "open"} className={`flex min-h-12 items-center gap-1.5 rounded-xl bg-[var(--mp-surface-sunken)] p-0 ring-1 transition-colors ${status.over ? "ring-[var(--mp-error)]" : "ring-[var(--mp-border)] focus-within:ring-[var(--mp-viridian)]"}`}>
          {!p.blocked && p.hasThread && <button type="button" onClick={() => setOptionsOpen((v) => !v)} aria-expanded={optionsOpen} aria-label={`${shellT("options", p.lang)}: ${mentorT(MODE_LABEL[p.mode], p.lang)} · ${answerLangLabel(p.answerLang)}`} className="flex min-h-11 max-w-28 shrink-0 items-center gap-1 rounded-xl px-1.5 text-[12px] text-[var(--mp-fg-muted)]"><Settings2 className="h-4 w-4 shrink-0" aria-hidden /><span className="truncate">{mentorT(MODE_LABEL[p.mode], p.lang)} · {answerLangLabel(p.answerLang)}</span></button>}
          <div className="relative min-w-0 flex-1">
            {p.blocked && <p id="mentor-blocked-reason" aria-live="off" className={p.draft ? "absolute start-2 top-0 max-w-full truncate text-[12px] leading-tight text-[var(--mp-fg-muted)]" : "sr-only"}>{reason}</p>}
            <textarea ref={ref} value={p.draft} onChange={(e) => p.onDraft(e.target.value)} onKeyDown={onKeyDown} rows={1} dir="auto" readOnly={p.blocked} aria-readonly={p.blocked} aria-describedby={p.blocked ? "mentor-blocked-reason" : undefined} aria-label={mentorT("composer_label", p.lang)} aria-invalid={status.over} placeholder={p.blocked ? reason : mentorT(MODE_PLACEHOLDER[p.mode], p.lang)} enterKeyHint="send" className={`max-h-36 min-h-11 w-full min-w-0 resize-none bg-transparent [&&]:!bg-transparent [&&]:!border-transparent px-2 ${p.blocked && p.draft ? "pb-1 pt-4" : "py-2.5"} text-[15px] leading-snug text-[var(--mp-fg)] outline-none placeholder:text-[var(--mp-fg-subtle)]`} />
          </div>
          {p.blocked ? p.blockedActionHref && <Link href={p.blockedActionHref} className="mp-btn mp-btn--primary !h-12 !min-h-12 shrink-0 !px-3 text-[12px]">{mentorT("btn_see_packages", p.lang)}</Link> : p.busy ? <button type="button" onClick={p.answerHidden ? undefined : p.onStop} aria-disabled={p.answerHidden || undefined} className="mp-btn mp-btn--secondary h-11 w-11 shrink-0 !p-0 aria-disabled:opacity-60" aria-label={a38T("hide", p.lang)} aria-describedby="mentor-hide-hint" title={a38T("hide_hint", p.lang)}><EyeOff className="h-4 w-4" aria-hidden /><span id="mentor-hide-hint" className="sr-only">{a38T("hide_hint", p.lang)}</span></button> : <button type="button" onClick={p.onSend} disabled={!sendable} className="mp-btn mp-btn--success h-11 w-11 shrink-0 !p-0 disabled:cursor-not-allowed disabled:bg-[var(--mp-surface-sunken)] disabled:text-[var(--mp-fg-muted)] disabled:border disabled:border-[var(--mp-border)]" aria-label={mentorT("btn_send", p.lang)}><SendHorizontal className="h-[18px] w-[18px] rtl:-scale-x-100" aria-hidden /></button>}
        </div>
        <div className="flex items-center justify-between gap-2 text-[12px] leading-4 text-[var(--mp-fg-muted)]">
          <p dir="auto">{r3T("disclaimer", p.lang)} <button type="button" onClick={e => { e.currentTarget.focus(); setInfoOpen(true); }} className="inline-flex min-h-11 items-center underline">{r3T("more", p.lang)}</button></p>
          {status.nearLimit && <p className="shrink-0 font-semibold tabular-nums" role={status.over ? "alert" : undefined}>{status.over ? mentorT("composer_too_long", p.lang) : mentorT("composer_counter", p.lang, { n: status.count, max: MENTOR_MESSAGE_MAX_CHARS })}</p>}
        </div>
        <Dialog open={languageOpen} onOpenChange={setLanguageOpen} title={mentorT("lang_label", p.lang)}><div data-mentor-sheet className="flex flex-col">{MENTOR_ANSWER_LANGS.map(l => <button type="button" key={l} aria-pressed={p.answerLang === l} className="min-h-11 text-start" onClick={() => { p.onAnswerLang(l === "ar" ? "en" : l); setLanguageOpen(false); }}>{answerLangLabel(l)}{l === "ar" ? " (Beta)" : ""}</button>)}</div></Dialog>
        <Dialog open={infoOpen} onOpenChange={setInfoOpen} title={r3T("more", p.lang)}><div data-mentor-sheet className="space-y-3 text-[13px] text-[var(--mp-fg)]">{(["uses","never","report","data"] as const).map(k => <p key={k}>{r3T(k, p.lang)}</p>)}</div></Dialog>

      </div>
    </div>
  );
}
