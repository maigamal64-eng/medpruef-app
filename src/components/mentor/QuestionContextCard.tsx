'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Flag } from 'lucide-react';
import ReportQuestionModal from '@/components/ReportQuestionModal';
import type { MentorUiLang } from '@/lib/i18n-mentor';
import { loadMentorApi } from './client';
import type { MentorReportedQuestion } from './api';
import { a39T } from './a39-copy';

const COPY = {
 de:{report:'Frage melden'},
 en:{report:'Report question'},
 ru:{report:'Сообщить об ошибке в вопросе'},
 uk:{report:'Повідомити про помилку в питанні'},
 tr:{report:'Soruyu bildir'},
};
export const AR_QUESTION_DRAFT = {status:'needs [name] sign-off',question:'السؤال',report:'بلّغ عن السؤال',back:'ارجع للسؤال',detach:'نتكلم عن سؤال جديد',loading:'بنحمّل السؤال'};

/** The learner's own choices (one or several option texts joined with "; "). */
export function chosenTexts(selected: string | undefined): Set<string> {
 return new Set((selected ?? '').split(';').map(t => t.trim()).filter(Boolean));
}

/**
 * MUX-58: the question being explained stays pinned above the thread. It
 * collapses to one 44px line; expanded it shows the stem and the options.
 * The learner's choice and the key appear only when the question was
 * answered (no spoiler in the unanswered hint flow, MUX-60).
 */
/** True only when the learner's choice is known and differs from the key. */
export function choiceWasWrong(q: MentorReportedQuestion | null, selected: string | undefined): boolean {
 const chosen=chosenTexts(selected);
 const opts=q?.options ?? [];
 if(!chosen.size||!opts.length)return false;
 const key=new Set(opts.filter(o=>o.correct).map(o=>o.text.trim()));
 return key.size>0&&(key.size!==chosen.size||[...chosen].some(t=>!key.has(t)));
}

export default function QuestionContextCard({questionId,lang,answered=false,selectedOptionText,onDetach,onQuestion}:{questionId:number;lang:MentorUiLang;answered?:boolean;selectedOptionText?:string;onDetach?:()=>void;onQuestion?:(q:MentorReportedQuestion|null)=>void}) {
 const router=useRouter();
 const c=COPY[lang as keyof typeof COPY] ?? COPY.en;
 const [question,setQuestion]=useState<MentorReportedQuestion|null>(null);
 const [failed,setFailed]=useState(false);
 const [expanded,setExpanded]=useState(false);
 const [reportOpen,setReportOpen]=useState(false);
 useEffect(()=>{let live=true;const ctrl=new AbortController();setQuestion(null);setFailed(false);void loadMentorApi().then(api=>api.question(questionId,ctrl.signal)).then(r=>{if(!live)return;if(r.ok){setQuestion(r.question);onQuestion?.(r.question);}else setFailed(true);});return()=>{live=false;ctrl.abort();};// eslint-disable-next-line react-hooks/exhaustive-deps -- onQuestion is a notification, not an input
 },[questionId]);
 const head=question?.topic?a39T('question_head',lang,{n:questionId,topic:question.topic}):a39T('question_head_plain',lang,{n:questionId});
 const chosen=chosenTexts(selectedOptionText);
 const options=question?.options ?? [];
 return <section data-mentor-question-card className="shrink-0 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 text-[13px]" aria-label={head}>
  <button type="button" onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded} aria-controls={`mentor-question-${questionId}`} className="flex min-h-11 w-full items-center justify-between gap-2 text-start font-semibold text-[var(--mp-fg)]">
   <span dir="auto" className="min-w-0 truncate">{head}</span><span className="flex shrink-0 items-center gap-1 text-[12px] font-normal text-[var(--mp-fg-muted)]">{a39T(expanded?'show_less':'show_more',lang)}<ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${expanded?'rotate-180':''}`} aria-hidden /></span>
  </button>
  {expanded && <div id={`mentor-question-${questionId}`} className="pb-2">
   {question ? <>
    <p lang="de" dir="ltr" className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[var(--mp-fg)]">{question.question}</p>
    {options.length>0 && <ul className="mt-2 space-y-1.5" lang="de" dir="ltr">
     {options.map((o,i)=>{const mine=answered&&chosen.has(o.text.trim());const key=answered&&o.correct;return <li key={i} className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${key?'border-[var(--mp-viridian)]/50 bg-[var(--mp-success-bg)]':mine?'border-[var(--mp-error)]/40 bg-[var(--mp-error-bg)]':'border-[var(--mp-border)]'}`}>
      <span className="min-w-0 flex-1 break-words">{o.text}</span>
      {(mine||key)&&<span className="flex shrink-0 flex-col items-end gap-0.5 text-[12px] font-semibold">{mine&&<span>{a39T('your_choice',lang)}</span>}{key&&<span className="inline-flex items-center gap-1 text-[var(--mp-viridian)]"><Check className="h-3.5 w-3.5" aria-hidden />{a39T('key',lang)}</span>}</span>}
     </li>;})}
    </ul>}
   </> : <p role="status" className="py-1 text-[var(--mp-fg-muted)]">{failed?a39T('question_unavailable',lang):a39T('question_loading',lang)}</p>}
  </div>}
  <div className="flex flex-wrap gap-x-3">
   <button type="button" className="min-h-11 text-start text-[var(--mp-cta-blue)]" onClick={()=>window.history.length>1?router.back():router.push('/quiz')}>{a39T('back_to_question',lang)}</button>
   <button type="button" disabled={!question} onClick={()=>setReportOpen(true)} className="inline-flex min-h-11 items-center gap-1 text-start text-[var(--mp-cta-blue)] disabled:opacity-50"><Flag className="h-4 w-4" aria-hidden />{c.report}</button>
   {onDetach&&<button type="button" onClick={onDetach} className="min-h-11 text-start text-[var(--mp-fg-muted)]">{a39T('new_question',lang)}</button>}
  </div>
  {question&&<ReportQuestionModal open={reportOpen} onClose={()=>setReportOpen(false)} lang={lang==='de'?'de':'en'} questionId={question.id} questionText={question.question} explanation={question.explanation} topic={question.topic}/>}
 </section>;
}
