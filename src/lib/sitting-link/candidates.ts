/**
 * The sittings a one-tap link offers (a-sitting-one-tap). Pure, server-safe.
 *
 * Only OFFICIAL_SITTINGS, read through the same selector as the in-app picker
 * (getUpcomingOfficialFor + groupOfficialByDate per bank). Rows whose window
 * is unconfirmed (window_unconfirmed) are left out whole. One option per bank
 * and date: the Stichprobentest option carries both publishers' rows, so both
 * deadlines show where they differ. The account's own bank comes first; the
 * other banks follow (choosing there switches the practice bank, the same
 * write onboarding makes). "open" is the explicit "not decided yet" choice.
 */
import {
  OFFICIAL_KEYS_BY_BANK,
  OFFICIAL_SITTINGS,
  asPuypExamType,
  daysUntilViennaDate,
  getUpcomingOfficialFor,
  groupOfficialByDate,
  type OfficialSitting,
  type PuypExamType,
} from "@/lib/exam-dates";

export const BANK_ORDER: readonly PuypExamType[] = ["kenntnispruefung", "kmp_innsbruck", "pharma"];
/** At most this many upcoming dates per bank (the in-app picker shows 3 before "more"). */
export const MAX_PER_BANK = 4;

export interface SittingOption {
  /** Form value: "<bank>:<YYYY-MM-DD>". */
  id: string;
  bank: PuypExamType;
  /** The date written to users.exam_date (first day of an exam week). */
  date: string;
  /** Last day of the sitting (date_end of an exam week, else the date). */
  lastDay: string;
  rows: OfficialSitting[];
}

export interface BankOptions {
  bank: PuypExamType;
  options: SittingOption[];
}

export function optionId(bank: PuypExamType, date: string): string {
  return `${bank}:${date}`;
}

export function candidateSittings(
  ownBank: unknown,
  now: Date = new Date(),
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
): BankOptions[] {
  const own = asPuypExamType(ownBank) ?? "kenntnispruefung";
  const banks = [own, ...BANK_ORDER.filter((b) => b !== own)];
  const confirmed = sittings.filter((s) => !s.window_unconfirmed);
  const out: BankOptions[] = [];
  for (const bank of banks) {
    // A date with any unconfirmed row is skipped by the filter above only for
    // that row; drop the whole date so a half-confirmed option never shows.
    const unconfirmedDates = new Set(sittings.filter((s) => s.window_unconfirmed && OFFICIAL_KEYS_BY_BANK[bank].includes(s.exam_key)).map((s) => s.date));
    const groups = groupOfficialByDate(getUpcomingOfficialFor({ exams: OFFICIAL_KEYS_BY_BANK[bank], now }, confirmed))
      .filter((g) => !unconfirmedDates.has(g.date))
      .slice(0, MAX_PER_BANK);
    out.push({
      bank,
      options: groups.map((g) => ({ id: optionId(bank, g.date), bank, date: g.date, lastDay: g.date_end ?? g.date, rows: g.rows })),
    });
  }
  return out;
}

export type ParsedChoice =
  | { kind: "open" }
  | { kind: "sitting"; option: SittingOption }
  | { kind: "invalid" };

/** A form value is valid only when it names an option the page offers right now. */
export function resolveChoice(value: unknown, banks: BankOptions[]): ParsedChoice {
  if (value === "open") return { kind: "open" };
  if (typeof value !== "string" || value.length > 40) return { kind: "invalid" };
  for (const b of banks) {
    const hit = b.options.find((o) => o.id === value);
    if (hit) return { kind: "sitting", option: hit };
  }
  return { kind: "invalid" };
}

export type TimeLeft =
  | { unit: "today" }
  | { unit: "days"; n: number }
  | { unit: "weeks"; n: number };

/** Whole weeks (or days under two weeks) from Vienna today to the sitting's first day. */
export function timeLeft(date: string, now: Date = new Date()): TimeLeft {
  const days = daysUntilViennaDate(date, now);
  if (days <= 0) return { unit: "today" };
  if (days < 14) return { unit: "days", n: days };
  return { unit: "weeks", n: Math.floor(days / 7) };
}

/** The official pages behind the options of a bank (one per source document). */
export function officialSources(rows: readonly OfficialSitting[]): Array<{ publisher: string; url: string }> {
  const seen = new Map<string, string>();
  for (const r of rows) if (!seen.has(r.source_url)) seen.set(r.source_url, r.publisher);
  return [...seen].map(([url, publisher]) => ({ url, publisher }));
}

/** Every official page of every bank, for the date-watch freeze (no dates). */
export function allOfficialSources(sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS): Array<{ bank: PuypExamType; sources: Array<{ publisher: string; url: string }> }> {
  return BANK_ORDER.map((bank) => ({
    bank,
    sources: officialSources(sittings.filter((s) => OFFICIAL_KEYS_BY_BANK[bank].includes(s.exam_key))),
  }));
}
