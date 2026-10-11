'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Flag } from 'lucide-react';
import ReportQuestionModal from '@/components/ReportQuestionModal';
import type { MentorUiLang } from '@/lib/i18n-mentor';
import { loadMentorApi } from './client';
import type { MentorReportedQuestion } from './api';

const COPY = {
 de:{question:'Frage',report:'Frage melden',back:'Zur Frage zurück',detach:'Neue Frage besprechen',loading:'Frage wird geladen'},
 en:{question:'Question',report:'Report question',back:'Back to question',detach:'Discuss a new question',loading:'Loading question'},
 ru:{question:'Вопрос',report:'Сообщить об ошибке в вопросе',back:'Вернуться к вопросу',detach:'Обсудить новый вопрос',loading:'Загрузка вопроса'},
 uk:{question:'Питання',report:'Повідомити про помилку в питанні',back:'Повернутися до питання',detach:'Обговорити нове питання',loading:'Завантаження питання'},
 tr:{question:'Soru',report:'Soruyu bildir',back:'Soruya dön',detach:'Yeni bir soruyu konuş',loading:'Soru yükleniyor'},
};
export const AR_QUESTION_DRAFT = {status:'needs [name] sign-off',question:'السؤال',report:'بلّغ عن السؤال',back:'ارجع للسؤال',detach:'نتكلم عن سؤال جديد',loading:'بنحمّل السؤال'};
/** Report control only. Displayed option order and unanswered-key guard belong to MUX-58/60. */
export default function QuestionContextCard({questionId,lang,onDetach}:{questionId:number;lang:MentorUiLang;onDetach?:()=>void}) {
 const router=useRouter();
 const c=COPY[lang as keyof typeof COPY] ?? COPY.en;
 const [question,setQuestion]=useState<MentorReportedQuestion|null>(null);
 const [expanded,setExpanded]=useState(false);
 const [reportOpen,setReportOpen]=useState(false);
 useEffect(()=>{let live=true;const ctrl=new AbortController();setQuestion(null);void loadMentorApi().then(api=>api.question(questionId,ctrl.signal)).then(r=>{if(live&&r.ok)setQuestion(r.question);});return()=>{live=false;ctrl.abort();};},[questionId]);
 return <section className="shrink-0 border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 text-[13px]" aria-label={`${c.question} ${questionId}`}>
  <div className="mx-auto max-w-3xl">
   <button type="button" onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded} className="flex min-h-11 w-full items-center justify-between gap-2 text-start">
    <span dir="auto">{c.question} {questionId}{question?.topic ? ` · ${question.topic}`:''}</span><ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
   </button>
   {expanded && <p dir="auto" className="whitespace-pre-wrap break-words pb-2">{question?.question ?? c.loading}</p>}
   <div className="flex flex-wrap gap-x-3">
    <button type="button" className="min-h-11 text-start text-[var(--mp-cta-blue)]" onClick={()=>window.history.length>1?router.back():router.push('/quiz')}>{c.back}</button>
    <button type="button" disabled={!question} onClick={()=>setReportOpen(true)} className="inline-flex min-h-11 items-center gap-1 text-start text-[var(--mp-cta-blue)] disabled:opacity-50"><Flag className="h-4 w-4" aria-hidden />{c.report}</button>
    {onDetach&&<button type="button" onClick={onDetach} className="min-h-11 text-start text-[var(--mp-fg-muted)]">{c.detach}</button>}
   </div>
  </div>
  {question&&<ReportQuestionModal open={reportOpen} onClose={()=>setReportOpen(false)} lang={lang==='de'?'de':'en'} questionId={question.id} questionText={question.question} explanation={question.explanation} topic={question.topic}/>}
 </section>;
}
