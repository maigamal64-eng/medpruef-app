"use client";

/**
 * StudyPathTimeline (Phase A.1) — the "path to exam day" milestone layer.
 *
 * Renders the registration-deadline anchor (escalating urgency) + the
 * weeks-out phase ladder (Foundation -> Build -> Consolidate -> Taper)
 * with the current phase highlighted. Pure presentation over
 * `buildStudyPath` (src/lib/studyPath.ts); no generator math here.
 *
 * Austrian lens only. No em dashes in user copy.
 */

import {
  CheckCircle2,
  Circle,
  CalendarClock,
  AlertTriangle,
  Flag,
} from "lucide-react";
import type { StudyPathSummary, PhaseStatus } from "@/lib/studyPath";

type Lang = "de" | "en";

function formatDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(
    lang === "de" ? "de-AT" : "en-GB",
    { day: "numeric", month: "long" },
  );
}

const REG_STYLE: Record<
  string,
  { wrap: string; icon: string; label: (n: number, lang: Lang) => string }
> = {
  quiet: {
    wrap: "border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]",
    icon: "text-[var(--mp-fg-subtle)]",
    label: (n, lang) =>
      lang === "de"
        ? `Anmeldeschluss in ${n} Tagen`
        : `Registration closes in ${n} days`,
  },
  soon: {
    wrap: "border-[var(--mp-status-warning)]/30 bg-[var(--mp-status-warning)]/10 text-[var(--mp-fg)]",
    icon: "text-[var(--mp-status-warning)]",
    label: (n, lang) =>
      lang === "de"
        ? `Bald anmelden: Anmeldeschluss in ${n} ${n === 1 ? "Tag" : "Tagen"}`
        : `Register soon: deadline in ${n} ${n === 1 ? "day" : "days"}`,
  },
  urgent: {
    wrap: "border-[var(--mp-error)]/40 bg-[var(--mp-error)]/10 text-[var(--mp-fg)]",
    icon: "text-[var(--mp-error)]",
    label: (n, lang) =>
      lang === "de"
        ? `Jetzt anmelden: Anmeldeschluss in ${n} ${n === 1 ? "Tag" : "Tagen"}`
        : `Register now: deadline in ${n} ${n === 1 ? "day" : "days"}`,
  },
  passed: {
    wrap: "border-[var(--mp-error)]/40 bg-[var(--mp-error)]/10 text-[var(--mp-fg)]",
    icon: "text-[var(--mp-error)]",
    label: (_n, lang) =>
      lang === "de"
        ? "Anmeldeschluss vorbei. Prüfe deinen Anmeldestatus."
        : "Registration deadline has passed. Check your registration status.",
  },
};

function dot(status: PhaseStatus) {
  if (status === "past") return "bg-[var(--mp-viridian)] border-[var(--mp-viridian)]";
  if (status === "current") return "bg-[var(--mp-cta-blue)] border-[var(--mp-cta-blue)] ring-4 ring-[var(--mp-cta-blue)]/20";
  return "bg-[var(--mp-surface-raised)] border-[var(--mp-border)]";
}

export default function StudyPathTimeline({
  path,
  lang = "de",
}: {
  path: StudyPathSummary;
  lang?: Lang;
}) {
  const current = path.phases.find((p) => p.status === "current") ?? path.phases[0];
  const reg = path.registration;
  const regStyle = reg ? REG_STYLE[reg.level] : null;

  return (
    <div className="mp-card p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-bold text-[var(--mp-fg)] flex items-center gap-2">
          <Flag className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden />
          {lang === "de" ? "Dein Weg zur Prüfung" : "Your path to the exam"}
        </h3>
        <span className="text-xs font-mono text-[var(--mp-fg-muted)]">
          {path.daysLeft === 0
            ? lang === "de" ? "heute" : "today"
            : lang === "de"
              ? `noch ${path.daysLeft} ${path.daysLeft === 1 ? "Tag" : "Tage"}`
              : `${path.daysLeft} ${path.daysLeft === 1 ? "day" : "days"} left`}
        </span>
      </div>

      {/* Registration-deadline anchor — the irreversible date, escalating urgency */}
      {reg && regStyle && (
        <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 mb-4 ${regStyle.wrap}`}>
          {reg.level === "quiet" ? (
            <CalendarClock className={`w-4 h-4 mt-0.5 shrink-0 ${regStyle.icon}`} aria-hidden />
          ) : (
            <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${regStyle.icon}`} aria-hidden />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">{regStyle.label(reg.daysLeft, lang)}</p>
            <p className="text-xs opacity-80 mt-0.5">
              {lang === "de" ? "Anmeldeschluss: " : "Registration deadline: "}
              {formatDate(reg.deadlineISO, lang)}
            </p>
          </div>
        </div>
      )}

      {/* Phase ladder */}
      <ol className="space-y-0">
        {path.phases.map((p, i) => {
          const isLast = i === path.phases.length - 1;
          return (
            <li key={p.key} className="flex gap-3">
              {/* rail */}
              <div className="flex flex-col items-center">
                <span
                  className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 mt-1 flex items-center justify-center ${dot(p.status)}`}
                >
                  {p.status === "past" && <CheckCircle2 className="w-2.5 h-2.5 text-white" aria-hidden />}
                </span>
                {!isLast && (
                  <span
                    className={`w-0.5 flex-1 my-1 ${
                      p.status === "past" ? "bg-[var(--mp-viridian)]/40" : "bg-[var(--mp-border)]"
                    }`}
                    style={{ minHeight: p.status === "current" ? 36 : 16 }}
                  />
                )}
              </div>
              {/* content */}
              <div className={`pb-3 min-w-0 ${p.status === "upcoming" ? "opacity-55" : ""}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-sm font-semibold ${
                      p.status === "current" ? "text-[var(--mp-cta-blue)]" : "text-[var(--mp-fg)]"
                    }`}
                  >
                    {p.label[lang]}
                  </span>
                  {p.status === "current" && (
                    <span className="inline-flex items-center bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)] text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                      {lang === "de" ? "Jetzt" : "Now"}
                    </span>
                  )}
                </div>
                {p.status === "current" && (
                  <p className="text-xs text-[var(--mp-fg-muted)] mt-1 leading-relaxed">
                    {p.blurb[lang]}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="sr-only">{current.label[lang]}</p>
    </div>
  );
}
