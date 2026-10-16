"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, Clock3, ExternalLink, Info } from "lucide-react";
import type { MentorAnswerBlock, MentorCitation, MentorNextAction, MentorPlanItem } from "@/lib/mentor/contract";
import type { MentorUiLang } from "@/lib/i18n-mentor";
import { mentorT } from "@/lib/i18n-mentor";
import { actionHref } from "@/lib/mentor/actions";
import { trackEvent } from "@/lib/tracker";
import { trackMentor } from "./telemetry";
import { AnswerText } from "./answer-display";
import { r2AnswerCopy } from "./r2-answer-copy";
import { safeExternalUrl } from "./view-model";
import ExamDateAction from "./ExamDateAction";
import { answerCopy } from "./answer-copy";
import { isOlderSource, isReplacedBlock, orderedActions, sourceDate, sourceHintStorageKey, withoutInlineSourceStamp } from "./answer-view";

/** One number per URL/read date, including aliases belonging to the same source. */
export function groupCitations(citations: MentorCitation[]) {
  const groups: Array<{ citation: MentorCitation; factIds: string[] }> = [];
  for (const citation of citations) {
    const previous = groups.find(g => g.citation.source_url === citation.source_url && g.citation.read_on === citation.read_on);
    if (previous) { previous.factIds.push(citation.fact_id); if (publisherRank(citation.source_label) > publisherRank(previous.citation.source_label)) previous.citation = citation; }
    else groups.push({ citation, factIds: [citation.fact_id] });
  }
  return groups.sort((a,b) => publisherRank(b.citation.source_label) - publisherRank(a.citation.source_label));
}
function publisherRank(label: string) { return /^(?:Medizinische Universität|MedUni|Universität|Österreichische Ärztekammer|Austrian Medical Chamber)/iu.test(label) ? 1 : 0; }
export function citationIndex(citations: MentorCitation[]): Map<string, number> {
  const index = new Map<string, number>();
  groupCitations(citations).forEach((group,i) => group.factIds.forEach(id => index.set(id,i+1)));
  return index;
}
function recordAction(action: MentorNextAction, lang: MentorUiLang, mode: import("@/lib/mentor/contract").MentorMode = "study") {
  trackMentor("mentor_next_step_click", { entry: "mentor", lang, kind: action.kind, mode });
}

export function SourceChips({ citations, lang, learnerId = "", now = new Date(), highlightedFact, suppressOlderFooter = false }: { citations: MentorCitation[]; lang: MentorUiLang; learnerId?: string; now?: Date; highlightedFact?: string | null; suppressOlderFooter?: boolean }) {
  const index = citationIndex(citations);
  const groups = groupCitations(citations);
  const unique = groups.map(g => g.citation);
  const [expanded, setExpanded] = useState(false);
  const [narrow, setNarrow] = useState(true);
  const sourceListId = useId();
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => { const query = window.matchMedia("(max-width: 399px)"); const update = () => setNarrow(query.matches); update(); query.addEventListener("change", update); return () => query.removeEventListener("change", update); }, []);
  useEffect(() => { if (highlightedFact) { setExpanded(true); requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-source-number="${citationIndex(citations).get(highlightedFact)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" })); } }, [highlightedFact, citations]);
  const cap = narrow ? 2 : 3;
  const [openFact, setOpenFact] = useState<string | null>(null);
  const opener = useRef<HTMLAnchorElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const shownFor = useRef(new Set<string>());
  const popoverId = useId();
  const storageKey = sourceHintStorageKey(learnerId);
  const close = useCallback(() => { setOpenFact(null); requestAnimationFrame(() => opener.current?.focus()); }, []);
  useEffect(() => {
    if (!openFact) return;
    closeButton.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popover.current?.contains(event.target) && !opener.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [openFact, close]);
  if (unique.length === 0) return null;
  const openSource = (event: React.MouseEvent<HTMLAnchorElement>, citation: MentorCitation) => {
    if (storageKey && !shownFor.current.has(storageKey)) {
      let seen = false;
      try { seen = localStorage.getItem(storageKey) === "1"; } catch { /* The per-learner in-memory fallback still works. */ }
      shownFor.current.add(storageKey);
      if (!seen) {
        event.preventDefault();
        opener.current = event.currentTarget;
        try { localStorage.setItem(storageKey, "1"); } catch { /* No auth or answer data is stored. */ }
        setOpenFact(citation.fact_id);
        return;
      }
    }
    trackEvent("feature_use", { feature: "mentor_source_open" });
  };
  return (
    <div className="mt-3 border-t border-[var(--mp-border)] pt-2.5">
      <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)]">{mentorT("sources_label", lang)}</p>
      <ul ref={list} id={sourceListId} className="flex flex-col gap-1.5">
        {unique.map((citation, sourceIndex) => {
          const href = safeExternalUrl(citation.source_url);
          const date = sourceDate(citation.read_on, lang);
          const older = isOlderSource(citation, now);
          const open = openFact === citation.fact_id;
          const inner = <>
            <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-[var(--mp-viridian)]/12 px-1 text-[11px] font-bold text-[var(--mp-viridian)]">{index.get(citation.fact_id)}</span>
            <span className="min-w-0 flex-1">
              <span dir="auto" className="line-clamp-2 block break-words text-[12.5px] font-medium text-[var(--mp-fg)]">{citation.source_label}</span>
              {date && <span className={`block whitespace-normal break-words text-[12px] ${older ? "text-[var(--mp-warning-text)]" : "text-[var(--mp-fg-muted)]"}`}>{answerCopy("source_checked", lang, { date })}</span>}
              {older && <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium text-[var(--mp-warning-text)]"><Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />{answerCopy("older", lang)}</span>}
            </span>
            {href && <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--mp-fg-subtle)] rtl:-scale-x-100" aria-hidden />}
          </>;
          const className = "flex min-h-11 items-center gap-2 rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] px-2.5 py-1.5 transition-colors hover:border-[var(--mp-viridian)]/40";
          return <li key={citation.fact_id} data-source-number={sourceIndex + 1} hidden={!expanded && sourceIndex >= cap} className={`relative ${highlightedFact && groups[sourceIndex].factIds.includes(highlightedFact) ? "rounded-lg ring-2 ring-[var(--mp-viridian)]" : ""}`}>
            {href ? <a href={href} target="_blank" rel="noopener noreferrer" className={className} aria-label={`${citation.source_label}. ${date ? answerCopy("source_checked", lang, { date }) : ""}. ${mentorT("source_open", lang)}`} aria-haspopup={storageKey ? "dialog" : undefined} aria-expanded={open} aria-controls={open ? popoverId : undefined} onClick={(event) => openSource(event, citation)}>{inner}</a> : <div className={className}>{inner}</div>}
            {open && <div ref={popover} id={popoverId} role="dialog" aria-label={answerCopy("source_hint_title", lang)} className="relative z-10 mt-1 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-3 shadow-[var(--shadow-card)]" onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); close(); }
              if (event.key === "Tab") {
                const targets = [...(popover.current?.querySelectorAll<HTMLElement>("a,button") ?? [])];
                const first = targets[0], last = targets.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
              }
            }}>
              <p className="text-[13px] leading-relaxed text-[var(--mp-fg)]">{answerCopy("source_hint", lang)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {href && <a href={href} target="_blank" rel="noopener noreferrer" className="mp-btn mp-btn--secondary min-h-11 whitespace-normal text-start" onClick={() => trackEvent("feature_use", { feature: "mentor_source_open" })}>{answerCopy("official_open", lang)}</a>}
                <button ref={closeButton} type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={close}>{answerCopy("close", lang)}</button>
              </div>
            </div>}
          </li>;
        })}
      </ul>
      {unique.length > cap && <button type="button" aria-expanded={expanded} aria-controls={sourceListId} onClick={() => setExpanded(v => !v)} className="mp-btn mp-btn--secondary mt-2 min-h-11 w-full whitespace-normal">{r2AnswerCopy("all_sources", lang, { n: unique.length })}</button>}
      {!suppressOlderFooter && unique.some((citation) => isOlderSource(citation, now)) && <p className="mt-2 text-[12px] leading-relaxed text-[var(--mp-warning-text)]">{answerCopy("older_footer", lang)}</p>}
    </div>
  );
}

export function NotConfirmed({ block, lang }: { block: MentorAnswerBlock; lang: MentorUiLang }) {
  const href = safeExternalUrl(block.official_url ?? block.text.match(/https:\/\/[^\s)]+/)?.[0]);
  const cleaned = block.text.replace(/https?:\/\/[^\s)]+/g, "").trim();
  const sentence = cleaned.match(/^[^.!?]+[.!?]?/)?.[0]?.trim() || answerCopy("not_confirmed_body", lang);
  return <div role="status" className="rounded-xl border border-[var(--mp-border)] bg-[var(--mp-info-bg)] p-3 text-[var(--mp-info-text)]">
    <p className="flex items-center gap-2 text-[13px] font-semibold"><Info className="h-4 w-4 shrink-0" aria-hidden />{answerCopy("not_confirmed", lang)}</p>
    <p dir="auto" className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed">{sentence}</p>
    {href && <a href={href} target="_blank" rel="noopener noreferrer" className="mp-btn mp-btn--secondary mt-2 min-h-11 w-full whitespace-normal text-start sm:w-auto">{answerCopy("official_open", lang)}<ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden /></a>}
  </div>;
}

export function AnswerBlocks({ blocks, citations, lang, onCitation }: { blocks: MentorAnswerBlock[]; citations: MentorCitation[]; lang: MentorUiLang; onCitation?: (fact: string) => void }) {
  const index = citationIndex(citations);
  const groups = groupCitations(citations);
  return <div className="space-y-2.5">{blocks.map((block, i) => {
    if (isReplacedBlock(block)) return <NotConfirmed key={i} block={block} lang={lang} />;
    // One source: the Sources row right below is unambiguous, so no inline markers.
    const nums = groups.length < 2 ? [] : [...new Set(block.fact_ids.map((fact) => index.get(fact)).filter((n): n is number => n !== undefined))].sort((a, b) => a - b);
    // One marker per block; several sources in one block share it (adjacent 44px hit areas would overlap).
    // A tap highlights the first and opens the full Sources list.
    const first = nums.length > 0 ? groups[nums[0] - 1].citation : null;
    const markers = first ? <button type="button" data-mentor-citation-marker aria-label={r2AnswerCopy("source", lang, { n: nums.join(", "), label: nums.map((n) => groups[n - 1].citation.source_label).join("; ") })} onClick={() => onCitation?.(first.fact_id)} className="mp-hit relative ms-0.5 inline-flex h-4 min-w-4 -translate-y-1.5 items-center justify-center rounded bg-[var(--mp-viridian)]/10 px-1 align-baseline text-[10px] font-semibold leading-none text-[var(--mp-viridian)]">{nums.join(",")}</button> : undefined;
    return <div key={i}><AnswerText text={citations.length > 0 ? withoutInlineSourceStamp(block.text) : block.text} confirmedDates={block.confirmed_dates} trailing={markers} /></div>;
  })}</div>;
}

const ACTION_LINK = "inline-flex min-h-11 min-w-11 items-center gap-1.5 whitespace-normal text-start text-[13px] font-semibold text-[var(--mp-cta-blue)] hover:underline";
const DATE_KINDS = new Set<MentorNextAction["kind"]>(["open_exam_dates", "set_exam_date", "deadline_reminder"]);

/**
 * One quiet footer row under an answer: up to two next actions as text links
 * (the rest behind More), and `trailing` (cost line, report flag) at the end.
 */
export function NextActions({ actions, lang, mode = "facts", trailing }: { actions: MentorNextAction[]; lang: MentorUiLang; requestId?: string; mode?: import("@/lib/mentor/contract").MentorMode; trailing?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const valid = orderedActions(actions).filter((action) => actionHref(action, lang));
  const label = (action: MentorNextAction) => <>{DATE_KINDS.has(action.kind) && <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />}{answerCopy(action.kind, lang)}</>;
  const link = (action: MentorNextAction, i: number) => action.kind === "deadline_reminder" || action.kind === "set_exam_date" && action.exam_date ? <ExamDateAction key={`${action.kind}:${i}`} action={action} lang={lang} className={ACTION_LINK} icon={<CalendarDays className="h-4 w-4 shrink-0" aria-hidden />} onClick={() => recordAction(action,lang,mode)} /> : <Link key={`${action.kind}:${i}`} href={actionHref(action, lang)!} onClick={() => recordAction(action, lang, mode)} className={ACTION_LINK}>{label(action)}</Link>;
  if (valid.length === 0 && !trailing) return null;
  return <div className="mt-2" data-mentor-answer-footer>
    <div className="flex flex-wrap items-center gap-x-3 text-[12px] text-[var(--mp-fg-muted)]">
      {valid.length > 0 && <div data-mentor-next-actions className="flex flex-wrap items-center gap-x-3">{valid.slice(0, 2).map(link)}{valid.length > 2 && <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((value) => !value)} className={ACTION_LINK}>{answerCopy("more", lang)}</button>}</div>}
      {trailing && <div className="ms-auto flex items-center gap-x-1">{trailing}</div>}
    </div>
    {valid.length > 2 && <div id={id} hidden={!expanded} className={`mt-1 flex-wrap gap-x-3 ${expanded ? "flex" : "hidden"}`}>{valid.slice(2).map(link)}</div>}
  </div>;
}

export function StudyPlanRows({ items, lang }: { items: MentorPlanItem[]; lang: MentorUiLang; requestId?: string }) {
  if (items.length === 0) return null;
  return <ul className="mt-3 space-y-2">{items.map((item, i) => {
    const accuracy = Math.round(Math.max(0, Math.min(100, item.accuracy)));
    const action: MentorNextAction = { kind: item.action === "review_mistakes" ? "open_mistakes" : item.action === "flashcards" ? "open_flashcards" : "practice_topic", topic: item.topic, ...(item.exam_source ? { exam_source: item.exam_source } : {}) };
    const href = actionHref(action);
    return <li key={`${item.topic}:${i}`} data-mentor-plan-row className="flex min-h-14 items-center gap-3 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-2.5">
      <div className="min-w-0 flex-1">
        <p dir="auto" className="break-words text-[13px] font-semibold text-[var(--mp-fg)]">{item.topic}</p>
        <p className="mt-0.5 text-[12px] text-[var(--mp-fg-muted)]">{answerCopy("accuracy", lang, { n: accuracy })} · {answerCopy("answered", lang, { n: item.answered })}</p>
        <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--mp-border)]"><div className="h-full rounded-full bg-[var(--mp-viridian)]" style={{ width: `${accuracy}%` }} /></div>
      </div>
      {href && <Link href={href} onClick={() => recordAction(action, lang)} className="mp-btn mp-btn--secondary min-h-11 min-w-11 shrink-0 whitespace-normal text-[13px]">{answerCopy("practice", lang)}</Link>}
    </li>;
  })}</ul>;
}

export type FilingUniversity = "wien" | "graz" | "innsbruck";
const UNIVERSITIES: Record<FilingUniversity, string> = { wien: "Wien", graz: "Graz", innsbruck: "Innsbruck" };
export function FilingUniversityChoice({ lang, onChoose }: { lang: MentorUiLang; onChoose?: (university: FilingUniversity) => void }) {
  const [selected, setSelected] = useState<FilingUniversity | null>(null);
  return <div className="mt-3 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-3">
    <p className="text-[13px] text-[var(--mp-fg)]">{selected ? answerCopy("filing_selected", lang, { university: UNIVERSITIES[selected] }) : answerCopy("filing_question", lang)}</p>
    {selected ? <button type="button" onClick={() => setSelected(null)} className="mt-1 min-h-11 text-[13px] font-semibold text-[var(--mp-cta-blue)]">{answerCopy("filing_change", lang)}</button> : <div className="mt-2 flex flex-wrap gap-2">{(Object.keys(UNIVERSITIES) as FilingUniversity[]).map((university) => <button key={university} type="button" onClick={() => { setSelected(university); onChoose?.(university); }} className="mp-btn mp-btn--secondary min-h-11 whitespace-normal">{UNIVERSITIES[university]}</button>)}</div>}
  </div>;
}
