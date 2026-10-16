"use client";

import { useRef, useState } from "react";
import { ExternalLink, Info, RotateCcw, Flag } from "lucide-react";
import { mentorT, type MentorUiLang } from "@/lib/i18n-mentor";
import type { AssistantMsg, UserMsg } from "./chat-state";
import ErrorNotice from "./ErrorNotice";
import { r3T } from "./r3-copy";
import { a38T, admissionGapText } from "./a38-copy";
import { errorView, formatCreditBalance, safeExternalUrl } from "./view-model";
import ReportQuestionModal from "@/components/ReportQuestionModal";
import ReportAnswerSheet from "./ReportAnswerSheet";
import { loadMentorApi } from "./client";
import type { MentorReportReason, MentorReportedQuestion } from "./api";
import { AnswerBlocks, FilingUniversityChoice, NextActions, SourceChips, StudyPlanRows, type FilingUniversity } from "./AnswerDetails";
import { answerCopy } from "./answer-copy";
import MentorAvatar from "./MentorAvatar";
import { r2AnswerCopy } from "./r2-answer-copy";
import { trackMentor } from "./telemetry";
import { AnswerText } from "./answer-display";
import { ExplainBlocks, HintActions, ProvenanceChip } from "./ExplainDetails";
import { r3ExplainCopy } from "./r3-explain-copy";
import { isOlderSource, visibleAnswer } from "./answer-view";
import SaveExplanation from "./SaveExplanation";
export { citationIndex } from "./AnswerDetails";

/** Fixed, reviewed safety copy; hotline numbers are links, never model claims. */
export function PatientAdvice({ lang }: { lang: MentorUiLang }) {
  const line = mentorT("refusal_patient_advice", lang);
  return (
    <div className="mt-3 flex gap-2.5 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-3">
      <Info className="mt-3 h-4 w-4 shrink-0 text-[var(--mp-info)]" aria-hidden />
      <p dir="auto" className="text-[13px] leading-relaxed text-[var(--mp-fg)]">
        {line.split(/(1450|144)/).map((part, i) => part === "1450" || part === "144" ? (
          <bdi dir="ltr" key={i}><a href={`tel:${part}`} className="inline-flex min-h-11 min-w-11 items-center justify-center font-semibold text-[var(--mp-cta-blue)] underline">{part}</a></bdi>
        ) : part)}
      </p>
    </div>
  );
}

export function UserBubble({ msg, lang = "en" }: { msg: UserMsg; lang?: MentorUiLang }) {
  return (
    <article className="flex justify-end">
      <span className="sr-only">{answerCopy("you", lang)}</span>
      <p
        dir="auto"
        className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-[var(--mp-oxford-blue)] px-4 py-2.5 text-[14.5px] leading-relaxed text-white shadow-[var(--shadow-xs)] sm:max-w-[75%]"
      >
        {msg.text}
      </p>
    </article>
  );
}

function Refusal({ reason, link, office, lang, onSuggestedQuestion }: { reason: NonNullable<AssistantMsg["final"]>["refused"]; link?: string; office?: string; lang: MentorUiLang; onSuggestedQuestion?: (text: string) => void }) {
  if (!reason) return null;
  if (reason === "patient_advice") return <PatientAdvice lang={lang} />;
  const href = safeExternalUrl(link);
  return (
    <div className="mt-3 flex gap-2.5 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-3">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mp-info)]" aria-hidden />
      <div className="min-w-0">

        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mp-btn mp-btn--secondary mt-2 min-h-11 w-full whitespace-normal break-words text-start sm:w-auto"
          >
            {office ? answerCopy("office_open", lang, { office }) : mentorT("refusal_link", lang)}
            <ExternalLink className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
          </a>
        )}
        {onSuggestedQuestion && <button type="button" onClick={() => onSuggestedQuestion(r2AnswerCopy("neighbour", lang))} className="mt-1 block min-h-11 text-start text-[13px] text-[var(--mp-fg)] underline">{r2AnswerCopy("neighbour", lang)}</button>}
      </div>
    </div>
  );
}

export function TypingDots({ label }: { label: string }) {
  return (
    <span aria-hidden="true" title={label} className="inline-flex items-center gap-1 py-1.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-[var(--mp-fg-subtle)] motion-safe:animate-bounce"
          style={{ animationDelay: `${i * 140}ms` }}
        />
      ))}
    </span>
  );
}

export function AssistantBubble({
  msg,
  lang,
  packagesHref,
  waitSeconds,
  onRetry,
  onRetryNotice,
  onNewChat,
  onRephrase,
  learnerId,
  onSuggestedQuestion,
  onChooseUniversity,
  onExplainAction,
}: {
  msg: AssistantMsg;
  lang: MentorUiLang;
  packagesHref: string | null;
  waitSeconds: number;
  onRetry: () => void;
  onRetryNotice?: () => void;
  onNewChat: () => void;
  onRephrase?: () => void;
  learnerId?: string;
  onSuggestedQuestion?: (text: string) => void;
  onChooseUniversity?: (university: FilingUniversity) => void;
  onExplainAction?: (action: "hint"|"solution") => void;
}) {
  const f = msg.final;
  const [highlightedFact, setHighlightedFact] = useState<string | null>(null);
  const visible = f ? visibleAnswer(f.answer_blocks, f.citations) : null;
  const blocks = visible && visible.blocks.length > 0 ? visible.blocks : null;
  const [reportOpen, setReportOpen] = useState(false);
  const [reportInitialReason, setReportInitialReason] = useState<MentorReportReason>();
  const [reportNotice, setReportNotice] = useState<"saved" | "question_unavailable" | null>(null);
  const [reportedQuestion, setReportedQuestion] = useState<MentorReportedQuestion | null>(null);
  const reportButton = useRef<HTMLButtonElement>(null);
  const questionButton = useRef<HTMLButtonElement>(null);
  const questionReturnTarget = useRef<HTMLButtonElement | null>(null);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const openQuestionReport = async () => {
    if (!f?.question_id || questionLoading) return;
    questionReturnTarget.current = questionButton.current;
    setQuestionLoading(true);
    const api = await loadMentorApi();
    const result = await api.question(f.question_id);
    setQuestionLoading(false);
    if (result.ok) setReportedQuestion(result.question);
    else setReportNotice("question_unavailable");
  };
  const report = async (reason: MentorReportReason, details: string) => {
    if (!f?.request_id) return false;
    const api = await loadMentorApi();
    const r = await api.report({ request_id: f.request_id, reason, ...(details ? { details } : {}) });
    if (!r.ok) return false;
    setReportNotice("saved");
    trackMentor("mentor_report", { entry: "mentor", lang });
    if (reason === "question_wrong" && f.question_id) {
      const q = await api.question(f.question_id);
      if (q.ok) {
        questionReturnTarget.current = reportButton.current;
        // Let the answer sheet return focus to its report control before the
        // question dialog captures that same return target.
        requestAnimationFrame(() => requestAnimationFrame(() => setReportedQuestion(q.question)));
      }
      else setReportNotice("question_unavailable");
    }
    setReportOpen(false);
    return true;
  };
  const answer = (f?.refused === "patient_advice" ? mentorT("refusal_patient_advice", lang) : blocks?.map((b) => b.text).join(" ") || msg.text).replace(/https?:\/\/[^\s)]+/g, "").trim();

  // MUX-37 A: a hidden answer is still finished and billed by the normal rule.
  // It lands collapsed and says whether it was charged; an error shows as usual.
  if (msg.hidden && !revealed && (msg.status === "streaming" || msg.status === "done")) {
    const done = msg.status === "done";
    return <article data-mentor-hidden-answer className="flex gap-2.5">
      <MentorAvatar lang={lang} />
      <div className="min-w-0 flex-1 rounded-2xl rounded-ss-md border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] px-4 py-3 text-[13px] text-[var(--mp-fg)]">
        <p dir="auto" role="status">{done ? a38T(f?.charged === true ? "stopped_charged" : f?.charged === false ? "stopped_free" : "stopped_ready", lang) : a38T("hidden_waiting", lang)}</p>
        {!done && <p dir="auto" className="mt-1 text-[12px] text-[var(--mp-fg-muted)]">{a38T("hide_hint", lang)}</p>}
        {done && <button type="button" onClick={() => setRevealed(true)} className="mp-btn mp-btn--secondary mt-2 min-h-11">{a38T("view", lang)}</button>}
      </div>
    </article>;
  }
  if (msg.status === "done" && f?.result === "notice") {
    const href = safeExternalUrl(f.answer_blocks.find(b => b.official_url)?.official_url);
    return <article className="rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-4 text-[var(--mp-fg)]" data-mentor-system-notice>
      <p dir="auto" className="text-[14px] leading-relaxed">{r2AnswerCopy("notice", lang)}</p>
      {href && <a href={href} target="_blank" rel="noopener noreferrer" className="mp-btn mp-btn--secondary mt-2 min-h-11">{answerCopy("official_open", lang)}</a>}
      <button type="button" onClick={f.reason === "no_source" ? onRephrase : (onRetryNotice ?? onRetry)} className="mp-btn mp-btn--secondary mt-2 min-h-11">{r2AnswerCopy(f.reason === "no_source" ? "rephrase" : "retry", lang)}</button>
      {/* MUX-38: the server booked this notice to the house (proved on scratch PostgreSQL, a38). */}
      {f.charged === false && <p dir="auto" className="mt-2 text-[12.5px] text-[var(--mp-fg)]">{a38T("not_charged_line", lang)}</p>}
    </article>;
  }
  if (msg.status === "error" && msg.error) {
    if (msg.error === "rate_limited") return null; // The composer owns the single live countdown.
    return <article data-mentor-system-notice>{(msg.error === "credits_required" || msg.error === "credits_exhausted") && <p className="text-[13px] text-[var(--mp-fg)]">{r3T("saved",lang)}</p>}<ErrorNotice view={errorViewFor(msg, lang)} lang={lang} packagesHref={msg.packagesUrl ?? packagesHref} waitSeconds={waitSeconds} onRetry={onRetry} onNewChat={onNewChat} onRephrase={onRephrase} diagnostics={{requestId:msg.requestId,code:msg.error,time:msg.errorAt}} billingLine={errorBillingLine(msg, lang)} /></article>;
  }
  const dateBlocks = blocks?.filter(b => b.confirmed_dates?.length) ?? [];
  const dateFooter = visible?.citations.some(c => isOlderSource(c)) ? "older_footer" : dateBlocks.some(b => b.date_type === "deadline") ? "deadline_footer" : "sitting_footer";
  const costLine = msg.status === "done" && f ? answerCostLine(f.credits_used, f.credits_left, lang) : null;
  return (
    <article className="flex gap-2.5">
      <span className="sr-only">{answerCopy("mentor", lang)}</span>
      <MentorAvatar lang={lang} />
      <div className="min-w-0 max-w-[92%] flex-1 sm:max-w-[80%] sm:flex-none">
        <div className="rounded-2xl rounded-ss-md border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 shadow-[var(--shadow-card)]">
          {msg.status === "streaming" && msg.inProgress && <p className="text-[13px] text-[var(--mp-fg-muted)]">{mentorT("answer_in_progress", lang)}</p>}
          {msg.status === "streaming" && msg.text === "" && !msg.inProgress && <div className="min-h-20"><p className="text-[13px] text-[var(--mp-fg-muted)]">{msg.phase ? r3ExplainCopy(msg.phase === "writing" ? "writing" : "checking",lang) : mentorT("thinking",lang)}</p><div aria-hidden className="mt-2 space-y-2"><div className="h-2 w-full rounded bg-[var(--mp-border)]"/><div className="h-2 w-5/6 rounded bg-[var(--mp-border)]"/><div className="h-2 w-2/3 rounded bg-[var(--mp-border)]"/></div>{msg.slow && <p className="text-[12px] text-[var(--mp-fg-muted)]">{r3ExplainCopy("slow",lang)}</p>}</div>}

          {msg.status === "streaming" && msg.text !== "" && (
            <p dir="auto" className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-[var(--mp-fg)]">
              {msg.text}
              <span aria-hidden className="ms-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-[var(--mp-viridian)] motion-safe:animate-pulse" />
            </p>
          )}

          {msg.status === "done" && f?.refused !== "patient_advice" && (blocks ? f?.question_id ? <ExplainBlocks blocks={blocks} lang={lang} hint={!!f.explain_hint} /> : <AnswerBlocks blocks={blocks} citations={visible?.citations ?? []} lang={lang} onCitation={fact => { setHighlightedFact(null); requestAnimationFrame(() => setHighlightedFact(fact)); }} /> : msg.text && <AnswerText text={msg.text} />)}

          {(msg.status === "error" || msg.status === "stopped") && msg.text !== "" && (
            <p dir="auto" className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-[var(--mp-fg)]">
              {msg.text}
            </p>
          )}

          {msg.status === "done" && f?.refused && <Refusal reason={f.refused} link={f.refusal_link} office={f.refusal_label} lang={lang} onSuggestedQuestion={onSuggestedQuestion} />}

          {msg.status === "done" && f && f.refused !== "patient_advice" && (visible?.citations.length ?? 0) > 0 && <SourceChips citations={visible!.citations} lang={lang} learnerId={learnerId} highlightedFact={highlightedFact} suppressOlderFooter={dateBlocks.length > 0} />}
          {msg.status === "done" && dateBlocks.length > 0 && !f?.refused && <p className="mt-2 text-[12px] leading-relaxed text-[var(--mp-fg)]">{dateFooter === "older_footer" ? answerCopy("older_footer", lang) : r2AnswerCopy(dateFooter, lang)}</p>}
          {msg.status === "done" && f && !f.refused && <ProvenanceChip lang={lang} questionId={f.question_id} study={f.study_answer} />}
          {msg.status === "done" && f?.explain_hint && onExplainAction && <HintActions lang={lang} hintsUsed={f.explain_hint.hints_used} creditCost={f.explain_hint.next_credit_cost} onAction={onExplainAction} />}
          {msg.status === "done" && f?.charged === false && <p className="mt-2 text-[12px] text-[var(--mp-fg-muted)]">{a38T("not_charged_footer", lang)}</p>}
          {msg.status === "done" && f?.study_answer && <div className="mt-2 text-[12px] leading-relaxed text-[var(--mp-fg)]">{f.study_scope && <span className="inline-flex rounded-full border border-[var(--mp-border)] px-2 py-1">{r2AnswerCopy("study_scope", lang, { n: f.study_scope.answered })}</span>}<p className="mt-1">{r2AnswerCopy("study_footer", lang)}</p></div>}
          {msg.status === "done" && f?.needs_filing_university && <FilingUniversityChoice lang={lang} onChoose={onChooseUniversity} />}
          {msg.status === "done" && f?.plan_items && <StudyPlanRows items={f.plan_items} lang={lang} requestId={f.request_id} />}
          {msg.status === "done" && f?.question_id && !f.refused && !f.explain_hint && blocks && blocks.length > 0 && <SaveExplanation blocks={blocks} questionId={f.question_id} lang={lang} />}
          {msg.status === "done" && f && (f.next_actions?.length || costLine || f.request_id) ? <NextActions actions={f.next_actions ?? []} lang={lang} requestId={f.request_id} mode={f.question_id ? "explain" : f.study_answer ? "study" : "facts"} trailing={(costLine || f.request_id) && <>
            {costLine && <span data-mentor-cost-line className="text-[12px] text-[var(--mp-fg-muted)]">{costLine}</span>}
            {f.request_id && <button ref={reportButton} type="button" onClick={(e) => { e.currentTarget.focus(); setReportInitialReason(undefined); setReportOpen(true); }} title={answerCopy("report_title", lang)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)] hover:text-[var(--mp-fg)]" aria-label={mentorT("report_answer_aria", lang, { answer: answer.slice(0, 100) })}>
              <Flag className="h-4 w-4 shrink-0" aria-hidden /><span className="sr-only">{mentorT("report_answer", lang)}</span>
            </button>}
          </>} /> : null}
          {msg.status === "done" && f?.request_id && reportNotice && <p role="status" className="text-[13px] text-[var(--mp-fg-muted)]">{mentorT(reportNotice === "saved" ? "report_success" : "report_question_unavailable", lang)}</p>}
          {msg.status === "done" && f?.refused === "no_verified_source" && (
            <div className="mt-3 space-y-2">
              <button type="button" onClick={(event) => { event.currentTarget.focus(); setReportInitialReason("other"); setReportOpen(true); }} className="mp-btn mp-btn--secondary min-h-11 w-full whitespace-normal text-start">{answerCopy("report_team", lang)}</button>
              {onSuggestedQuestion && <button type="button" onClick={() => onSuggestedQuestion(answerCopy("starter", lang))} className="min-h-11 w-full rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-2.5 text-start text-[13px] text-[var(--mp-fg)]"><span className="block font-semibold">{answerCopy("starter_label", lang)}</span>{answerCopy("starter", lang)}</button>}
            </div>
          )}
          {msg.status === "done" && f?.question_id && (
            <button ref={questionButton} type="button" disabled={questionLoading} aria-busy={questionLoading} onClick={(event) => { event.currentTarget.focus(); void openQuestionReport(); }} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-start text-[13px] font-semibold text-[var(--mp-cta-blue)]"><Flag className="h-3.5 w-3.5 shrink-0" aria-hidden />{answerCopy("report_question", lang)}</button>
          )}

          {msg.status === "stopped" && (
            // Restored from an older session only; the outcome of that turn is unknown here.
            <p className="mt-2 flex items-center gap-2 text-[12.5px] text-[var(--mp-fg-muted)]">
              <span>{r3T("not_arrived", lang)}. {a38T("network_check", lang)}</span>
              <button type="button" onClick={onRetry} className="inline-flex min-h-10 items-center gap-1 font-semibold text-[var(--mp-cta-blue)] hover:underline">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                {mentorT("btn_retry", lang)}
              </button>
            </p>
          )}


        </div>
        <ReportAnswerSheet open={reportOpen} onClose={() => setReportOpen(false)} onSubmit={report} lang={lang} initialReason={reportInitialReason} />
        {reportedQuestion && <ReportQuestionModal open={!!reportedQuestion} onClose={() => { setReportedQuestion(null); requestAnimationFrame(() => questionReturnTarget.current?.focus()); }} lang={lang === "de" ? "de" : "en"} questionId={reportedQuestion.id} questionText={reportedQuestion.question} explanation={reportedQuestion.explanation} topic={reportedQuestion.topic} />}
      </div>
    </article>
  );
}

/**
 * MUX-38 billing line under an error card. "Not charged" only when the server
 * confirmed it (credits_deducted:false); a network failure can never know, so
 * it gets the check-your-balance line instead. Codes whose own sentence already
 * covers the balance (reserve_failed, limits, resting, 402) get no extra line.
 */
export function errorBillingLine(msg: { error?: string; notCharged?: boolean; reason?: string }, lang: MentorUiLang): string | null {
  // The outcome is unknown to the browser: the server may still finish (and bill) the answer.
  if (msg.error === "network" || msg.reason === "answer_timeout") return a38T("network_check", lang);
  if (msg.notCharged && (msg.error === "upstream_error" || msg.error === "unknown" || msg.error === "input_too_large")) return a38T("not_charged_line", lang);
  return null;
}

/** errorView plus the MUX-23 admission-gap sentence on a 402 above zero. */
export function errorViewFor(msg: Pick<AssistantMsg, "error" | "retryAfterSeconds" | "reason" | "admitMinCredits" | "creditsLeft">, lang: MentorUiLang) {
  const view = errorView(msg.error!, { retryAfterSeconds: msg.retryAfterSeconds, reason: msg.reason });
  const gap = msg.error === "credits_exhausted" ? admissionGapText(msg.creditsLeft, msg.admitMinCredits, lang) : null;
  return gap ? { ...view, text: gap } : view;
}

/** Quiet cost meta under an answer, only while the balance is under 20 credits. */
export function answerCostLine(used: number | undefined, left: number, lang: MentorUiLang): string | null {
  if (used === undefined || !(used > 0) || !(left < 20)) return null;
  const remaining = formatCreditBalance(left, lang);
  // Singular only when the shown value is exactly 1 (printed "1", never "1,0").
  if (Math.round(used * 10) === 10) return r3ExplainCopy("cost_line_one", lang, { left: remaining });
  const n = used < 0.05 ? `<${formatCreditBalance(0.1, lang)}` : formatCreditBalance(used, lang);
  return r3ExplainCopy("cost_line", lang, { n, left: remaining });
}
