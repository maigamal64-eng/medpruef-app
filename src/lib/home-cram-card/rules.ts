/**
 * Show rules of the Home cram card (a-cram-card). Pure, client and server
 * safe, `now` injected. Sources: the Lektor-gated kits
 * a-cramstart-copy/home-cram-card.json (SIP, journey M4) and
 * a-rezgm-cram-kit/cram-card-copy.json (Rez/GM exam week).
 *
 * Dates come only from OFFICIAL_SITTINGS; nothing here types or estimates one.
 *
 *  - SIP named: the learner's saved exam date resolves to exactly one SIP4a or
 *    SIP5a sitting. Window: sitting date minus 28 days to the day before it.
 *  - SIP bank only: the saved bank is kenntnispruefung and no saved date names
 *    a sitting. No named sitting, no countdown (SIP4a and SIP5a share the bank,
 *    a named row would assert the wrong exam). Window: any SIP row whose own
 *    window is running. The plan line is cut at the EARLIEST such row's date
 *    minus 7 days (conservative: promotion pauses in the sitting week).
 *  - Rez/GM: saved bank pharma or kmp_innsbruck, or a saved date naming an exam
 *    week. Window: week start minus 28 days to the last day of the week. State
 *    B (with Gerichtsmedizin) only while GM practice is available.
 *  - Plan line (SIP only): no paid access, PRICING_V2 live, today on or before
 *    the row's date minus 7 days. Credits line (SIP only): a live free-credit
 *    lot the server read. A row with window_unconfirmed never shows a card.
 */
import {
  OFFICIAL_SITTINGS,
  asPuypExamType,
  daysUntilViennaDate,
  viennaToday,
  type OfficialSitting,
} from "@/lib/exam-dates";
import { addDays, resolveNamedSitting } from "@/lib/journey/moments";

/** The learner-facing label of an official row: German for de, English for every other language. */
export function rowLabel(row: OfficialSitting, lang: string): string {
  return (row.learner_label as Record<string, string>)[lang] ?? row.learner_label.en;
}

export type CramVariant = "sip_named" | "sip_bank" | "rezgm_a" | "rezgm_b";

export const CRAM_WINDOW_DAYS = 28;
export const CRAM_PLAN_CUT_DAYS = 7;
/** A dismissal lasts seven days, per account and device. */
export const CRAM_DISMISS_MS = 7 * 86_400_000;

export interface CramCredits { credits: number; expires_at: string }

export interface CramInput {
  now: Date;
  /** The saved bank (users.active_exam): kenntnispruefung | kmp_innsbruck | pharma. */
  examSource: string | null;
  /** users.exam_date, YYYY-MM-DD (or a timestamp). */
  examDate: string | null;
  isPaid: boolean;
  /** pricingV2Enabled(): the plan line's hard condition. */
  pricingV2: boolean;
  /** Gerichtsmedizin practice is available (flag plus enough active rows). */
  gmAvailable: boolean;
  /** The learner's live free-credit lot, as the server read it. */
  credits: CramCredits | null;
}

export interface CramPlan {
  variant: CramVariant;
  /** The one named SIP row (sip_named) or the week's Rezeptierkunde/Gerichtsmedizin row (rezgm). */
  row: OfficialSitting | null;
  /** Days to the sitting (sip_named) or to the exam week while it has not started (rezgm); else null. */
  daysLeft: number | null;
  planLine: boolean;
  credits: CramCredits | null;
  /** sip_bank: one choice per distinct in-window sitting date, only when there are two or more. */
  partChoices: OfficialSitting[];
}

function isSip(s: OfficialSitting): boolean {
  return s.exam_key === "sip4a" || s.exam_key === "sip5a";
}

function isRezGm(s: OfficialSitting): boolean {
  return s.exam_key === "rezeptierkunde" || s.exam_key === "gerichtsmedizin";
}

/** First day of the cram window of a sitting row (its date minus 28 days). */
export function cramWindowStart(date: string): string {
  return addDays(date, -CRAM_WINDOW_DAYS);
}

/** SIP: [date - 28, date - 1]. */
function sipWindowOpen(row: OfficialSitting, today: string): boolean {
  return !row.window_unconfirmed && today >= cramWindowStart(row.date) && today <= addDays(row.date, -1);
}

/** Rez/GM: [date - 28, last day of the week]. */
function rezWindowOpen(row: OfficialSitting, today: string): boolean {
  return !row.window_unconfirmed && today >= cramWindowStart(row.date) && today <= (row.date_end ?? row.date);
}

/** The plan line's last day: the row's date minus 7 days (journey M5, promotion pauses in the sitting week). */
export function planLineLastDay(date: string): string {
  return addDays(date, -CRAM_PLAN_CUT_DAYS);
}

function creditsLive(c: CramCredits | null, now: Date): CramCredits | null {
  return c && Number.isFinite(c.credits) && c.credits > 0 && Date.parse(c.expires_at) > now.getTime() ? c : null;
}

function distinctByDate(rows: readonly OfficialSitting[]): OfficialSitting[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.date) ? false : (seen.add(r.date), true))).sort((a, b) => a.date.localeCompare(b.date));
}

export function planCramCard(input: CramInput, sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS): CramPlan | null {
  const { now } = input;
  const today = viennaToday(now);
  const bank = asPuypExamType(input.examSource);
  const named = resolveNamedSitting({ examDate: input.examDate, activeExam: input.examSource }, now, sittings);

  const sipPlan = (variant: "sip_named" | "sip_bank", rows: OfficialSitting[], row: OfficialSitting | null, cutDate: string, choices: OfficialSitting[]): CramPlan => ({
    variant,
    row,
    daysLeft: row ? daysUntilViennaDate(row.date, now) : null,
    planLine: !input.isPaid && input.pricingV2 && today <= planLineLastDay(cutDate),
    credits: creditsLive(input.credits, now),
    partChoices: choices,
  });

  if (named) {
    if (named.segment === "stichprobentest") return null;
    if (named.segment === "vienna_sip") {
      const rows = named.rows.filter(isSip).filter((r) => sipWindowOpen(r, today));
      if (rows.length === 0) return null;
      // One exam on the date: name it. Two (a shared date): neutral, no named row, nothing to choose.
      if (named.exam_keys.length === 1) return sipPlan("sip_named", rows, rows[0], rows[0].date, []);
      return sipPlan("sip_bank", rows, null, rows[0].date, []);
    }
    return rezgmPlan(named.rows.filter(isRezGm), today, input, now);
  }

  if (bank === "kenntnispruefung") {
    const rows = sittings.filter(isSip).filter((r) => sipWindowOpen(r, today));
    if (rows.length === 0) return null;
    const dates = distinctByDate(rows);
    const cut = dates[0].date;
    return sipPlan("sip_bank", rows, null, cut, dates.length >= 2 ? dates : []);
  }
  if (bank === "pharma" || bank === "kmp_innsbruck") {
    return rezgmPlan(sittings.filter(isRezGm), today, input, now);
  }
  return null;
}

function rezgmPlan(rows: OfficialSitting[], today: string, input: CramInput, now: Date): CramPlan | null {
  const open = rows.filter((r) => rezWindowOpen(r, today)).sort((a, b) => a.date.localeCompare(b.date));
  if (open.length === 0) return null;
  const row = open.find((r) => r.exam_key === "rezeptierkunde") ?? open[0];
  const started = today >= row.date;
  return {
    variant: input.gmAvailable ? "rezgm_b" : "rezgm_a",
    row,
    // The countdown stops when the week starts, never a fake date.
    daysLeft: started ? null : daysUntilViennaDate(row.date, now),
    planLine: false,
    credits: null,
    partChoices: [],
  };
}

/** Does this learner's saved bank ask the server for credits (SIP) or GM availability (Rez/GM)? */
export function cramNeeds(plan: CramPlan | null): "credits" | "gm" | null {
  if (!plan) return null;
  return plan.variant === "sip_named" || plan.variant === "sip_bank" ? "credits" : "gm";
}

/** A stored dismissal (ms epoch as text) still hides the card. */
export function isCramDismissed(raw: string | null, nowMs: number): boolean {
  const until = raw === null ? NaN : Number(raw);
  return Number.isFinite(until) && until > nowMs;
}

/** The newest-expiring-first rule: the lot that ends soonest, its own balance, so balance and expiry belong together. */
export function pickCramCreditsLot(
  lots: ReadonlyArray<{ granted_micro: number | string; spent_micro: number | string | null; clawed_back_micro: number | string | null; expires_at: string }>,
  microPerCredit: number,
  now: Date,
): CramCredits | null {
  let best: CramCredits | null = null;
  for (const lot of lots) {
    const exp = Date.parse(lot.expires_at);
    if (!(exp > now.getTime())) continue;
    const left = Number(lot.granted_micro) - Number(lot.spent_micro ?? 0) - Number(lot.clawed_back_micro ?? 0);
    const credits = Number.isFinite(left) ? Math.floor(left / microPerCredit) : 0;
    if (credits <= 0) continue;
    if (!best || exp < Date.parse(best.expires_at)) best = { credits, expires_at: lot.expires_at };
  }
  return best;
}
