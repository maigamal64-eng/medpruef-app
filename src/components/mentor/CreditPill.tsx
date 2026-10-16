"use client";

import Link from "next/link";
import { Coins, Info, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { mentorT, type MentorUiLang } from "@/lib/i18n-mentor";
import type { UsageView } from "./view-model";
import { shellT } from "./r1-shell-copy";

const TONE: Record<UsageView["tone"], string> = {
  ok: "text-[var(--mp-viridian)] border-[var(--mp-viridian)]/30 bg-[var(--mp-success-bg)]",
  low: "text-[var(--mp-warning-text)] border-[var(--mp-status-warning)]/40 bg-[var(--mp-warning-bg)]",
  empty: "text-[var(--mp-fg-muted)] border-[var(--mp-border)] bg-[var(--mp-surface-sunken)]",
  trial: "text-[var(--mp-info-text)] border-[var(--mp-info)]/40 bg-[var(--mp-info-bg)]",
  rest: "text-[var(--mp-fg-muted)] border-[var(--mp-border)] bg-[var(--mp-surface-sunken)]",
};

const PILL = "inline-flex min-h-11 min-w-[7.5rem] shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 transition-colors";

/** R3: small mark beside a last known balance while a re-check runs (never after it gave up). */
function RefreshMark({ lang }: { lang: MentorUiLang }) {
  return <span data-mentor-credit-refreshing title={mentorT("credits_stale", lang)} className="inline-flex shrink-0"><RefreshCw aria-hidden className="h-3 w-3 opacity-70 motion-safe:animate-spin [animation-duration:2s]" /></span>;
}

/**
 * Credit balance chip for the header. Message cost varies, so details explain
 * the cost instead of promising a remaining message count.
 */

export default function CreditPill({
  view,
  lang,
  href,
  details,
  refreshing = false,
  seedText = null,
}: {
  view: UsageView | null;
  lang: MentorUiLang;
  href?: string | null;
  details?: string | null;
  /** R3: the shown balance is the last known one and a re-check is running. */
  refreshing?: boolean;
  /** R3: balance from the restored chat while usage has not loaded yet. */
  seedText?: string | null;
}) {
  const [open, setOpen] = useState(false);
  // Not loaded yet, but the restored chat knows the last balance (R3).
  if (!view && seedText) {
    const label = `${mentorT("credits_aria", lang)}: ${seedText}${refreshing ? `, ${mentorT("credits_stale", lang)}` : ""}`;
    return (
      <div role="status" aria-label={label} className={`${PILL} ${TONE.empty}`}>
        <Coins className="h-4 w-4 shrink-0" aria-hidden />
        <span aria-hidden className="font-display text-[13px] font-bold tabular-nums">{seedText}</span>
        {refreshing && <RefreshMark lang={lang} />}
      </div>
    );
  }
  // Loading: the same chip with a neutral ellipsis, so the header never jumps
  // and never shows an empty box (a-mentor-mobile-2 shell-2).
  if (!view) {
    return (
      <div role="status" aria-label={mentorT("credits_loading", lang)} className={`${PILL} ${TONE.empty}`}>
        <Coins className="h-4 w-4 shrink-0" aria-hidden />
        <span aria-hidden className="font-display text-[13px] font-bold">…</span>
        <span className="sr-only">{mentorT("credits_loading", lang)}</span>
      </div>
    );
  }
  const body = (
    <>
      {view.tone === "trial" ? <Info className="h-4 w-4 shrink-0" aria-hidden /> : <Coins className="h-4 w-4 shrink-0" aria-hidden />}
      <span className="flex min-w-0 items-start text-start leading-tight">
        <span className="font-display text-[13px] font-bold tabular-nums">{view.creditsText}</span>
      </span>
      {refreshing && <RefreshMark lang={lang} />}
    </>
  );
  const cls = `${PILL} ${TONE[view.tone]}`;
  return (
    <div className="relative">
      <button type="button" className={cls} aria-expanded={open} aria-label={`${mentorT("credits_aria", lang)}: ${view.creditsText}${refreshing ? `, ${mentorT("credits_stale", lang)}` : ""}`} onClick={() => setOpen((v) => !v)}>{body}</button>
      {open && <div className="absolute end-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-24px)] rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-3 text-[13px] leading-snug shadow-lg">
        <button type="button" className="float-end -me-2 -mt-2 flex h-11 w-11 items-center justify-center" aria-label={shellT("close", lang)} onClick={() => setOpen(false)}><X className="h-4 w-4" aria-hidden /></button>
        {!view.hideCostDetails && <p>{view.messagesText}</p>}
        {view.trialNoticeText && <p className="mt-2">{view.trialNoticeText}</p>}
        {details && <p className="mt-2">{details}</p>}
        {view.expiryText && <p className="mt-2">{view.expiryText}</p>}
        {href && <Link href={href} className="mp-btn mp-btn--secondary mt-2 min-h-11">{mentorT("btn_see_packages", lang)}</Link>}
      </div>}
    </div>
  );
}
