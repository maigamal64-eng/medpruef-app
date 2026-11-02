/**
 * A1 of the 2 Nov growth pass: the sitting line on the free empty state of
 * the Vienna (kenntnispruefung) bank. Pure, client and server safe, `now`
 * injected. The server route (/api/free-empty/sitting-line) reads the
 * account and calls this; nothing here typed a date, a price or a plan name.
 *
 *  - sitting: the saved exam date is one SIP4a or SIP5a row of
 *    OFFICIAL_SITTINGS (window confirmed), the sitting is 1 to 28 days away
 *    and today is before the Monday of its week (promotion pause).
 *  - ask: no exam date saved, and today is in no SIP sitting week.
 *  - Both stop after FREE_EMPTY_WINDOW_END (the batch window of the pass);
 *    anything else is "none" and the empty state renders as before.
 */
import { OFFICIAL_SITTINGS, daysUntilViennaDate, viennaToday, type OfficialSitting } from "@/lib/exam-dates";
import { formatSittingWhen } from "@/lib/i18n-dates";
import { addDays, isoDayOf, weekStart } from "@/lib/journey/moments";
import { fill, sittingLinkCopy } from "@/lib/sitting-link/copy";
import { A1_ASK_LINE, A1_SITTING_LINE, freeEmptyLang } from "./copy";

/** Sun 15 Nov 2026: the promotion pause starts with the SIP sitting week on Mon 16 Nov. */
export const FREE_EMPTY_WINDOW_END = "2026-11-15";
export const FREE_EMPTY_WINDOW_DAYS = 28;
/** Where "Termin eintragen" leads: the same target as the Home sitting prompt. */
export const FREE_EMPTY_ASK_HREF = "/settings#exam-date";

export interface FreeEmptyFit {
  plan: string;
  total: string;
}

export type FreeEmptySitting =
  | { state: "none" }
  | { state: "sitting" | "ask"; lines: string[]; cta: { label: string; href: string } };

export interface FreeEmptySittingInput {
  now: Date;
  lang: string;
  /** The bank of the practice screen ("kenntnispruefung" only; anything else is "none"). */
  bank: string | null;
  /** users.exam_date (YYYY-MM-DD or a timestamp), null when none is saved. */
  examDate: string | null;
  /** The plan-fit sentence parts for the sitting (sittingFit().recommended, rendered by the caller), or null. */
  fit: (sitting: { date: string; lastDay: string }) => FreeEmptyFit | null;
  sittings?: readonly OfficialSitting[];
}

const NONE: FreeEmptySitting = { state: "none" };

function isSip(s: OfficialSitting): boolean {
  return s.exam_key === "sip4a" || s.exam_key === "sip5a";
}

/** True while today (Vienna) is inside the Monday to Sunday week of any SIP row. */
export function inAnySipSittingWeek(today: string, sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS): boolean {
  return sittings.some((s) => {
    if (!isSip(s)) return false;
    const start = weekStart(s.date);
    return today >= start && today <= addDays(weekStart(s.date_end ?? s.date), 6);
  });
}

export function freeEmptySitting(input: FreeEmptySittingInput): FreeEmptySitting {
  const sittings = input.sittings ?? OFFICIAL_SITTINGS;
  if (input.bank !== "kenntnispruefung") return NONE;
  const today = viennaToday(input.now);
  if (today > FREE_EMPTY_WINDOW_END) return NONE;
  const lang = freeEmptyLang(input.lang);
  const day = isoDayOf(input.examDate);

  if (!day) {
    if (inAnySipSittingWeek(today, sittings)) return NONE;
    const ask = A1_ASK_LINE[lang];
    return { state: "ask", lines: [ask.body], cta: { label: ask.cta, href: FREE_EMPTY_ASK_HREF } };
  }

  const rows = sittings.filter((s) => isSip(s) && s.date === day);
  if (rows.length === 0 || rows.some((s) => s.window_unconfirmed)) return NONE;
  const row = rows[0];
  const lastDay = row.date_end ?? row.date;
  const days = daysUntilViennaDate(row.date, input.now);
  if (days < 1 || days > FREE_EMPTY_WINDOW_DAYS) return NONE;
  if (today >= weekStart(row.date)) return NONE;

  const label = (row.learner_label as Record<string, string>)[lang] ?? row.learner_label.en;
  const sittingLabel = `${label}, ${formatSittingWhen(row, lang)}`;
  const fit = input.fit({ date: row.date, lastDay });
  const fitLine = fit ? fill(sittingLinkCopy(lang).fitLine, { plan: fit.plan, total: fit.total }) : "";
  const copy = A1_SITTING_LINE[lang];
  const body = copy.body.replace("{SITTING_LABEL}", sittingLabel).replace("{FIT_PLAN_LINE}", fitLine).trim();
  const q = new URLSearchParams({ gate: "full_bank", bank: "kenntnispruefung", sitting: row.date, sitting_end: lastDay });
  return { state: "sitting", lines: [body], cta: { label: copy.cta, href: `/pricing?${q.toString()}` } };
}

/** Parse of the route body on the client; anything unexpected reads as "none". */
export function parseFreeEmptySitting(body: unknown): FreeEmptySitting {
  if (!body || typeof body !== "object") return NONE;
  const b = body as Record<string, unknown>;
  if (b.state !== "sitting" && b.state !== "ask") return NONE;
  const lines = Array.isArray(b.lines) ? b.lines.filter((l): l is string => typeof l === "string" && l.length > 0) : [];
  const cta = b.cta as { label?: unknown; href?: unknown } | undefined;
  if (lines.length === 0 || !cta || typeof cta.label !== "string" || typeof cta.href !== "string" || !/^\/(?![\/\\])/.test(cta.href)) return NONE;
  return { state: b.state, lines, cta: { label: cta.label, href: cta.href } };
}
