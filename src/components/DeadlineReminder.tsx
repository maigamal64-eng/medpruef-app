"use client";

import { useMemo, useState } from "react";
import { BellRing, CheckCircle2 } from "lucide-react";
import { t, type Lang } from "@/lib/i18n";
import { getUpcomingSittings } from "@/lib/exam-dates";
import { getStoredAttribution } from "@/lib/attribution";

/**
 * Exam deadline reminder capture (2026-07-03). Shows the nearest real
 * registration deadline (from the self-aging exam calendar) and captures an
 * email so we can nudge the candidate before it closes. The market's purest
 * lead magnet: a scared candidate always wants this. Posts to /api/reminders.
 */
export default function DeadlineReminder({ lang }: { lang: Lang }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const next = useMemo(() => {
    const s = getUpcomingSittings()[0];
    if (!s) return null;
    const d = new Date(`${s.registrationDeadline ?? s.date}T00:00:00Z`);
    const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
    const dateStr = d.toLocaleDateString(lang === "de" ? "de-AT" : lang, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return { sitting: s, dateStr, days };
  }, [lang]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "loading") return;
    setState("loading");
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          exam_type: next?.sitting.examType ?? "all",
          locale: lang,
          source: "landing_deadline",
          attribution: getStoredAttribution(),
        }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (!next) return null;

  return (
    <div className="mp-card rounded-2xl border border-[var(--mp-border)] p-6 md:p-7 bg-[var(--mp-surface-raised)]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)]">
          <BellRing className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-[var(--mp-fg)]">
            {t("reminder_title", lang)}
          </h3>
          <p className="mt-1 text-sm text-[var(--mp-fg-muted)]">
            {t("reminder_next", lang)}{" "}
            <strong className="text-[var(--mp-fg)]">
              {next.sitting.label[lang === "de" ? "de" : "en"]}
              {next.sitting.location ? `, ${next.sitting.location}` : ""}
            </strong>{" "}
            {"·"} {t("reminder_deadline", lang)} <strong className="text-[var(--mp-fg)]">{next.dateStr}</strong>{" "}
            <span className="text-[var(--mp-viridian)] font-medium">({next.days} {t("reminder_days_left", lang)})</span>
          </p>
        </div>
      </div>

      {state === "done" ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--mp-viridian)]/10 px-4 py-3 text-sm text-[var(--mp-viridian)]">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {t("reminder_done", lang)}
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("reminder_email_placeholder", lang)}
            className="mp-field flex-1 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface)] px-4 py-2.5 text-sm text-[var(--mp-fg)] outline-none focus:border-[var(--mp-viridian)]"
            aria-label={t("reminder_email_placeholder", lang)}
          />
          <button
            type="submit"
            disabled={state === "loading"}
            className="btn-primary rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-60"
          >
            {state === "loading" ? t("reminder_sending", lang) : t("reminder_cta", lang)}
          </button>
        </form>
      )}
      {state === "error" && (
        <p className="mt-2 text-xs text-[var(--mp-status-error)]">{t("reminder_error", lang)}</p>
      )}
      <p className="mt-2 text-xs text-[var(--mp-fg-subtle)]">{t("reminder_privacy", lang)}</p>
    </div>
  );
}
