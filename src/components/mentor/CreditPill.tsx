"use client";

import Link from "next/link";
import { Coins } from "lucide-react";
import { mentorT, type MentorUiLang } from "@/lib/i18n-mentor";
import type { UsageView } from "./view-model";

const TONE: Record<UsageView["tone"], string> = {
  ok: "text-[var(--mp-viridian)] border-[var(--mp-viridian)]/30 bg-[var(--mp-success-bg)]",
  low: "text-[var(--mp-warning-dk)] border-[var(--mp-status-warning)]/40 bg-[var(--mp-warning-bg)]",
  empty: "text-[var(--mp-fg-muted)] border-[var(--mp-border)] bg-[var(--mp-surface-sunken)]",
  rest: "text-[var(--mp-fg-muted)] border-[var(--mp-border)] bg-[var(--mp-surface-sunken)]",
};

/**
 * Credit balance chip for the header. Learners see credits and "about N
 * messages", never money. Links to the packages page when buying is on sale.
 */
export default function CreditPill({
  view,
  lang,
  href,
}: {
  view: UsageView | null;
  lang: MentorUiLang;
  href?: string | null;
}) {
  if (!view) {
    return (
      <div
        className="h-11 w-28 animate-pulse rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)]"
        role="status"
        aria-label={mentorT("credits_loading", lang)}
      />
    );
  }
  const body = (
    <>
      <Coins className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex min-w-0 flex-col items-start text-start leading-tight">
        <span className="font-display text-[13px] font-bold tabular-nums">{view.creditsText}</span>
        <span className="truncate text-[10.5px] font-medium opacity-80">{view.messagesText}</span>
      </span>
    </>
  );
  const cls = `inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 py-1.5 transition-colors ${TONE[view.tone]}`;
  if (href) {
    return (
      <Link href={href} className={`${cls} hover:brightness-95`} aria-label={`${mentorT("credits_aria", lang)}: ${view.creditsText}, ${view.messagesText}`}>
        {body}
      </Link>
    );
  }
  return (
    <div className={cls} role="status" aria-label={`${mentorT("credits_aria", lang)}: ${view.creditsText}, ${view.messagesText}`}>
      {body}
    </div>
  );
}
