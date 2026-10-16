/**
 * Organiser cohort read (a-partner-kit): pure shaping of the three totals an
 * organiser may see for their own code. Privacy rules live here, once:
 *   - a count under SMALL_CELL (5) is never shown, only "unter 5";
 *   - shown counts are rounded to the nearest 5 (answers to 10);
 *   - "questions answered" is shown only when at least SMALL_CELL learners
 *     contributed to it, and then rounded to the nearest 10 (so a single new
 *     learner never moves a visible number by their own count);
 *   - nothing else leaves: no id, name, address, date of one person.
 */
import { SMALL_CELL } from "./index";

export interface PartnerRaw {
  /** Distinct learners who redeemed the code. */
  redemptions: number;
  /** Of them, learners with at least one answer in the last 7 days. */
  active7d: number;
  /** Learners with at least one answer since their redemption. */
  answerers: number;
  /** All answers by redeemers since their own redemption. */
  answers: number;
}

export type Shown = { kind: "number"; value: number } | { kind: "small" };

export interface PartnerReport {
  redemptions: Shown;
  active: Shown;
  answers: Shown;
  /** True when the answers figure is rounded (it always is while shown). */
  answersRounded: boolean;
}

// Shown counts are rounded to the nearest 5 (answers to 10), so one learner joining or going quiet never moves a figure by one.
const gate = (n: number): Shown => (Number.isFinite(n) && n >= SMALL_CELL ? { kind: "number", value: Math.max(SMALL_CELL, Math.round(n / 5) * 5) } : { kind: "small" });

export function shapeReport(raw: PartnerRaw): PartnerReport {
  const answers: Shown = raw.answerers >= SMALL_CELL && raw.answers >= SMALL_CELL ? { kind: "number", value: Math.round(raw.answers / 10) * 10 } : { kind: "small" };
  return { redemptions: gate(raw.redemptions), active: gate(raw.active7d), answers, answersRounded: answers.kind === "number" };
}

export const shownText = (s: Shown, small: string, lang: "de" | "en"): string => (s.kind === "small" ? small : new Intl.NumberFormat(lang === "en" ? "en-GB" : "de-AT").format(s.value));
