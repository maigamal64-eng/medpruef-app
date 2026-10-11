import { describe, expect, it, vi } from "vitest";
import { isMentorClientEvent, mentorCostBucket, mentorEventData, MENTOR_CLIENT_EVENTS } from "@/lib/mentor/telemetry";
import { terminalNoticeRetry } from "@/components/mentor/r2-retry";
import { chatReducer, INITIAL_CHAT_STATE, lastUserRequest } from "@/components/mentor/chat-state";
import type { MentorFinalEvent } from "@/lib/mentor/contract";
vi.mock("@/lib/tracker", () => ({ trackEvent: vi.fn() }));
import { trackEvent } from "@/lib/tracker";
import { trackMentor, trackMentorOnce } from "@/components/mentor/telemetry";

describe("MUX108 text-free funnel", () => {
  it("accepts only fixed, bounded enums and no text or identifiers", () => {
    const safe = {entry:"mentor",lang:"ru",mode:"explain",plan_source:"pro_included",package_id:"mentor_plus"};
    expect(mentorEventData({...safe, question:"private",answer:"private",user_id:"other",request_id:"uuid",reason:"private",topic:"private"})).toEqual(safe);
    expect(mentorEventData({status:"private payer name",from:"https://secret/",entry:"arbitrary"})).toEqual({});
    expect(isMentorClientEvent("mentor_turn")).toBe(false);
    for (const e of MENTOR_CLIENT_EVENTS) expect(isMentorClientEvent(e)).toBe(true);
  });
  it("keeps entry impressions once per learner/session/surface and allows another learner", () => {
    vi.mocked(trackEvent).mockClear();
    trackMentorOnce("synthetic-a", "mentor_entry_shown", "mentor", {entry:"mentor",message:"private"});
    trackMentorOnce("synthetic-a", "mentor_entry_shown", "mentor", {entry:"mentor"});
    trackMentorOnce("synthetic-b", "mentor_entry_shown", "mentor", {entry:"mentor"});
    expect(trackEvent).toHaveBeenCalledTimes(2);
    trackMentor("mentor_report", {entry:"mentor",lang:"de",details:"private"});
    expect(trackEvent).toHaveBeenLastCalledWith("mentor_report", {entry:"mentor",lang:"de"});
  });
  it("uses fixed server cost buckets", () => {
    expect([0,499,500,4999,5000].map(mentorCostBucket)).toEqual(["zero","under_500_micro_usd","under_5000_micro_usd","under_5000_micro_usd","5000_micro_usd_or_more"]);
  });
});
describe("MUX12 explicit terminal-notice retry and MUX35 unresolved recovery", () => {
  const request = {client_request_id:"original",message:"synthetic",lang:"en" as const,mode:"facts" as const};
  const sent = chatReducer(INITIAL_CHAT_STATE,{type:"send",userId:"u",assistantId:"a",text:request.message,request});
  const final: MentorFinalEvent = {type:"final",conversation_id:"opaque",answer_blocks:[],citations:[],credits_left:1,messages_left_estimate:1,result:"notice",reason:"truncated",charged:false};
  it("only creates a new UUID for an explicit retry of a canonical free terminal notice", () => {
    expect(terminalNoticeRetry(sent,"next")).toBeNull();
    expect(lastUserRequest(sent)?.client_request_id).toBe("original");
    const done = chatReducer(sent,{type:"event",event:final});
    expect(terminalNoticeRetry(done,"next")).toEqual({...request,conversation_id:"opaque",client_request_id:"next"});
    for(const patch of [{charged:true},{reason:"no_source" as const},{result:"answer" as const}]) expect(terminalNoticeRetry(chatReducer(sent,{type:"event",event:{...final,...patch}}),"next")).toBeNull();
  });
});
