"use client";

import { useMemo, useState } from "react";
import { BellRing, CheckCircle2 } from "lucide-react";
import { t, type Lang } from "@/lib/i18n";
import {
  bankForOfficialKey,
  getNextOfficialDeadlineGroup,
  getUpcomingOfficialFor,
} from "@/lib/exam-dates";
import {
  describeDeadlineGroup,
  describeStpSitting,
  describeUpcomingGroup,
} from "@/lib/i18n-dates";
import { getStoredAttribution } from "@/lib/attribution";

/**
 * Exam deadline reminder capture (2026-07-03). Shows the nearest real
 * registration deadline and captures an email so we can nudge the candidate
 * before it closes. Posts to /api/reminders.
 *
 * Since W1-CAL (2026-10-10) the deadline comes from the OFFICIAL sittings
 * (C7 `OFFICIAL_SITTINGS`: SIP4a/SIP5a, Rezeptierkunde/Gerichtsmedizin,
 * Stichprobentest with both publishers), compared in Vienna time. It no
 * longer shows the postgraduate ÖÄK date. The reminder's exam_type maps back
 * to the legacy bank key so /api/reminders does not drop it to "all".
 */
export default function DeadlineReminder({ lang }: { lang: Lang }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  const next = useMemo(() => {
    const now = new Date();
    const g = getNextOfficialDeadlineGroup({ now });
    if (!g) return null;
    const first = g.rows[0];
    let text: string;
    if (first.exam_key === "stichprobentest") {
      // Both publishers for that sitting, each with its label.
      const rows = getUpcomingOfficialFor({ exams: ["stichprobentest"], now }).filter(
        (r) => r.date === first.date
      );
      text = describeStpSitting(rows, lang);
    } else {
      text = g.started ? describeDeadlineGroup(g, lang, now) : describeUpcomingGroup(g, lang);
    }
    return { text, examType: bankForOfficialKey(first.exam_key) ?? "all" };
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
          exam_type: next?.examType ?? "all",
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
            <span className="text-[var(--mp-fg)] font-medium">{t("reminder_next", lang)}</span>{" "}
            {next.text}
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
