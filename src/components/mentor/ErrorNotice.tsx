"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { r3T } from "./r3-copy";
import { mentorT, type MentorUiLang } from "@/lib/i18n-mentor";
import type { ErrorView } from "./view-model";

/** Seconds left until `until` (ms epoch), ticking once a second. Returns 0 when done. */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (until === null) return 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}

export default function ErrorNotice({
  view,
  lang,
  packagesHref,
  onRetry,
  onNewChat,
  waitSeconds,
  onRephrase,
  diagnostics,
  billingLine,
}: {
  view: ErrorView;
  /** Server-confirmed "not charged" line, or the network "check your balance" line (MUX-38). */
  billingLine?: string | null;
  onRephrase?: () => void;
  diagnostics?: { requestId?: string; code?: string; time?: string };
  lang: MentorUiLang;
  /** Where "see packages" goes; omitted when the server told us buying is off. */
  packagesHref?: string | null;
  onRetry?: () => void;
  onNewChat?: () => void;
  /** Live countdown for rate limits. */
  waitSeconds?: number;
}) {
  const vars = view.action === "wait" && view.vars && waitSeconds !== undefined ? { ...view.vars, s: waitSeconds } : view.vars;
  const showWait = view.action === "wait";
  const waiting = showWait && waitSeconds !== undefined && waitSeconds > 0;
  const text = view.text ?? mentorT(waiting || !showWait ? view.messageKey : "err_rate_limited_nowait", lang, vars);
  const [copied, setCopied] = useState(false);

  return (
    <div role="status" className="mt-2 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-3">
      <p dir="auto" className="text-[13.5px] leading-snug text-[var(--mp-fg)]">{text}</p>
      {billingLine && <p dir="auto" className="mt-1 text-[12.5px] leading-snug text-[var(--mp-fg)]">{billingLine}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {view.action === "packages" && packagesHref && (
          <Link href={packagesHref} className="mp-btn mp-btn--primary mp-btn--sm min-h-11">
            {mentorT("btn_see_packages", lang)}
          </Link>
        )}
        {view.action === "signin" && (
          <Link href="/login?next=%2Fmentor" className="mp-btn mp-btn--primary mp-btn--sm min-h-11">
            {mentorT("btn_signin", lang)}
          </Link>
        )}
        {view.action === "new_chat" && onNewChat && (
          <button type="button" onClick={onNewChat} className="mp-btn mp-btn--secondary mp-btn--sm min-h-11">
            {mentorT("btn_new_chat", lang)}
          </button>
        )}
        {(view.action === "retry" || (view.action === "wait" && !waiting)) && onRetry && (
          <button type="button" onClick={onRetry} className="mp-btn mp-btn--secondary mp-btn--sm min-h-11">
            {mentorT("btn_retry", lang)}
          </button>
        )}
        {view.action === "rephrase" && <button type="button" onClick={onRephrase} className="mp-btn mp-btn--secondary min-h-11">{r3T("edit", lang)}</button>}
        {view.action === "pro" && <Link href="/pricing" className="mp-btn mp-btn--secondary min-h-11">{r3T("pro", lang)}</Link>}
      </div>
      {diagnostics && <details className="mt-2 text-[12px]"><summary className="min-h-11 cursor-pointer">{mentorT("btn_copy_error", lang)}</summary><button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify({ request_id: diagnostics.requestId ?? null, code: diagnostics.code ?? null, time: diagnostics.time ?? null })); setCopied(true); } catch { setCopied(false); } }}>{mentorT("btn_copy_error", lang)}</button>{copied && <span aria-hidden> ✓</span>}</details>}
    </div>
  );
}
