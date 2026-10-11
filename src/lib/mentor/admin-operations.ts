import { factReviewDue, isAssertable, readFactFilesFromDisk, validateFactRecord, type RawFactFile } from "./facts-loader";
import type { MentorFact } from "./seam";
export interface FactHealthRow { id: string; read_on: string; due_on: string; source_url: string; owner_file: string; status: "OK" | "Due" | "Expired" }
export interface FactHealth { total: number; assertable: number; due_7_days: number; expired: number; oldest_read_on: string | null; due_3_days: number; soonest: FactHealthRow[]; errors: string[] }
export function buildFactHealth(now: Date, input: { files: RawFactFile[]; errors: string[] } = readFactFilesFromDisk()): FactHealth {
 const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
 const future = (days: number) => new Date(Date.parse(today)+days*86400000).toISOString().slice(0,10);
 const errors=[...input.errors]; const facts=new Map<string,{fact:MentorFact;file:string}>(); const duplicates=new Set<string>();
 for(const file of input.files) {
  if(!Array.isArray(file.records)){ errors.push(`${file.file}: invalid fact array`);continue; }
  for(const raw of file.records){const checked=validateFactRecord(raw);if(!checked.ok){errors.push(`${file.file}: ${checked.error}`);continue;}
   if(facts.has(checked.fact.id)||duplicates.has(checked.fact.id)){facts.delete(checked.fact.id);duplicates.add(checked.fact.id);errors.push(`duplicate fact ${checked.fact.id}`);continue;}
   facts.set(checked.fact.id,{fact:checked.fact,file:file.file});
  }
 }
 const rows=[...facts.values()].map(({fact,file})=>({id:fact.id,read_on:fact.read_on,due_on:factReviewDue(fact),source_url:fact.source_url,owner_file:`content/mentor-facts/${file.split(/[\\/]/).pop()}`,status: !isAssertable(fact,now)?"Expired":factReviewDue(fact)<=future(7)?"Due":"OK"} as FactHealthRow));
 const due=(days:number)=>rows.filter(row=>row.status!=="Expired"&&row.due_on<=future(days)).length;
 return {total:rows.length,assertable:rows.filter(row=>row.status!=="Expired").length,due_7_days:due(7),expired:rows.filter(row=>row.status==="Expired").length,oldest_read_on:rows.map(row=>row.read_on).sort()[0]??null,due_3_days:due(3),soonest:rows.sort((a,b)=>a.due_on.localeCompare(b.due_on)||a.id.localeCompare(b.id)).slice(0,10),errors};
}
export interface ReadinessCheck { key: string; label: string; ok: boolean; detail: string; fix: string }
export interface MentorOperations { breaker: { floor_micro: number; net_pct: number; resting_until: string }; generated_at: string; facts: FactHealth; checks: ReadinessCheck[]; last_turn: string | null; last_sweep: string | null; last_whop_event: string | null; last_eval: { commit: string; score: string; passed_at: string } | null }
export const NEXT_MENTOR_MONTH = (now:Date) => new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString();
