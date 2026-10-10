"use client";

import { ExternalLink, Info, ShieldAlert, RotateCcw, Brain } from "lucide-react";
import { mentorT, type MentorUiLang } from "@/lib/i18n-mentor";
import type { MentorAnswerBlock, MentorCitation } from "@/lib/mentor/contract";
import type { AssistantMsg, UserMsg } from "./chat-state";
import ErrorNotice from "./ErrorNotice";
import { errorView, formatDate, refusalKey, safeExternalUrl } from "./view-model";

export function UserBubble({ msg }: { msg: UserMsg }) {
  return (
    <div className="flex justify-end">
      <p
        dir="auto"
        className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-[var(--mp-oxford-blue)] px-4 py-2.5 text-[14.5px] leading-relaxed text-white shadow-[var(--shadow-xs)] sm:max-w-[75%]"
      >
        {msg.text}
      </p>
    </div>
  );
}

function Avatar() {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--mp-viridian)]/25 bg-[var(--mp-success-bg)] text-[var(--mp-viridian)]"
    >
      <Brain className="h-4 w-4" />
    </span>
  );
}

/** Numbers each citation once, in order of first appearance, keyed by fact id. */
export function citationIndex(citations: MentorCitation[]): Map<string, number> {
  const idx = new Map<string, number>();
  citations.forEach((c) => {
    if (!idx.has(c.fact_id)) idx.set(c.fact_id, idx.size + 1);
  });
  return idx;
}

function SourceChips({ citations, lang }: { citations: MentorCitation[]; lang: MentorUiLang }) {
  const idx = citationIndex(citations);
  const seen = new Set<string>();
  const unique = citations.filter((c) => (seen.has(c.fact_id) ? false : (seen.add(c.fact_id), true)));
  if (unique.length === 0) return null;
  return (
    <div className="mt-3 border-t border-[var(--mp-border)] pt-2.5">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)]">{mentorT("sources_label", lang)}</p>
      <ul className="flex flex-col gap-1.5">
        {unique.map((c) => {
          const href = safeExternalUrl(c.source_url);
          const date = formatDate(c.read_on, lang);
          const n = idx.get(c.fact_id);
          const inner = (
            <>
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--mp-viridian)]/12 px-1 text-[10.5px] font-bold text-[var(--mp-viridian)]">
                {n}
              </span>
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate text-[12.5px] font-medium text-[var(--mp-fg)]">
                  {c.source_label}
                </span>
                {date && <span className="block text-[11px] text-[var(--mp-fg-muted)]">{mentorT("source_stand", lang, { date })}</span>}
              </span>
              {href && <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--mp-fg-subtle)] rtl:-scale-x-100" aria-hidden />}
            </>
          );
          return (
            <li key={c.fact_id}>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] px-2.5 py-1.5 transition-colors hover:border-[var(--mp-viridian)]/40"
                  aria-label={`${c.source_label}. ${mentorT("source_open", lang)}`}
                >
                  {inner}
                </a>
              ) : (
                <div className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] px-2.5 py-1.5">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Blocks({ blocks, citations }: { blocks: MentorAnswerBlock[]; citations: MentorCitation[] }) {
  const idx = citationIndex(citations);
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => {
        const nums = [...new Set(b.fact_ids.map((f) => idx.get(f)).filter((n): n is number => n !== undefined))].sort((a, c) => a - c);
        return (
          <p key={i} dir="auto" className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-[var(--mp-fg)]">
            {b.text}
            {nums.map((n) => (
              <sup key={n} className="ms-0.5 rounded bg-[var(--mp-viridian)]/12 px-1 text-[10px] font-bold text-[var(--mp-viridian)]">
                {n}
              </sup>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function Refusal({ reason, link, lang }: { reason: NonNullable<AssistantMsg["final"]>["refused"]; link?: string; lang: MentorUiLang }) {
  if (!reason) return null;
  const href = safeExternalUrl(link);
  return (
    <div className="mt-3 flex gap-2.5 rounded-xl border border-[var(--mp-status-warning)]/35 bg-[var(--mp-warning-bg)] p-3">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mp-warning-dk)]" aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[var(--mp-warning-dk)]">{mentorT("refusal_label", lang)}</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--mp-fg-muted)]">{mentorT(refusalKey(reason), lang)}</p>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mp-btn mp-btn--secondary mp-btn--sm mt-2 min-h-10"
          >
            {mentorT("refusal_link", lang)}
            <ExternalLink className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}

export function TypingDots({ label }: { label: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex items-center gap-1 py-1.5">
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
  onNewChat,
}: {
  msg: AssistantMsg;
  lang: MentorUiLang;
  packagesHref: string | null;
  waitSeconds: number;
  onRetry: () => void;
  onNewChat: () => void;
}) {
  const f = msg.final;
  const blocks = f && f.answer_blocks.length > 0 ? f.answer_blocks : null;

  return (
    <div className="flex gap-2.5">
      <Avatar />
      <div className="min-w-0 max-w-[92%] flex-1 sm:max-w-[80%] sm:flex-none">
        <div className="rounded-2xl rounded-ss-md border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-3 shadow-[var(--shadow-card)]">
          {msg.status === "streaming" && msg.text === "" && <TypingDots label={mentorT("thinking", lang)} />}

          {msg.status === "streaming" && msg.text !== "" && (
            <p dir="auto" aria-live="polite" className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-[var(--mp-fg)]">
              {msg.text}
              <span aria-hidden className="ms-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-[var(--mp-viridian)] motion-safe:animate-pulse" />
            </p>
          )}

          {msg.status === "done" && (blocks ? <Blocks blocks={blocks} citations={f?.citations ?? []} /> : msg.text && <p dir="auto" className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">{msg.text}</p>)}

          {(msg.status === "error" || msg.status === "stopped") && msg.text !== "" && (
            <p dir="auto" className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-[var(--mp-fg)]">
              {msg.text}
            </p>
          )}

          {msg.status === "done" && f?.refused && <Refusal reason={f.refused} link={f.refusal_link} lang={lang} />}

          {msg.status === "done" && f?.validator_replaced && (
            <p className="mt-2.5 flex gap-2 text-[12px] leading-snug text-[var(--mp-fg-muted)]">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--mp-info)]" aria-hidden />
              {mentorT("validator_notice", lang)}
            </p>
          )}

          {msg.status === "done" && f && f.citations.length > 0 && <SourceChips citations={f.citations} lang={lang} />}

          {msg.status === "stopped" && (
            <p className="mt-2 flex items-center gap-2 text-[12.5px] text-[var(--mp-fg-muted)]">
              <span>{mentorT("stopped_notice", lang)}</span>
              <button type="button" onClick={onRetry} className="inline-flex min-h-10 items-center gap-1 font-semibold text-[var(--mp-cta-blue)] hover:underline">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                {mentorT("btn_retry", lang)}
              </button>
            </p>
          )}

          {msg.status === "error" && msg.error && (
            <>
              {msg.text !== "" && <p className="mt-2 text-[12px] text-[var(--mp-fg-muted)]">{mentorT("partial_notice", lang)}</p>}
              <ErrorNotice
                view={errorView(msg.error, { retryAfterSeconds: msg.retryAfterSeconds })}
                lang={lang}
                packagesHref={msg.packagesUrl ?? packagesHref}
                waitSeconds={waitSeconds}
                onRetry={onRetry}
                onNewChat={onNewChat}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
