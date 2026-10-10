"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui";
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
}: {
  view: ErrorView;
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
  const text = mentorT(waiting || !showWait ? view.messageKey : "err_rate_limited_nowait", lang, vars);
  const variant = view.tone === "error" ? "error" : view.tone === "warning" ? "warning" : "info";

  return (
    <Alert variant={variant} className="mt-2">
      <p dir="auto" className="text-[13.5px] leading-snug text-[var(--mp-fg)]">{text}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {view.action === "packages" && packagesHref && (
          <Link href={packagesHref} className="mp-btn mp-btn--primary mp-btn--sm min-h-10">
            {mentorT("btn_see_packages", lang)}
          </Link>
        )}
        {view.action === "signin" && (
          <Link href="/login?next=%2Fmentor" className="mp-btn mp-btn--primary mp-btn--sm min-h-10">
            {mentorT("btn_signin", lang)}
          </Link>
        )}
        {view.action === "new_chat" && onNewChat && (
          <button type="button" onClick={onNewChat} className="mp-btn mp-btn--secondary mp-btn--sm min-h-10">
            {mentorT("btn_new_chat", lang)}
          </button>
        )}
        {(view.action === "retry" || (view.action === "wait" && !waiting)) && onRetry && (
          <button type="button" onClick={onRetry} className="mp-btn mp-btn--secondary mp-btn--sm min-h-10">
            {mentorT("btn_retry", lang)}
          </button>
        )}
      </div>
    </Alert>
  );
}
