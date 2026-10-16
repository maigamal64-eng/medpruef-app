/**
 * Study plan (Lernplan) generator.
 *
 * Pure function — given the user's exam date, daily question goal, and
 * per-topic progress, produces a day-by-day schedule that distributes
 * question targets across topics. No side effects, no randomness, no
 * external dependencies.
 *
 * High-level policy:
 *   - First ~70% of the timeline = new-material phase
 *     (prioritize "weak" < 60% accuracy + "new" topics that still have
 *     unseen questions). Each topic gets a slice proportional to its
 *     deficit (how many questions are still unmastered).
 *   - Last ~30% = consolidation phase
 *     (review mistakes + unseen of the most critical weak topics only).
 *   - If the exam is in <= 7 days, we skip straight into review mode for
 *     the whole remaining window. The "tight" status is separate (LX-02):
 *     it means the unseen questions do not fit the days at the daily goal.
 *   - If the exam has already passed or is today, we surface a
 *     single-day plan for "today" so the UI always has something
 *     actionable to render.
 *   - If the exam is > 365 days away, we cap the plan at 365 days (any
 *     longer is fiction — the user will iterate).
 *
 * Deterministic: same inputs → identical output. Dates are normalized
 * to midnight UTC so the schedule doesn't jitter across timezones.
 *
 * Feedback driving this: Mounzer and user A. asked for "Lernplan-
 * Funktion" in their survey replies — a structured plan to prepare
 * for their exam. This is Phase 1: pure logic + a single day-card UI
 * on top of /api/user/study-plan.
 */

import { WEAK_BELOW_PCT } from "./weak-topics";
import { planEffort, type EffortSummary } from "./master-learning/plan-effort";
import { pickSimulationDays, type SimulationDay } from "./master-learning/plan-simulations";
import { DRILL_BELOW, drillRunFor, type PartRunSummary } from "./master-learning/plan-drill";
import { addDays } from "./master-learning/plan-target";

export type StudyFocus = "review" | "weak" | "new";

/** Resolve a plan focus to a resilient quiz pool mode. Review prioritizes due
 * cards via `all`, which falls back to the topic pool when no due review rows
 * are available. */
export function getStudyPlanPracticeMode(focus: StudyFocus): "all" | "unseen" {
  return focus === "review" ? "all" : "unseen";
}

export interface TopicProgress {
  topic: string;
  total: number;
  answered: number;
  correct: number;
  accuracy: number;
}

export interface StudyPlanDayTopic {
  topic: string;
  targetCount: number;
  focus: StudyFocus;
}

export interface StudyPlanDay {
  day: string; // ISO YYYY-MM-DD
  topics: StudyPlanDayTopic[];
  totalQuestions: number;
  phase: "new" | "consolidation";
  /** LX-04: a timed mock exam is scheduled on this day (consolidation only). */
  simulation?: { presetId: string; offsetDays: number };
  /** UX-STU-23: one lighter day a week (half load, review only). */
  light?: boolean;
  /**
   * a-cram-part-plan: the day after a timed part run. "blocks": the topics
   * are that run's subjects below 60 percent; "none_below": the run had none,
   * the day keeps its plan; "pending": the run is still ahead.
   */
  drill?: { presetId: string; state: "pending" | "blocks" | "none_below"; runDay?: string; blocks?: string[] };
}

export interface StudyPlan {
  totalDays: number;
  totalQuestions: number;
  dailySchedule: StudyPlanDay[];
  phaseBreak: string; // ISO date — day on which consolidation starts
  generatedFor: string; // ISO date — the exam date the plan targets
  weakTopics: string[]; // topics flagged as weak (accuracy < 60%, answered > 0)
  /**
   * LX-02: days-and-load status. "tight" means the questions still unseen do
   * not fit the days left at the learner's daily goal (effort verdict tight or
   * too_much), not merely that the date is close.
   */
  status: "normal" | "tight" | "expired" | "far_future";
  /** LX-02: what the date implies (unseen questions, per day, minutes, verdict). */
  effort?: EffortSummary;
}

export interface GenerateStudyPlanInput {
  examDate: Date;
  dailyQuestionGoal: number;
  availableTopics: TopicProgress[];
  /**
   * Optional override for "today" — used in tests and for server-side
   * determinism. Defaults to `new Date()` normalized to midnight UTC.
   */
  now?: Date;
  /**
   * LX-04: preset or bank key for timed mock exams in the consolidation
   * window. Null or absent schedules none (the bank has no startable preset).
   */
  simulationPresetId?: string | null;
  /** UX-STU-23: mark one lighter day per week (half load, review only). Opt in. */
  lightDays?: boolean;
  /**
   * a-cram-part-plan: relative weight per topic (mean 1) from a part preset's
   * practice blueprint; multiplies each topic's deficit weight. Absent: 1.
   */
  topicWeights?: Readonly<Record<string, number>>;
  /** a-cram-part-plan: part plans of 10 to 29 days get T-14/T-7 runs (pickSimulationDays cram). */
  cramSimulations?: boolean;
  /**
   * a-cram-part-plan: drill days after part runs. The day after each
   * scheduled run, and today when a run of the preset was finished yesterday,
   * practise that run's subjects below 60 percent. Absent: no drill days.
   */
  drill?: { presetId: string; runs: readonly PartRunSummary[] };
}

/**
 * Row shape from the server-side `user_topic_strength` table (read via
 * `/api/user/topic-strength` or directly by the service-role client).
 * This is the cross-device source of truth for per-topic accuracy
 * introduced in backlog #13 (2026-04-21).
 */
export interface TopicStrengthInput {
  topic: string;
  answered: number;
  correct: number;
}

/**
 * Merge per-topic totals (from `get_topic_counts`) with strength rows
 * (from `user_topic_strength`) and optionally an answer_history
 * fallback aggregation, into the `TopicProgress[]` shape consumed by
 * `generateStudyPlan`.
 *
 * Precedence:
 *   1. `user_topic_strength` row if present (cross-device counters)
 *   2. Fallback answer_history aggregation if supplied
 *   3. Zero (topic appears in the bank but user hasn't touched it)
 *
 * This keeps the study-plan endpoint's read logic in one place and
 * lets the pure generator stay pure.
 */
export function mergeTopicProgressSources(
  topicTotals: { topic: string; count: number }[],
  strengthRows: TopicStrengthInput[],
  fallbackHistory?: Record<string, { answered: number; correct: number }>
): TopicProgress[] {
  const strengthMap = new Map<string, TopicStrengthInput>();
  for (const row of strengthRows || []) {
    if (row && typeof row.topic === "string") strengthMap.set(row.topic, row);
  }

  return (topicTotals || []).map(tc => {
    const total = Number(tc.count) || 0;
    const s = strengthMap.get(tc.topic);
    const h = fallbackHistory?.[tc.topic];

    const answered = s
      ? Number(s.answered) || 0
      : h
        ? Number(h.answered) || 0
        : 0;
    const correct = s
      ? Number(s.correct) || 0
      : h
        ? Number(h.correct) || 0
        : 0;

    return {
      topic: tc.topic,
      total,
      answered,
      correct,
      accuracy: answered > 0 ? Math.round((correct / answered) * 100) : 0,
    };
  });
}

const MS_PER_DAY = 86_400_000;
const MAX_PLAN_DAYS = 365;
const MIN_DAILY_QUESTIONS = 5;
const MAX_DAILY_QUESTIONS = 200;
const WEAK_ACCURACY_THRESHOLD = WEAK_BELOW_PCT; // shared weak-topic threshold (src/lib/weak-topics.ts, MUX-68)
const CONSOLIDATION_RATIO = 0.3;
/**
 * Below this many days the schedule is review only (schedule shape). The
 * "tight" STATUS is no longer derived from days alone (LX-02): it comes from
 * the effort verdict (unseen questions against the days and the daily goal).
 */
const SHORT_WINDOW_DAYS = 7;
/** Every 7th plan day is a lighter day when `lightDays` is on (UX-STU-23). */
const LIGHT_DAY_EVERY = 7;

/** Normalize a date to midnight UTC. */
function atMidnightUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Format a Date as YYYY-MM-DD. */
function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Clamp a number to a range. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Score a topic's "weight" in the new-material phase.
 * Higher score = more time should be spent on it.
 *
 *   - A topic with 0 answered → weight = total (all questions still to see)
 *   - A topic with accuracy < 60% → weight = (total - correct) * 1.5
 *     (the 1.5x premium pushes weak topics ahead of freshly-unseen ones)
 *   - A topic with accuracy ≥ 60% → weight = max(0, total - answered)
 *     (only the genuinely unseen questions count)
 */
function topicWeight(tp: TopicProgress, factors?: Readonly<Record<string, number>>): number {
  const f = factors ? (factors[tp.topic] ?? 1) : 1;
  if (tp.total <= 0) return 0;
  if (tp.answered === 0) return tp.total * f;
  if (tp.accuracy < WEAK_ACCURACY_THRESHOLD) {
    return Math.max(1, (tp.total - tp.correct) * 1.5) * f;
  }
  return Math.max(0, tp.total - tp.answered) * f;
}

/**
 * Decide the focus tag for a topic on a given phase. Used to label
 * day cards so the UI can show "review / weak / new" chips.
 */
function topicFocus(tp: TopicProgress, phase: "new" | "consolidation"): StudyFocus {
  if (phase === "consolidation") return "review";
  if (tp.answered === 0) return "new";
  if (tp.accuracy < WEAK_ACCURACY_THRESHOLD) return "weak";
  return "new";
}

/**
 * Distribute `total` integer units across `weights.length` slots
 * proportional to the weights. Uses the largest-remainder method so
 * the returned counts sum exactly to `total`. Deterministic.
 */
function distributeProportional(total: number, weights: number[]): number[] {
  const sumW = weights.reduce((s, w) => s + w, 0);
  if (sumW <= 0 || total <= 0) return weights.map(() => 0);

  const raw = weights.map(w => (w / sumW) * total);
  const floors = raw.map(r => Math.floor(r));
  let remaining = total - floors.reduce((s, n) => s + n, 0);

  // Largest remainder: hand out leftover units to slots whose
  // fractional part is largest. Tie-break by index (ascending) so the
  // output is deterministic.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => {
      if (b.frac !== a.frac) return b.frac - a.frac;
      return a.i - b.i;
    });

  const out = floors.slice();
  for (const { i } of order) {
    if (remaining <= 0) break;
    out[i] += 1;
    remaining -= 1;
  }
  return out;
}

/** Cycle through indices for cases where we can only fit a few topics per day. */
function cycleIndex(step: number, length: number): number {
  if (length <= 0) return 0;
  return ((step % length) + length) % length;
}

/**
 * Given a list of topic weights and a daily cap, emit a per-day array
 * of `{ topicIdx, count }` tuples. Policy: rotate through the topics
 * in weight-descending order, giving each day a slice of the two or
 * three top topics so a day isn't exclusively one subject.
 */
function buildDailyAllocation(
  numDays: number,
  dailyCap: number,
  topicIndicesByWeight: number[],
  topics: TopicProgress[],
  factors?: Readonly<Record<string, number>>
): Array<Array<{ topicIdx: number; count: number }>> {
  const out: Array<Array<{ topicIdx: number; count: number }>> = [];
  if (numDays <= 0) return out;

  // No topics — every day is empty (rendered as a rest/catch-up day).
  if (topicIndicesByWeight.length === 0) {
    for (let i = 0; i < numDays; i++) out.push([]);
    return out;
  }

  for (let d = 0; d < numDays; d++) {
    const maxSlots = Math.min(3, topicIndicesByWeight.length);
    // Rotate the starting topic each day so a user doesn't grind the
    // same subject every morning.
    const start = cycleIndex(d, topicIndicesByWeight.length);
    const dayTopicIdx: number[] = [];
    for (let k = 0; k < maxSlots; k++) {
      dayTopicIdx.push(
        topicIndicesByWeight[cycleIndex(start + k, topicIndicesByWeight.length)]
      );
    }

    // Give each slot a share of the daily cap proportional to the
    // topic's remaining deficit, capped by remaining questions.
    const slotWeights = dayTopicIdx.map(i => Math.max(1, topicWeight(topics[i], factors)));
    const counts = distributeProportional(dailyCap, slotWeights);

    const entries = dayTopicIdx.map((idx, k) => ({
      topicIdx: idx,
      count: counts[k],
    })).filter(e => e.count > 0);

    out.push(entries);
  }
  return out;
}

/** Edge-case helper: produce a one-day "today" plan when the exam date is in the past or today. */
function expiredPlan(
  today: Date,
  examDate: Date,
  dailyCap: number,
  topics: TopicProgress[]
): StudyPlan {
  // Order topics by weakness so the single day focuses on what hurts most.
  const ordered = topics
    .map((tp, i) => ({ tp, i, w: topicWeight(tp) }))
    .filter(x => x.w > 0)
    .sort((a, b) => b.w - a.w)
    .slice(0, 3);

  const weights = ordered.map(o => o.w);
  const counts = distributeProportional(dailyCap, weights);

  const dayTopics: StudyPlanDayTopic[] = ordered.map((o, k) => ({
    topic: o.tp.topic,
    targetCount: counts[k],
    focus: "review" as StudyFocus,
  })).filter(t => t.targetCount > 0);

  return {
    totalDays: 1,
    totalQuestions: dayTopics.reduce((s, d) => s + d.targetCount, 0),
    dailySchedule: [
      {
        day: toISODate(today),
        topics: dayTopics,
        totalQuestions: dayTopics.reduce((s, d) => s + d.targetCount, 0),
        phase: "consolidation",
      },
    ],
    phaseBreak: toISODate(today),
    generatedFor: toISODate(examDate),
    weakTopics: topics.filter(t => t.answered > 0 && t.accuracy < WEAK_ACCURACY_THRESHOLD).map(t => t.topic),
    status: "expired",
  };
}

/** Questions of the pool the learner has not answered yet. */
export function unseenTotal(topics: TopicProgress[]): number {
  return topics.reduce((sum, t) => sum + Math.max(0, (t.total || 0) - (t.answered || 0)), 0);
}

/**
 * UX-STU-23: half load and review only on every 7th day, skipping simulation
 * days so a mock exam never lands on a lighter day. Mutates the schedule it is
 * given (called once on a freshly built array).
 */
function markLightDays(schedule: StudyPlanDay[]): void {
  schedule.forEach((day, i) => {
    if ((i + 1) % LIGHT_DAY_EVERY !== 0 || day.simulation || day.drill || day.topics.length === 0) return;
    const half = day.topics
      .map(t => ({ ...t, targetCount: Math.floor(t.targetCount / 2), focus: "review" as StudyFocus }))
      .filter(t => t.targetCount > 0);
    day.topics = half;
    day.totalQuestions = half.reduce((s, t) => s + t.targetCount, 0);
    day.light = true;
  });
}

/**
 * a-cram-part-plan: mark drill days and, where the run is known, fill them
 * with that run's subjects below 60 percent (only subjects of this plan).
 * Mutates the schedule it is given.
 */
function applyDrills(
  schedule: StudyPlanDay[],
  picks: readonly SimulationDay[],
  drill: NonNullable<GenerateStudyPlanInput["drill"]>,
  dailyCap: number,
  topics: TopicProgress[],
): void {
  if (schedule.length === 0) return;
  const first = schedule[0].day;
  // Drill day -> earliest run day it accepts: a scheduled run's own day.
  const drillDays = new Map<string, string>(picks.map(p => [addDays(p.day, 1), p.day]));
  // A run finished yesterday (scheduled or not) makes today a drill day.
  const yesterday = addDays(first, -1);
  if (drill.runs.some(r => r.presetId === drill.presetId && r.day === yesterday) && !drillDays.has(first)) drillDays.set(first, yesterday);
  const known = new Set(topics.map(t => t.topic));
  for (const day of schedule) {
    if (!drillDays.has(day.day) || day.simulation) continue;
    const run = drillRunFor(day.day, drill.presetId, drill.runs, drillDays.get(day.day));
    if (!run) {
      day.drill = { presetId: drill.presetId, state: "pending" };
      continue;
    }
    const weak = run.weak.filter(w => known.has(w.topic));
    if (weak.length === 0) {
      day.drill = { presetId: drill.presetId, state: "none_below", runDay: run.day };
      continue;
    }
    // Further below the mark gets more of the day.
    const counts = distributeProportional(dailyCap, weak.map(w => Math.max(0.05, DRILL_BELOW - w.pct)));
    const dayTopics = weak
      .map((w, k) => ({ topic: w.topic, targetCount: counts[k], focus: "weak" as StudyFocus }))
      .filter(t => t.targetCount > 0);
    day.topics = dayTopics;
    day.totalQuestions = dayTopics.reduce((s, t) => s + t.targetCount, 0);
    day.drill = { presetId: drill.presetId, state: "blocks", runDay: run.day, blocks: weak.map(w => w.topic) };
  }
}

/**
 * Main entry point. Pure and deterministic.
 */
export function generateStudyPlan(input: GenerateStudyPlanInput): StudyPlan {
  const dailyCap = clamp(
    Math.round(input.dailyQuestionGoal || 20),
    MIN_DAILY_QUESTIONS,
    MAX_DAILY_QUESTIONS
  );
  const today = atMidnightUTC(input.now ?? new Date());
  const exam = atMidnightUTC(input.examDate);

  const diffDays = Math.round((exam.getTime() - today.getTime()) / MS_PER_DAY);
  const topics = (input.availableTopics || []).filter(
    t => t && typeof t.topic === "string" && t.total > 0
  );

  const weakTopicNames = topics
    .filter(t => t.answered > 0 && t.accuracy < WEAK_ACCURACY_THRESHOLD)
    .map(t => t.topic);

  // Exam already passed or is today → one-day consolidation plan.
  if (diffDays <= 0) {
    return expiredPlan(today, exam, dailyCap, topics);
  }

  // Cap at a year — anything beyond that is aspirational.
  const rawDays = diffDays;
  const totalDays = Math.min(rawDays, MAX_PLAN_DAYS);
  const effort = planEffort(unseenTotal(topics), totalDays, dailyCap);
  const factors = input.topicWeights;
  const shortWindow = rawDays <= SHORT_WINDOW_DAYS;
  const status: StudyPlan["status"] =
    rawDays > MAX_PLAN_DAYS
      ? "far_future"
      : shortWindow || effort.verdict !== "fits"
      ? "tight"
      : "normal";

  // Order topics descending by weight (most deficit first).
  const orderedIdx = topics
    .map((_, i) => i)
    .sort((a, b) => topicWeight(topics[b], factors) - topicWeight(topics[a], factors));

  // For short windows, everything becomes consolidation of weak topics.
  if (shortWindow) {
    const weakIdx = orderedIdx.filter(i => {
      const t = topics[i];
      return t.accuracy < WEAK_ACCURACY_THRESHOLD || t.answered === 0;
    });
    const pool = weakIdx.length > 0 ? weakIdx : orderedIdx;

    const alloc = buildDailyAllocation(totalDays, dailyCap, pool, topics, factors);
    const schedule: StudyPlanDay[] = alloc.map((entries, d) => {
      const date = new Date(today.getTime() + d * MS_PER_DAY);
      return {
        day: toISODate(date),
        topics: entries.map(e => ({
          topic: topics[e.topicIdx].topic,
          targetCount: e.count,
          focus: "review",
        })),
        totalQuestions: entries.reduce((s, e) => s + e.count, 0),
        phase: "consolidation",
      };
    });
    if (input.drill) applyDrills(schedule, [], input.drill, dailyCap, topics);

    return {
      totalDays,
      totalQuestions: schedule.reduce((s, d) => s + d.totalQuestions, 0),
      dailySchedule: schedule,
      phaseBreak: toISODate(today),
      generatedFor: toISODate(exam),
      weakTopics: weakTopicNames,
      status,
      effort,
    };
  }

  // Normal / far-future split: first 70% = new, last 30% = consolidation.
  const consolidationDays = Math.max(1, Math.round(totalDays * CONSOLIDATION_RATIO));
  const newDays = Math.max(1, totalDays - consolidationDays);

  // New-material phase pool = all topics (weights push weak/unseen up).
  const newPool = orderedIdx.filter(i => topicWeight(topics[i], factors) > 0);
  const newAlloc = buildDailyAllocation(
    newDays,
    dailyCap,
    newPool.length > 0 ? newPool : orderedIdx,
    topics,
    factors
  );

  // Consolidation phase pool = weak + unseen only. If there aren't any
  // weak topics (e.g. the user already has 80%+ everywhere), fall back
  // to the top-weight topics so review still has something to do.
  const critIdx = orderedIdx.filter(i => {
    const t = topics[i];
    return t.accuracy < 70 || t.answered < t.total;
  });
  const consPool = critIdx.length > 0 ? critIdx.slice(0, 5) : orderedIdx.slice(0, 3);
  const consAlloc = buildDailyAllocation(consolidationDays, dailyCap, consPool, topics, factors);

  const schedule: StudyPlanDay[] = [];
  for (let d = 0; d < newDays; d++) {
    const date = new Date(today.getTime() + d * MS_PER_DAY);
    const entries = newAlloc[d] || [];
    schedule.push({
      day: toISODate(date),
      topics: entries.map(e => ({
        topic: topics[e.topicIdx].topic,
        targetCount: e.count,
        focus: topicFocus(topics[e.topicIdx], "new"),
      })),
      totalQuestions: entries.reduce((s, e) => s + e.count, 0),
      phase: "new",
    });
  }
  for (let d = 0; d < consolidationDays; d++) {
    const date = new Date(today.getTime() + (newDays + d) * MS_PER_DAY);
    const entries = consAlloc[d] || [];
    schedule.push({
      day: toISODate(date),
      topics: entries.map(e => ({
        topic: topics[e.topicIdx].topic,
        targetCount: e.count,
        focus: "review",
      })),
      totalQuestions: entries.reduce((s, e) => s + e.count, 0),
      phase: "consolidation",
    });
  }

  const phaseBreak = toISODate(new Date(today.getTime() + newDays * MS_PER_DAY));

  // LX-04: timed mock exams on named consolidation days (T-14, T-7, T-3 from
  // 60 days). Only when the caller names a startable preset; the plan never
  // invents a duration or a pass mark (the page reads them from the preset).
  // Far-future plans are capped at a year, so their window never reaches the
  // exam and gets none.
  let picks: SimulationDay[] = [];
  if (input.simulationPresetId && rawDays <= MAX_PLAN_DAYS) {
    picks = pickSimulationDays({
      startDay: toISODate(today),
      examDate: toISODate(exam),
      consolidationStart: phaseBreak,
      presetId: input.simulationPresetId,
      ...(input.cramSimulations ? { cram: true } : {}),
    });
    for (const pick of picks) {
      const day = schedule.find(d => d.day === pick.day);
      if (day) day.simulation = { presetId: pick.presetId, offsetDays: pick.offsetDays };
    }
  }
  if (input.drill) applyDrills(schedule, picks, input.drill, dailyCap, topics);
  if (input.lightDays) markLightDays(schedule);

  return {
    totalDays,
    totalQuestions: schedule.reduce((s, d) => s + d.totalQuestions, 0),
    dailySchedule: schedule,
    phaseBreak,
    generatedFor: toISODate(exam),
    weakTopics: weakTopicNames,
    status,
    effort,
  };
}
