"use client";

/**
 * UX-PRA-45: the result of replaying offline answers, shown once as a status
 * line that stays until dismissed (no auto-dismiss). Counts come from
 * offlineSync; nothing here claims a save the server did not confirm.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { OFFLINE_SYNC_EVENT, type OfflineSyncResult } from "@/lib/offlineSync";

type Lang = "de" | "en";

export function syncResultLines(result: OfflineSyncResult, lang: Lang): string[] {
  const lines: string[] = [];
  const dropped = result.unavailable + result.plan + result.conflict + result.gaveUp;
  if (result.sent > 0 || dropped > 0) {
    let line = t("a23_sync_sent", lang).replace("{n}", String(result.sent));
    if (dropped > 0) line += ` ${t("a23_sync_dropped", lang).replace("{n}", String(dropped))}`;
    lines.push(line);
  }
  if (result.waitingForLogin > 0) lines.push(t("a23_sync_login", lang).replace("{n}", String(result.waitingForLogin)));
  return lines;
}

export default function OfflineSyncNotice({ lang }: { lang: Lang }) {
  const [result, setResult] = useState<OfflineSyncResult | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(OFFLINE_SYNC_EVENT);
      if (raw) setResult(JSON.parse(raw) as OfflineSyncResult);
    } catch { /* storage blocked or malformed */ }
    const onResult = (e: Event) => setResult((e as CustomEvent<OfflineSyncResult>).detail);
    window.addEventListener(OFFLINE_SYNC_EVENT, onResult);
    return () => window.removeEventListener(OFFLINE_SYNC_EVENT, onResult);
  }, []);

  if (!result) return null;
  const lines = syncResultLines(result, lang);
  if (!lines.length) return null;
  const dismiss = () => {
    try { sessionStorage.removeItem(OFFLINE_SYNC_EVENT); } catch { /* storage blocked */ }
    setResult(null);
  };
  return (
    <div role="status" className="mp-card px-4 py-3 mb-3 flex items-start gap-3 text-[13px] text-[var(--mp-fg)]">
      <div className="flex-1 min-w-0 space-y-1">
        {lines.map((line) => <p key={line}>{line}</p>)}
        {result.waitingForLogin > 0 && (
          <Link href="/login?next=/quiz" className="inline-flex min-h-11 items-center font-semibold underline">{t("home_sign_in", lang)}</Link>
        )}
      </div>
      <button type="button" className="min-h-11 min-w-11 text-[var(--mp-fg-muted)]" aria-label={t("a23_sync_dismiss", lang)} onClick={dismiss}>×</button>
    </div>
  );
}
