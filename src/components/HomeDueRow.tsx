"use client";
/**
 * HomeDueRow (LX-06, UX-HOME-15): "Heute fällig: N" for accounts with review
 * scheduling, one tap to a capped due-first round. Text, not colour. A free
 * account never sees a due number (its review mode is Pro): the row is absent.
 * Counts come from GET /api/user/due-summary (one server source with
 * /flashcards); nothing renders until that answer arrives, and a failed read
 * renders nothing rather than an invented count.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { t, type Lang } from "@/lib/i18n";
import { buildQuizHref } from "@/lib/quiz-links";
import { formatNumberText } from "@/lib/master-locale/format";
import { renderedLanguage } from "@/lib/master-locale/render";
import type { DueSummary } from "@/lib/master-learning/due-summary";

export function isDueSummary(v: unknown): v is DueSummary {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (s.entitled === false) return true;
  const n = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0;
  return s.entitled === true && n(s.dueToday) && n(s.overdue) && n(s.capped) && n(s.remaining) && n(s.cap)
    && Array.isArray(s.next7) && s.next7.every(n);
}

/** Pure copy for the row (exported for tests). */
export function dueRowText(summary: DueSummary, lang: Lang): { line: string; rest: string | null } | null {
  if (!summary.entitled) return null;
  const fmt = renderedLanguage(lang).lang;
  if (summary.dueToday > 0) {
    return {
      line: t("a12_due_today", lang).replace("{n}", formatNumberText(summary.dueToday, fmt)),
      rest: summary.remaining > 0 ? t("a22_due_rest", lang).replace("{n}", formatNumberText(summary.capped, fmt)).replace("{rest}", formatNumberText(summary.remaining, fmt)) : null,
    };
  }
  const next = summary.next7.findIndex((x) => x > 0);
  if (next === -1) return { line: t("a12_due_none", lang), rest: null };
  const when = next === 0 ? t("a12_due_next_tomorrow", lang) : t("a12_due_next_days", lang).replace("{n}", formatNumberText(next + 1, fmt));
  return { line: `${t("a12_due_none", lang)} ${t("a22_due_next", lang).replace("{when}", when).replace("{n}", formatNumberText(summary.next7[next], fmt))}`, rest: null };
}

export default function HomeDueRow({ examSource, lang, entitled, onStart }: {
  examSource: string; lang: Lang; entitled: boolean; onStart?: () => void;
}) {
  const [summary, setSummary] = useState<DueSummary | null>(null);
  useEffect(() => {
    setSummary(null);
    if (!entitled) return;
    const controller = new AbortController();
    authFetch(`/api/user/due-summary?examType=${encodeURIComponent(examSource)}`, { signal: controller.signal, timeoutMs: 8_000 })
      .then(async (res) => {
        if (!res.ok) return;
        const body: unknown = await res.json();
        if (!controller.signal.aborted && isDueSummary(body)) setSummary(body);
      })
      .catch(() => { /* no invented count on failure */ });
    return () => controller.abort();
  }, [examSource, entitled]);

  if (!entitled || !summary) return null;
  const text = dueRowText(summary, lang);
  if (!text) return null;
  const due = summary.entitled && summary.dueToday > 0;
  return (
    <section aria-labelledby="home-due-title" className="mp-card flex flex-wrap items-center justify-between gap-3 p-4" style={{ borderRadius: "var(--mp-r-card)" }} data-testid="home-due-row">
      <div className="flex items-start gap-3 min-w-0">
        <RotateCcw className="w-5 h-5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]" aria-hidden />
        <div className="min-w-0">
          <h2 id="home-due-title" className="text-[15px] font-semibold text-[var(--mp-fg)]">{text.line}</h2>
          {text.rest && <p className="text-[13px] text-[var(--mp-fg-muted)]">{text.rest}</p>}
        </div>
      </div>
      {due && summary.entitled && (
        <Link
          href={buildQuizHref({ examSource, practiceMode: "review", limit: summary.capped })}
          onClick={onStart}
          className="mp-btn mp-btn--secondary min-h-11"
        >
          {t("a22_due_start", lang).replace("{n}", formatNumberText(summary.capped, renderedLanguage(lang).lang))}
        </Link>
      )}
    </section>
  );
}
