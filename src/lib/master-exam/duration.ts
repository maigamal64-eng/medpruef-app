import type { SittingDurationRecord } from "./contracts";
import type { ExamPreset } from "./presets";

/**
 * Duration as a parameter (pick-spt-duration A). The official duration is used only
 * when the format data file records one with status official for that sitting;
 * otherwise the preset practice timer applies and the caller must label it as practice.
 */

export interface ResolvedDuration {
  seconds: number;
  kind: "official" | "practice";
  sourceId: string | null;
  sittingDate: string | null;
}

export function resolveDuration(
  preset: Pick<ExamPreset, "formatExamKey" | "practiceDurationS">,
  sittings: readonly SittingDurationRecord[],
  sittingDate?: string,
): ResolvedDuration {
  const record = sittingDate
    ? sittings.find((s) => s.examKey === preset.formatExamKey && s.date === sittingDate)
    : undefined;
  if (record && record.status === "official" && typeof record.durationMin === "number" && record.durationMin > 0) {
    return { seconds: Math.round(record.durationMin * 60), kind: "official", sourceId: record.sourceId, sittingDate: record.date };
  }
  return { seconds: preset.practiceDurationS, kind: "practice", sourceId: null, sittingDate: record?.date ?? null };
}

/** Optional proportional timer for a shorter custom exam (the page uses the full timer today); never less than a minute. */
export function scaleDuration(fullSeconds: number, fullCount: number, actualCount: number): number {
  if (fullCount <= 0 || actualCount <= 0) return 0;
  if (actualCount >= fullCount) return fullSeconds;
  return Math.max(60, Math.round((fullSeconds * actualCount) / fullCount));
}

/** Remaining seconds from a wall-clock deadline; survives reloads (startedAt persisted by the caller). */
export function remainingFromDeadline(startedAtMs: number, durationS: number, nowMs: number): number {
  const left = Math.ceil((startedAtMs + durationS * 1000 - nowMs) / 1000);
  return Math.min(durationS, Math.max(0, left));
}
