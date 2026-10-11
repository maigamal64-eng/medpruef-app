import { isMentorClientEvent, mentorCostBucket, mentorEventData } from "./telemetry";
import type { MentorTurnRow } from "./outcomes";
export interface FunnelEvent { event_type: string; event_data: Record<string, unknown> | null }
export interface MentorFunnel {
  days: number; counts: Record<string, number>; turn_outcomes: Record<string, number>;
  cost_buckets: Record<string, number>; explain_answers: number; explain_practice_clicks: number;
  explain_to_practice_click_rate: number | null;
  completion_status: "not_instrumented";
}
/** Client funnel and server turn truth are joined as aggregates, never copied. */
export function buildMentorFunnel(events: readonly FunnelEvent[], turns: readonly Pick<MentorTurnRow,"mode"|"outcome"|"charged_micro"|"house_micro">[]): MentorFunnel {
  const counts: Record<string,number> = {}, outcomes: Record<string,number> = {}, buckets: Record<string,number> = {};
  let explainAnswers = 0, practiceClicks = 0;
  for (const event of events) {
    if (!isMentorClientEvent(event.event_type)) continue;
    counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
    const data = mentorEventData(event.event_data ?? {});
    if (event.event_type === "mentor_next_step_click" && data.mode === "explain" && ["practice_topic","open_mistakes","open_flashcards"].includes(data.kind)) practiceClicks++;
  }
  for (const turn of turns) {
    outcomes[turn.outcome] = (outcomes[turn.outcome] ?? 0) + 1;
    const bucket = mentorCostBucket(Number(turn.charged_micro) + Number(turn.house_micro));
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    if (turn.mode === "explain" && ["answered","replaced_partial"].includes(turn.outcome)) explainAnswers++;
  }
  return {days:30,counts,turn_outcomes:outcomes,cost_buckets:buckets,explain_answers:explainAnswers,explain_practice_clicks:practiceClicks,explain_to_practice_click_rate:explainAnswers ? practiceClicks/explainAnswers*100:null,completion_status:"not_instrumented"};
}
