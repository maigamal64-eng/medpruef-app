"use client";

/**
 * ReadinessSignal (Phase A.2) — the honest, banded readiness indicator.
 *
 * Shows a BAND ("how ready your practice looks"), four descriptive factor
 * bars (coverage / accuracy / consistency / pace), a trend arrow, and a
 * single concrete "what helps most right now" tip for the weakest factor.
 * It explicitly is NOT a prediction of the exam result (verbatim
 * disclaimer), and it never shows a composite number or a pass-%.
 *
 * Self-fetches /api/user/readiness. Austrian lens only. No em dashes.
 */

import { useEffect, useState } from "react";
import StudyReadError from "@/components/StudyReadError";
import { checkedJson } from "@/lib/async-data";
import { authFetch } from "@/lib/authFetch";
import { TrendingUp, TrendingDown, Minus, ShieldCheck, Sparkles } from "lucide-react";
import type { ReadinessBand, Trend, FactorKey } from "@/lib/readiness";

type Lang = "de" | "en";

interface ReadinessResponse {
  band: ReadinessBand;
  factors: { coverage: number; accuracy: number; consistency: number; pace: number | null };
  trend: Trend;
  lowestFactor: FactorKey;
  hasExamDate: boolean;
}

const BAND_META: Record<ReadinessBand, { label: { de: string; en: string }; color: string; track: string }> = {
  just_started: {
    label: { de: "Gerade gestartet", en: "Just getting started" },
    color: "var(--mp-fg-muted)",
    track: "var(--mp-fg-muted)",
  },
  building: {
    label: { de: "Im Aufbau", en: "Building" },
    color: "var(--mp-cta-blue)",
    track: "var(--mp-cta-blue)",
  },
  on_track: {
    label: { de: "Auf Kurs", en: "On track" },
    color: "var(--mp-viridian)",
    track: "var(--mp-viridian)",
  },
  exam_ready_looking: {
    label: { de: "Sieht prüfungsbereit aus", en: "Looking exam-ready" },
    color: "var(--mp-accent-teal)",
    track: "var(--mp-accent-teal)",
  },
};

const FACTOR_LABEL: Record<FactorKey, { de: string; en: string }> = {
  coverage: { de: "Abdeckung", en: "Coverage" },
  accuracy: { de: "Genauigkeit", en: "Accuracy" },
  consistency: { de: "Beständigkeit", en: "Consistency" },
  pace: { de: "Tempo", en: "Pace" },
};

// Single concrete action for the weakest factor (from A0-methodology.md §4.4).
const FACTOR_TIP: Record<FactorKey, { de: string; en: string }> = {
  coverage: {
    de: "Übe ein paar Fragen in Themen, die du noch nicht angefangen hast. Breite zählt hier am meisten.",
    en: "Practice a few questions in topics you have not touched yet. Breadth moves this most.",
  },
  accuracy: {
    de: "Geh langsamer vor und lies jede Erklärung, vor allem bei falsch beantworteten Fragen.",
    en: "Slow down and read every explanation, especially on questions you got wrong.",
  },
  consistency: {
    de: "Kurze tägliche Einheiten schlagen lange seltene. Versuch, diese Woche an ein paar Tagen dein Tagesziel zu treffen.",
    en: "Short daily sessions beat long rare ones. Aim to hit your daily goal a few days this week.",
  },
  pace: {
    de: "Du bist etwas hinter deinem Plan. Pack an den Tagen, an denen es geht, ein paar Fragen drauf.",
    en: "You are a little behind your plan. Add a few extra questions on the days you can.",
  },
};

const TREND_META: Record<Trend, { de: string; en: string; Icon: typeof TrendingUp; color: string }> = {
  up: { de: "steigend", en: "rising", Icon: TrendingUp, color: "var(--mp-viridian)" },
  flat: { de: "gleichbleibend", en: "steady", Icon: Minus, color: "var(--mp-fg-muted)" },
  down: { de: "fallend", en: "falling", Icon: TrendingDown, color: "var(--mp-status-warning)" },
};

export function isReadinessResponse(value: unknown): value is ReadinessResponse {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<ReadinessResponse>;
  const factors = data.factors;
  const validFactor = (n: unknown) => n === null || (typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1);
  return (
    typeof data.band === "string" && Object.prototype.hasOwnProperty.call(BAND_META, data.band) &&
    !!factors && typeof factors === "object" &&
    factors.coverage !== null && factors.accuracy !== null && factors.consistency !== null &&
    validFactor(factors.coverage) && validFactor(factors.accuracy) &&
    validFactor(factors.consistency) && validFactor(factors.pace) &&
    typeof data.trend === "string" && Object.prototype.hasOwnProperty.call(TREND_META, data.trend) &&
    typeof data.lowestFactor === "string" && Object.prototype.hasOwnProperty.call(FACTOR_TIP, data.lowestFactor) &&
    typeof data.hasExamDate === "boolean"
  );
}

export default function ReadinessSignal({ lang = "de" }: { lang?: Lang }) {
  const [data, setData] = useState<ReadinessResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setState("loading"); setError(null);
    authFetch("/api/user/readiness", { signal: controller.signal })
      .then((r) => checkedJson(r, isReadinessResponse))
      .then((d) => {
        if (!alive) return;
        if (!isReadinessResponse(d)) throw new Error("Invalid readiness response");
        setData(d);
        setState("ready");
      })
      .catch((err) => { if (alive) { setError(err); setState("error"); } });
    return () => {
      alive = false; controller.abort();
    };
  }, [reload]);

  if (state === "loading" && !data) {
    return <div className="h-24 rounded-xl bg-[var(--mp-surface-sunken)] animate-pulse" aria-hidden />;
  }
  const errorCard = error ? <StudyReadError page="readiness" error={error} lang={lang} retry={() => setReload(n => n + 1)} /> : null;
  if (!data) return errorCard;

  const band = BAND_META[data.band];
  const tip = FACTOR_TIP[data.lowestFactor];
  const trend = TREND_META[data.trend];
  const TrendIcon = trend.Icon;

  const factorKeys: FactorKey[] = ["coverage", "accuracy", "consistency", "pace"];

  return (
    <section aria-busy={state === "loading"}>{errorCard}<div className="rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-4">
      {/* Band */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {data.band === "exam_ready_looking" ? (
            <ShieldCheck className="w-5 h-5" style={{ color: band.color }} aria-hidden />
          ) : (
            <Sparkles className="w-5 h-5" style={{ color: band.color }} aria-hidden />
          )}
          <div>
            <p className="text-[12px] uppercase tracking-wider font-semibold text-[var(--mp-fg-subtle)]">
              {lang === "de" ? "Übungs-Bereitschaft" : "Practice readiness"}
            </p>
            <p className="text-base font-bold" style={{ color: band.color }}>
              {band.label[lang]}
            </p>
          </div>
        </div>
        <span
          className="inline-flex items-center gap-1 text-xs font-medium"
          style={{ color: trend.color }}
          title={lang === "de" ? "Trend deiner Genauigkeit" : "Your accuracy trend"}
        >
          <TrendIcon className="w-3.5 h-3.5" aria-hidden />
          {lang === "de" ? `Trend: ${trend.de}` : `Trend: ${trend.en}`}
        </span>
      </div>

      {/* Factor bars (descriptive strength, no misleading percentages) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        {factorKeys.map((k) => {
          const v = data.factors[k];
          if (v === null || v === undefined) return null; // pace hidden when no exam date
          const isLowest = k === data.lowestFactor;
          return (
            <div key={k}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[13px] font-medium ${isLowest ? "text-[var(--mp-fg)]" : "text-[var(--mp-fg-muted)]"}`}>
                  {FACTOR_LABEL[k][lang]}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--mp-surface-sunken)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.round(v * 100)}%`,
                    backgroundColor: isLowest ? "var(--mp-status-warning)" : band.track,
                  }}
                  aria-hidden
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* What helps most right now (weakest factor) */}
      <div className="mt-4 flex items-start gap-2 rounded-lg bg-[var(--mp-viridian)]/[0.06] border border-[var(--mp-viridian)]/15 px-3 py-2.5">
        <Sparkles className="w-4 h-4 text-[var(--mp-viridian)] shrink-0 mt-0.5" aria-hidden />
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-[var(--mp-viridian)]">
            {lang === "de" ? "Was jetzt am meisten hilft" : "What helps most right now"}
          </p>
          <p className="text-sm text-[var(--mp-fg-muted)] mt-0.5 leading-relaxed">{tip[lang]}</p>
        </div>
      </div>

      {/* Honest disclaimer (verbatim from the methodology spec) */}
      <p className="text-[13px] text-[var(--mp-fg-subtle)] mt-3 leading-relaxed">
        {lang === "de"
          ? "Das zeigt, wie bereit deine Übung aussieht: Abdeckung, Genauigkeit, Beständigkeit und Tempo im Vergleich zu deinem Plan. Es ist keine Vorhersage deines Prüfungsergebnisses."
          : "This shows how ready your practice looks: your coverage, accuracy, consistency, and pace vs your plan. It is not a prediction of your exam result."}
      </p>
    </div></section>
  );
}
