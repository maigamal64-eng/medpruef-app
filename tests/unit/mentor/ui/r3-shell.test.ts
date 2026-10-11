import { describe, expect, it } from "vitest";
import { chatReducer, INITIAL_CHAT_STATE, buildChatRequest, lastUserRequest } from "@/components/mentor/chat-state";
import { countdownAnnouncement, parseChatCache, threadState } from "@/components/mentor/r3-session";
import { toMentorEvent } from "@/components/mentor/sse";
import { createMentorApi, failureFromResponse } from "@/components/mentor/api";
import { MENTOR_ERROR_STATUS } from "@/lib/mentor/contract";
import { errorView } from "@/components/mentor/view-model";
import { r3T, R3_AR_DRAFT } from "@/components/mentor/r3-copy";
import { FIXTURE_FINAL_OK } from "@/lib/mentor/fixtures";

describe("R3 thread and draft recovery", () => {
 it("fast paint keeps the unfinished UUID and restores only the owner's server final", () => {
  const req = buildChatRequest({text:"Retain my question",mode:"facts",lang:"en",clientRequestId:"request-uuid"});
  const state = chatReducer(INITIAL_CHAT_STATE,{type:"send",userId:"u",assistantId:"a",text:req.message,request:req});
  const cached = parseChatCache(JSON.stringify(state))!;
  expect(cached.busy).toBe(false);
  expect(lastUserRequest(cached)?.client_request_id).toBe("request-uuid");
  expect(cached.messages.at(-1)).toMatchObject({status:"error",error:"network"});
  const canonical = threadState({conversation_id:"c",messages:[{id:"u",role:"user",text:req.message},{id:"a",role:"assistant",text:"Stored answer",final:FIXTURE_FINAL_OK}]});
  expect(canonical.messages.at(-1)).toMatchObject({status:"done",final:FIXTURE_FINAL_OK});
  expect(canonical.credits?.left).toBe(FIXTURE_FINAL_OK.credits_left);
 });
 it("refuses malformed cache and does not overwrite a live turn with stale history", () => {
  expect(parseChatCache('{"messages":[{"role":"assistant"}]}')).toBeNull();
  const live = chatReducer(INITIAL_CHAT_STATE,{type:"send",userId:"u",assistantId:"a",text:"Question"});
  expect(chatReducer(live,{type:"restore",state:INITIAL_CHAT_STATE})).toBe(live);
 });
 it("clearing the thread keeps balance and does not imply a rate reset", () => {
  const state = {...INITIAL_CHAT_STATE,credits:{left:11.8,estimate:12}};
  expect(chatReducer(state,{type:"reset"}).credits).toEqual(state.credits);
 });
});
describe("R3 rate and status transport", () => {
 it("day and minute classification survives response parsing", async () => {
  for (const limit of ["minute","day"] as const) {
   expect(await failureFromResponse(new Response(JSON.stringify({error:"rate_limited",limit,retry_after_seconds:120}),{status:429}))).toMatchObject({error:"rate_limited",limit,retryAfterSeconds:120});
  }
 });
 it("announces crossing 30,10,0 once without announcing each visual tick", () => {
  expect(countdownAnnouncement(31,30)).toBe(true);
  expect(countdownAnnouncement(30,29)).toBe(false);
  expect(countdownAnnouncement(11,9)).toBe(true);
  expect(countdownAnnouncement(1,0)).toBe(true);
  expect(countdownAnnouncement(0,0)).toBe(false);
 });
 it("parses actual phases, heartbeat and exact debit without losing R2 or explain metadata", () => {
  expect(toMentorEvent({type:"status",phase:"checking_sources"})).toEqual({type:"status",phase:"checking_sources"});
  expect(toMentorEvent({type:"heartbeat"})).toEqual({type:"heartbeat"});
  const final = {...FIXTURE_FINAL_OK,result:"answer",charged:true,credits_used:0.147,study_answer:true,study_scope:{answered:20},explain_hint:{hints_used:1,next_credit_cost:2},answer_blocks:[{text:"Grounded",fact_ids:[],explain_layer:"grounded",confirmed_dates:["10.10.2026"],date_type:"sitting"}]};
  expect(toMentorEvent(final)).toMatchObject(final);
 });
 it("phase changes keep the busy turn, while heartbeat does not create an error", () => {
  const state = chatReducer(INITIAL_CHAT_STATE,{type:"send",userId:"u",assistantId:"a",text:"Q"});
  const checking = chatReducer(state,{type:"event",event:{type:"status",phase:"checking_sources"}});
  expect(checking.busy).toBe(true);
  expect(checking.messages.at(-1)).toMatchObject({phase:"checking_sources"});
  expect(chatReducer(checking,{type:"event",event:{type:"heartbeat"}})).toBe(checking);
 });
 it("history client uses an encoded conversation filter", async () => {
  const paths:string[]=[];
  const api=createMentorApi(async p => {paths.push(p);return new Response(JSON.stringify({conversation_id:null,messages:[]}));});
  expect(await api.history?.("a?b")).toMatchObject({ok:true,thread:{messages:[]}});
  expect(paths).toEqual(["/api/mentor/chat/history?conversation_id=a%3Fb"]);
  const broken = createMentorApi(async () => new Response("{}"));
  expect(await broken.history?.()).toMatchObject({ok:false,error:"unknown"});
 });
});
describe("R3 errors and draft copy", () => {
 it("every server code has a mapped next step, breakers do not retry", () => {
  for (const code of Object.keys(MENTOR_ERROR_STATUS) as Array<keyof typeof MENTOR_ERROR_STATUS>) expect(errorView(code).messageKey).toBeTruthy();
  for (const code of ["global_cap","ai_disabled"] as const) expect(errorView(code).action).toBe("none");
  expect(errorView("reserve_failed").messageKey).toBe("err_reserve_failed");
  expect(errorView("upstream_error").messageKey).toBe("err_upstream_error");
  expect(errorView("invalid_input",{reason:"question_access"}).action).toBe("pro");
 });
 it("Arabic is draft only and active copy uses English", () => {
  expect(R3_AR_DRAFT.status).toBe("needs [name] sign-off");
  expect(r3T("saved","ar")).toBe(r3T("saved","en"));
  expect(r3T("disclaimer","de")).not.toMatch(/[—–]/);
 });
});
