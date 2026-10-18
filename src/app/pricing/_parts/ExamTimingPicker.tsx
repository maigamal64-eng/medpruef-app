"use client";
/**
 * "Wann ist Ihre Prüfung?" (a-pricing-v2). The learner picks an upcoming
 * official sitting of their question bank (OFFICIAL_SITTINGS, the same rows
 * as the shared ExamSittingPicker), several exams ahead, repeating a part
 * not passed (copy-audit F19), or "not sure yet". The page highlights the one fitting
 * plan (recommendTier: the cheapest plan that covers the chosen sitting,
 * a-pricing-v2-fit); every plan stays visible. Native radios in one
 * fieldset, 44 px rows, formal Sie, no em dashes.
 */
import { useEffect, useMemo, useState } from "react";
import { OFFICIAL_KEYS_BY_BANK, getUpcomingOfficialFor, groupOfficialByDate, type PuypExamType } from "@/lib/exam-dates";
import { formatSittingWhen, joinList, shortExamName } from "@/lib/i18n-dates";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import type { BillingLang } from "@/lib/billing-copy";
import type { ExamTiming } from "@/lib/pricing-v2/offer";

export type TimingChoice =
  | { kind: "sitting"; bank: PuypExamType; date: string; lastDay: string }
  | { kind: "long_route" }
  | { kind: "after_fail" }
  | { kind: "unsure" };

export function timingOf(choice: TimingChoice | null): ExamTiming | null {
  if (!choice) return null;
  return choice.kind === "sitting" ? { kind: "sitting", lastDay: choice.lastDay, date: choice.date } : choice;
}

const BANKS: PuypExamType[] = ["kenntnispruefung", "kmp_innsbruck", "pharma"];
const MAX_SITTINGS = 6;

export default function ExamTimingPicker({ lang, bank, onBankChange, value, onChange, renderedAt }: {
  lang: BillingLang;
  /** ISO instant of the server render: /pricing is prerendered, so the list hydrates from it, then follows the live clock (a-landing-418-fix). */
  renderedAt: string;
  bank: PuypExamType;
  onBankChange: (bank: PuypExamType) => void;
  value: TimingChoice | null;
  onChange: (choice: TimingChoice) => void;
}) {
  const de = lang === "de";
  const [clientNow, setClientNow] = useState<Date | null>(null);
  useEffect(() => { setClientNow(new Date()); }, []);
  const nowMs = clientNow ? clientNow.getTime() : Date.parse(renderedAt);
  const groups = useMemo(
    () => groupOfficialByDate(getUpcomingOfficialFor({ exams: OFFICIAL_KEYS_BY_BANK[bank], now: new Date(nowMs) })).slice(0, MAX_SITTINGS),
    [bank, nowMs],
  );
  const name = "exam-timing";
  const row = "flex items-start gap-3 min-h-11 px-3 py-2.5 rounded-lg border cursor-pointer";
  const isChecked = (c: TimingChoice) => {
    if (!value || value.kind !== c.kind) return false;
    return c.kind !== "sitting" || (value.kind === "sitting" && value.date === c.date && value.bank === c.bank);
  };
  const tone = (checked: boolean) => checked ? "border-[var(--mp-viridian)] bg-[var(--mp-surface-sunken)]" : "border-[var(--mp-border-subtle)]";
  const extra: Array<{ choice: TimingChoice; label: string; hint: string }> = [
    {
      choice: { kind: "long_route" },
      // copy-audit F19 (Lektor, 15 Oct), byte-exact.
      label: de ? "Ich habe mehrere Prüfungen vor mir" : "I have several exams ahead",
      hint: de ? "Zum Beispiel SIP-Blöcke, Rezeptierkunde und Gerichtsmedizin über viele Monate" : "For example SIP blocks, Rezeptierkunde and Gerichtsmedizin over many months",
    },
    {
      choice: { kind: "after_fail" },
      label: de ? "Ich wiederhole einen nicht bestandenen Prüfungsteil" : "I am repeating a part I did not pass",
      hint: de ? "Zum Beispiel einen SIP-Block, Rezeptierkunde oder Gerichtsmedizin. Mit Verlängerung auf Nachweis" : "For example a SIP block, Rezeptierkunde or Gerichtsmedizin. With a renewal on proof",
    },
    {
      choice: { kind: "unsure" },
      label: de ? "Noch nicht sicher" : "Not sure yet",
      hint: de ? "Monatlich starten und später entscheiden" : "Start monthly and decide later",
    },
  ];
  return (
    <section aria-labelledby="exam-timing-title" className="mp-card p-5 space-y-3">
      <div>
        <h2 id="exam-timing-title" className="mp-h3 m-0">{de ? "Wann ist Ihre Prüfung?" : "When is your exam?"}</h2>
        <p className="text-sm text-[var(--mp-fg-muted)] mt-1 mb-0">
          {de ? "Wir markieren den passenden Tarif. Alle Tarife bleiben sichtbar." : "We mark the plan that fits. All plans stay visible."}
        </p>
      </div>
      <label className="block text-sm">
        <span className="font-semibold text-[var(--mp-fg)]">{de ? "Prüfung" : "Exam"}</span>
        <select
          className="mp-field mt-1 block w-full min-h-11"
          value={bank}
          onChange={(e) => onBankChange(e.target.value as PuypExamType)}
        >
          {BANKS.map((b) => <option key={b} value={b}>{getExamLabel(b, "full", lang)}</option>)}
        </select>
      </label>
      <fieldset className="m-0 p-0 border-0 space-y-2">
        <legend className="text-sm font-semibold text-[var(--mp-fg)] mb-1">{de ? "Nächste offizielle Termine" : "Next official sittings"}</legend>
        {groups.length === 0 && (
          <p className="text-sm text-[var(--mp-fg-muted)] m-0">{de ? "Für diese Prüfung ist noch kein Termin veröffentlicht." : "No sitting has been published for this exam yet."}</p>
        )}
        {groups.map((g) => {
          const choice: TimingChoice = { kind: "sitting", bank, date: g.date, lastDay: g.date_end ?? g.date };
          const checked = isChecked(choice);
          return (
            <label key={g.date} className={`${row} ${tone(checked)}`}>
              <input type="radio" name={name} className="mt-1 size-4 shrink-0" checked={checked} onChange={() => onChange(choice)} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--mp-fg)] tabular-nums">{formatSittingWhen(g, lang)}</span>
                <span className="block text-sm text-[var(--mp-fg-muted)]">{joinList(g.rows.map((r) => shortExamName(r, lang)), lang)}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <fieldset className="m-0 p-0 border-0 space-y-2">
        <legend className="sr-only">{de ? "Andere Situation" : "Other situation"}</legend>
        {extra.map(({ choice, label, hint }) => {
          const checked = isChecked(choice);
          return (
            <label key={choice.kind} className={`${row} ${tone(checked)}`}>
              <input type="radio" name={name} className="mt-1 size-4 shrink-0" checked={checked} onChange={() => onChange(choice)} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--mp-fg)]">{label}</span>
                <span className="block text-sm text-[var(--mp-fg-muted)]">{hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}
