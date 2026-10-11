-- R4 candidate only. Apply after 20261022100000 in SCRATCH before release.
-- Append-only cost rollup is maintained in the ledger insert transaction.
BEGIN;
CREATE TABLE public.ai_mentor_daily_cost (
 timezone text NOT NULL CHECK(timezone IN ('UTC','Europe/Vienna')),
 day date NOT NULL,
 mentor_micro bigint NOT NULL DEFAULT 0,
 house_micro bigint NOT NULL DEFAULT 0,
 calls bigint NOT NULL DEFAULT 0,
 overruns bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(timezone,day)
);
ALTER TABLE public.ai_mentor_daily_cost ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_mentor_daily_cost FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_mentor_daily_cost TO service_role;
-- Prevent an insert racing backfill. Ledger is append-only by contract.
LOCK TABLE public.ai_usage_ledger IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.ai_mentor_daily_cost(timezone,day,mentor_micro,house_micro,calls,overruns)
SELECT z.tz,(l.created_at AT TIME ZONE z.tz)::date,sum(coalesce(cost_micro,0)),
 sum(CASE WHEN kind='house_cost' THEN coalesce(cost_micro,0) ELSE 0 END),count(*),
 count(*) FILTER(WHERE hold_micro<0 AND cost_micro > -hold_micro)
FROM public.ai_usage_ledger l CROSS JOIN (VALUES ('UTC'),('Europe/Vienna')) z(tz)
WHERE kind IN ('settle','house_cost') GROUP BY z.tz,(l.created_at AT TIME ZONE z.tz)::date;
CREATE FUNCTION public.mentor_record_daily_cost() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tz text;
BEGIN
 IF NEW.kind NOT IN ('settle','house_cost') THEN RETURN NEW; END IF;
 FOREACH tz IN ARRAY ARRAY['UTC','Europe/Vienna'] LOOP
  INSERT INTO public.ai_mentor_daily_cost AS d(timezone,day,mentor_micro,house_micro,calls,overruns)
  VALUES(tz,(NEW.created_at AT TIME ZONE tz)::date,coalesce(NEW.cost_micro,0),CASE WHEN NEW.kind='house_cost' THEN coalesce(NEW.cost_micro,0) ELSE 0 END,1,CASE WHEN NEW.hold_micro<0 AND NEW.cost_micro > -NEW.hold_micro THEN 1 ELSE 0 END)
  ON CONFLICT(timezone,day) DO UPDATE SET mentor_micro=d.mentor_micro+EXCLUDED.mentor_micro,house_micro=d.house_micro+EXCLUDED.house_micro,calls=d.calls+1,overruns=d.overruns+EXCLUDED.overruns;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mentor_record_daily_cost() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER mentor_daily_cost_insert AFTER INSERT ON public.ai_usage_ledger FOR EACH ROW EXECUTE FUNCTION public.mentor_record_daily_cost();
CREATE FUNCTION public.mentor_admin_snapshot(p_month text,p_timezone text,p_now timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE first_day date; last_day date; start_at timestamptz; end_at timestamptz; q jsonb; result jsonb;
BEGIN
 IF p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' OR p_timezone NOT IN ('UTC','Europe/Vienna') THEN RAISE EXCEPTION 'invalid range'; END IF;
 first_day=(p_month||'-01')::date; last_day=(first_day+interval '1 month')::date;
 start_at=first_day::timestamp AT TIME ZONE 'UTC'; end_at=last_day::timestamp AT TIME ZONE 'UTC';
 -- SQL aggregates return bounded JSON, never PostgREST-clipped source rows.
 WITH turns AS (SELECT * FROM public.ai_mentor_turn WHERE created_at>=start_at AND created_at<end_at),
 d AS (SELECT (created_at AT TIME ZONE p_timezone)::date AS day,outcome,count(*) n FROM turns GROUP BY 1,2),
 dd AS (SELECT day,jsonb_object_agg(outcome,n) AS outcomes FROM d GROUP BY day),
 langs AS (SELECT lang,count(*) n FROM turns WHERE outcome IN ('answered','replaced_partial') GROUP BY lang),
 totals AS (SELECT count(*) n,count(*) FILTER(WHERE outcome IN ('replaced_partial','notice_only')) replaced,count(*) FILTER(WHERE outcome='error') errors,count(*) FILTER(WHERE calls>0) reached,
 coalesce(sum(charged_micro+house_micro),0) cost,count(*) FILTER(WHERE cold_cache) cold,count(*) FILTER(WHERE charged) paid,count(DISTINCT user_id) FILTER(WHERE charged) payers,
 coalesce(percentile_disc(0.5) WITHIN GROUP(ORDER BY latency_ms) FILTER(WHERE calls>0),0) p50,coalesce(percentile_disc(0.95) WITHIN GROUP(ORDER BY latency_ms) FILTER(WHERE calls>0),0) p95 FROM turns)
 SELECT jsonb_build_object('by_day',coalesce((SELECT jsonb_agg(jsonb_build_object('day',day,'outcomes',jsonb_build_object('answered',0,'refused',0,'replaced_partial',0,'notice_only',0,'error',0,'blocked_402',0,'blocked_429',0,'blocked_cap',0)||outcomes) ORDER BY day) FROM dd),'[]'),
 'replaced_pct',coalesce(replaced*100.0/nullif(n,0),0),'error_pct',coalesce(errors*100.0/nullif(n,0),0),'replaced_amber',coalesce(replaced*100.0/nullif(n,0)>5,false),'error_amber',coalesce(errors*100.0/nullif(n,0)>2,false),
 'p50_latency_ms',p50,'p95_latency_ms',p95,'cost_per_message_micro',coalesce(cost*1.0/nullif(reached,0),0),'cold_cache_share_pct',coalesce(cold*100.0/nullif(reached,0),0),'messages_per_payer',coalesce(paid*1.0/nullif(payers,0),0),'answers_by_language',coalesce((SELECT jsonb_object_agg(lang,n) FROM langs),'{}')) INTO q FROM totals;
 WITH l AS (SELECT * FROM public.ai_usage_ledger WHERE kind IN ('settle','house_cost') AND created_at>=start_at AND created_at<end_at),
 models AS (SELECT coalesce(nullif(model,''),'unknown') model,sum(cost_micro) mentor_micro,count(*) calls,coalesce(sum(input_tokens),0) input_tokens,coalesce(sum(output_tokens),0) output_tokens,coalesce(sum(cache_read_tokens),0) cache_read_tokens FROM l GROUP BY 1),
 live AS (SELECT user_id,sum(greatest(granted_micro-spent_micro-clawed_back_micro,0)) available_micro FROM public.ai_credit_lot WHERE status='live' AND starts_at<=p_now AND expires_at>p_now GROUP BY user_id),
 users_top AS (SELECT l.user_id,sum(cost_micro) spent_micro,count(DISTINCT request_id) messages,coalesce(max(live.available_micro),0) available_micro FROM l LEFT JOIN live USING(user_id) WHERE kind='settle' AND l.user_id IS NOT NULL GROUP BY l.user_id ORDER BY spent_micro DESC,l.user_id LIMIT 10),
 packages AS (SELECT package_id,count(*) lots,sum(granted_micro) granted_micro,sum(spent_micro) spent_micro,sum(clawed_back_micro) clawed_back_micro,sum(CASE WHEN status='live' AND starts_at<=p_now AND expires_at>p_now THEN greatest(granted_micro-spent_micro-clawed_back_micro,0) ELSE 0 END) live_remaining_micro FROM public.ai_credit_lot GROUP BY package_id),
 pkg AS (SELECT p.package_id,coalesce(a.lots,0) lots,coalesce(a.granted_micro,0) granted_micro,coalesce(a.spent_micro,0) spent_micro,coalesce(a.clawed_back_micro,0) clawed_back_micro,coalesce(a.live_remaining_micro,0) live_remaining_micro FROM public.ai_credit_package p LEFT JOIN packages a USING(package_id) WHERE a.lots IS NOT NULL OR p.package_id IN ('mentor_basis','mentor_plus','mentor_topup')),
 stale AS (SELECT request_id,call_index,user_id,ceiling_micro,greatest(floor(extract(epoch FROM p_now-created_at)/60),0) age_minutes FROM public.ai_mentor_reservation WHERE status='open' AND created_at<p_now-interval '15 minutes' ORDER BY created_at,request_id LIMIT 50),
 claw AS (SELECT lot_id,user_id,package_id,greatest(-delta_micro_usd,0) clawed_micro,created_at AS at FROM public.ai_usage_ledger WHERE kind='clawback' AND lot_id IS NOT NULL AND user_id IS NOT NULL ORDER BY id DESC LIMIT 25)
 SELECT jsonb_build_object('mentor_micro',coalesce((SELECT sum(mentor_micro) FROM public.ai_mentor_daily_cost WHERE timezone='UTC' AND day>=first_day AND day<last_day),0),
 'by_day',coalesce((SELECT jsonb_agg(jsonb_build_object('day',days.day::date,'mentor_micro',coalesce(d.mentor_micro,0),'house_micro',coalesce(d.house_micro,0),'calls',coalesce(d.calls,0)) ORDER BY days.day) FROM generate_series(first_day::timestamp,least(last_day-1,(p_now AT TIME ZONE p_timezone)::date)::timestamp,interval '1 day') days(day) LEFT JOIN public.ai_mentor_daily_cost d ON d.day=days.day::date AND d.timezone=p_timezone),'[]'),
 'by_model',coalesce((SELECT jsonb_agg(to_jsonb(models) ORDER BY mentor_micro DESC,model) FROM models),'[]'),'top_users',coalesce((SELECT jsonb_agg(to_jsonb(users_top) ORDER BY spent_micro DESC,user_id) FROM users_top),'[]'),
 'lots_by_package',coalesce((SELECT jsonb_agg(to_jsonb(pkg) ORDER BY package_id) FROM pkg),'[]'),'stale_reservations',coalesce((SELECT jsonb_agg(to_jsonb(stale) ORDER BY age_minutes DESC,request_id) FROM stale),'[]'),'clawbacks',coalesce((SELECT jsonb_agg(to_jsonb(claw) ORDER BY at DESC) FROM claw),'[]'),
 'overruns',coalesce((SELECT sum(overruns) FROM public.ai_mentor_daily_cost WHERE timezone='UTC' AND day>=first_day AND day<last_day),0),'debt_total_micro',coalesce((SELECT sum(debt_micro) FROM public.ai_credit_wallet),0),'quality',q) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.mentor_admin_snapshot(text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mentor_admin_snapshot(text,text,timestamptz) TO service_role;
COMMIT;
