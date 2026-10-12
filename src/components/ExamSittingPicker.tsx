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
 * Since W1-CAL (2026-10-10) the options are the OFFICIAL sittings of the
 * C7 export for the learner's bank: SIP4a/SIP5a for the Vienna bank (never
 * the postgraduate ÖÄK date), the Rezeptierkunde/Gerichtsmedizin exam weeks
 * for Pharma (the week's first day is the target date), and the
 * Stichprobentest sittings with both publishers' deadlines.
 *
 * Controlled: `value` is "" (no date yet) or a "YYYY-MM-DD" ISO date.
 * `onChange` always emits one of those two shapes.
 *
 * Austrian lens only. No em dashes in user copy ([name]'s rule).
 */

import { useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  CalendarPlus,
  CircleSlash,
  ExternalLink,
} from "lucide-react";
import {
  OFFICIAL_KEYS_BY_BANK,
  PHARMA_INFO_URL,
  daysUntilViennaDate,
  getUpcomingOfficialFor,
  groupOfficialByDate,
  hasOfficialWindowStarted,
  isOfficialWindowOpen,
  type OfficialDateGroup,
  type PuypExamType,
} from "@/lib/exam-dates";
import {
  deadlineLabel,
  formatOfficialDate,
  formatSittingWhen,
  formatWindow,
  joinList,
  shortExamName,
  td,
} from "@/lib/i18n-dates";

import { t } from "@/lib/i18n";
import { TextField } from "@/components/ui";

type Lang = "de" | "en";

interface ExamSittingPickerProps {
  /** Exam source id (kenntnispruefung | kmp_innsbruck | pharma). */
  examType: string;
  /** Selected ISO date "YYYY-MM-DD", or "" for "no date yet". */
  value: string | null;
  /** Emits a real ISO date or "" (never a preset string). */
  onChange: (iso: string) => void;
  onCustomStart?: () => void;
  lang?: Lang;
  /** Visual density: "modal" (onboarding) trims vertical padding. */
  density?: "modal" | "page";
  /** Id of a hint that describes the choice group (UX-ONB-29). */
  describedBy?: string;
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
  onCustomStart,
  lang = "de",
  density = "page",
  describedBy,
}: ExamSittingPickerProps) {
  const et = coerceExamType(examType);
  const [showAll, setShowAll] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);

  // Official upcoming sittings for THIS bank, one option per date.
  const groups = useMemo<OfficialDateGroup[]>(
    () => groupOfficialByDate(getUpcomingOfficialFor({ exams: OFFICIAL_KEYS_BY_BANK[et] })),
    [et],
  );

  const sittingDates = useMemo(() => new Set(groups.map((g) => g.date)), [groups]);
  // A value that is set but matches no known sitting = a custom date.
  const isCustom = !!value && !sittingDates.has(value);
  const anyChecked = value !== null || customOpen;
  const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const customPast = isCustom && !!value && value < todayIso;

  const pad = density === "modal" ? "p-3.5" : "p-4";

  const selectedRing =
    "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/5";
  const idleRing =
    "border-[var(--mp-border)] hover:border-[var(--mp-fg-subtle)]";

  return (
    <div className="space-y-2.5">
      {/* No published official sitting: honest empty state */}
      {groups.length === 0 && (
        <div className="rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-3.5">
          <p className="text-sm font-medium text-[var(--mp-fg)] flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--mp-fg-subtle)]" aria-hidden />
            {td("picker_no_official", lang)}
          </p>
          <p className="text-xs text-[var(--mp-fg-muted)] mt-1 leading-relaxed">
            {td("picker_no_official_body", lang)}
          </p>
          <a
            href={PHARMA_INFO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[var(--mp-viridian)] hover:text-[var(--mp-accent-teal)] mt-2 transition-colors"
          >
            {td("official_dates", lang)}
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {groups.length > 0 && (
        <p className="text-xs text-[var(--mp-fg-muted)] leading-relaxed">
          {td("picker_official_hint", lang)}
        </p>
      )}

      {/* UX-ONB-29: one labelled radio group with roving focus; nothing is
          preselected while value is null. */}
      <div
        role="radiogroup"
        aria-label={t("a22_picker_group", lang)}
        aria-describedby={describedBy}
        className="space-y-2.5"
        onKeyDown={(e) => {
          if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
          const radios = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
          const i = radios.indexOf(document.activeElement as HTMLButtonElement);
          if (i < 0) return;
          e.preventDefault();
          const nextIndex = e.key === "Home" ? 0 : e.key === "End" ? radios.length - 1
            : (i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : radios.length - 1)) % radios.length;
          radios[nextIndex]?.focus();
          radios[nextIndex]?.click();
        }}
      >
      {/* Official upcoming sittings: the recommended anchor */}
      {(showAll || (value && groups.findIndex(g => g.date === value) >= 3) ? groups : groups.slice(0, 3)).map((g) => {
        const selected = value === g.date && !customOpen;
        const dleft = daysUntil(g.date);
        const isStp = g.rows[0].exam_key === "stichprobentest";
        const title = isStp
          ? lang === "de"
            ? g.rows[0].learner_label.de
            : g.rows[0].learner_label.en
          : joinList(g.rows.map((r) => shortExamName(r, lang)), lang);
        // One deadline per distinct (close, publisher, type).
        const deadlines = [
          ...new Map(
            g.rows.map((r) => [`${r.registration_closes}|${r.publisher}|${r.deadline_type}`, r]),
          ).values(),
        ].sort((a, b) => (a.registration_closes ?? "").localeCompare(b.registration_closes ?? ""));
        return (
          <button
            key={g.date}
            type="button"
            onClick={() => { setCustomOpen(false); onChange(g.date); }}
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (!anyChecked && g.date === groups[0]?.date) ? 0 : -1}
            className={`w-full min-h-[56px] ${pad} rounded-xl border-2 text-left transition-all mp-focusable ${
              selected ? selectedRing : idleRing
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[var(--mp-fg)]">{title}</span>
                </div>
                <p className="text-sm text-[var(--mp-fg-muted)] mt-0.5">
                  {g.date_end ? formatSittingWhen(g, lang) : formatDate(g.date, lang)}
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
                  {deadlines.map((r) => {
                    if (!r.registration_closes) return null;
                    const open = isOfficialWindowOpen(r);
                    const started = hasOfficialWindowStarted(r);
                    const regLeft = daysUntilViennaDate(r.registration_closes);
                    let text: string;
                    if (isStp) {
                      // Both publishers, labelled; no instruction wording.
                      text = `${deadlineLabel(r, lang)}: ${formatOfficialDate(r.registration_closes, lang)}`;
                    } else if (!open) {
                      text = lang === "de" ? "Anmeldung geschlossen" : "Registration closed";
                    } else if (!started) {
                      text = formatWindow(r, lang);
                    } else if (regLeft <= 0) {
                      text = td("closes_today", lang);
                    } else {
                      text =
                        lang === "de"
                          ? `Anmeldeschluss in ${regLeft} ${regLeft === 1 ? "Tag" : "Tagen"}`
                          : `Registration closes in ${regLeft} ${regLeft === 1 ? "day" : "days"}`;
                    }
                    return (
                      <span
                        key={`${r.publisher}-${r.registration_closes}`}
                        className={`inline-flex items-center text-[11px] font-medium px-1.5 py-0.5 rounded ${
                          !open
                            ? "bg-[var(--mp-status-warning)]/15 text-[var(--mp-status-warning)]"
                            : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]"
                        }`}
                      >
                        {text}
                      </span>
                    );
                  })}
                </div>
              </div>
              {selected && (
                <CheckCircle2 className="w-5 h-5 text-[var(--mp-viridian)] shrink-0" aria-hidden />
              )}
            </div>
          </button>
        );
      })}

      {groups.length > 3 && !showAll && <button type="button" onClick={() => setShowAll(true)} className="mp-btn mp-btn--secondary min-h-11 w-full">{t("study_more_dates", lang)}</button>}
      {/* Custom date */}
      <div>
        <button
          type="button"
          onClick={() => { setCustomOpen(true); onCustomStart?.(); }}
          role="radio"
          aria-checked={isCustom || customOpen}
          tabIndex={isCustom || customOpen || (!anyChecked && groups.length === 0) ? 0 : -1}
          className={`w-full min-h-[56px] ${pad} rounded-xl border-2 text-left transition-all mp-focusable ${
            isCustom ? selectedRing : idleRing
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm text-[var(--mp-fg)] flex items-center gap-2">
              <CalendarPlus className="w-4 h-4 text-[var(--mp-fg-subtle)]" aria-hidden />
              {t("a22_picker_custom", lang)}
            </span>
            {isCustom && (
              <CheckCircle2 className="w-5 h-5 text-[var(--mp-viridian)] shrink-0" aria-hidden />
            )}
          </div>
        </button>
        {/* Always-available date input under the custom option. Picking a
            date here sets value directly (and flips the option to selected). */}
        {(customOpen || isCustom) && <TextField
          type="date"
          value={(isCustom || customOpen) && value ? value : ""}
          onChange={(e) => { if (!e.target.value && onCustomStart) onCustomStart(); else onChange(e.target.value); }}
          label={t("study_custom_date", lang)}
          helper={t("study_custom_caveat", lang)}
          min={todayIso}
          error={customPast ? t("a22_picker_past", lang) : undefined}
          className="mt-2"
        />}

      </div>

      {/* Not sure yet */}
      <button
        type="button"
        onClick={() => { setCustomOpen(false); onChange(""); }}
        role="radio"
        aria-checked={value === "" && !customOpen}
        tabIndex={value === "" && !customOpen ? 0 : -1}
        className={`w-full min-h-[56px] ${pad} rounded-xl border-2 text-left transition-all mp-focusable ${
          value === "" && !customOpen ? selectedRing : idleRing
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="font-medium text-sm text-[var(--mp-fg)] flex items-center gap-2">
            <CircleSlash className="w-4 h-4 text-[var(--mp-fg-subtle)]" aria-hidden />
            {t("study_no_date_option", lang)}
          </span>
          {value === "" && !customOpen && (
            <CheckCircle2 className="w-5 h-5 text-[var(--mp-viridian)] shrink-0" aria-hidden />
          )}
        </div>
        <p className="text-xs text-[var(--mp-fg-subtle)] mt-1">
          {t("a22_picker_none_note", lang)}
        </p>
      </button>
      </div>
    </div>
  );
}
