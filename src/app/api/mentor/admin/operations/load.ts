import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFactHealth, NEXT_MENTOR_MONTH, type MentorOperations, type ReadinessCheck } from "@/lib/mentor/admin-operations";
import { MENTOR_FACT_TRACE, MENTOR_RELEASE_EVAL } from "@/lib/mentor/deployment-manifest";
import { readMentorConfig, MENTOR_DB_FLAG_KEY, MENTOR_WHOP_PLAN_ENV } from "@/lib/mentor/config";
import { mentorIncludedCopyEnabled, mentorPublicCopyEnabled } from "@/lib/mentor-public/flag";
import schedule from "../../../../../../vercel.json";
export async function loadMentorOperations(db: SupabaseClient, now: Date, env: Record<string,string|undefined> = process.env): Promise<MentorOperations> {
 const sold = Object.keys(MENTOR_WHOP_PLAN_ENV);
 const [packages,flag,job,turn,event,request,reservations,rollup,split] = await Promise.all([
  db.from("ai_credit_package").select("package_id,active").in("package_id",sold),
  db.from("flags").select("enabled,rollout_pct").eq("key",MENTOR_DB_FLAG_KEY).maybeSingle(),
  db.from("ai_mentor_job").select("last_run_at").eq("job","sweep").maybeSingle(),
  db.from("ai_mentor_turn").select("created_at").order("created_at",{ascending:false}).limit(1).maybeSingle(),
  db.from("payment_events").select("created_at").eq("provider","whop").contains("metadata",{kind:"mentor_credits"}).order("created_at",{ascending:false}).limit(1).maybeSingle(),
  db.from("ai_mentor_request").select("request_id").limit(1),
  db.from("ai_mentor_reservation").select("request_id").limit(1),
  db.from("ai_mentor_daily_cost").select("day").limit(1),
  Promise.resolve(db.rpc("ai_spend_month_split",{p_month:now.toISOString().slice(0,7)})).catch((error:unknown)=>({data:null,error})),
 ]);
 const facts=buildFactHealth(now); const checks:ReadinessCheck[]=[];
 const add=(key:string,label:string,ok:boolean,detail:string,fix:string)=>checks.push({key,label,ok,detail,fix});
 const ledgerInstalled=![packages,job,turn,request,reservations].some(result=>result.error);
 add("ledger","Mentor ledger",ledgerInstalled,ledgerInstalled?"Installed":"Not installed or unavailable","Apply the reviewed mentor migration in scratch PostgreSQL, then through track-A.");
 add("daily_rollup","Admin daily rollup",!rollup.error,rollup.error?"Not installed or unavailable":"Installed","Apply 20261022120000_mentor_admin_rollup.sql in scratch PostgreSQL and prove its large-fixture gate before release.");
 add("split_caps","Separate mentor cap",!split.error,split.error?"Not installed: legacy AI spend can still rest the mentor":"Installed: mentor and legacy AI each have their own share",`Apply 20261208090000_a38_mentor_spend_split.sql (proof: npm run test:db:a38) through track-A.`);
 add("sweep_schedule","Sweep scheduled",schedule.crons.some(row=>row.path==="/api/cron/mentor-sweep"&&row.schedule==="*/15 * * * *"),"Every 15 minutes in committed cron configuration","Restore the mentor-sweep cron entry before deployment.");
 const lastSweep=!job.error?job.data?.last_run_at??null:null;
 add("sweep_run","Sweep heartbeat",!!lastSweep&&now.getTime()-Date.parse(lastSweep)<=24*3600000&&Date.parse(lastSweep)<=now.getTime(),lastSweep??"No recorded successful run","Run the deployed mentor-sweep with CRON_SECRET and verify the successful heartbeat.");
 add("webhook_secret","Whop webhook secret (v1)",!!env.WHOP_WEBHOOK_SECRET_V1?.trim(),env.WHOP_WEBHOOK_SECRET_V1?.trim()?"Configured":"Missing","Configure WHOP_WEBHOOK_SECRET_V1 (the v1 hook's signing secret) through the release owner.");
 const lastWhop=!event.error?event.data?.created_at??null:null;
 add("webhook_event","Whop mentor event",!!lastWhop,lastWhop??"No mentor payment event recorded","Prove a signed mentor webhook through a controlled test before package enablement.");
 for(const [pkg,key] of Object.entries(MENTOR_WHOP_PLAN_ENV)) add(`plan_${pkg}`,`${pkg} plan ID`,!!env[key]?.trim(),env[key]?.trim()?"Configured (ID hidden)":"Missing",`Set ${key} to the existing verified Whop plan through the release owner.`);
 add("packages","Active sold packages",!packages.error&&sold.every(id=>packages.data?.some(row=>row.package_id===id&&row.active)),"All three sold package rows must be active before sales","Activate reviewed package rows only after their verified plans exist.");
 add("db_flag","DB flag row",!flag.error&&!!flag.data,flag.data?`Present; enabled ${flag.data.enabled}; rollout ${flag.data.rollout_pct}%`:"Missing or unavailable","Install the mentor flag row; leave it disabled until release approval.");
 add("fact_bundle","Fact bundle",facts.total>0&&facts.errors.length===0&&"/api/mentor/chat" in MENTOR_FACT_TRACE,`${facts.total} loaded rows; ${facts.errors.length} load errors`,"Restore the traced fact files and resolve load errors.");
 add("last_eval","Last live eval pass",MENTOR_RELEASE_EVAL!==null,MENTOR_RELEASE_EVAL?`${MENTOR_RELEASE_EVAL.commit}: ${MENTOR_RELEASE_EVAL.score}`:"No attested pass for this candidate","track-A re-runs the live eval and records commit, score and passed_at in deployment-manifest.ts.");
 const config=readMentorConfig(env);
 // a-mentor-preconds: the public copy tells every learner they can book Mentor Basis (true only when any signed-in account is admitted and packages are on); the included-credit sentences are false while included grants stay allowlist-only.
 const publicCopy=mentorPublicCopyEnabled(env.NEXT_PUBLIC_MENTOR_PUBLIC_COPY);
 const includedCopy=mentorIncludedCopyEnabled(env.NEXT_PUBLIC_MENTOR_INCLUDED_COPY,env.NEXT_PUBLIC_MENTOR_PUBLIC_COPY);
 const copyReady=config.aiFeaturesEnabled&&config.enabled&&config.accessScope==="signed_in"&&config.packagesEnabled;
 add("public_copy","Public mentor copy matches access",!publicCopy||(copyReady&&!includedCopy),!publicCopy?"Public copy off":includedCopy?"Included-credit copy is on, but only allowlisted accounts receive included credits":copyReady?"On, with scope signed_in and packages on":`On, but scope ${config.accessScope}${config.packagesEnabled?"":", packages off"}${config.aiFeaturesEnabled&&config.enabled?"":", mentor off"}`,"Turn NEXT_PUBLIC_MENTOR_PUBLIC_COPY on only with AI_FEATURES_ENABLED, MENTOR_ENABLED, MENTOR_PACKAGES_ENABLED and MENTOR_ACCESS_SCOPE=signed_in; keep NEXT_PUBLIC_MENTOR_INCLUDED_COPY unset.");
 return {breaker:{floor_micro:config.globalMonthlyCapFloorMicro,net_pct:config.globalCapNetPct,resting_until:NEXT_MENTOR_MONTH(now)},generated_at:now.toISOString(),facts,checks,last_turn:!turn.error?turn.data?.created_at??null:null,last_sweep:lastSweep,last_whop_event:lastWhop,last_eval:MENTOR_RELEASE_EVAL};
}
