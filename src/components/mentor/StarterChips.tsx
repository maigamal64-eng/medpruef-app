"use client";
import Link from "next/link";
import { MessageCircle, BookOpen, Lightbulb } from "lucide-react";
import { mentorT, type MentorKey, type MentorUiLang } from "@/lib/i18n-mentor";
import type { MentorMode } from "@/lib/mentor/contract";
export const STARTER_KEYS: Record<MentorMode, MentorKey[]> = {
  facts: ["starter_facts_1", "starter_facts_2", "starter_facts_3"],
  study: ["starter_study_1", "starter_study_2"],
  explain: ["starter_explain_1"],
};
/** Shared starter choices. Checkout routes to the canonical bounded mentor prefill. */
export default function StarterChips({ lang, mode, onPick }: { lang: MentorUiLang; mode: MentorMode; onPick?: (key: MentorKey) => void }) {
  const Icon = mode === "facts" ? MessageCircle : mode === "study" ? BookOpen : Lightbulb;
  const classes = "flex min-h-11 w-full items-start gap-2.5 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3.5 py-2.5 text-start text-[13.5px] leading-snug text-[var(--mp-fg)] shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--mp-viridian)]/40 hover:bg-[var(--mp-surface-sunken)]";
  return <ul className="flex w-full max-w-md flex-col gap-2">{STARTER_KEYS[mode].map(key => {
    const text = mentorT(key, lang);
    const content = <><Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mp-viridian)]" aria-hidden /><span dir="auto" className="line-clamp-2">{text}</span></>;
    return <li key={key}>{onPick ? <button type="button" onClick={() => onPick(key)} className={classes}>{content}</button> : <Link className={classes} href={`/mentor?${new URLSearchParams({ q: text.slice(0, 200), mode, from: "pricing" })}`}>{content}</Link>}</li>;
  })}</ul>;
}
