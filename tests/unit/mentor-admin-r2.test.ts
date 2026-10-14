import { describe,it,expect,vi } from "vitest";
import {readFactFilesFromDisk} from "@/lib/mentor/facts-loader";
import {buildFactHealth,NEXT_MENTOR_MONTH} from "@/lib/mentor/admin-operations";
import {makeReviewSnapshot,parseReviewVerdict} from "@/lib/mentor/review";
import {mentorBetaAllowed} from "@/lib/mentor/beta";
import {mentorMarginDisplayAllowed,MENTOR_FINANCE_MODEL} from "@/lib/mentor/finance";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {MentorChatRequest,MentorFinalEvent} from "@/lib/mentor/contract";
import fs from "node:fs";
const fact=readFactFilesFromDisk().files.flatMap(file=>Array.isArray(file.records)?file.records:[])[0] as Record<string,unknown>;
function data(extra:Record<string,unknown>={}) {return {files:[{file:"fixture.json",records:[{...fact,read_on:"2026-10-10",review_every_days:7,status:"live",verdict:"confirmed",valid_until:undefined,...extra}]}],errors:[]};}
describe("MUX-101 fact health",()=>{
 it("counts 3 and 7 day horizons and immutable owner/source metadata",()=>{const h=buildFactHealth(new Date("2026-10-14T12:00:00Z"),data());expect(h).toMatchObject({total:1,assertable:1,due_7_days:1,due_3_days:1,expired:0,oldest_read_on:"2026-10-10"});expect(h.soonest[0]).toMatchObject({due_on:"2026-10-17",status:"Due",owner_file:"content/mentor-facts/fixture.json",source_url:fact.source_url});});
 it("remains assertable on review due day, then expires next Vienna date",()=>{expect(buildFactHealth(new Date("2026-10-17T12:00:00Z"),data()).assertable).toBe(1);expect(buildFactHealth(new Date("2026-10-18T12:00:00Z"),data())).toMatchObject({assertable:0,expired:1});});
 it("shows OK for a distant review, removes duplicate IDs and exposes malformed inputs",()=>{expect(buildFactHealth(new Date("2026-10-11T12:00:00Z"),data({review_every_days:90})).soonest[0].status).toBe("OK");const x=data();x.files[0].records.push(x.files[0].records[0]);expect(buildFactHealth(new Date("2026-10-11"),x)).toMatchObject({total:0});expect(buildFactHealth(new Date("2026-10-11"),data({read_on:"wrong"})).errors.length).toBe(1);});
});
describe("MUX-100 immutable review snapshot",()=>{
 it("retains the canonical finished answer and checked dates with bounded text",()=>{const request={message:"q".repeat(10000),lang:"ru"} as MentorChatRequest;const final={conversation_id:"c",answer_blocks:[{text:"a".repeat(30000),fact_ids:["f"]}],citations:[{fact_id:"f",read_on:"2026-10-10",source_url:"https://example.org"}]} as MentorFinalEvent;
 const snapshot=makeReviewSnapshot({requestId:"r",userId:"u",request,final});expect(snapshot.question_text.length).toBe(8000);expect(snapshot.answer_text.length).toBe(24000);expect(snapshot.citations).toEqual([{fact_id:"f",read_on:"2026-10-10",source_url:"https://example.org"}]);expect(snapshot.lang).toBe("ru");});
 it("only permits code-owned verdicts and exact UUIDs",()=>{expect(parseReviewVerdict({request_id:"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",verdict:"wrong"})).not.toBeNull();expect(parseReviewVerdict({request_id:"-".repeat(36),verdict:"accept"})).toBeNull();expect(parseReviewVerdict({request_id:"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",verdict:"refund"})).toBeNull();});
 it("changeset bounds retention, user deletion and denies clients",()=>{const sql=fs.readFileSync("supabase/migrations/20261022100000_mentor_ledger.sql","utf8");expect(sql).toContain("DELETE FROM public.ai_mentor_review WHERE created_at < now() - interval '30 days'");expect(sql).toContain("user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE");expect(sql).toContain("'ai_mentor_job', 'ai_mentor_review'");expect(sql).toContain("verdict_lang=v_lang");expect(sql).toContain("'mentor.review.verdict'");});
});
describe("MUX-103 beta override and operational boundaries",()=>{
 function db(value:unknown,error:unknown=null){const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:value,error})};return {from:vi.fn().mockReturnValue(query)} as unknown as SupabaseClient;}
 it("explicit DB excludes override an open legacy list; DB allows override a closed legacy list",async()=>{expect(await mentorBetaAllowed(db({allowed:false}),"u",[])).toBe(false);expect(await mentorBetaAllowed(db({allowed:true}),"u",["other"])).toBe(true);});
 it("fails closed on DB error and otherwise retains legacy eligibility",async()=>{expect(await mentorBetaAllowed(db(null,"db_error"),"u",[])).toBe(false);expect(await mentorBetaAllowed(db(null),"u",["u"])).toBe(true);expect(await mentorBetaAllowed(db(null),"u",["other"])).toBe(false);});
 it("SQL refuses resume without an existing enabled rollout, never sets enabled",()=>{const sql=fs.readFileSync("supabase/migrations/20261022100000_mentor_ledger.sql","utf8").split("CREATE OR REPLACE FUNCTION public.mentor_set_pause")[1].split("CREATE OR REPLACE FUNCTION public.mentor_set_beta")[0];expect(sql).toContain("IF NOT f.enabled OR previous IS NULL OR previous<=0");expect(sql).not.toMatch(/SET\s+enabled/i);expect(sql).toContain("'mentor.pause'");expect(sql).toContain("'mentor.resume'");});
});
describe("MUX-98 verified fee gate and reset time",()=>{it("never displays unverified fee/FX assumptions",()=>{expect(MENTOR_FINANCE_MODEL.whopFee).toBeNull();expect(mentorMarginDisplayAllowed()).toBe(false);});it("UTC breaker reset crosses year boundary",()=>{expect(NEXT_MENTOR_MONTH(new Date("2026-12-31T22:00:00Z"))).toBe("2027-01-01T00:00:00.000Z");});});

describe("MUX-102 server readiness",()=>{
 it("shows every prerequisite, hides configured plan IDs and preserves expected uninstalled state",async()=>{
  const {loadMentorOperations}=await import("@/app/api/mentor/admin/operations/load");
  const db={from:(table:string)=>{
   const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),in:vi.fn().mockReturnThis(),contains:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),limit:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:null,error:table.startsWith("ai_")?{code:"PGRST205"}:null}),then:(resolve:(x:unknown)=>unknown)=>Promise.resolve({data:[],error:table.startsWith("ai_")?{code:"PGRST205"}:null}).then(resolve)};
   return query;
  },rpc:vi.fn().mockResolvedValue({data:null,error:{code:"PGRST202"}})} as unknown as SupabaseClient;
  const info=await loadMentorOperations(db,new Date("2026-10-11T12:00:00Z"),{WHOP_PLAN_MENTOR_BASIS:"private-plan-id",WHOP_WEBHOOK_SECRET:"private-secret"});
  for(const key of ["ledger","split_caps","sweep_schedule","sweep_run","webhook_secret","webhook_event","plan_mentor_basis","plan_mentor_plus","plan_mentor_topup","packages","db_flag","fact_bundle","last_eval","public_copy"])expect(info.checks.some(row=>row.key===key)).toBe(true);
  expect(info.checks.find(row=>row.key==="public_copy")?.ok).toBe(true);
  expect(info.checks.find(row=>row.key==="ledger")?.ok).toBe(false);expect(info.checks.find(row=>row.key==="split_caps")?.ok).toBe(false);expect(info.checks.find(row=>row.key==="sweep_schedule")?.ok).toBe(true);expect(info.checks.find(row=>row.key==="last_eval")?.ok).toBe(false);expect(JSON.stringify(info)).not.toContain("private-plan-id");expect(JSON.stringify(info)).not.toContain("private-secret");expect(info.last_eval).toBeNull();
 });
 it("Ops privilege changes add one exact allowed definer function and retain every old guard",()=>{
  const sql=fs.readFileSync("supabase/migrations/20261022110000_ops_mentor_reads.sql","utf8");
  const previous=fs.readFileSync("supabase/migrations/20261006120000_ops_content_actions.sql","utf8");
  const actual=sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.ops_runtime_check()"));
  const expected=previous.slice(previous.indexOf("CREATE OR REPLACE FUNCTION public.ops_runtime_check()"));
  expect(actual.replace(" 'public.ops_mentor_summary(text,text,text,bigint,integer)'::regprocedure,\n", "")).toBe(expected);
  expect(sql).toContain("public.ops_require(p_token_hash,p_environment,p_audience,'revenue.read')");expect(sql).toContain("IF NOT (a->'permissions') ? 'system.read'");expect(sql).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE)\s+ON/i);
 });
});
