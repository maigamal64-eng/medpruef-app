/**
 * Public study-plan generator (marketing lever M8, a-study-plan-magnet). Pure.
 *
 * A visitor picks a question bank, an official sitting and hours per week and
 * gets a week-by-week view of the same deterministic engine the signed-in
 * /study-plan uses (generateStudyPlan). Every date comes from OFFICIAL_SITTINGS
 * in exam-dates.ts; nothing here types a date, a price or a pass mark.
 *
 * The short narrative above the plan is never generated live: it is drafted
 * offline (scripts/study-plan-public) and shown only when Lektor approved it
 * (narratives.data.json, status "approved", text hash unchanged).
 */
import {
  OFFICIAL_SITTINGS,
  asPuypExamType,
  getUpcomingOfficialFor,
  groupOfficialByDate,
  isOfficialWindowOpen,
  viennaToday,
  type OfficialDeadlineType,
  type OfficialExamKey,
  type OfficialSitting,
  type PuypExamType,
} from "../exam-dates";
import { MINUTES_PER_QUESTION, type EffortVerdict } from "../master-learning/plan-effort";
import { daysBetween } from "../master-learning/plan-target";
import { generateStudyPlan, unseenTotal, type StudyPlan, type StudyPlanDay, type TopicProgress } from "../studyPlan";
import { simulationPresetFor } from "../study-plan-target";

/** Server flag (STUDY_PLAN_PUBLIC_ENABLED). Only the literal "true" opens the page. */
export function publicPlanEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STUDY_PLAN_PUBLIC_ENABLED === "true";
}

export const PUBLIC_PLAN_PATH = "/lernplan";

/** Hours a week the visitor can choose. A fixed list keeps the narrative set finite. */
export const PUBLIC_PLAN_HOURS = [3, 5, 8, 12, 16, 20] as const;
export type PublicPlanHours = (typeof PUBLIC_PLAN_HOURS)[number];
export const DEFAULT_PUBLIC_HOURS: PublicPlanHours = 8;

export const PUBLIC_PLAN_BANKS: readonly PuypExamType[] = ["kenntnispruefung", "kmp_innsbruck", "pharma"];

/**
 * Official exams a bank's sittings come from on this page. The pharma bank's
 * sitting is the Rezeptierkunde week; Gerichtsmedizin shares that week, and
 * its practice rows (a44, topic Gerichtsmedizin in the pharma bank) enter the
 * plan as a topic once they are active. Only the Rezeptierkunde rows name the
 * sitting here, so the label never implies a separate Gerichtsmedizin plan.
 */
export const PUBLIC_PLAN_EXAM_KEYS: Record<PuypExamType, readonly OfficialExamKey[]> = {
  kenntnispruefung: ["sip4a", "sip5a"],
  kmp_innsbruck: ["stichprobentest"],
  pharma: ["rezeptierkunde"],
};

/** First-touch tags the save CTA carries to /login (captured only when no earlier tag exists). */
export const PUBLIC_PLAN_UTM = { utm_source: "study-plan", utm_medium: "lead-magnet", utm_campaign: "lernplan" } as const;

/**
 * Daily question goal for hours a week, at the stated estimate of
 * MINUTES_PER_QUESTION (an estimate, not a measured value). Clamped to the
 * 5..200 range the engine and the preference API accept.
 */
export function dailyGoalForHours(hours: number): number {
  const perDay = (Math.max(0, hours) * 60) / MINUTES_PER_QUESTION / 7;
  return Math.max(5, Math.min(200, Math.round(perDay)));
}

export interface PublicSittingOption {
  /** ISO day of the sitting (first day of an exam week). */
  date: string;
  dateEnd?: string;
  /** Learner labels of the rows on that date, de-duplicated. */
  labels: { de: string; en: string }[];
  /** Publishers of the date and its deadlines, de-duplicated (both Stichprobentest publishers). */
  publishers: string[];
  sourceUrls: string[];
  /** True when a row's registration window is not confirmed on the official page. */
  windowUnconfirmed: boolean;
  /** Latest day the official sources of this date were read. */
  readOn: string;
  /**
   * True when every published deadline of the date has closed (Vienna time).
   * An unconfirmed window never counts as closed.
   */
  registrationClosed: boolean;
}

function uniq<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(key(item)) ? false : (seen.add(key(item)), true)));
}

/** Upcoming official sittings of a bank after today (Vienna), one option per date. */
export function publicSittingOptions(
  bank: PuypExamType,
  now: Date = new Date(),
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
): PublicSittingOption[] {
  const today = viennaToday(now);
  const rows = getUpcomingOfficialFor({ exams: PUBLIC_PLAN_EXAM_KEYS[bank], now }, sittings).filter((r) => r.date > today);
  return groupOfficialByDate(rows).map((g) => ({
    date: g.date,
    ...(g.date_end ? { dateEnd: g.date_end } : {}),
    labels: uniq(g.rows.map((r) => r.learner_label), (l) => l.de),
    publishers: uniq(g.rows.map((r) => r.publisher), (p) => p),
    sourceUrls: uniq(g.rows.map((r) => r.source_url), (u) => u),
    windowUnconfirmed: g.rows.some((r) => r.window_unconfirmed === true),
    readOn: g.rows.map((r) => r.read_on).sort().at(-1) as string,
    registrationClosed: g.rows.every((r) => !r.window_unconfirmed && !!r.registration_closes && !isOfficialWindowOpen(r, now)),
  }));
}

/** The form's default sitting: the first whose registration is still open, else the first. */
export function defaultSitting(options: readonly PublicSittingOption[]): string | null {
  return (options.find((o) => !o.registrationClosed) ?? options[0])?.date ?? null;
}

export interface PublicPlanQuery {
  bank: PuypExamType;
  sitting: string;
  hours: PublicPlanHours;
}

function first(value: string | string[] | null | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function parseHours(value: string | string[] | null | undefined): PublicPlanHours | null {
  const n = Number(first(value));
  return (PUBLIC_PLAN_HOURS as readonly number[]).includes(n) ? (n as PublicPlanHours) : null;
}

/**
 * The visitor's choice from the query string. A plan exists only when all
 * three are valid and the sitting is an upcoming official option of the bank.
 * `form` always holds usable defaults for the form.
 */
export function parsePublicPlanQuery(
  params: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): { form: { bank: PuypExamType; sitting: string | null; hours: PublicPlanHours }; query: PublicPlanQuery | null } {
  const bank = asPuypExamType(first(params.bank)) ?? "kenntnispruefung";
  const options = publicSittingOptions(bank, now);
  const askedSitting = first(params.sitting);
  const sitting = options.some((o) => o.date === askedSitting) ? askedSitting : null;
  const hours = parseHours(params.hours);
  const form = { bank, sitting: sitting ?? defaultSitting(options), hours: hours ?? DEFAULT_PUBLIC_HOURS };
  const complete = asPuypExamType(first(params.bank)) !== null && sitting !== null && hours !== null;
  return { form, query: complete ? { bank, sitting: sitting as string, hours: hours as PublicPlanHours } : null };
}

export interface PlanWeekTopic {
  topic: string;
  count: number;
}

export interface PlanWeek {
  index: number;
  from: string;
  to: string;
  questions: number;
  phase: "new" | "consolidation" | "mixed";
  /** Topics of the week by planned questions, largest first. */
  topics: PlanWeekTopic[];
  simulations: number;
  lightDays: number;
}

/** Seven-day weeks from the first plan day; the last week may be shorter. */
export function weeksFromSchedule(schedule: readonly StudyPlanDay[]): PlanWeek[] {
  const weeks: PlanWeek[] = [];
  for (let i = 0; i < schedule.length; i += 7) {
    const days = schedule.slice(i, i + 7);
    const byTopic = new Map<string, number>();
    for (const day of days) for (const t of day.topics) byTopic.set(t.topic, (byTopic.get(t.topic) ?? 0) + t.targetCount);
    const phases = new Set(days.map((d) => d.phase));
    weeks.push({
      index: weeks.length + 1,
      from: days[0].day,
      to: days[days.length - 1].day,
      questions: days.reduce((s, d) => s + d.totalQuestions, 0),
      phase: phases.size > 1 ? "mixed" : (days[0].phase as "new" | "consolidation"),
      topics: [...byTopic.entries()]
        .map(([topic, count]) => ({ topic, count }))
        .filter((t) => t.count > 0)
        .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)),
      simulations: days.filter((d) => d.simulation).length,
      lightDays: days.filter((d) => d.light).length,
    });
  }
  return weeks;
}

export interface TopicCountRow {
  topic: string;
  count: number | string;
}

export interface PublicPlan {
  query: PublicPlanQuery;
  todayISO: string;
  dailyGoal: number;
  plan: StudyPlan;
  weeks: PlanWeek[];
  /** Questions of the bank (active, DB-owned at render time). */
  bankTotal: number;
  /** New questions the plan reaches by the sitting at this pace. */
  reachable: number;
  verdict: EffortVerdict | null;
  daysLeft: number;
  registration: PublicRegistrationRow[];
}

export interface PublicRegistrationRow {
  closes: string;
  closesAtTime?: string;
  deadlineType: OfficialDeadlineType;
  /** Publisher as written in exam-dates.ts (both Stichprobentest publishers appear). */
  publisher: string;
  passed: boolean;
  sourceUrl: string;
}

/**
 * Published deadlines for the chosen sitting, one per (close, publisher),
 * soonest first. Rows whose window is unconfirmed are left out (the page then
 * points to the official source). Never picks one publisher for the visitor.
 */
export function publicRegistrationRows(
  bank: PuypExamType,
  sitting: string,
  now: Date = new Date(),
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
): PublicRegistrationRow[] {
  const keys = PUBLIC_PLAN_EXAM_KEYS[bank];
  const rows = sittings.filter((s) => keys.includes(s.exam_key) && s.date === sitting && !!s.registration_closes && !s.window_unconfirmed);
  return uniq(rows, (r) => `${r.registration_closes}|${r.publisher}|${r.deadline_type}`)
    .map((r) => ({
      closes: r.registration_closes as string,
      ...(r.closes_at_time ? { closesAtTime: r.closes_at_time } : {}),
      deadlineType: r.deadline_type,
      publisher: r.publisher,
      passed: !isOfficialWindowOpen(r, now),
      sourceUrl: r.source_url,
    }))
    .sort((a, b) => a.closes.localeCompare(b.closes) || a.publisher.localeCompare(b.publisher));
}

/**
 * The plan for a visitor who has not answered anything yet. `todayISO` is the
 * Vienna day; the engine counts UTC days, so it gets noon UTC of that day
 * (the signed-in route does the same).
 */
export function buildPublicPlan(input: {
  query: PublicPlanQuery;
  topicCounts: readonly TopicCountRow[];
  todayISO: string;
  now?: Date;
}): PublicPlan {
  const { query, todayISO } = input;
  const topics: TopicProgress[] = input.topicCounts
    .map((r) => ({ topic: r.topic, total: Number(r.count) || 0, answered: 0, correct: 0, accuracy: 0 }))
    .filter((t) => t.total > 0)
    .sort((a, b) => a.topic.localeCompare(b.topic));
  const dailyGoal = dailyGoalForHours(query.hours);
  const plan = generateStudyPlan({
    examDate: new Date(`${query.sitting}T00:00:00Z`),
    dailyQuestionGoal: dailyGoal,
    availableTopics: topics,
    now: new Date(`${todayISO}T12:00:00Z`),
    simulationPresetId: simulationPresetFor(query.bank),
    lightDays: true,
  });
  const bankTotal = unseenTotal(topics);
  const planned = plan.dailySchedule.filter((d) => d.phase === "new").reduce((s, d) => s + d.totalQuestions, 0);
  return {
    query,
    todayISO,
    dailyGoal,
    plan,
    weeks: weeksFromSchedule(plan.dailySchedule),
    bankTotal,
    reachable: Math.max(0, Math.min(bankTotal, planned)),
    verdict: plan.effort?.verdict ?? null,
    daysLeft: Math.max(0, daysBetween(todayISO, query.sitting)),
    registration: publicRegistrationRows(query.bank, query.sitting, input.now ?? new Date(`${todayISO}T12:00:00Z`)),
  };
}

// ---------------------------------------------------------------------------
// Carrying the plan into an account. The save CTA sends the visitor to
// /study-plan with these three values; /study-plan applies them only when
// they still name an upcoming official sitting of that bank.
// ---------------------------------------------------------------------------

export interface CarriedPlan {
  exam: PuypExamType;
  examDate: string;
  dailyGoal: number;
}

export const CARRY_PARAMS = { exam: "plan_exam", date: "plan_date", goal: "plan_goal", from: "from" } as const;

export function studyPlanCarryHref(plan: CarriedPlan): string {
  const p = new URLSearchParams({
    [CARRY_PARAMS.exam]: plan.exam,
    [CARRY_PARAMS.date]: plan.examDate,
    [CARRY_PARAMS.goal]: String(plan.dailyGoal),
    [CARRY_PARAMS.from]: "lernplan",
  });
  return `/study-plan?${p}`;
}

export function parseCarriedPlan(params: URLSearchParams, now: Date = new Date()): CarriedPlan | null {
  if (params.get(CARRY_PARAMS.from) !== "lernplan") return null;
  const exam = asPuypExamType(params.get(CARRY_PARAMS.exam));
  const examDate = params.get(CARRY_PARAMS.date);
  const goalRaw = params.get(CARRY_PARAMS.goal);
  if (!exam || !examDate || !goalRaw || !/^\d{1,3}$/.test(goalRaw)) return null;
  const dailyGoal = Number(goalRaw);
  if (dailyGoal < 5 || dailyGoal > 200) return null;
  if (!publicSittingOptions(exam, now).some((o) => o.date === examDate)) return null;
  return { exam, examDate, dailyGoal };
}

/**
 * Marker the save CTA leaves in localStorage (30 minutes, survives the e-mail
 * verification tab). /study-plan applies a carried
 * plan without asking only when it matches, so a link someone else crafted
 * never changes an account silently (it gets the confirm card instead).
 */
export const PENDING_PLAN_KEY = "medpruef_public_plan_pending";

export function pendingPlanMarker(plan: CarriedPlan): string {
  return `${plan.exam}|${plan.examDate}|${plan.dailyGoal}`;
}

/** Same 30-minute window as the auth hand-off (auth-entry.ts). */
export const PENDING_PLAN_TTL_MS = 30 * 60_000;

export function pendingPlanRecord(plan: CarriedPlan, nowMs: number): string {
  return JSON.stringify({ marker: pendingPlanMarker(plan), expires: nowMs + PENDING_PLAN_TTL_MS });
}

/** True when the stored record was left by the save CTA for exactly this plan and has not expired. */
export function pendingPlanMatches(record: string | null, plan: CarriedPlan, nowMs: number): boolean {
  if (!record) return false;
  try {
    const parsed = JSON.parse(record) as { marker?: unknown; expires?: unknown };
    return parsed.marker === pendingPlanMarker(plan) && typeof parsed.expires === "number" && parsed.expires > nowMs;
  } catch {
    return false;
  }
}

/** The carry parameters removed, so a reload never re-applies them. */
export function withoutCarryParams(search: string): string {
  const p = new URLSearchParams(search);
  for (const key of Object.values(CARRY_PARAMS)) p.delete(key);
  const rest = p.toString();
  return rest ? `?${rest}` : "";
}

// ---------------------------------------------------------------------------
// Narrative templates (drafted offline, approved by Lektor).
// ---------------------------------------------------------------------------

export type NarrativeLang = "de" | "en";

/** Placeholders a template may use; code fills every value from the live plan. */
export const NARRATIVE_PLACEHOLDERS = ["exam", "sitting", "weeks", "hours", "per_week", "review_from"] as const;
export type NarrativePlaceholder = (typeof NARRATIVE_PLACEHOLDERS)[number];

export interface NarrativeEntry {
  key: string;
  bank: PuypExamType;
  sitting: string;
  hours: number;
  /** Effort verdict the draft was written for; shown only while the live plan has the same verdict. */
  verdict: EffortVerdict;
  de: string;
  en: string;
  status: "draft" | "approved";
  model?: string;
  drafted_on?: string;
  approved_by?: string;
  approved_on?: string;
  /** sha256 of `${de}\n${en}` at approval; a later text edit hides the entry until it is approved again. */
  text_sha256?: string;
}

export function narrativeKey(bank: string, sitting: string, hours: number): string {
  return `${bank}|${sitting}|${hours}`;
}

/** Approved entries keyed by narrativeKey. The hash check runs on the server (node:crypto). */
export function approvedNarratives(
  entries: readonly NarrativeEntry[],
  hash: (text: string) => string,
): Record<string, NarrativeEntry> {
  const out: Record<string, NarrativeEntry> = {};
  for (const e of entries) {
    if (e.status !== "approved" || !e.approved_by || !e.approved_on) continue;
    if (!e.text_sha256 || e.text_sha256 !== hash(`${e.de}\n${e.en}`)) continue;
    if (validateNarrative(e.de, "de").length || validateNarrative(e.en, "en").length) continue;
    out[e.key] = e;
  }
  return out;
}

export function fillNarrative(template: string, values: Record<NarrativePlaceholder, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (whole, name: string) =>
    (NARRATIVE_PLACEHOLDERS as readonly string[]).includes(name) ? values[name as NarrativePlaceholder] : whole,
  );
}

/** The narrative for this plan and language, or null (no approved entry, or the verdict moved). */
export function resolveNarrative(
  approved: Record<string, NarrativeEntry>,
  plan: Pick<PublicPlan, "query" | "verdict">,
  lang: NarrativeLang,
  values: Record<NarrativePlaceholder, string>,
): string | null {
  const entry = approved[narrativeKey(plan.query.bank, plan.query.sitting, plan.query.hours)];
  if (!entry || entry.verdict !== plan.verdict) return null;
  return fillNarrative(entry[lang], values);
}

/** Month names: a date in a narrative must come from a placeholder, never from the model. */
const MONTHS = /\b(jänner|januar|january|februar|february|märz|march|april|mai|juni|june|juli|july|august|september|oktober|october|november|dezember|december)\b/i;

const FORBIDDEN: Record<NarrativeLang, RegExp[]> = {
  de: [
    /bestehen|bestanden|bestehst|erfolgsquote|garant/i,
    /deutschland|deutsche[nr]? (prüfung|approbation)|approbation/i,
    /zugelassen|zulassung|berechtigt|voraussetzung|anspruch|vorgeschrieben/i,
    /preis|kosten|kostenlos|gratis|euro|€|abo\b|pro-?version/i,
    /\b(du|dein|deine|dich|dir)\b/i,
    /offizielle prüfungsfragen|echte prüfungsfragen|originalfragen/i,
  ],
  en: [
    /\bpass(es|ed|ing)?\b|success rate|guarantee/i,
    /\bgermany\b|german (exam|licen[cs]e)|approbation/i,
    /eligib|entitled|admission|requirement|prescribed/i,
    /price|cost|free\b|euro|€|subscription/i,
    /official exam questions|real exam questions|leaked/i,
  ],
};

/**
 * Problems in a drafted narrative (empty = clean). Used by the drafting script
 * and again before an approved entry renders.
 */
export function validateNarrative(text: string, lang: NarrativeLang): string[] {
  const issues: string[] = [];
  const t = text.trim();
  if (!t) return ["empty"];
  if (t.length > 420) issues.push("too_long");
  if (/[–—]/.test(t)) issues.push("dash");
  if (/\d/.test(t.replace(/\{[a-z_]+\}/g, ""))) issues.push("digit");
  for (const m of t.matchAll(/\{([^}]*)\}/g)) {
    if (!(NARRATIVE_PLACEHOLDERS as readonly string[]).includes(m[1])) issues.push(`placeholder:${m[1]}`);
  }
  if (/[{}]/.test(t.replace(/\{[a-z_]+\}/g, ""))) issues.push("brace");
  if (MONTHS.test(t) || /\bMay\b/.test(t.slice(1))) issues.push("month");
  for (const re of FORBIDDEN[lang]) if (re.test(t)) issues.push(`forbidden:${re.source.slice(0, 24)}`);
  if (lang === "de" && !/\b(Sie|Ihr|Ihre|Ihnen|Ihren|Ihrem|Ihrer)\b/.test(t)) issues.push("not_formal");
  return issues;
}
