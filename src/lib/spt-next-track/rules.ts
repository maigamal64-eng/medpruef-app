/**
 * Show rule of the Home pointer from the Stichprobentest to Rezeptierkunde
 * (a-growth-lines-1102, A2). Pure, client and server safe, `now` injected.
 *
 *  - the saved bank is the Stichprobentest (kmp_innsbruck) and the saved exam
 *    date is a real day that has passed (a single saved date, so no later
 *    Stichprobentest sitting is set);
 *  - never in a Rezeptierkunde or Gerichtsmedizin exam week (Monday to Sunday
 *    of any such row of OFFICIAL_SITTINGS), because that week is the
 *    learner's own exam moment, not a pointer's;
 *  - the sample line only for a free learner whose free sample covers the
 *    pharma bank (the caller passes the server-read answer).
 * Not built here (followups): the "practised the bank before the last past
 * sitting, no sitting set" branch and the hide after 20 Pharma answers, which
 * need per-bank answer reads.
 */
import { OFFICIAL_SITTINGS, viennaToday, type OfficialSitting } from "@/lib/exam-dates";
import { addDays, isoDayOf, weekStart } from "@/lib/journey/moments";

export interface SptNextTrackInput {
  now: Date;
  examSource: string | null;
  examDate: string | null;
  isPaid: boolean;
  /** The free sample covers the pharma bank (the server read the free-set size; the browser never loads it). */
  pharmaFreeSample: boolean;
  sittings?: readonly OfficialSitting[];
}

export interface SptNextTrackPlan {
  sampleLine: boolean;
}

export function inRezGmExamWeek(today: string, sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS): boolean {
  return sittings.some((s) => {
    if (s.exam_key !== "rezeptierkunde" && s.exam_key !== "gerichtsmedizin") return false;
    return today >= weekStart(s.date) && today <= addDays(weekStart(s.date_end ?? s.date), 6);
  });
}

export function planSptNextTrack(input: SptNextTrackInput): SptNextTrackPlan | null {
  if (input.examSource !== "kmp_innsbruck") return null;
  const day = isoDayOf(input.examDate);
  if (!day || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))) return null;
  const today = viennaToday(input.now);
  if (day >= today) return null;
  if (inRezGmExamWeek(today, input.sittings)) return null;
  return { sampleLine: !input.isPaid && input.pharmaFreeSample };
}
