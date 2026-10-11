/** track-A only: apply the ledger and R4 rollup changesets to local scratch. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, expect } from "vitest";
const run=promisify(execFile); const port=process.env.MENTOR_PG_PORT;
describe.skipIf(!port)("R4 transactional daily rollup scratch PostgreSQL",()=>{
 it("keeps complete totals above the former 200k row cap and Vienna midnight, no browser role access",async()=>{
  if(!port||!/^\d{1,5}$/.test(port))throw new Error("Use a local scratch port");
  const {stdout}=await run(process.env.MENTOR_PSQL??"/opt/homebrew/bin/psql",["-h","127.0.0.1","-p",port,"-U","postgres","-d","mentor","-qtAX","-v","ON_ERROR_STOP=1","-c",`
   BEGIN; SET LOCAL statement_timeout='45s'; SET LOCAL lock_timeout='5s';
   DO $test$
   DECLARE prefix text:=gen_random_uuid()::text; baseline bigint; after_total bigint; before_vienna bigint; after_vienna bigint; snap jsonb;
   BEGIN
    SELECT coalesce(sum(mentor_micro),0) INTO baseline FROM public.ai_mentor_daily_cost WHERE timezone='UTC' AND day BETWEEN '2026-10-01' AND '2026-10-31';
    SELECT coalesce(sum(mentor_micro),0) INTO before_vienna FROM public.ai_mentor_daily_cost WHERE timezone='Europe/Vienna' AND day='2026-10-11';
    INSERT INTO public.ai_usage_ledger(kind,source,source_id,cost_micro,hold_micro,created_at)
    SELECT 'settle','r4_synthetic',prefix||':'||i,1,-2,'2026-10-10T12:00:00Z' FROM generate_series(1,200005) i;
    INSERT INTO public.ai_usage_ledger(kind,source,source_id,cost_micro,created_at) VALUES('house_cost','r4_synthetic',prefix||':edge',7,'2026-10-10T22:30:00Z');
    snap:=public.mentor_admin_snapshot('2026-10','Europe/Vienna','2026-10-11T12:00:00Z');
    after_total:=(snap->>'mentor_micro')::bigint;
    IF after_total-baseline<>200012 THEN RAISE EXCEPTION 'rollup clipped or duplicated: %',after_total-baseline; END IF;
    SELECT mentor_micro INTO after_vienna FROM public.ai_mentor_daily_cost WHERE timezone='Europe/Vienna' AND day='2026-10-11';
    IF after_vienna-before_vienna<>7 THEN RAISE EXCEPTION 'Vienna midnight failed'; END IF;
    IF jsonb_array_length(snap->'by_day')<>11 THEN RAISE EXCEPTION 'daily range malformed'; END IF;
    IF has_function_privilege('anon','public.mentor_admin_snapshot(text,text,timestamptz)','execute') OR has_function_privilege('authenticated','public.mentor_admin_snapshot(text,text,timestamptz)','execute') THEN RAISE EXCEPTION 'snapshot public'; END IF;
    IF has_table_privilege('authenticated','public.ai_mentor_daily_cost','select') THEN RAISE EXCEPTION 'rollup table public'; END IF;
   END $test$; ROLLBACK; SELECT 'r4-rollup-ok';
  `],{timeout:60000});expect(stdout.trim()).toBe("r4-rollup-ok");
 },60000);
});
