"use client";

/**
 * "Für offline laden" entry (LX-16) on Home and in the quiz: one tap to
 * Settings > Offline lernen, with what this device holds for the active exam
 * and when it was last updated (getLastSync). Signed-in accounts only; the
 * count belongs to the account that downloaded it (ensureOfflineOwner).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { CloudDownload } from "lucide-react";
import { countQuestions, getLastSync } from "@/lib/offlineDb";
import { ensureOfflineOwner } from "@/lib/offline-pack";
import { syncStamp, to } from "@/lib/i18n-offline";

interface Props {
  lang: string;
  examType: string;
  userId: string | null;
  variant?: "card" | "link";
}

export function entryLine(stored: number | null, lastSync: string | null, lang: string): string {
  if (!stored) return to("entry_none", lang);
  const stamp = syncStamp(lastSync, lang);
  return stamp ? to("entry_some", lang, { n: stored, date: stamp }) : to("entry_some_nodate", lang, { n: stored });
}

export default function OfflinePackEntry({ lang, examType, userId, variant = "card" }: Props) {
  const [stored, setStored] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || userId.startsWith("guest_")) return;
    let cancelled = false;
    void (async () => {
      await ensureOfflineOwner(userId).catch(() => false);
      const count = await countQuestions(examType).catch(() => null);
      if (cancelled) return;
      setStored(count);
      setLastSync(getLastSync(examType));
    })();
    return () => { cancelled = true; };
  }, [userId, examType]);

  if (!userId || userId.startsWith("guest_")) return null;
  const line = entryLine(stored, lastSync, lang);

  if (variant === "link") {
    return (
      <Link href="/settings#offline" prefetch={false} className="text-xs underline inline-flex items-center gap-1 min-h-11 sm:min-h-0" data-testid="offline-entry-link">
        <CloudDownload className="w-3.5 h-3.5" aria-hidden />
        <span>{to("entry_title", lang)}</span>
        <span className="text-[var(--mp-fg-muted)] no-underline">({line})</span>
      </Link>
    );
  }

  return (
    <Link
      href="/settings#offline"
      prefetch={false}
      className="card flex items-center gap-3 p-4 min-h-11 hover:border-[var(--mp-viridian)] transition-colors"
      data-testid="offline-entry-card"
    >
      <CloudDownload className="w-5 h-5 flex-shrink-0 text-[var(--mp-viridian)]" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--mp-fg)]">{to("entry_title", lang)}</span>
        <span className="block text-xs text-[var(--mp-fg-muted)]">{line}</span>
      </span>
    </Link>
  );
}
