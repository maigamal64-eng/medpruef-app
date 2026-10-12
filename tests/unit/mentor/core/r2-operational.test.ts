import { describe, expect, it, vi } from "vitest";
import { handleMentorChat, type ChatHandlerDeps } from "@/app/api/mentor/chat/handler";
import { createRunMentorTurn } from "@/lib/mentor/turn";
import { checkMentorAccess } from "@/lib/mentor/guard";
import type { MentorChatResultResponse } from "@/lib/mentor/contract";
import { CONV, USER, request, makeDeps, type Step } from "./helpers";
import replies from "./fixtures/rpc-replies.json";

function setup(steps: Step[], rpcOverrides: Record<string,unknown>={}) {
  const env=makeDeps(steps,{grantMicro:500_000});
  const tasks:Promise<unknown>[]=[];
  const results=new Map<string,{id:string;result:MentorChatResultResponse}>();
  const rows: Array<Parameters<ChatHandlerDeps["recordTurn"]>[0]>=[];
  const deps:ChatHandlerDeps={
    config:env.deps.config,authenticate:async()=>({ok:true,userId:USER,paidAccess:true}),flag:async()=>true,
    rpc:{rpc:async(name)=>name==="ai_spend_month_split"&&!(name in rpcOverrides)?{data:null,error:{code:"PGRST202",message:"Could not find the function"}}:({data:rpcOverrides[name]??({mentor_reserved_attempt:replies.attempt_ok,ai_spend_month:replies.spend_month,ai_spend_cap:replies.spend_cap} as Record<string,unknown>)[name],error:null})},
    requests:{claim:async(_u,r,id)=>{const prior=results.get(r.client_request_id);if(prior)return {claimed:false,result:prior.result};results.set(r.client_request_id,{id,result:{status:"in_progress"}});return {claimed:true,requestId:id};},
      finish:async(_u,id,r)=>{const row=[...results.values()].find(row=>row.id===id);if(row)row.result=typeof r==="string"?{status:"error",error:r}:{status:"complete",final:r};},
      result:async(_u,id)=>results.get(id)?.result??{status:"missing"}},
    recordTurn:async(row)=>{rows.push(row);},services:()=>({brain:env.deps.brain,facts:env.deps.facts,wallet:env.deps.wallet}),
    meterFor:()=>env.deps.meter,house:env.deps.house,conversations:{resolve:async()=>({conversationId:CONV,history:[],isNew:true}),append:async()=>true},
    canReadQuestion:async()=>true,callClaude:env.deps.callClaude,clock:env.deps.clock,newRequestId:()=>crypto.randomUUID(),runTurn:createRunMentorTurn(),
    background:task=>{tasks.push(task);},alert:()=>{},
  };
  return {env,deps,tasks,rows};
}
const post=(body= request())=>new Request("http://localhost/api/mentor/chat",{method:"POST",body:JSON.stringify(body)});
describe("MUX115 and MUX103 operational trust cases",()=>{
  it.each([["attempt_minute",60],["attempt_day",36000]] as const)("minute/day429 %s never reaches the model",async(key,seconds)=>{
    const s=setup([],{mentor_reserved_attempt:replies[key]});const result=await handleMentorChat(post(),s.deps);
    expect(result.status).toBe(429);expect((await result.json()).retry_after_seconds).toBe(seconds);
    expect(s.env.claude.calls).toHaveLength(0);expect(s.rows[0].outcome).toBe("blocked_429");
  });
  it("402 mid-session reads the current wallet after an earlier completed answer",async()=>{
    const s=setup([{text:"First grounded synthetic answer."}]);
    expect((await handleMentorChat(post(),s.deps)).status).toBe(200);await Promise.all(s.tasks);
    const source=s.env.ledger.lots[0];expect(s.env.ledger.clawback(source.source,source.sourceId).ok).toBe(true);
    const result=await handleMentorChat(post(request({client_request_id:crypto.randomUUID()})),s.deps);
    expect(result.status).toBe(402);expect(s.env.claude.calls).toHaveLength(1);expect(s.rows.at(-1)?.outcome).toBe("blocked_402");
  });
  it("a killed stream settles, recovers the canonical final, and double send has one charge",async()=>{
    const s=setup([{text:"Canonical finished answer."}]);const body=request();
    const response=await handleMentorChat(post(body),s.deps);await response.body?.cancel();await Promise.all(s.tasks);
    const recovered=await s.deps.requests.result(USER,body.client_request_id);
    expect(recovered.status).toBe("complete");
    const replay=await handleMentorChat(post(body),s.deps);expect(await replay.text()).toContain("Canonical finished answer.");
    expect(s.env.claude.calls).toHaveLength(1);expect(s.env.ledger.entries.filter(row=>row.kind==="settle")).toHaveLength(1);
    expect(s.env.ledger.reconciles(USER)).toBe(true);
  });
  it("pause while the model runs blocks new work but the in-flight turn finishes and settles",async()=>{
    const s=setup([{text:"In-flight completed answer."}]);let release!:()=>void;let entered!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;});const pending=new Promise<void>(resolve=>{release=resolve;});
    const original=s.deps.callClaude;s.deps.callClaude=async(params)=>{entered();await pending;return original(params);};
    const response=await handleMentorChat(post(),s.deps);await started;s.deps.flag=async()=>false;
    expect((await handleMentorChat(post(request({client_request_id:crypto.randomUUID()})),s.deps)).status).toBe(403);
    release();expect(await response.text()).toContain("In-flight completed answer.");await Promise.all(s.tasks);
    expect(s.env.ledger.reservedOf(USER)).toBe(0);expect(s.env.ledger.reconciles(USER)).toBe(true);
    expect(s.env.claude.calls).toHaveLength(1);
  });
  it("a beta override never bypasses a disabled master or paused DB rollout",async()=>{
    const s=setup([]);const beta=vi.fn(async()=>true);
    expect(await checkMentorAccess({...s.deps.config,enabled:false},USER,s.deps.flag,beta)).toMatchObject({status:403});
    expect(await checkMentorAccess(s.deps.config,USER,async()=>false,beta)).toMatchObject({status:403});
    expect(beta).not.toHaveBeenCalled();
  });
});
