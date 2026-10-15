"use client";

/**
 * Today: Anthropic workspace spend (a-anthropic-features). One line with the
 * month and today against the workspace limit, a dot for ok / alarm (70 %) /
 * soft stop (95 %), and a disclosure with each feature's month-to-date calls,
 * cost and prompt-cache hit rate. Loaded on its own (GET /api/admin/ai-spend,
 * revenue.read) so it never holds the page. An unreadable figure says so,
 * never 0.
 */

import { useEffect, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { StatusDot, formatInt } from "../_components/primitives";
import { CouldNotLoad } from "./MoreSignals";

interface Meter {
  workspace: "prod" | "dev";
  monthCapMicro: number;
  dayCapMicro: number;
  monthMicro: number | null;
  dayMicro: number | null;
  monthPct: number | null;
  dayPct: number | null;
  state: "ok" | "alarm" | "soft_stop" | "unknown";
}

interface Feature {
  feature: string;
  calls: number;
  costMicro: number;
  cacheReadTokens: number;
  hitRate: number | null;
}

interface SpendBody {
  meter: Meter;
  features: Feature[] | null;
}

const FEATURE_LABEL: Record<string, string> = {
  mentor: "AI Mentor",
  ai_chat: "AI explanation chat",
  translate: "Translations",
  notes_transform: "Flash-note creation",
  notes_safety: "Note safety scan",
  other: "Other (older rows)",
};

function usd(micro: number | null, digits = 2): string {
  return micro === null ? "unknown" : `USD ${(micro / 1_000_000).toFixed(digits)}`;
}

const STATE_COPY: Record<Meter["state"], string> = {
  ok: "Within budget.",
  alarm: "Over 70 %: check the AI routes.",
  soft_stop: "Over 95 %: free and house-funded AI is resting, paid learners continue.",
  unknown: "Could not read every figure; the lane caps still apply.",
};

export function AiSpendRow({ refreshKey }: { refreshKey: number | null }) {
  const [body, setBody] = useState<SpendBody | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/ai-spend", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok || !json?.meter) throw new Error("ai-spend");
        setBody(json as SpendBody);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshKey, attempt]);

  if (failed && !body) {
    return (
      <section aria-label="AI spend" className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-3 py-2.5 text-xs">
        <span className="font-semibold text-[var(--mp-fg)]">AI spend</span>
        <CouldNotLoad onRetry={() => setAttempt((n) => n + 1)} />
      </section>
    );
  }
  if (!body) return null;
  const m = body.meter;
  const tone = m.state === "soft_stop" ? "danger" : m.state === "alarm" ? "warn" : m.state === "ok" ? "success" : "neutral";
  return (
    <section aria-label="AI spend" className="space-y-2 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-3 py-2.5 text-xs" data-testid="overview-ai-spend">
      <p className="flex min-w-0 items-start gap-2 text-[var(--mp-fg)]">
        <span className="mt-1">
          <StatusDot tone={tone} size={7} />
        </span>
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className="font-semibold">AI spend ({m.workspace === "prod" ? "production" : "development"} workspace): </span>
          {usd(m.monthMicro)} of USD {formatInt(Math.round(m.monthCapMicro / 1_000_000))} this month
          {m.monthPct !== null ? ` (${m.monthPct} %)` : ""}, today {usd(m.dayMicro)} of {usd(m.dayCapMicro)}
          {m.dayPct !== null ? ` (${m.dayPct} %)` : ""}. {STATE_COPY[m.state]}
          {failed ? " (last refresh failed, showing the previous reading)" : ""}
        </span>
      </p>
      <details className="group">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold text-[var(--mp-fg)] sm:min-h-8 sm:py-1">Per feature this month (UTC)</summary>
        {body.features === null ? (
          <p className="text-[var(--mp-fg-muted)]">Could not read the per-feature rows.</p>
        ) : body.features.length === 0 ? (
          <p className="text-[var(--mp-fg-muted)]">No AI calls this month.</p>
        ) : (
          <ul className="divide-y divide-[var(--mp-border-subtle)]" data-testid="overview-ai-spend-features">
            {body.features.map((f) => (
              <li key={f.feature} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5">
                <span className="font-medium text-[var(--mp-fg)]">{FEATURE_LABEL[f.feature] ?? f.feature}</span>
                <span className="text-[var(--mp-fg-muted)] tabular-nums">
                  {formatInt(f.calls)} call{f.calls === 1 ? "" : "s"}, {usd(f.costMicro, 4)}, cache hit {f.hitRate === null ? "n/a" : `${Math.round(f.hitRate * 100)} %`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[var(--mp-fg-muted)]">
          Cache hit = prompt tokens read from the prompt cache over all prompt tokens. Budget: the Anthropic workspace limit; the daily budget is the month spread evenly.
        </p>
      </details>
    </section>
  );
}
