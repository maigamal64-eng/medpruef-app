/**
 * The Home payload of /api/journey (a-journey-engine). Pure projection of
 * LearnerMoments plus the server switches a surface depends on. Carries no
 * learner id and no label text; the sitting date is included only so the
 * deadline line can restrict itself to the learner's own sitting (it formats
 * every displayed date from OFFICIAL_SITTINGS itself).
 */
import type { JourneyExamKey, JourneyPhase, JourneySegment, LearnerMoments, MomentCode } from "./moments";
import { RESULTS_ROUTE_EXAMS } from "./moments";

type Env = Record<string, string | undefined>;

export interface JourneyView {
  phase: JourneyPhase;
  code: MomentCode | null;
  named: { key: string; exam_keys: JourneyExamKey[]; segment: JourneySegment; date: string } | null;
  closingSoon: boolean;
  inCram: boolean;
  canConfirm: boolean;
  registered: boolean;
  sittingWeek: boolean;
  /** Timed KAF practice is live (KAF_TIMED_ENABLED) and the learner sits SIP4a. */
  kaf: boolean;
  /** The results route owns M6 and is switched on for this sitting's exam (RESULTS_ROUTE_ENABLED). */
  resultsRoute: boolean;
}

/**
 * KAF counts as live only where the code switch is on (the path.json item
 * kaf-timed is switched on together with KAF_TIMED_ENABLED, 5 Nov).
 */
export function kafLive(env: Env = process.env): boolean {
  return (env.KAF_TIMED_ENABLED ?? "").trim() === "true";
}

/** Same literal rule as resultsRouteEnabled in src/lib/results-route.ts (a-results-route). */
export function resultsRouteLive(env: Env = process.env): boolean {
  return (env.RESULTS_ROUTE_ENABLED ?? "").trim() === "true";
}

export function journeyView(m: LearnerMoments, env: Env = process.env): JourneyView {
  const keys = m.named?.exam_keys ?? [];
  return {
    phase: m.phase,
    code: m.code,
    named: m.named ? { key: m.named.key, exam_keys: [...m.named.exam_keys], segment: m.named.segment, date: m.named.date } : null,
    closingSoon: m.closingSoon,
    inCram: m.inCram,
    canConfirm: m.canConfirmRegistration,
    registered: m.registered,
    sittingWeek: m.sittingWeek,
    kaf: kafLive(env) && keys.includes("sip4a"),
    resultsRoute: m.phase === "results" && resultsRouteLive(env) && keys.some((k) => RESULTS_ROUTE_EXAMS.has(k)),
  };
}
