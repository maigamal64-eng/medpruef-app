/**
 * Home helpers for the moment surfaces (a-journey-engine). Pure.
 */
import type { JourneyExamKey } from "./moments";

export type { MomentCode } from "./moments";

/**
 * The timed simulation for the learner's own exam: SIP4a and SIP5a open their
 * part of the Vienna bank, the Stichprobentest its bank, Rezeptierkunde and
 * Gerichtsmedizin the pharma bank. Without the mock exam entitlement the
 * existing plan gate opens instead (same door as the Home practice row).
 */
export function mockHrefFor(examKeys: readonly JourneyExamKey[], canMock: boolean): string {
  if (!canMock) return "/pricing?gate=mock_exam";
  if (examKeys.includes("stichprobentest")) return "/exam?examSource=kmp_innsbruck";
  if (examKeys.includes("sip4a") && !examKeys.includes("sip5a")) return "/exam?examSource=kenntnispruefung&part=sip4";
  if (examKeys.includes("sip5a") && !examKeys.includes("sip4a")) return "/exam?examSource=kenntnispruefung&part=sip5";
  if (examKeys.includes("sip4a")) return "/exam?examSource=kenntnispruefung";
  return "/exam?examSource=pharma";
}
