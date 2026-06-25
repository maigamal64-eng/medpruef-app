"use client";

/**
 * GuidedPathCard (Phase A.1) — the home-dashboard entry into the guided
 * study path. Replaces the old inline exam-countdown tile: keeps the
 * countdown, and adds the current weeks-out phase, a registration-deadline
 * nudge, and a CTA into /study-plan. Computes everything client-side from
 * the user's exam date + active exam via buildStudyPath (no extra fetch).
 *
 * Austrian lens only. No em dashes in user copy.
 */

import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";
import { buildStudyPath } from "@/lib/studyPath";

type Lang = "de" | "en";

function urgencyColor(daysLeft: number): string {
  if (daysLeft <= 14) return "var(--mp-error)";
  if (daysLeft <= 30) return "var(--mp-warning-dk)";
  return "var(--mp-viridian)";
}

export default function GuidedPathCard({
  examISO,
  activeExam,
  lang = "de",
}: {
  examISO: string;
  activeExam: string;
  lang?: Lang;
}) {
  const path = buildStudyPath(examISO, activeExam);

  // Exam date today/past → gentle "update it" prompt (rare; parent usually
  // only mounts this for a future date).
  if (!path) {
    return (
      <Link
        href="/settings"
        className="rounded-2xl p-6 flex flex-col items-center justify-center text-center mp-focusable"
        style={{
          background: "var(--mp-surface-raised)",
          border: "1px solid var(--mp-border-subtle)",
          boxShadow: "var(--mp-shadow-card)",
        }}
      >
        <CalendarClock className="w-8 h-8 text-[var(--mp-fg-subtle)] mb-2" aria-hidden />
        <p className="text-sm font-semibold text-[var(--mp-fg)]">
          {lang === "de" ? "Prüfungstermin aktualisieren" : "Update your exam date"}
        </p>
        <p className="text-xs text-[var(--mp-fg-muted)] mt-1">
          {lang === "de"
            ? "Dein Termin liegt in der Vergangenheit."
            : "Your date is in the past."}
        </p>
      </Link>
    );
  }

  const color = urgencyColor(path.daysLeft);
  const phase = path.phases.find((p) => p.status === "current") ?? path.phases[0];
  const reg = path.registration;
  const showReg = reg && (reg.level === "soon" || reg.level === "urgent");

  return (
    <div
      className="rounded-2xl p-6 flex flex-col items-center justify-center text-center"
      style={{
        background: "var(--mp-surface-raised)",
        border: "1px solid var(--mp-border-subtle)",
        boxShadow: "var(--mp-shadow-card)",
      }}
      aria-label={lang === "de" ? "Dein Weg zur Prüfung" : "Your path to the exam"}
    >
      <p className="mp-caption mb-2" style={{ color, letterSpacing: "0.08em" }}>
        {lang === "de" ? "Countdown zur Prüfung" : "Exam countdown"}
      </p>
      <p
        className="mp-num"
        style={{
          fontFamily: "var(--mp-font-display)",
          fontWeight: 900,
          fontSize: 64,
          lineHeight: 1,
          color,
        }}
      >
        {path.daysLeft}
      </p>
      <p className="text-sm text-[var(--mp-fg-muted)] mt-1">
        {lang === "de" ? "Tage bis zur Prüfung" : "days until your exam"}
      </p>

      {/* Current weeks-out phase */}
      <span className="inline-flex items-center gap-1.5 mt-3 bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)] text-xs font-semibold px-3 py-1 rounded-full">
        {lang === "de" ? "Jetzt: " : "Now: "}
        {phase.label[lang]}
      </span>

      {/* Registration nudge (only when soon/urgent) */}
      {showReg && reg && (
        <p
          className="text-xs font-medium mt-2 flex items-center gap-1"
          style={{ color: reg.level === "urgent" ? "var(--mp-error)" : "var(--mp-status-warning)" }}
        >
          <CalendarClock className="w-3.5 h-3.5" aria-hidden />
          {lang === "de"
            ? `Anmeldeschluss in ${reg.daysLeft} ${reg.daysLeft === 1 ? "Tag" : "Tagen"}`
            : `Registration closes in ${reg.daysLeft} ${reg.daysLeft === 1 ? "day" : "days"}`}
        </p>
      )}

      <Link
        href="/study-plan"
        className="inline-flex items-center gap-1.5 mt-4 text-sm font-semibold text-[var(--mp-viridian)] hover:gap-2.5 transition-all mp-focusable"
      >
        {lang === "de" ? "Lernplan ansehen" : "View your study plan"}
        <ArrowRight className="w-4 h-4" aria-hidden />
      </Link>
    </div>
  );
}
