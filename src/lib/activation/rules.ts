/**
 * First 48 hours (a-activation-48h). Pure rules, no I/O.
 *
 * Production read 15 Oct 2026 (107 accounts, 180 days, read-only): a learner
 * with no answer on the signup day came back on day 1 or 2 in 1 of 42 cases,
 * 1 to 9 answers in 8 of 43, 10 or more in 13 of 22. The first ten answers on
 * day 0 are the lever; every other step hangs off them.
 *
 * The path for an account younger than ACTIVATION_WINDOW_HOURS:
 *  - starter:   no answer yet. Home's hero opens the starter set (10 free-set
 *               questions, the curated opening first, then questions whose
 *               explanation is already translated into the learner's reading
 *               language, spread across subjects).
 *  - continue:  1 to 9 answers. Home names how many remain and opens the rest.
 *  - after_win: 10 or more. The plan for the named sitting (or "When is your
 *               exam?") and the opt-in study reminder for tomorrow.
 *  - outside:   the window has passed: nothing of this path renders.
 *
 * Behind ACTIVATION_48H_ENABLED (server, default off; only the literal "true").
 */
import { TRANSLATION_TARGETS, type TranslationTarget } from "@/lib/explanation-translation";
import { viennaStamp } from "@/lib/exam-dates";
import { STUDY_NUDGE_HOURS } from "@/lib/reminders/schedule";

export const ACTIVATION_WINDOW_HOURS = 48;
export const FIRST_WIN_SIZE = 10;

type Env = Record<string, string | undefined>;

export function activationEnabled(env: Env = process.env): boolean {
  return (env.ACTIVATION_48H_ENABLED ?? "").trim() === "true";
}

/** Epoch ms when the account's first 48 hours end, or null for an unreadable creation time. */
export function activationWindowEnd(createdAt: string | null | undefined): number | null {
  if (!createdAt) return null;
  const start = Date.parse(createdAt);
  if (!Number.isFinite(start)) return null;
  return start + ACTIVATION_WINDOW_HOURS * 3_600_000;
}

export function inActivationWindow(createdAt: string | null | undefined, now: Date): boolean {
  const end = activationWindowEnd(createdAt);
  if (end === null) return false;
  const start = end - ACTIVATION_WINDOW_HOURS * 3_600_000;
  // A creation time in the future (clock skew) is treated as just created.
  return now.getTime() < end && now.getTime() >= start - 5 * 60_000;
}

export type ActivationStage = "starter" | "continue" | "after_win" | "outside";

export function activationStage(args: { inWindow: boolean; answered: number }): ActivationStage {
  if (!args.inWindow) return "outside";
  if (args.answered <= 0) return "starter";
  if (args.answered < FIRST_WIN_SIZE) return "continue";
  return "after_win";
}

/**
 * The learner's reading language for explanations: a translation target, or
 * null for German (the exam language, nothing to translate).
 */
export function readingLang(raw: string | null | undefined): TranslationTarget | null {
  const v = (raw ?? "").trim().toLowerCase().slice(0, 2);
  return (TRANSLATION_TARGETS as readonly string[]).includes(v) ? (v as TranslationTarget) : null;
}

/** Journey segment, from the named sitting first, else the bank (CUSTOMER-JOURNEY section 2). */
export type ActivationSegment = "stichprobentest" | "vienna_sip" | "rez_gm" | "unknown";

export function activationSegment(named: string | null | undefined, activeExam: string | null | undefined): ActivationSegment {
  if (named === "stichprobentest" || named === "vienna_sip" || named === "rez_gm") return named;
  if (activeExam === "kmp_innsbruck") return "stichprobentest";
  if (activeExam === "kenntnispruefung") return "vienna_sip";
  if (activeExam === "pharma") return "rez_gm";
  return "unknown";
}

/**
 * The starter set: up to `size` unanswered free-set ids. Order: the curated
 * opening (its own order), then ids with a cached explanation translation in
 * the reading language, then the rest; inside the last two groups one id per
 * subject in turn so the set spans subjects. Deterministic for equal input.
 */
export function pickStarterIds(args: {
  opening: readonly number[];
  free: readonly number[];
  topicOf: ReadonlyMap<number, string>;
  translated: ReadonlySet<number>;
  answered: ReadonlySet<number>;
  size: number;
}): number[] {
  const size = Math.max(0, Math.floor(args.size));
  if (size === 0) return [];
  const freeSet = new Set(args.free);
  const out: number[] = [];
  const taken = new Set<number>();
  const take = (id: number) => {
    if (out.length >= size || taken.has(id) || args.answered.has(id) || !freeSet.has(id)) return;
    taken.add(id);
    out.push(id);
  };
  for (const id of args.opening) take(id);

  const spread = (ids: readonly number[]) => {
    const byTopic = new Map<string, number[]>();
    for (const id of ids) {
      if (taken.has(id) || args.answered.has(id)) continue;
      const topic = args.topicOf.get(id) ?? "";
      const list = byTopic.get(topic) ?? [];
      list.push(id);
      byTopic.set(topic, list);
    }
    // Subjects already in the set wait their turn after the others.
    const used = new Set(out.map((id) => args.topicOf.get(id) ?? ""));
    const topics = [...byTopic.keys()].sort((a, b) => Number(used.has(a)) - Number(used.has(b)) || a.localeCompare(b));
    let round = 0;
    while (out.length < size) {
      let added = false;
      for (const topic of topics) {
        const id = byTopic.get(topic)![round];
        if (id === undefined) continue;
        take(id);
        added = true;
        if (out.length >= size) break;
      }
      if (!added) break;
      round++;
    }
  };
  const sortedFree = [...args.free].sort((a, b) => a - b);
  spread(sortedFree.filter((id) => args.translated.has(id)));
  spread(sortedFree);
  return out;
}

/** How many of the picked ids carry a cached translation. */
export function translatedCount(ids: readonly number[], translated: ReadonlySet<number>): number {
  return ids.filter((id) => translated.has(id)).length;
}

/** The quiz link for a starter set (ids hand-off; `starter=1` marks the round). */
export function starterHref(exam: string, ids: readonly number[]): string {
  const p = new URLSearchParams({ examSource: exam, ids: ids.join(","), starter: "1" });
  return `/quiz?${p.toString()}`;
}

/** The reminder hour offered for tomorrow: this hour in Vienna, kept inside the sender's hours. */
export function reminderHourFor(now: Date): number {
  const h = Number(viennaStamp(now).slice(11, 13));
  if (!Number.isFinite(h)) return STUDY_NUDGE_HOURS.fallback;
  return Math.min(STUDY_NUDGE_HOURS.max, Math.max(STUDY_NUDGE_HOURS.min, h));
}

/** Steps the path reports through the signed tracker (activation_step). */
export const ACTIVATION_STEPS = [
  "starter_shown",
  "starter_started",
  "continue_shown",
  "first_win",
  "plan_opened",
  "ask_opened",
  "reminder_shown",
  "reminder_saved",
  "reminder_pending",
  "trial_mock",
  "trial_mistakes",
] as const;
export type ActivationStep = (typeof ACTIVATION_STEPS)[number];
