"use client";

/**
 * ExamSittingPicker — the ONE shared exam-date control, used in both the
 * guided onboarding (Onboarding.tsx) and Settings (settings/page.tsx).
 *
 * Why it exists (Phase A.1): the old onboarding emitted vague presets
 * ("1month" / "3months" / "not_planned") that the home handler then
 * dropped unless they happened to be a real ISO date — so most onboarded
 * users ended up with users.exam_date = NULL and their study plan never
 * generated. This control anchors the date on the REAL upcoming Austrian
 * sittings from src/lib/exam-dates.ts (the self-aging calendar), so a
 * pick resolves to a concrete YYYY-MM-DD that drives /api/user/study-plan.
 *
 * Controlled: `value` is "" (no date yet) or a "YYYY-MM-DD" ISO date.
 * `onChange` always emits one of those two shapes.
 *
 * Austrian lens only. No em dashes in user copy ([name]'s rule).
 */

import { useMemo } from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  CalendarPlus,
  CircleSlash,
  ExternalLink,
} from "lucide-react";
import {
  getUpcomingSittings,
  PHARMA_INFO_URL,
  type ExamSitting,
  type PuypExamType,
} from "@/lib/exam-dates";

type Lang = "de" | "en";

interface ExamSittingPickerProps {
  /** Exam source id (kenntnispruefung | kmp_innsbruck | pharma). */
  examType: string;
  /** Selected ISO date "YYYY-MM-DD", or "" for "no date yet". */
  value: string;
  /** Emits a real ISO date or "" (never a preset string). */
  onChange: (iso: string) => void;
  lang?: Lang;
  /** Visual density: "modal" (onboarding) trims vertical padding. */
  density?: "modal" | "page";
}

const VALID_EXAM_TYPES: PuypExamType[] = [
  "kenntnispruefung",
  "kmp_innsbruck",
  "pharma",
];

function coerceExamType(id: string): PuypExamType {
  return (VALID_EXAM_TYPES as string[]).includes(id)
    ? (id as PuypExamType)
    : "kenntnispruefung";
}

/** Days from today (local) to an ISO date. Negative = in the past. */
function daysUntil(iso: string): number {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  const target = new Date(y, (m || 1) - 1, d || 1);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function formatDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(
    lang === "de" ? "de-AT" : "en-GB",
    { weekday: "short", day: "numeric", month: "long", year: "numeric" },
  );
}

export default function ExamSittingPicker({
  examType,
  value,
  onChange,
  lang = "de",
  density = "page",
}: ExamSittingPickerProps) {
  const et = coerceExamType(examType);

  // Future sittings for THIS exam only (self-aging, sorted ascending).
  const sittings = useMemo<ExamSitting[]>(
    () => getUpcomingSittings().filter((s) => s.examType === et),
    [et],
  );

  const sittingDates = useMemo(() => new Set(sittings.map((s) => s.date)), [sittings]);
  // A value that is set but matches no known sitting = a custom date.
  const isCustom = value !== "" && !sittingDates.has(value);

  const pad = density === "modal" ? "p-3.5" : "p-4";

  const selectedRing =
    "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/5";
  const idleRing =
    "border-[var(--mp-border)] hover:border-[var(--mp-fg-subtle)]";

  return (
    <div className="space-y-2.5">
      {/* Pharma (and any exam with no published sitting): rolling/term-based note */}
      {sittings.length === 0 && (
        <div className="rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-3.5">
          <p className="text-sm font-medium text-[var(--mp-fg)] flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--mp-fg-subtle)]" aria-hidden />
            {lang === "de"
              ? "Kein fester Prüfungstermin"
              : "No fixed exam date"}
          </p>
          <p className="text-xs text-[var(--mp-fg-muted)] mt-1 leading-relaxed">
            {lang === "de"
              ? "Diese Prüfung folgt den regulären Semester-Prüfungswochen. Setze dein Wunschdatum unten, um einen Lernplan zu erhalten."
              : "This exam follows the regular semester exam weeks. Set your target date below to get a study plan."}
          </p>
          <a
            href={PHARMA_INFO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[var(--mp-viridian)] hover:text-[var(--mp-accent-teal)] mt-2 transition-colors"
          >
            {lang === "de" ? "Offizielle Termine" : "Official dates"}
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Real upcoming sittings — the recommended anchor */}
      {sittings.map((s) => {
        const selected = value === s.date;
        const dleft = daysUntil(s.date);
        const regLeft = s.registrationDeadline
          ? daysUntil(s.registrationDeadline)
          : null;
        return (
          <button
            key={s.date}
            type="button"
            onClick={() => onChange(s.date)}
            aria-pressed={selected}
            className={`w-full ${pad} rounded-xl border-2 text-left transition-all ${
              selected ? selectedRing : idleRing
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[var(--mp-fg)]">
                    {s.label[lang]}
                  </span>
                  {s.location && (
                    <span className="inline-flex items-center gap-1 text-xs text-[var(--mp-fg-muted)]">
                      <MapPin className="w-3 h-3" aria-hidden />
                      {s.location}
                    </span>
                  )}
                </div>
                <p className="text-sm text-[var(--mp-fg-muted)] mt-0.5">
                  {formatDate(s.date, lang)}
                </p>
                <div className="flex items-center gap-2 flex-wrap mt-1.5">
                  {dleft >= 0 && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--mp-viridian)]">
                      <Clock className="w-3 h-3" aria-hidden />
                      {lang === "de"
                        ? `in ${dleft} ${dleft === 1 ? "Tag" : "Tagen"}`
                        : `in ${dleft} ${dleft === 1 ? "day" : "days"}`}
                    </span>
                  )}
                  {s.registrationDeadline && regLeft !== null && (
                    <span
                      className={`inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded ${
                        regLeft < 0
                          ? "bg-[var(--mp-status-warning)]/15 text-[var(--mp-status-warning)]"
                          : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]"
                      }`}
                    >
                      {regLeft < 0
                        ? lang === "de"
                          ? "Anmeldung geschlossen"
                          : "Registration closed"
                        : lang === "de"
                          ? `Anmeldeschluss in ${regLeft} ${regLeft === 1 ? "Tag" : "Tagen"}`
                          : `Registration closes in ${regLeft} ${regLeft === 1 ? "day" : "days"}`}
                    </span>
                  )}
                </div>
              </div>
              {selected && (
                <CheckCircle2 className="w-5 h-5 text-[var(--mp-viridian)] shrink-0" aria-hidden />
              )}
            </div>
          </button>
        );
      })}

      {/* Custom date */}
      <div>
        <button
          type="button"
          onClick={() => {
            // Selecting "custom" without a value yet keeps value empty until
            // the user picks a date in the revealed input.
            if (!isCustom) onChange("");
          }}
          aria-pressed={isCustom}
          className={`w-full ${pad} rounded-xl border-2 text-left transition-all ${
            isCustom ? selectedRing : idleRing
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm text-[var(--mp-fg)] flex items-center gap-2">
              <CalendarPlus className="w-4 h-4 text-[var(--mp-fg-subtle)]" aria-hidden />
              {lang === "de" ? "Eigenes Datum" : "Custom date"}
            </span>
            {isCustom && (
              <CheckCircle2 className="w-5 h-5 text-[var(--mp-viridian)] shrink-0" aria-hidden />
            )}
          </div>
        </button>
        {/* Always-available date input under the custom option. Picking a
            date here sets value directly (and flips the option to selected). */}
        <input
          type="date"
          value={isCustom ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 w-full px-3 py-2.5 border border-[var(--mp-border)] rounded-xl bg-[var(--mp-surface-raised)] text-[var(--mp-fg)] focus:outline-none focus:border-[var(--mp-viridian)] text-sm"
          aria-label={lang === "de" ? "Eigenes Prüfungsdatum" : "Custom exam date"}
        />
      </div>

      {/* Not sure yet */}
      <button
        type="button"
        onClick={() => onChange("")}
        aria-pressed={value === ""}
        className={`w-full ${pad} rounded-xl border-2 text-left transition-all ${
          value === "" ? selectedRing : idleRing
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="font-medium text-sm text-[var(--mp-fg)] flex items-center gap-2">
            <CircleSlash className="w-4 h-4 text-[var(--mp-fg-subtle)]" aria-hidden />
            {lang === "de" ? "Noch nicht sicher" : "Not sure yet"}
          </span>
          {value === "" && (
            <CheckCircle2 className="w-5 h-5 text-[var(--mp-viridian)] shrink-0" aria-hidden />
          )}
        </div>
        <p className="text-xs text-[var(--mp-fg-subtle)] mt-1">
          {lang === "de"
            ? "Du kannst den Termin jederzeit in den Einstellungen setzen."
            : "You can set the date any time in Settings."}
        </p>
      </button>
    </div>
  );
}
