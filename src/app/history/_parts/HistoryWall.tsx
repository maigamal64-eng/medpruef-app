"use client";

/**
 * Detail gate for free and lapsed learners (UX-EXM-38, pick B). Names the
 * stored data from the counts-only list ("3 Prüfungen sind gespeichert,
 * zuletzt 66 Prozent."), says the results stay saved, one CTA "Zu Pro". No
 * loss or urgency framing, no decorative crown.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/authFetch";
import { th } from "@/lib/i18n-history";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { wallDataLine } from "./history-rules";

export default function HistoryWall({ lang }: { lang: string }) {
  const { audience, isLoading, error } = useUserTier();
  const [data, setData] = useState<{ count: number | null; latest: number | null } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await authFetch("/api/history/exams?limit=1");
        if (!res.ok) return;
        const d = (await res.json()) as { total?: unknown; attempts?: { score_pct?: unknown }[] };
        const latest = Array.isArray(d.attempts) && d.attempts[0] ? Number(d.attempts[0].score_pct) : null;
        if (alive) setData({ count: typeof d.total === "number" ? d.total : null, latest: latest !== null && Number.isFinite(latest) ? latest : null });
      } catch { /* the data line is optional */ }
    })();
    return () => { alive = false; };
  }, []);

  const lapsed = !isLoading && !error && audience === "lapsed";
  const line = data ? wallDataLine(data.count, data.latest, lang) : null;

  return (
    <div className="card mt-2 p-6 text-center sm:p-8">
      <h2 className="mp-h3 mb-3 text-[var(--mp-fg)]">{th(lapsed ? "wall_title_lapsed" : "wall_title_free", lang)}</h2>
      {line && <p className="mb-1 text-[var(--mp-fg)]">{line}</p>}
      <p className="mb-6 text-[var(--mp-fg-muted)]">{th("wall_kept", lang)}</p>
      <Link href="/pricing?gate=history" className="mp-btn mp-btn--primary min-h-11">
        {th("to_pro", lang)}
      </Link>
      <p className="mt-4">
        <Link href="/history" className="inline-flex min-h-11 items-center text-sm text-[var(--mp-cta)] underline-offset-2 hover:underline">
          {th("wall_list_link", lang)}
        </Link>
      </p>
    </div>
  );
}
