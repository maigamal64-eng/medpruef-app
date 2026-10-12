/**
 * Effort the plan date implies (LX-02-R). Pure.
 *
 * MINUTES_PER_QUESTION is a stated estimate (members quote about 1.5 minutes
 * per question, SOT-REF pending [name]'s confirmation), not a measured value.
 */

export const MINUTES_PER_QUESTION = 1.5;
/** Above this many questions per day the plan is "too much" on its own. */
export const TOO_MUCH_PER_DAY = 60;
/** "too much" also when required exceeds this multiple of the daily goal. */
export const TOO_MUCH_GOAL_MULTIPLE = 2;
/** "tight" when required exceeds the daily goal; this is the goal when none is set. */
export const DEFAULT_DAILY_GOAL = 30;

export type EffortVerdict = "fits" | "tight" | "too_much";

export function requiredPerDay(unseen: number, daysLeft: number): number {
  const q = Math.max(0, Math.floor(unseen));
  if (q === 0) return 0;
  return Math.ceil(q / Math.max(1, Math.floor(daysLeft)));
}

export function minutesPerDay(questionsPerDay: number): number {
  return Math.round(Math.max(0, questionsPerDay) * MINUTES_PER_QUESTION);
}

export function effortVerdict(required: number, dailyGoal?: number | null): EffortVerdict {
  const hasGoal = typeof dailyGoal === "number" && dailyGoal > 0;
  const goal = hasGoal ? (dailyGoal as number) : DEFAULT_DAILY_GOAL;
  if (required > TOO_MUCH_PER_DAY) return "too_much";
  if (hasGoal && required > TOO_MUCH_GOAL_MULTIPLE * goal) return "too_much";
  if (required > goal) return "tight";
  return "fits";
}

export interface EffortSummary {
  unseen: number;
  daysLeft: number;
  questionsPerDay: number;
  minutesPerDay: number;
  verdict: EffortVerdict;
}

export function planEffort(unseen: number, daysLeft: number, dailyGoal?: number | null): EffortSummary {
  const questionsPerDay = requiredPerDay(unseen, daysLeft);
  return {
    unseen,
    daysLeft,
    questionsPerDay,
    minutesPerDay: minutesPerDay(questionsPerDay),
    verdict: effortVerdict(questionsPerDay, dailyGoal),
  };
}

/**
 * Questions per day to bring `sharePct` percent of the pool to "answered
 * correctly once" by the date ("Für 80 % wären es etwa N pro Tag").
 */
export function targetShare(opts: {
  sharePct: number;
  pool: number;
  daysLeft: number;
  alreadyCovered?: number;
}): { questionsPerDay: number; questionsNeeded: number } {
  const pct = Math.min(100, Math.max(0, opts.sharePct));
  const wanted = Math.ceil((Math.max(0, opts.pool) * pct) / 100);
  const needed = Math.max(0, wanted - Math.max(0, opts.alreadyCovered ?? 0));
  return { questionsNeeded: needed, questionsPerDay: requiredPerDay(needed, opts.daysLeft) };
}

/** Honest sentence for the verdict (DE and EN). No em dashes. */
export function effortSentence(s: EffortSummary, lang: "de" | "en"): string {
  const q = s.questionsPerDay;
  const m = s.minutesPerDay;
  if (lang === "de") {
    if (s.verdict === "too_much")
      return `Bis zum Termin brauchst du etwa ${q} Fragen pro Tag (rund ${m} Minuten). Das ist sehr viel. Konzentriere dich auf deine schwachen Themen.`;
    if (s.verdict === "tight")
      return `Bis zum Termin brauchst du etwa ${q} Fragen pro Tag (rund ${m} Minuten). Das wird eng, ist aber machbar.`;
    return `Bis zum Termin reichen etwa ${q} Fragen pro Tag (rund ${m} Minuten).`;
  }
  if (s.verdict === "too_much")
    return `You need about ${q} questions a day to finish by the date (around ${m} minutes). That is a lot. Focus on your weak topics.`;
  if (s.verdict === "tight")
    return `You need about ${q} questions a day to finish by the date (around ${m} minutes). It is tight but doable.`;
  return `About ${q} questions a day is enough to finish by the date (around ${m} minutes).`;
}
