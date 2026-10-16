/**
 * Results-day route (a-results-route; growth-plan LP6, fast-money M30-8,
 * customer journey M6). Pure rules, server and client safe (no I/O).
 *
 * After an official Stichprobentest or SIP sitting, the Settings exam report
 * card asks one outcome question and routes the learner: next track
 * (Rezeptierkunde and Gerichtsmedizin, or the next SIP part), a testimonial,
 * a referral, or a rescue plan to the next sitting. Behind its own flag,
 * RESULTS_ROUTE_ENABLED, default OFF; independent of the exam report reward.
 *
 * Rules that bind every change here:
 *  - The Stichprobentest has no pass or fail (SoT 1.1; journey section 8): its
 *    question asks which exams follow, never whether the learner passed.
 *  - Retake rules are never summarised: the route links one official page.
 *  - No reward amount lives here; the testimonial follows the existing
 *    experience reward (decision credit-amounts) and only while it is on.
 *  - Answers are stored as user_events `result_reported` (no migration).
 */

import { EXAM_SITTINGS, OFFICIAL_SITTINGS, type ExamSitting, type OfficialSitting } from "./exam-dates";
import { examReportBlocked, viennaDay, type ReportableSitting } from "./rewards-program";

type Env = Record<string, string | undefined>;

export const RESULTS_ROUTE_ENV = "RESULTS_ROUTE_ENABLED";

/** Only the literal "true" switches the route on. */
export function resultsRouteEnabled(env: Env = process.env): boolean {
  return (env[RESULTS_ROUTE_ENV] ?? "").trim() === "true";
}

export const RESULT_EVENT = "result_reported";

export type RouteExamKey = "stichprobentest" | "sip4a" | "sip5a";
export type RouteKind = "spt" | "sip";

/**
 * Days after a sitting's last day in which the outcome question is asked.
 * Journey M6 (chat-reported): SIP results about 3 weeks after, the
 * Stichprobentest 1 to 2 months; the window runs past the late end.
 */
export const RESULTS_WINDOW_DAYS: Record<RouteExamKey, number> = { stichprobentest: 90, sip4a: 60, sip5a: 60 };

/** A "result not here yet" answer asks again after this many days. */
export const WAITING_SNOOZE_DAYS = 7;

/** Days before a sitting in which an answer counts as "active before it". */
export const ACTIVE_BEFORE_DAYS = 90;

export const SPT_OUTCOMES = ["rez_gm", "rez_gm_sip", "waiting", "not_sat"] as const;
export const SIP_OUTCOMES = ["passed", "not_all_passed", "waiting", "not_sat"] as const;
export type SptOutcome = (typeof SPT_OUTCOMES)[number];
export type SipOutcome = (typeof SIP_OUTCOMES)[number];
export type RouteOutcome = SptOutcome | SipOutcome;

/** What the answer means for the learner's need, for HQ (A.5 r5) and the Analyst. */
export type RouteNeed = "part_done" | "more_to_do" | "waiting" | "not_sat";

export function kindOf(exam: RouteExamKey): RouteKind {
  return exam === "stichprobentest" ? "spt" : "sip";
}

export function outcomesFor(kind: RouteKind): readonly RouteOutcome[] {
  return kind === "spt" ? SPT_OUTCOMES : SIP_OUTCOMES;
}

export function isOutcomeFor(kind: RouteKind, value: unknown): value is RouteOutcome {
  return typeof value === "string" && (outcomesFor(kind) as readonly string[]).includes(value);
}

export function needOf(outcome: RouteOutcome): RouteNeed {
  if (outcome === "rez_gm" || outcome === "passed") return "part_done";
  if (outcome === "rez_gm_sip" || outcome === "not_all_passed") return "more_to_do";
  return outcome;
}

const ROUTE_EXAMS = new Set<string>(["stichprobentest", "sip4a", "sip5a"]);

/** One sitting the outcome question can name. */
export interface RouteSitting extends ReportableSitting {
  exam_key: RouteExamKey;
}

function addDays(day: string, n: number): string {
  const t = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Stichprobentest sittings of the PUYP calendar (EXAM_SITTINGS.kmp_innsbruck,
 * official source each) that OFFICIAL_SITTINGS does not carry: the 23 Sep
 * 2026 Graz sitting predates the official table. Only confirmed rows.
 */
function legacySptSittings(rows: readonly ExamSitting[]): RouteSitting[] {
  return rows.filter((r) => r.confidence === "high").map((r) => {
    const venue = r.location ?? "";
    const en = venue === "Wien" ? "Vienna" : venue;
    return {
      key: `stichprobentest:${r.date}`,
      exam_key: "stichprobentest",
      date: r.date,
      last_day: r.date,
      label: { de: venue ? `Stichprobentest ${venue}` : "Stichprobentest", en: en ? `Stichprobentest ${en}` : "Stichprobentest" },
    };
  });
}

/** Every Stichprobentest and SIP sitting the route knows, one per exam and date. */
export function routeSittings(
  official: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
  legacySpt: readonly ExamSitting[] = EXAM_SITTINGS.kmp_innsbruck,
): RouteSitting[] {
  const out = new Map<string, RouteSitting>();
  for (const r of official) {
    if (!ROUTE_EXAMS.has(r.exam_key)) continue;
    const key = `${r.exam_key}:${r.date}`;
    if (!out.has(key)) out.set(key, { key, exam_key: r.exam_key as RouteExamKey, date: r.date, last_day: r.date_end ?? r.date, label: r.learner_label });
  }
  for (const s of legacySptSittings(legacySpt)) if (!out.has(s.key)) out.set(s.key, s);
  return [...out.values()];
}

/** Sittings whose results window contains `now` (Vienna day), newest first. */
export function resultsWindowSittings(now: Date, sittings: readonly RouteSitting[] = routeSittings()): RouteSitting[] {
  const today = viennaDay(now);
  return sittings
    .filter((s) => today > s.last_day && today <= addDays(s.last_day, RESULTS_WINDOW_DAYS[s.exam_key]))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key.localeCompare(b.key)));
}

/**
 * The card asks nothing on an official sitting day or in the November
 * blackout (shared with the exam report card); a POST is still accepted.
 */
export function routePromptBlocked(now: Date, official: readonly OfficialSitting[] = OFFICIAL_SITTINGS): boolean {
  return examReportBlocked(viennaDay(now), official);
}

/** The official exams that belong to each app bank (route subset). */
const BANK_EXAMS: Record<string, readonly RouteExamKey[]> = {
  kmp_innsbruck: ["stichprobentest"],
  kenntnispruefung: ["sip4a", "sip5a"],
};

export interface LearnerFacts {
  /** users.exam_date (YYYY-MM-DD) or null. */
  examDate: string | null;
  /** users.active_exam (bank key) or null. */
  activeExam: string | null;
}

/**
 * The sittings this learner may be asked about. A stored exam date that
 * names a window sitting wins (that sitting only); otherwise the window
 * sittings of the learner's active bank. The caller keeps a candidate only
 * when the learner answered questions in the ACTIVE_BEFORE_DAYS before it.
 */
export function candidateSittings(facts: LearnerFacts, windowRows: readonly RouteSitting[]): { rows: RouteSitting[]; byDate: boolean } {
  const date = facts.examDate?.slice(0, 10) ?? null;
  if (date) {
    const exact = windowRows.filter((s) => s.date === date);
    if (exact.length > 0) return { rows: exact, byDate: true };
  }
  const exams = BANK_EXAMS[facts.activeExam ?? ""] ?? [];
  return { rows: windowRows.filter((s) => exams.includes(s.exam_key)), byDate: false };
}

/** The UTC instant of 00:00 Europe/Vienna on `day` (CET or CEST). */
export function viennaMidnight(day: string): string {
  for (const off of ["+01:00", "+02:00"]) {
    const t = new Date(`${day}T00:00:00${off}`);
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", hour: "2-digit", hourCycle: "h23" }).format(t);
    if (viennaDay(t) === day && hour === "00") return t.toISOString();
  }
  return `${day}T00:00:00.000Z`;
}

/** "Active before the sitting": from Vienna midnight ACTIVE_BEFORE_DAYS before it, up to (not including) the Vienna midnight after its last day. */
export function activeBeforeRange(s: Pick<RouteSitting, "date" | "last_day">): { from: string; before: string } {
  return { from: viennaMidnight(addDays(s.date, -ACTIVE_BEFORE_DAYS)), before: viennaMidnight(addDays(s.last_day, 1)) };
}

export interface StoredAnswer {
  sitting_key: string;
  outcome: RouteOutcome;
  at: string;
}

/** Outcomes that hold a route to show (the others show only a summary with "change answer"). */
export function hasRoute(outcome: RouteOutcome): boolean {
  return outcome !== "waiting" && outcome !== "not_sat";
}

/** Is the question still waiting for an answer for this sitting? */
export function shouldAsk(latest: StoredAnswer | null, now: Date): boolean {
  if (!latest) return true;
  if (latest.outcome !== "waiting") return false;
  return now.getTime() - Date.parse(latest.at) >= WAITING_SNOOZE_DAYS * 86_400_000;
}

/** The app bank the next-track buttons open. */
export type NextBank = "pharma" | "kenntnispruefung";

export interface RouteFlags {
  /** The experience reward (MENTOR_EXPERIENCE_REWARD_ENABLED) can reach this learner and nothing was sent yet. */
  testimonial: boolean;
  /** users.referrals_enabled. */
  referral: boolean;
  /** Gerichtsmedizin practice is offered (flag plus enough active rows). */
  gm: boolean;
}

export interface RoutePlan {
  /** Banks offered as the next track, in order. */
  next: NextBank[];
  /** Show the official retake line and the study plan (SIP not all passed). */
  rescue: boolean;
  /** Show the official page link for exams that follow (SPT with SIP blocks imposed). */
  officialNext: boolean;
  gm: boolean;
  testimonial: boolean;
  referral: boolean;
}

const NONE: RoutePlan = { next: [], rescue: false, officialNext: false, gm: false, testimonial: false, referral: false };

/**
 * What the card shows after an answer. Relief branches (part done) open the
 * next track and invite a testimonial and a referral; the rescue branch shows
 * the official retake page and the plan, never an ask.
 */
export function routeFor(outcome: RouteOutcome, flags: RouteFlags): RoutePlan {
  switch (outcome) {
    case "rez_gm":
      return { ...NONE, next: ["pharma"], gm: flags.gm, testimonial: flags.testimonial, referral: flags.referral };
    case "rez_gm_sip":
      return { ...NONE, next: ["pharma", "kenntnispruefung"], officialNext: true, gm: flags.gm };
    case "passed":
      return { ...NONE, next: ["kenntnispruefung", "pharma"], gm: flags.gm, testimonial: flags.testimonial, referral: flags.referral };
    case "not_all_passed":
      return { ...NONE, rescue: true };
    default:
      return NONE;
  }
}
