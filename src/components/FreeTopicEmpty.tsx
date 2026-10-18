"use client";

/**
 * Honest empty state for a free learner (a-free-set issue 1): the chosen
 * topic has no free question, or they answered all of its free questions.
 * Says the topic is part of Pro, offers up to three topics that still have
 * free questions and the Pro link. The "all 150 free questions used" wall
 * is the paywall modal and appears only when the server says so.
 */
import Link from "next/link";
import { Lock } from "lucide-react";
import { buildQuizHref } from "@/lib/quiz-links";
import { freeEmptyText, freeLeftLine, freeSetCopy, type FreeEmptyKind } from "@/lib/i18n-free-set";

export interface FreeTopicLeftItem {
  topic: string;
  left: number;
}

export interface FreeTopicEmptyProps {
  lang: string;
  reason: FreeEmptyKind;
  /** The single topic the learner picked, when there was one. */
  topic: string | null;
  topics: FreeTopicLeftItem[];
  examSource: string;
  /** Practice mode to keep on the suggested topic links. */
  practiceMode?: string;
  /** Where a suggestion leads (defaults to the quiz). */
  hrefFor?: (topic: string) => string;
  /** a-paywall-deadend-fix (flag on): lines under the body (free sample left, plan fit). */
  extraLines?: string[];
  /** a-paywall-deadend-fix (flag on): the Pro link with the bank; defaults to today's link. */
  pricingHref?: string;
}

/** Parse the server's `freeTopicEmpty` body; null when it is not one. */
export function readFreeTopicEmpty(data: unknown): { reason: FreeEmptyKind; topics: FreeTopicLeftItem[]; freeLeft: number | null } | null {
  if (!data || typeof data !== "object" || (data as { freeTopicEmpty?: unknown }).freeTopicEmpty !== true) return null;
  const raw = data as { reason?: unknown; topics?: unknown; freeLeft?: unknown };
  const reason: FreeEmptyKind = raw.reason === "no_free_in_topic" || raw.reason === "all_seen" ? raw.reason : "other";
  const topics = Array.isArray(raw.topics)
    ? raw.topics
        .filter((t): t is FreeTopicLeftItem => !!t && typeof (t as FreeTopicLeftItem).topic === "string" && typeof (t as FreeTopicLeftItem).left === "number")
        .slice(0, 3)
    : [];
  const freeLeft = typeof raw.freeLeft === "number" && Number.isFinite(raw.freeLeft) && raw.freeLeft >= 0 ? Math.floor(raw.freeLeft) : null;
  return { reason, topics, freeLeft };
}

export default function FreeTopicEmpty({ lang, reason, topic, topics, examSource, practiceMode, hrefFor, extraLines, pricingHref }: FreeTopicEmptyProps) {
  const copy = freeSetCopy(lang);
  const text = freeEmptyText(copy, reason, topic);
  const href = hrefFor ?? ((t: string) => buildQuizHref({ examSource, topic: t, practiceMode }));
  return (
    <div className="mp-card p-5 text-left" data-testid="free-topic-empty" role="status">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]">
          <Lock size={16} />
        </span>
        <div className="min-w-0">
          <h2 className="mp-h3 text-[var(--mp-fg)]">{text.title}</h2>
          <p className="mt-1 text-sm text-[var(--mp-fg-muted)]">{text.body}</p>
          {extraLines?.map((line) => (
            <p key={line} className="mt-1 text-sm text-[var(--mp-fg-muted)]">{line}</p>
          ))}
        </div>
      </div>
      {topics.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-[var(--mp-fg)]">{copy.suggestionsLabel}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {topics.map((t) => (
              <li key={t.topic}>
                <Link
                  href={href(t.topic)}
                  className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-[var(--mp-border)] px-3 py-2 text-sm hover:bg-[var(--mp-surface-sunken)]"
                >
                  <span className="min-w-0 break-words font-medium text-[var(--mp-fg)]">{t.topic}</span>
                  <span className="shrink-0 text-[var(--mp-fg-muted)]">{freeLeftLine(copy, t.left)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={pricingHref ?? "/pricing?gate=full_bank"} className="mp-btn mp-btn--primary">
          {copy.proLink}
        </Link>
        <Link href="/" className="mp-btn mp-btn--secondary">
          {copy.backHome}
        </Link>
      </div>
    </div>
  );
}
