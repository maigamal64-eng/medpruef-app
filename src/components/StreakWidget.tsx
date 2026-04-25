"use client";

import { useState, useEffect, useMemo } from "react";
import { t } from "@/lib/i18n";
import { authFetch as fetch } from "@/lib/authFetch";

type Lang = "de" | "en";

interface DayActivity {
  date: string;       // YYYY-MM-DD in Europe/Vienna
  answered: number;
  correct: number;
  xpEarned?: number;
}

/**
 * Intensity buckets tied to answered-count.
 * inactive: 0 answers
 * light:    1–4
 * mid:      5–14
 * strong:   15+
 * Today gets a slight visual lift on top of its intensity bucket.
 */
type Intensity = "inactive" | "light" | "mid" | "strong";

function bucketFor(answered: number): Intensity {
  if (answered <= 0) return "inactive";
  if (answered < 5) return "light";
  if (answered < 15) return "mid";
  return "strong";
}

function StreakCountdown({ lang }: { lang: Lang }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    function calcTimeLeft() {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      const diff = midnight.getTime() - now.getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    setTimeLeft(calcTimeLeft());
    const interval = setInterval(() => setTimeLeft(calcTimeLeft()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!timeLeft) return null;

  return (
    <p className="text-xs text-[var(--mp-status-warning)] font-mono mt-0.5">
      ⚠ {lang === "de" ? "Setzt zurück in" : "Resets in"} {timeLeft}
    </p>
  );
}

interface StreakWidgetProps {
  streak: number;
  lang: Lang;
}

/**
 * StreakWidget renders:
 *  - the current streak count + 🔥 emoji
 *  - a countdown until the Vienna-midnight reset (when streak > 0)
 *  - a 7-cell "last week" strip of REAL per-day activity
 *
 * Activity is fetched from `/api/stats/last7days` on mount via the
 * authenticated client helper. While the fetch is in flight, the
 * strip falls back to the simple "first N of 7 are lit" visualization
 * based on the streak prop — so nothing ever appears broken and
 * unauthenticated/guest users still see a sensible strip.
 *
 * DD-09 (2026-04-17): replaced the assumption-based strip with real
 * per-day data. The "today highlight" now uses the last entry of the
 * API response (= Vienna today) rather than `new Date().getDay()` so
 * the client's local TZ doesn't skew the visualization.
 */
export default function StreakWidget({ streak, lang }: StreakWidgetProps) {
  const [days, setDays] = useState<DayActivity[] | null>(null);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/stats/last7days", { cache: "no-store" });
        if (!r.ok) {
          // 401 for guests is expected — fall through to fallback
          // rendering. Other failures behave the same way.
          if (!cancelled) setError(true);
          return;
        }
        const json = (await r.json()) as { days?: DayActivity[] };
        if (!cancelled && Array.isArray(json.days) && json.days.length === 7) {
          setDays(json.days);
        } else if (!cancelled) {
          setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Day-of-week labels keyed off each entry's date so the strip
  // matches the actual Vienna calendar (not the client's system TZ).
  const dayLabels = useMemo(() => {
    const labelsDe = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    const labelsEn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const labels = lang === "de" ? labelsDe : labelsEn;

    if (days) {
      return days.map(d => {
        // Parse YYYY-MM-DD as a LOCAL date (not UTC) so the weekday
        // label lines up with Vienna's local calendar. Using `new
        // Date("2026-04-17")` would parse as UTC-midnight and flip to
        // the previous day for callers west of UTC.
        const [y, m, day] = d.date.split("-").map(Number);
        const local = new Date(y, (m || 1) - 1, day || 1);
        return labels[local.getDay()] || "";
      });
    }
    // Fallback order matches the legacy strip: Monday-first.
    return lang === "de"
      ? ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  }, [days, lang]);

  // Fallback strip — used while loading, on error, or for guests.
  // Lights the last N of 7 cells based on streak count, matching the
  // pre-DD-09 behavior.
  const fallbackCells = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => i < Math.min(streak, 7)),
    [streak]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>🔥</span>
          <div>
            <p className="text-3xl font-black text-[var(--mp-error)] font-mono">{streak}</p>
            <p className="text-xs text-[var(--mp-fg-muted)]">
              {t("streak", lang)} · {t("days", lang)}
            </p>
            {streak > 0 && <StreakCountdown lang={lang} />}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-1">
        {days && !error
          ? days.map((d, i) => {
              const isToday = i === days.length - 1;
              const intensity = bucketFor(d.answered);
              return (
                <DayCell
                  key={d.date}
                  intensity={intensity}
                  label={dayLabels[i] || ""}
                  answered={d.answered}
                  correct={d.correct}
                  date={d.date}
                  isToday={isToday}
                  lang={lang}
                />
              );
            })
          : fallbackCells.map((active, i) => {
              const intensity: Intensity = active ? "mid" : "inactive";
              // In the fallback we treat the last cell as "today" to
              // match the new data-driven visualization.
              const isToday = i === fallbackCells.length - 1;
              return (
                <DayCell
                  key={i}
                  intensity={intensity}
                  label={dayLabels[i] || ""}
                  answered={active ? 1 : 0}
                  correct={0}
                  date={null}
                  isToday={isToday}
                  lang={lang}
                  fallback
                />
              );
            })}
      </div>
    </div>
  );
}

interface DayCellProps {
  intensity: Intensity;
  label: string;
  answered: number;
  correct: number;
  date: string | null;
  isToday: boolean;
  lang: Lang;
  fallback?: boolean;
}

const INTENSITY_CLASS: Record<Intensity, string> = {
  inactive:
    "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)] border-[var(--mp-border)]",
  light:
    "bg-[color-mix(in_srgb,var(--mp-viridian)_35%,transparent)] text-white border-[color-mix(in_srgb,var(--mp-viridian)_40%,transparent)]",
  mid: "bg-[color-mix(in_srgb,var(--mp-viridian)_65%,transparent)] text-white border-[color-mix(in_srgb,var(--mp-viridian)_55%,transparent)]",
  strong: "bg-[var(--mp-viridian)] text-white border-[var(--mp-viridian)]",
};

function DayCell({
  intensity,
  label,
  answered,
  correct,
  date,
  isToday,
  lang,
  fallback = false,
}: DayCellProps) {
  const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;

  const ariaLabel = (() => {
    // Translate the weekday label back to a full-day name for a11y.
    // We keep it straightforward — short labels are fine for screen
    // readers too since the date gives full context in the tooltip.
    const dateStr = date || "";
    if (fallback) {
      return answered > 0
        ? lang === "de"
          ? `${label}: Tag der Serie`
          : `${label}: streak day`
        : lang === "de"
          ? `${label}: kein Lernen`
          : `${label}: no learning`;
    }
    if (answered === 0) {
      return lang === "de"
        ? `${label} ${dateStr}: kein Lernen`
        : `${label} ${dateStr}: no learning`;
    }
    return lang === "de"
      ? `${label} ${dateStr}: ${answered} Fragen beantwortet, ${accuracy}% korrekt`
      : `${label} ${dateStr}: ${answered} questions answered, ${accuracy}% correct`;
  })();

  const tooltip = fallback
    ? undefined
    : answered === 0
      ? lang === "de"
        ? `${date} · ${lang === "de" ? "kein Lernen" : "no learning"}`
        : `${date} · no learning`
      : lang === "de"
        ? `${date} · ${answered} Fragen · ${accuracy}% korrekt`
        : `${date} · ${answered} questions · ${accuracy}% correct`;

  const todayRing = isToday
    ? "ring-2 ring-offset-1 ring-[var(--mp-viridian)] ring-offset-[var(--mp-surface)]"
    : "";

  const content = (() => {
    if (intensity === "inactive") return "·";
    if (isToday) return answered > 0 ? answered : "·";
    return "✓";
  })();

  return (
    <div className="flex flex-col items-center gap-1 motion-safe:animate-[scale-in_200ms_ease-out]">
      <div
        title={tooltip}
        aria-label={ariaLabel}
        role="img"
        className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-medium border transition-colors ${INTENSITY_CLASS[intensity]} ${todayRing}`}
      >
        <span aria-hidden>{content}</span>
      </div>
      <span
        className={`text-[9px] ${
          isToday
            ? "text-[var(--mp-viridian)] font-semibold"
            : "text-[var(--mp-fg-subtle)]"
        }`}
      >
        {label}
      </span>
    </div>
  );
}
