"use client";

/**
 * My reports (a15: QLT-03, TR-10). The signed-in learner's own question
 * reports with a learner-facing state, read from GET /api/suggestions/mine.
 * The endpoint returns only the caller's rows: no admin notes, no question
 * content, no other learner's text. Turnaround is a population median from
 * the server, shown only when enough reports were resolved.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useLang } from "@/lib/i18n";
import { reportsCopy, turnaroundLine } from "@/lib/i18n-reports";
import type { LearnerReportState } from "@/lib/reports/report-status";

interface MyReport {
  id: number;
  question_id: number;
  type: "flag" | "edit" | string;
  status: string;
  state: LearnerReportState;
  /** a-rewards-program: fix reward the learner still holds for this report. */
  reward_credits?: number;
  created_at: string | null;
  resolved_at: string | null;
}

interface MineResponse {
  suggestions: MyReport[];
  total: number;
  turnaround: { median_hours: number | null; sample: number } | null;
}

const PAGE = 20;
const KNOWN_STATES: LearnerReportState[] = ["open", "accepted", "fixed", "not_an_error", "needs_info", "closed"];

const STATE_TONE: Record<LearnerReportState, string> = {
  open: "bg-[var(--mp-status-warning)]/12 text-[var(--mp-fg)] border-[var(--mp-status-warning)]/50",
  accepted: "bg-[var(--mp-accent-teal)]/10 text-[var(--mp-fg)] border-[var(--mp-accent-teal)]/50",
  fixed: "bg-[var(--mp-viridian)]/10 text-[var(--mp-fg)] border-[var(--mp-viridian)]/50",
  not_an_error: "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)] border-[var(--mp-border)]",
  needs_info: "bg-[var(--mp-cta-blue)]/10 text-[var(--mp-fg)] border-[var(--mp-cta-blue)]/40",
  closed: "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] border-[var(--mp-border)]",
};

function isMineResponse(value: unknown): value is MineResponse {
  return !!value && typeof value === "object" && Array.isArray((value as MineResponse).suggestions) && typeof (value as MineResponse).total === "number";
}

export function MyReportsList({ headingId = "meine-meldungen-title" }: { headingId?: string }) {
  const lang = useLang();
  const copy = reportsCopy(lang);
  const [items, setItems] = useState<MyReport[]>([]);
  const [total, setTotal] = useState(0);
  const [turnaround, setTurnaround] = useState<MineResponse["turnaround"]>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (offset: number) => {
    const ticket = ++seq.current;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/suggestions/mine?limit=${PAGE}&offset=${offset}`);
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok || !isMineResponse(payload)) throw new Error("load failed");
      if (ticket !== seq.current) return;
      setItems((current) => (offset === 0 ? payload.suggestions : [...current, ...payload.suggestions]));
      setTotal(payload.total);
      setTurnaround(payload.turnaround ?? null);
    } catch {
      if (ticket === seq.current) setError(true);
    } finally {
      if (ticket === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(0); }, [load]);

  // The acknowledgement links to /settings#meine-meldungen; the section
  // renders after the client loads, so scroll once it exists.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || loading || typeof window === "undefined") return;
    scrolled.current = true;
    if (window.location.hash !== "#meine-meldungen") return;
    document.getElementById("meine-meldungen")?.scrollIntoView({ block: "start" });
  }, [loading]);

  const formatDate = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString(copy.dateLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Vienna" }) : null;
  };

  return (
    <section aria-labelledby={headingId} aria-busy={loading} className="space-y-3" data-testid="my-reports">
      <div>
        <h2 id={headingId} className="text-base font-semibold text-[var(--mp-fg)]">{copy.listTitle}</h2>
        <p className="text-sm text-[var(--mp-fg-muted)] mt-0.5">{copy.listIntro}</p>
        {turnaround?.median_hours ? (
          <p className="text-sm text-[var(--mp-fg-muted)] mt-1" data-testid="my-reports-turnaround">{turnaroundLine(copy, turnaround.median_hours)}</p>
        ) : null}
      </div>

      {loading && items.length === 0 && <p role="status" className="text-sm text-[var(--mp-fg-muted)]">{copy.loading}</p>}

      {error && (
        <div role="alert" className="rounded-xl border border-[var(--mp-error)]/40 bg-[var(--mp-error)]/5 p-3 text-sm text-[var(--mp-fg)]">
          <p>{copy.listError}</p>
          <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm mt-2 min-h-11" onClick={() => void load(items.length ? items.length : 0)}>
            {copy.retry}
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 text-sm text-[var(--mp-fg-muted)]">{copy.listEmpty}</p>
      )}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => {
            const state: LearnerReportState = KNOWN_STATES.includes(item.state) ? item.state : "closed";
            const reported = formatDate(item.created_at);
            const resolved = state === "open" ? null : formatDate(item.resolved_at);
            return (
              <li key={item.id} className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3" data-state={state}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--mp-fg)]">{copy.question.replace("{id}", String(item.question_id))}</p>
                    <p className="text-xs text-[var(--mp-fg-muted)]">
                      {item.type === "edit" ? copy.typeEdit : copy.typeFlag}
                      {reported ? ` · ${copy.reportedOn.replace("{date}", reported)}` : ""}
                      {resolved ? ` · ${copy.resolvedOn.replace("{date}", resolved)}` : ""}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATE_TONE[state]}`}>{copy.state[state]}</span>
                </div>
                <p className="mt-1.5 text-sm text-[var(--mp-fg-muted)]">{copy.stateBody[state]}</p>
                {state === "fixed" && typeof item.reward_credits === "number" && item.reward_credits > 0 && (
                  <p className="mt-1 text-sm text-[var(--mp-fg)]" data-testid="report-fix-reward">{copy.fixReward.replace("{n}", String(item.reward_credits))}</p>
                )}
                <Link
                  href={`/quiz?questionId=${encodeURIComponent(String(item.question_id))}`}
                  className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2"
                >
                  {copy.openQuestion}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {items.length > 0 && items.length < total && !error && (
        <button type="button" disabled={loading} className="mp-btn mp-btn--secondary mp-btn--sm min-h-11 disabled:opacity-50" onClick={() => void load(items.length)}>
          {copy.loadMore}
        </button>
      )}
    </section>
  );
}
