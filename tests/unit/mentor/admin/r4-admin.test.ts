import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mentorDate, projectMentorSpend, loadRollupSummary } from "@/lib/mentor/admin-trends";
import { loadMentorLearnerPanel } from "@/lib/mentor/admin-learner";
import { CONFIG,NOW,U1 } from "./fixtures";
import { stubClient } from "./stub-client";
import { buildMentorQuality } from "@/app/api/mentor/admin/summary/quality";
const blank={mentor_micro:0,by_day:[],by_model:[],top_users:[],lots_by_package:[],stale_reservations:[],clawbacks:[],overruns:0,debt_total_micro:0,quality:buildMentorQuality([])};
describe("R4 support read",()=>{
 it("reads only the selected learner; last 20 outcomes omit answer text",async()=>{
  const lots=[{id:"lot",user_id:U1,package_id:"mentor_basis",status:"live",granted_micro:100000,spent_micro:10000,clawed_back_micro:20000,starts_at:"2026-10-01T00:00:00Z",expires_at:"2026-11-01T00:00:00Z",created_at:"2026-10-01T00:00:00Z"}];
  const {client,log}=stubClient({tables:{ai_credit_lot:lots,ai_mentor_reservation:[],ai_mentor_turn:[],ai_mentor_whop_membership:[],ai_usage_ledger:[]}});
  const data=await loadMentorLearnerPanel(client,U1,NOW);
  expect(data.lots[0].remaining_micro).toBe(70000);
  expect(log.queries.every(q=>q.filters.includes(`eq:user_id=${U1}`))).toBe(true);
  const source=readFileSync("src/lib/mentor/admin-learner.ts","utf8");
  expect(source).toContain('.limit(20)');expect(source).not.toContain('select("*")');expect(source).not.toContain('.insert(');
 });
 it("read failure refuses all partial support data",async()=>{
  const {client}=stubClient({tables:{},errors:{ai_credit_lot:{code:"42P01"}}});
  await expect(loadMentorLearnerPanel(client,U1,NOW)).rejects.toThrow("mentor_learner_unavailable");
 });
});
describe("R4 large ledger rollup",()=>{
 it("reads aggregate snapshot without raw ledger pages even above 200,000 events",async()=>{
  const total=1000000000;
  const {client,log}=stubClient({tables:{flags:[]},rpc:{mentor_admin_snapshot:{data:{...blank,mentor_micro:total,by_day:[{day:"2026-10-01",mentor_micro:total,house_micro:0,calls:500000}]}},ai_spend_month:{data:total},ai_spend_cap:{data:2000000000}}});
  const data=await loadRollupSummary(client,CONFIG,NOW,"Europe/Vienna");
  expect(data.spend.mentor_micro).toBe(total);expect(data.by_day[0].calls).toBe(500000);
  expect(log.queries.map(q=>q.table)).toEqual(["flags"]);
  expect(data.timezone).toBe("Europe/Vienna");
 });
 it("missing changeset is unavailable, never a zero total",async()=>{
  const {client}=stubClient({tables:{flags:[]},rpc:{mentor_admin_snapshot:{data:null,error:{code:"PGRST202"}},ai_spend_month:{data:0},ai_spend_cap:{data:10000000}}});
  await expect(loadRollupSummary(client,CONFIG,NOW,"UTC")).rejects.toMatchObject({code:"ledger_not_applied"});
 });
 it("rejects malformed snapshots",async()=>{
  const {client}=stubClient({tables:{flags:[]},rpc:{mentor_admin_snapshot:{data:{}},ai_spend_month:{data:0},ai_spend_cap:{data:10000000}}});
  await expect(loadRollupSummary(client,CONFIG,NOW,"UTC")).rejects.toMatchObject({code:"db_error"});
 });
 it("Vienna day honours midnight and both DST boundaries",()=>{
  expect(mentorDate(new Date("2026-10-10T22:30:00Z"),"Europe/Vienna")).toBe("2026-10-11");
  expect(mentorDate(new Date("2026-10-10T22:30:00Z"),"UTC")).toBe("2026-10-10");
  expect(mentorDate(new Date("2026-03-29T22:30:00Z"),"Europe/Vienna")).toBe("2026-03-30");
  expect(mentorDate(new Date("2026-10-25T23:30:00Z"),"Europe/Vienna")).toBe("2026-10-26");
 });
 it("projection uses elapsed UTC month, handles no pace and reached cap",()=>{
  const now=new Date("2026-10-11T00:00:00Z");
  expect(projectMentorSpend(10000000,30000000,now)).toEqual({projected_month_micro:31000000,cap_in_days:20});
  expect(projectMentorSpend(0,10000000,now).cap_in_days).toBe(null);
  expect(projectMentorSpend(10000000,10000000,now).cap_in_days).toBe(0);
 });
 it("SQL rollup is transactional, backfilled and unavailable to browser roles",()=>{
  const sql=readFileSync("supabase/migrations/20261022120000_mentor_admin_rollup.sql","utf8");
  expect(sql).toContain("AFTER INSERT ON public.ai_usage_ledger");expect(sql).toContain("LOCK TABLE public.ai_usage_ledger");
  expect(sql).toContain("REVOKE ALL ON FUNCTION public.mentor_admin_snapshot(text,text,timestamptz) FROM PUBLIC,anon,authenticated");
  expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
 });
});
