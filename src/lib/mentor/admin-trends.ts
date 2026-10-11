import type { SupabaseClient } from "@supabase/supabase-js";
import type { MentorAdminSummary } from "./contract";
import type { MentorConfig } from "./config";
import { MENTOR_DB_FLAG_KEY } from "./config";
import { checkGlobalSpend, type RpcClient } from "@/lib/ai/limits";
import { MentorAdminLoadError, utcMonth } from "@/app/api/mentor/admin/summary/load";
export type MentorAdminTimezone = "UTC" | "Europe/Vienna";
export function mentorDate(now: Date, timezone: MentorAdminTimezone): string {
 return new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}
/** Projection is an estimate of the UTC breaker month, not a promised charge or cap change. */
export function projectMentorSpend(total: number, cap: number, now: Date) {
 const start=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1), end=Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1);
 const elapsed=Math.max((now.getTime()-start)/86400000,1/24);
 const pace=total/elapsed;
 return {projected_month_micro:Math.round(pace*((end-start)/86400000)),cap_in_days:total>=cap?0:pace>0?Math.ceil((cap-total)/pace):null};
}
type Snapshot = Pick<MentorAdminSummary,"by_day"|"by_model"|"top_users"|"lots_by_package"|"stale_reservations"|"clawbacks"|"overruns"|"debt_total_micro"|"quality"> & {mentor_micro:number};
function validSnapshot(raw: unknown): raw is Snapshot {
 if(!raw||typeof raw!=="object")return false;
 const d=raw as Record<string,unknown>;
 return ["by_day","by_model","top_users","lots_by_package","stale_reservations","clawbacks"].every(k=>Array.isArray(d[k]))&&["mentor_micro","overruns","debt_total_micro"].every(k=>typeof d[k]==="number"&&Number.isFinite(d[k])&&Number(d[k])>=0)&&!!d.quality;
}
export async function loadRollupSummary(db: SupabaseClient, config: MentorConfig, now: Date, timezone: MentorAdminTimezone): Promise<MentorAdminSummary> {
 const month=utcMonth(now);
 const [rollup,flag,spend]=await Promise.all([
  db.rpc("mentor_admin_snapshot",{p_month:month,p_timezone:timezone,p_now:now.toISOString()}),
  db.from("flags").select("enabled,env,rollout_pct").eq("key",MENTOR_DB_FLAG_KEY).maybeSingle(),
  checkGlobalSpend(db as unknown as RpcClient,{now,floorMicro:config.globalMonthlyCapFloorMicro,netPct:config.globalCapNetPct}),
 ]);
 if(rollup.error){if(["42883","PGRST202","42P01","PGRST205"].includes(rollup.error.code))throw new MentorAdminLoadError("ledger_not_applied");throw new MentorAdminLoadError("db_error");}
 if(flag.error||!validSnapshot(rollup.data)||spend.spentMicro===null||spend.capMicro===null)throw new MentorAdminLoadError("db_error");
 const {mentor_micro,...data}=rollup.data;
 const total=Math.max(spend.spentMicro,mentor_micro), cap=spend.capMicro;
 return {...data,generated_at:now.toISOString(),month,timezone,projection:projectMentorSpend(total,cap,now),
  spend:{mentor_micro,legacy_micro:Math.max(0,total-mentor_micro),total_micro:total,cap_micro:cap,pct_of_cap:cap>0?total/cap*100:total>0?100:0},
  state:{ai_features_enabled:config.aiFeaturesEnabled,mentor_enabled:config.enabled,packages_enabled:config.packagesEnabled,topups_enabled:config.topupsEnabled,db_flag:flag.data,resting:total>=cap,beta_allowlist_size:config.betaUserIds.length},
 };
}
