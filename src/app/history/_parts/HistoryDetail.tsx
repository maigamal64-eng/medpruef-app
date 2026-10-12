"use client";

/**
 * /history/[id] (UX-EXM-36/38/39): one saved exam as its own route, so Back,
 * refresh and links work. The server decides the state: 403 shows the Pro
 * wall, 400/404 a not-found state with a link to the list (never an endless
 * loader), 401 is redirected to sign-in by authFetch.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Alert, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { authFetch } from "@/lib/authFetch";
import { useLang } from "@/lib/i18n";
import { th, historyLang } from "@/lib/i18n-history";
import { formatDurationLabel, practiseIdsHref } from "@/lib/exam-run";
import { useSignedInRoute } from "@/lib/hooks/useSignedInRoute";
import { attemptTitle } from "./ExamRow";
import HistoryWall from "./HistoryWall";
import ReviewRow from "./ReviewRow";
import {
  DETAIL_FILTERS,
  filterCounts,
  flaggedSet,
  formatDateTime,
  formatPct,
  isAnswered,
  isAttemptId,
  matchesFilter,
  missedIds,
  pageCount,
  pageSlice,
  type DetailFilter,
  type ReviewQuestion,
} from "./history-rules";

interface DetailAttempt {
  id: string;
  exam_type: string;
  title: string | null;
  config: Record<string, unknown> | null;
  flagged_ids?: number[];
  correct_count: number;
  total_count: number;
  score_pct: number;
  duration_ms: number | null;
  completed_at: string;
}

type DetailState =
  | { kind: "loading" }
  | { kind: "notfound" }
  | { kind: "wall" }
  | { kind: "error" }
  | { kind: "ready"; attempt: DetailAttempt; questions: ReviewQuestion[] };

const FILTER_KEY: Record<DetailFilter, "filter_wrong" | "filter_open" | "filter_flagged" | "filter_all"> = {
  wrong: "filter_wrong",
  open: "filter_open",
  flagged: "filter_flagged",
  all: "filter_all",
};

export default function HistoryDetail({ id }: { id: string }) {
  const signedIn = useSignedInRoute();
  const lang = useLang();
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    if (!isAttemptId(id)) {
      setState({ kind: "notfound" });
      return;
    }
    setRetrying(true);
    try {
      const res = await authFetch(`/api/history/exams/${encodeURIComponent(id)}`);
      if (res.status === 403) { setState({ kind: "wall" }); return; }
      if (res.status === 404 || res.status === 400) { setState({ kind: "notfound" }); return; }
      if (!res.ok) throw new Error(`Detail unavailable (${res.status})`);
      const d = (await res.json()) as { attempt?: DetailAttempt; questions?: ReviewQuestion[] };
      if (!d?.attempt?.id || !Array.isArray(d.questions)) throw new Error("Invalid detail");
      setState({ kind: "ready", attempt: d.attempt, questions: d.questions });
    } catch {
      setState((prev) => (prev.kind === "ready" ? prev : { kind: "error" }));
    } finally {
      setRetrying(false);
    }
  }, [id]);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  if (!signedIn || state.kind === "loading") {
    return (
      <div aria-busy="true">
        <span className="sr-only" role="status">{th("loading_more", lang)}</span>
        <Skeleton className="mb-4 h-10 w-2/3" />
        <Skeleton variant="card" className="mb-3 h-24" />
        <Skeleton variant="card" className="h-40" />
      </div>
    );
  }

  if (state.kind === "notfound") {
    return (
      <>
        <PageHeader title={th("title", lang)} back />
        <EmptyState
          title={th("notfound_title", lang)}
          body={th("notfound_body", lang)}
          action={<Link href="/history" className="mp-btn mp-btn--primary min-h-11">{th("back_to_list", lang)}</Link>}
        />
      </>
    );
  }

  if (state.kind === "wall") {
    return (
      <>
        <PageHeader title={th("title", lang)} back />
        <HistoryWall lang={lang} />
      </>
    );
  }

  if (state.kind === "error") {
    return (
      <>
        <PageHeader title={th("title", lang)} back />
        <Alert variant="error" title={th("detail_error", lang)}>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="mp-btn mp-btn--secondary min-h-11" disabled={retrying} aria-busy={retrying} onClick={() => void load()}>
              {th("retry", lang)}
            </button>
            <Link href="/history" className="mp-btn mp-btn--ghost min-h-11">{th("back_to_list", lang)}</Link>
          </div>
        </Alert>
      </>
    );
  }

  return <DetailView attempt={state.attempt} questions={state.questions} lang={lang} />;
}

function DetailView({ attempt, questions, lang }: { attempt: DetailAttempt; questions: ReviewQuestion[]; lang: string }) {
  const hl = historyLang(lang);
  const kaf = attempt.config?.kind === "kaf";
  const flagged = useMemo(() => flaggedSet(attempt.flagged_ids ?? attempt.config?.flagged_ids), [attempt]);
  const counts = useMemo(() => filterCounts(questions, flagged), [questions, flagged]);
  const answered = useMemo(() => questions.filter(isAnswered).length, [questions]);
  const missed = useMemo(() => missedIds(questions), [questions]);
  const [filter, setFilter] = useState<DetailFilter>("all");
  const [page, setPage] = useState(1);
  const listTop = useRef<HTMLDivElement>(null);

  const indexed = useMemo(() => questions.map((q, i) => ({ q, number: i + 1 })), [questions]);
  const visible = useMemo(() => indexed.filter(({ q }) => matchesFilter(q, filter, flagged)), [indexed, filter, flagged]);
  const pages = pageCount(visible.length);
  const current = Math.min(page, pages);
  const slice = pageSlice(visible, current);

  const goPage = (next: number) => {
    setPage(next);
    listTop.current?.scrollIntoView({ block: "start" });
  };

  const durationMs = typeof attempt.duration_ms === "number" && attempt.duration_ms >= 1000 ? attempt.duration_ms : null;
  const subtitle = [
    formatDateTime(attempt.completed_at, lang),
    durationMs !== null ? th("row_duration", lang, { d: formatDurationLabel(durationMs / 1000, hl) }) : null,
  ].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader title={attemptTitle(attempt, lang)} subtitle={subtitle} back />

      <div className="card mb-4 p-4">
        <p className="text-[15px] font-semibold text-[var(--mp-fg)]">
          {th("detail_score", lang, { correct: attempt.correct_count, total: attempt.total_count, pct: formatPct(attempt.score_pct, lang) })}
        </p>
        <p className="mt-1 text-[14px] text-[var(--mp-fg-muted)]">
          {th("detail_counts", lang, { answered, open: questions.length - answered })}
        </p>
        {kaf && <p className="mt-1 text-[13px] font-semibold text-[var(--mp-fg-muted)]">{th("self_marked", lang)}</p>}
        {missed.length > 0 && (
          <Link href={practiseIdsHref(missed, attempt.exam_type)} className="mp-btn mp-btn--secondary mt-3 min-h-11">
            {th("practise_missed", lang, { n: missed.length })}
          </Link>
        )}
      </div>

      <div ref={listTop} className="mb-3 flex flex-wrap gap-2 scroll-mt-4" role="group" aria-label={th("filter_label", lang)}>
        {DETAIL_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => { setFilter(f); setPage(1); }}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-semibold ${
              filter === f
                ? "border-[var(--mp-action-primary)] bg-[var(--mp-action-primary)] text-[var(--mp-fg-on-cta-blue)]"
                : "border-[var(--mp-border)] bg-[var(--mp-surface)] text-[var(--mp-fg)]"
            }`}
          >
            {th(FILTER_KEY[f], lang)}
            <span className="font-mono text-[13px] opacity-80">{counts[f]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState title={th("filter_empty", lang)} />
      ) : (
        <ul className="space-y-2">
          {slice.map(({ q, number }) => (
            <ReviewRow key={`${q.question_id}-${number}`} question={q} number={number} kaf={kaf} flagged={flagged.has(q.question_id)} lang={lang} />
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between gap-2" aria-label={th("page_status", lang, { page: current, pages })}>
          <button type="button" className="mp-btn mp-btn--secondary min-h-11" disabled={current <= 1} onClick={() => goPage(current - 1)}>
            {th("page_prev", lang)}
          </button>
          <span className="text-[13px] text-[var(--mp-fg-muted)]" aria-live="polite">{th("page_status", lang, { page: current, pages })}</span>
          <button type="button" className="mp-btn mp-btn--secondary min-h-11" disabled={current >= pages} onClick={() => goPage(current + 1)}>
            {th("page_next", lang)}
          </button>
        </nav>
      )}
    </>
  );
}
