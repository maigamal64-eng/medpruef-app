"use client";

/**
 * Fragen-Verlauf (Pro): the raw practice answer history with filters. Moved
 * out of the History page in a24; loading, error with retry and empty are
 * separate states (UX-EXM-37). Exam answers are not part of this list.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, XCircle } from "lucide-react";
import { Alert, EmptyState, Skeleton } from "@/components/ui";
import { authFetch } from "@/lib/authFetch";
import { createRequestSequence } from "@/lib/async-data";
import { th, historyLang } from "@/lib/i18n-history";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { formatDate, formatNumber, isEarlierVersionAnswer, type StoredChoiceLike } from "./history-rules";

interface AnswerRowData {
  id: number;
  question_id: number;
  user_answer: string | null;
  is_correct: boolean;
  time_spent_ms: number | null;
  created_at: string;
  question: {
    id: number;
    topic: string;
    question: string;
    answer: string;
    explanation: string | null;
    choices?: StoredChoiceLike[] | null;
    is_active: boolean;
    exam_type: string;
  } | null;
}

const PAGE = 20;
const EXAM_KEYS = ["kenntnispruefung", "kmp_innsbruck", "pharma"] as const;

export default function QuestionsTab({ lang }: { lang: string }) {
  const hl = historyLang(lang);
  const [rows, setRows] = useState<AnswerRowData[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filterExam, setFilterExam] = useState("");
  const [filterCorrect, setFilterCorrect] = useState<"all" | "correct" | "wrong">("all");
  const [filterDays, setFilterDays] = useState<0 | 7 | 30>(0);
  const sequence = useRef(createRequestSequence());

  const load = useCallback(
    async (offset: number, append: boolean) => {
      const request = sequence.current.begin();
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
        if (filterExam) params.set("exam_type", filterExam);
        if (filterCorrect !== "all") params.set("correctness", filterCorrect);
        if (filterDays > 0) params.set("days", String(filterDays));
        const res = await authFetch(`/api/history/answers?${params.toString()}`, { signal: request.signal });
        if (!res.ok) throw new Error("History unavailable");
        const d = await res.json();
        if (!Array.isArray(d?.answers)) throw new Error("Invalid history");
        if (!request.current()) return;
        setError(false);
        const next = d.answers as AnswerRowData[];
        setRows((prev) => (append && prev ? [...prev, ...next] : next));
        if (typeof d?.total === "number") setTotal(d.total);
      } catch {
        if (request.current()) setError(true);
      } finally {
        if (request.current()) setLoading(false);
      }
    },
    [filterExam, filterCorrect, filterDays]
  );

  useEffect(() => {
    void load(0, false);
    const current = sequence.current;
    return () => current.cancel();
  }, [load]);

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select value={filterExam} onChange={(e) => setFilterExam(e.target.value)} className="mp-field min-h-11 text-sm" aria-label={th("qh_exam_type", lang)}>
          <option value="">{th("qh_all_exams", lang)}</option>
          {EXAM_KEYS.map((key) => (
            <option key={key} value={key}>{getExamLabel(key, "full", hl)}</option>
          ))}
        </select>
        <select
          value={filterCorrect}
          onChange={(e) => setFilterCorrect(e.target.value as typeof filterCorrect)}
          className="mp-field min-h-11 text-sm"
          aria-label={th("qh_result", lang)}
        >
          <option value="all">{th("qh_all", lang)}</option>
          <option value="correct">{th("verdict_correct", lang)}</option>
          <option value="wrong">{th("verdict_wrong", lang)}</option>
        </select>
        <select
          value={filterDays}
          onChange={(e) => setFilterDays(Number(e.target.value) as typeof filterDays)}
          className="mp-field min-h-11 text-sm"
          aria-label={th("qh_period", lang)}
        >
          <option value={0}>{th("qh_any_time", lang)}</option>
          <option value={7}>{th("qh_last7", lang)}</option>
          <option value={30}>{th("qh_last30", lang)}</option>
        </select>
        {total !== null && <span className="ml-auto text-xs text-[var(--mp-fg-muted)]">{th("qh_count", lang, { n: formatNumber(total, lang) })}</span>}
      </div>

      {error && (
        <Alert variant="error" title={th("qh_error", lang)} className="mb-4">
          <button type="button" className="mp-btn mp-btn--secondary mt-2 min-h-11" disabled={loading} onClick={() => void load(0, false)}>
            {th("retry", lang)}
          </button>
        </Alert>
      )}

      {rows === null ? (
        error ? null : <Skeleton variant="card" />
      ) : rows.length === 0 ? (
        <EmptyState title={th("qh_none", lang)} />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <AnswerRow key={row.id} row={row} lang={lang} />
          ))}
          {rows.length < (total ?? 0) && (
            <button
              type="button"
              onClick={() => void load(rows.length, true)}
              disabled={loading}
              aria-busy={loading}
              className="mp-btn mp-btn--secondary min-h-11 w-full"
            >
              {loading ? th("loading_more", lang) : th("qh_load_more", lang)}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function AnswerRow({ row, lang }: { row: AnswerRowData; lang: string }) {
  const q = row.question;
  return (
    <div className="card p-3.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--mp-fg-muted)]">{formatDate(row.created_at, lang)}</span>
        {row.is_correct ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--mp-success-text)]">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {th("verdict_correct", lang)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--mp-error-text)]">
            <XCircle className="h-3.5 w-3.5" aria-hidden /> {th("verdict_wrong", lang)}
          </span>
        )}
      </div>
      {q ? (
        <>
          <p className="mb-1 whitespace-pre-wrap break-words text-sm text-[var(--mp-fg)]" lang="de" dir="ltr">{q.question}</p>
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--mp-fg-muted)]">
            <span className="rounded-full bg-[var(--mp-border-subtle)] px-2 py-0.5">{q.topic}</span>
            {typeof row.time_spent_ms === "number" && row.time_spent_ms > 0 && (
              <span className="font-mono">{th("qh_seconds", lang, { n: Math.max(1, Math.round(row.time_spent_ms / 1000)) })}</span>
            )}
            {!q.is_active && (
              <span className="rounded-full bg-[var(--mp-warning-bg)] px-2 py-0.5 text-[var(--mp-warning-text)]">{th("verdict_removed", lang)}</span>
            )}
          </div>
          <div className="text-xs text-[var(--mp-fg-muted)]">
            <span className="font-semibold">{th("qh_your_answer", lang)}</span>{" "}
            <span className="min-w-0 break-words text-[var(--mp-fg)]" lang="de" dir="ltr">{row.user_answer ?? "-"}</span>
            {/* Legacy rows stored the correct answer text as user_answer, which
                would read "your answer" == "correct" on a wrong row. */}
            {!row.is_correct && !(row.user_answer && row.user_answer.trim() === q.answer.trim()) && (
              <>
                {" "}
                <span className="font-semibold">{th("qh_correct_label", lang)}</span>{" "}
                <span className="text-[var(--mp-success-text)]" lang="de" dir="ltr">{q.answer}</span>
              </>
            )}
          </div>
          {isEarlierVersionAnswer(row.user_answer, q.choices, q.answer) && (
            <p className="mt-1 text-xs text-[var(--mp-fg-muted)]" data-testid="history-earlier-version">{th("qh_earlier_version", lang)}</p>
          )}
          <Link href={`/quiz?questionId=${q.id}`} className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm text-[var(--mp-cta)] hover:underline">
            {th("qh_practise_again", lang)} <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </>
      ) : (
        <p className="text-xs text-[var(--mp-fg-muted)]">{th("qh_not_in_bank", lang)}</p>
      )}
    </div>
  );
}
