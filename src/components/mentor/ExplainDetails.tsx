"use client";
import { useId, useState } from "react";
import { BookOpen } from "lucide-react";
import type { MentorAnswerBlock } from "@/lib/mentor/contract";
import type { MentorUiLang } from "@/lib/i18n-mentor";
import { AnswerText } from "./answer-display";
import { r3ExplainCopy } from "./r3-explain-copy";

export function ExplainBlocks({ blocks, lang, hint = false }: { blocks: MentorAnswerBlock[]; lang: MentorUiLang; hint?: boolean }) {
 const [expanded, setExpanded] = useState(false); const id = useId();
 const options = blocks.filter(b => b.explain_layer === "options");
 const render = (block: MentorAnswerBlock, i: number) => <div key={i} className={block.explain_layer === "background" ? "border-s-2 border-[var(--mp-fg-muted)] ps-3" : ""} data-explain-layer={block.explain_layer ?? "grounded"}>
  {!hint && <p className="mb-1 text-[12px] font-semibold text-[var(--mp-fg-muted)]">{r3ExplainCopy(block.explain_layer === "background" ? "background" : "grounded", lang)}</p>}
  <AnswerText text={block.text} rtl={lang === "ar"} />
 </div>;
 return <div className="space-y-2.5">{blocks.filter(b => b.explain_layer !== "options").map(render)}{options.length > 0 && <><button type="button" className="mp-btn mp-btn--secondary min-h-11 whitespace-normal text-start" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(v => !v)}>{r3ExplainCopy("options",lang)}</button><div id={id} hidden={!expanded} className="space-y-2.5">{options.map(render)}</div></>}</div>;
}
export function ProvenanceChip({ lang, questionId, study }: { lang: MentorUiLang; questionId?: number; study?: boolean }) {
 if (!questionId && !study) return null;
 return <div data-mentor-provenance className="mt-3 flex min-h-11 items-center gap-2 rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] px-2.5 py-1.5 text-[12.5px] text-[var(--mp-fg)]"><BookOpen aria-hidden className="h-4 w-4 shrink-0"/><span>{r3ExplainCopy(questionId ? "question" : "progress",lang,{n:questionId ?? ""})}</span></div>;
}
export function HintActions({ lang, hintsUsed, creditCost, onAction }: { lang: MentorUiLang; hintsUsed: 1|2; creditCost: number; onAction: (action:"hint"|"solution")=>void }) {
 const button = (action:"hint"|"solution",disabled = false) => <button type="button" disabled={disabled} className="mp-btn mp-btn--secondary min-h-11 flex-1 flex-col items-start whitespace-normal text-start disabled:opacity-50" onClick={()=>onAction(action)}><span>{r3ExplainCopy(action === "hint" ? "hint" : "solution",lang)}</span><span className="text-[12px] font-normal">{r3ExplainCopy("cost",lang,{n:creditCost})}</span></button>;
 return <div data-mentor-hint-actions className="mt-3 flex gap-2">{button("hint", hintsUsed >= 2)}{button("solution")}</div>;
}
