import { expect, it } from "vitest";
import { buildMentorFunnel } from "@/lib/mentor/funnel";
it("MUX108 joins text-free client counts with authoritative turn costs, never invents completion",()=>{
  const result=buildMentorFunnel([
    {event_type:"mentor_entry_shown",event_data:{entry:"mentor"}},
    {event_type:"mentor_turn",event_data:{outcome:"fake"}},
    {event_type:"mentor_next_step_click",event_data:{mode:"explain",kind:"practice_topic"}},
    {event_type:"mentor_next_step_click",event_data:{mode:"facts",kind:"practice_topic"}},
  ],[{mode:"explain",outcome:"answered",charged_micro:400,house_micro:0},{mode:"explain",outcome:"notice_only",charged_micro:0,house_micro:500}]);
  expect(result.counts.mentor_turn).toBeUndefined();
  expect(result.turn_outcomes).toEqual({answered:1,notice_only:1});
  expect(result.explain_to_practice_click_rate).toBe(100);
  expect(result.completion_status).toBe("not_instrumented");
  expect(result.cost_buckets).toEqual({under_500_micro_usd:1,under_5000_micro_usd:1});
});
