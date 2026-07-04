"use client";

/**
 * Lower-section tab panels for the user-detail page: the exact records
 * behind the visuals — answered questions, sessions, notes, money, and
 * feedback/flags.
 */

import {
  CheckCircle2,
  XCircle,
  Smartphone,
  Monitor,
  CreditCard,
  Gift,
  MessageSquare,
  Flag,
  StickyNote,
} from "lucide-react";
import { getExamSource } from "@/lib/topics";
import type {
  AnswerDetail,
  SessionDetail,
  NoteDetail,
  FeedbackDetail,
  FlagDetail,
  UserMoney,
} from "./types";
import { fmtDateTime, fmtDurationMs, fmtDurationSec, fmtEuroCents, fmtDate } from "./visuals";

function examLabel(id: string | null): string {
  if (!id) return "—";
  return getExamSource(id)?.label || id;
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-sm text-[var(--mp-fg-subtle)] italic py-10 text-center">
      {children}
    </div>
  );
}

// ── Answered questions ──────────────────────────────────────────────
export function AnswersPanel({
  answers,
  total,
}: {
  answers: AnswerDetail[];
  total: number;
}) {
  if (!answers.length) return <EmptyPanel>No questions answered yet.</EmptyPanel>;
  return (
    <div className="space-y-2">
      {answers.map((a) => (
        <div
          key={a.id}
          className="rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3"
        >
          <div className="flex items-start gap-2.5">
            <span
              className="flex-shrink-0 mt-0.5"
              style={{ color: a.isCorrect ? "var(--mp-viridian)" : "var(--mp-error)" }}
            >
              {a.isCorrect ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap text-[10px] text-[var(--mp-fg-muted)] mb-1">
                <span className="font-mono">#{a.questionId}</span>
                {a.topic && (
                  <span className="px-1.5 py-0.5 rounded bg-[var(--mp-surface-sunken)]">
                    {a.topic}
                  </span>
                )}
                {a.examType && <span>{examLabel(a.examType)}</span>}
                {a.removed && (
                  <span className="px-1.5 py-0.5 rounded bg-[var(--mp-error)]/10 text-[var(--mp-error)]">
                    removed
                  </span>
                )}
                <span className="ml-auto tabular-nums">{fmtDateTime(a.createdAt)}</span>
              </div>
              <p className="text-[13px] text-[var(--mp-fg)] leading-snug">
                {a.stem || (
                  <span className="italic text-[var(--mp-fg-subtle)]">
                    Question #{a.questionId} (removed from the bank)
                  </span>
                )}
              </p>
              {a.userAnswer && (
                <p className="text-[11px] text-[var(--mp-fg-muted)] mt-1">
                  <span className="text-[var(--mp-fg-subtle)]">Answer: </span>
                  {a.userAnswer}
                </p>
              )}
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[var(--mp-fg-subtle)] tabular-nums">
                <span>{fmtDurationMs(a.timeMs)}</span>
                {a.xp != null && a.xp > 0 && (
                  <span className="text-[var(--mp-status-warning)]">+{a.xp} XP</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
      {total > answers.length && (
        <div className="text-[10px] text-[var(--mp-fg-subtle)] text-center pt-1">
          Showing the {answers.length} most recent of {total} answered.
        </div>
      )}
    </div>
  );
}

// ── Sessions ────────────────────────────────────────────────────────
export function SessionsPanel({ sessions }: { sessions: SessionDetail[] }) {
  if (!sessions.length) return <EmptyPanel>No sessions recorded.</EmptyPanel>;
  return (
    <div className="space-y-2">
      {sessions.map((s, i) => {
        const isMobile = /iphone|android|mobile/i.test(s.platform || "");
        const DeviceIcon = isMobile ? Smartphone : Monitor;
        return (
          <div
            key={i}
            className="rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3 flex items-center gap-3"
          >
            <span className="flex-shrink-0 w-8 h-8 rounded-md bg-[var(--mp-surface-sunken)] flex items-center justify-center text-[var(--mp-fg-muted)]">
              <DeviceIcon size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap text-[12px] text-[var(--mp-fg)]">
                <span className="font-medium">{s.platform || "Unknown device"}</span>
                {s.browser && <span className="text-[var(--mp-fg-muted)]">· {s.browser}</span>}
                {s.timezone && (
                  <span className="text-[10px] text-[var(--mp-fg-subtle)]">{s.timezone}</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-[10px] text-[var(--mp-fg-subtle)] tabular-nums flex-wrap">
                <span>{fmtDateTime(s.startedAt)}</span>
                <span>· {fmtDurationSec(s.durationSeconds)}</span>
                {s.screen && <span>· {s.screen}</span>}
                {s.language && <span>· {s.language}</span>}
                {s.pagesVisited.length > 0 && <span>· {s.pagesVisited.length} pages</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Notes ───────────────────────────────────────────────────────────
export function NotesPanel({ notes }: { notes: NoteDetail[] }) {
  if (!notes.length) return <EmptyPanel>No flash-notes created.</EmptyPanel>;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {notes.map((n) => (
        <div
          key={n.id}
          className="rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3 flex items-start gap-2.5"
        >
          <span className="flex-shrink-0 mt-0.5 text-[var(--mp-viridian)]">
            <StickyNote size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-[var(--mp-fg)] font-medium truncate">
              {n.title || "Untitled note"}
            </p>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--mp-fg-subtle)] flex-wrap">
              {n.topic && (
                <span className="px-1.5 py-0.5 rounded bg-[var(--mp-surface-sunken)]">
                  {n.topic}
                </span>
              )}
              {n.visibility && n.visibility !== "private" && (
                <span className="px-1.5 py-0.5 rounded bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)]">
                  {n.visibility}
                </span>
              )}
              <span className="tabular-nums">{fmtDate(n.createdAt)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Money ───────────────────────────────────────────────────────────
export function MoneyPanel({ money }: { money: UserMoney }) {
  const hasAnything =
    money.subscriptions.length > 0 ||
    money.trial ||
    money.referralsMade > 0 ||
    money.referredByCode;
  return (
    <div className="space-y-4">
      {/* verdict banner */}
      <div
        className="rounded-xl border p-4 flex items-center gap-3"
        style={{
          borderColor: money.isPayer ? "rgba(0,123,95,0.4)" : "var(--mp-border-subtle)",
          background: money.isPayer ? "rgba(0,123,95,0.06)" : "var(--mp-surface-raised)",
        }}
      >
        <span
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{
            background: money.isPayer ? "rgba(0,123,95,0.12)" : "var(--mp-surface-sunken)",
            color: money.isPayer ? "var(--mp-viridian)" : "var(--mp-fg-muted)",
          }}
        >
          <CreditCard size={18} />
        </span>
        <div className="flex-1">
          <div className="text-sm font-semibold text-[var(--mp-fg)]">
            {money.isPayer ? "Paying / Pro customer" : "No payment on record"}
          </div>
          <div className="text-[11px] text-[var(--mp-fg-muted)]">
            Lifetime paid: {fmtEuroCents(money.paidTotalCents, money.currency)}
            {money.referralsMade > 0 &&
              ` · ${money.referralsMade} referrals (${money.referralsQualified} qualified)`}
          </div>
        </div>
      </div>

      {money.trial && (
        <div className="rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3 flex items-center gap-2.5">
          <Gift size={15} className="text-[#C08A2D]" />
          <span className="text-[12px] text-[var(--mp-fg)]">
            Free Pro trial{" "}
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                background: money.trial.active ? "rgba(0,123,95,0.12)" : "var(--mp-surface-sunken)",
                color: money.trial.active ? "var(--mp-viridian)" : "var(--mp-fg-muted)",
              }}
            >
              {money.trial.active ? "active" : "ended"}
            </span>
          </span>
          <span className="ml-auto text-[10px] text-[var(--mp-fg-subtle)] tabular-nums">
            {fmtDate(money.trial.startedAt)} → {money.trial.expiresAt ? fmtDate(money.trial.expiresAt) : "—"}
          </span>
        </div>
      )}

      {money.subscriptions.length > 0 && (
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--mp-surface-sunken)] text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">
                <th className="px-3 py-2 text-left">Tier</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Provider</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Started</th>
                <th className="px-3 py-2 text-right">Expires</th>
              </tr>
            </thead>
            <tbody>
              {money.subscriptions.map((s, i) => (
                <tr key={i} className="border-t border-[var(--mp-border-subtle)]/60">
                  <td className="px-3 py-2 text-[var(--mp-fg)]">{s.tier || "—"}</td>
                  <td className="px-3 py-2">
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                      style={{
                        background:
                          s.status === "active" ? "rgba(0,123,95,0.12)" : "var(--mp-surface-sunken)",
                        color:
                          s.status === "active" ? "var(--mp-viridian)" : "var(--mp-fg-muted)",
                      }}
                    >
                      {s.status || "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[var(--mp-fg-muted)]">
                    {[s.provider, s.method].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--mp-fg)]">
                    {fmtEuroCents(s.amountCents, s.currency || money.currency)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--mp-fg-subtle)]">
                    {fmtDate(s.startedAt)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--mp-fg-subtle)]">
                    {fmtDate(s.expiresAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!hasAnything && <EmptyPanel>No money activity for this user.</EmptyPanel>}
    </div>
  );
}

// ── Feedback + Flags ────────────────────────────────────────────────
export function FeedbackFlagsPanel({
  feedback,
  flags,
}: {
  feedback: FeedbackDetail[];
  flags: FlagDetail[];
}) {
  if (!feedback.length && !flags.length)
    return <EmptyPanel>No feedback or question flags from this user.</EmptyPanel>;
  return (
    <div className="space-y-4">
      {feedback.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--mp-fg-muted)] mb-2">
            Feedback ({feedback.length})
          </h4>
          <div className="space-y-2">
            {feedback.map((f) => (
              <div
                key={f.id}
                className="rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3 flex items-start gap-2.5"
              >
                <MessageSquare size={15} className="text-[var(--mp-cta-blue)] flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-[var(--mp-fg)]">{f.message}</p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--mp-fg-subtle)]">
                    <span className="px-1.5 py-0.5 rounded bg-[var(--mp-surface-sunken)]">
                      {f.status}
                    </span>
                    <span className="tabular-nums">{fmtDateTime(f.createdAt)}</span>
                  </div>
                  {f.adminNote && (
                    <p className="text-[11px] text-[var(--mp-fg-muted)] mt-1 italic">
                      Admin: {f.adminNote}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {flags.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--mp-fg-muted)] mb-2">
            Question flags / edits ({flags.length})
          </h4>
          <div className="space-y-2">
            {flags.map((fl) => (
              <div
                key={fl.id}
                className="rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3 flex items-start gap-2.5"
              >
                <Flag size={15} className="text-[var(--mp-status-warning)] flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] text-[var(--mp-fg-muted)]">
                    <span className="font-mono">#{fl.questionId ?? "?"}</span>
                    <span className="px-1.5 py-0.5 rounded bg-[var(--mp-surface-sunken)]">
                      {fl.type}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-[var(--mp-surface-sunken)]">
                      {fl.status}
                    </span>
                    <span className="ml-auto tabular-nums">{fmtDateTime(fl.createdAt)}</span>
                  </div>
                  {(fl.reason || fl.details) && (
                    <p className="text-[12px] text-[var(--mp-fg)] mt-1">
                      {fl.reason}
                      {fl.details ? ` — ${fl.details}` : ""}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
