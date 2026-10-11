-- UNAPPLIED MUX-99 bounded aggregate read catalog. Apply after the mentor ledger.
-- No role credentials, direct table permissions or outbound capability are added.
CREATE OR REPLACE FUNCTION public.ops_mentor_summary(p_token_hash text,p_environment text,p_audience text,p_floor bigint,p_pct integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb; cap bigint; spend bigint; day_start timestamptz:=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'revenue.read');
 IF NOT (a->'permissions') ? 'system.read' THEN RAISE EXCEPTION 'Permission required' USING ERRCODE='42501'; END IF;
 IF p_floor IS NULL OR p_floor<0 OR p_floor>1000000000 OR p_pct IS NULL OR p_pct NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Invalid breaker configuration' USING ERRCODE='22023'; END IF;
 spend:=public.ai_spend_month(to_char(now() AT TIME ZONE 'UTC','YYYY-MM'));
 cap:=public.ai_spend_cap(p_floor,p_pct);
 WITH days AS (SELECT generate_series(day_start-interval '7 days',day_start-interval '1 day',interval '1 day') d),
 daily AS (SELECT d,coalesce((SELECT sum(cost_micro) FROM public.ai_usage_ledger l WHERE l.created_at>=d AND l.created_at<d+interval '1 day' AND l.kind IN ('settle','house_cost')),0) cost,
 (SELECT count(*) FROM public.ai_mentor_turn t WHERE t.created_at>=d AND t.created_at<d+interval '1 day' AND t.outcome='blocked_402') blocks FROM days),
 price_change AS (SELECT max(created_at) changed FROM public.admin_audit_log WHERE action='mentor.package.price_changed'),
 totals AS (SELECT count(*) n,count(*) FILTER(WHERE outcome IN ('replaced_partial','notice_only')) replaced,count(*) FILTER(WHERE outcome='error') errors FROM public.ai_mentor_turn WHERE created_at>=day_start)
 SELECT jsonb_build_object(
 'generated_at',now(),'breaker_config_source','Ops service configuration; verify app parity','cap_floor_micro',p_floor,'cap_net_pct',p_pct,
 'breaker_pct',CASE WHEN cap>0 THEN spend::numeric/cap*100 WHEN spend>0 THEN 100 ELSE 0 END,
 'daily_micro',coalesce((SELECT sum(cost_micro) FROM public.ai_usage_ledger WHERE created_at>=day_start AND kind IN ('settle','house_cost')),0),
 'median_7d_micro',(SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY cost) FROM daily),
 'house_micro',coalesce((SELECT sum(cost_micro) FROM public.ai_usage_ledger WHERE created_at>=day_start AND kind='house_cost'),0),
 'stuck_holds',(SELECT count(*) FROM public.ai_mentor_reservation WHERE status='open' AND created_at<now()-interval '30 minutes'),
 'stale_swept',(SELECT count(*) FROM public.ai_mentor_reservation WHERE status='swept' AND settled_at>=day_start),
 'sweep_last_at',(SELECT last_run_at FROM public.ai_mentor_job WHERE job='sweep'),
 'overruns',(SELECT count(*) FROM public.ai_usage_ledger WHERE created_at>=day_start AND kind='settle' AND cost_micro>-hold_micro),
 'debt_micro',coalesce((SELECT sum(debt_micro) FROM public.ai_credit_wallet),0),
 'clawbacks',(SELECT count(*) FROM public.ai_usage_ledger WHERE created_at>=day_start AND kind='clawback'),
 'replaced_pct',CASE WHEN n>0 THEN replaced::numeric/n*100 ELSE 0 END,
 'errors_pct',CASE WHEN n>0 THEN errors::numeric/n*100 ELSE 0 END,
 'blocked_402',(SELECT count(*) FROM public.ai_mentor_turn WHERE created_at>=day_start AND outcome='blocked_402'),
 'median_7d_402',(SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY blocks) FROM daily),
 'price_changed',(SELECT coalesce(changed>=day_start-interval '7 days',false) FROM price_change),
 'payers_30d',(SELECT count(DISTINCT user_id) FROM public.ai_mentor_turn WHERE created_at>=now()-interval '30 days' AND charged),
 'cost_30d_micro',coalesce((SELECT sum(cost_micro) FROM public.ai_usage_ledger WHERE created_at>=now()-interval '30 days' AND kind IN ('settle','house_cost')),0),
 'margin',NULL,'margin_reason','Fee and EUR conversion not verified') INTO r FROM totals;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'mentor.summary');
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.ops_mentor_summary(text,text,text,bigint,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ops_mentor_summary(text,text,text,bigint,integer) TO medpruf_ops_mcp;

-- Preserve every existing runtime privilege check; add only the exact mentor function.
CREATE OR REPLACE FUNCTION public.ops_runtime_check() RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE allowed oid[]:=ARRAY[
 'public.ops_mentor_summary(text,text,text,bigint,integer)'::regprocedure,
 'public.ops_authenticate(text,text,text)'::regprocedure,
 'public.ops_users_search(text,text,text,text,integer,integer)'::regprocedure,
 'public.ops_user_get(text,text,text,uuid)'::regprocedure,
 'public.ops_feedback_list(text,text,text,text,integer)'::regprocedure,
 'public.ops_feedback_get(text,text,text,bigint)'::regprocedure,
 'public.ops_prepare_feedback(text,text,text,bigint,text,text,text)'::regprocedure,
 'public.ops_prepare_entitlement(text,text,text,uuid,integer,text,text)'::regprocedure,
 'public.ops_users_activity(text,text,text,uuid,integer,integer)'::regprocedure,
 'public.ops_content_flags_list(text,text,text,text,integer)'::regprocedure,
 'public.ops_content_question_get(text,text,text,integer)'::regprocedure,
 'public.ops_notes_reports_list(text,text,text,text,integer)'::regprocedure,
 'public.ops_revenue_events(text,text,text,text,integer)'::regprocedure,
 'public.ops_revenue_subscriptions(text,text,text,text,integer)'::regprocedure,
 'public.ops_revenue_reconcile_preview(text,text,text,integer)'::regprocedure,
 'public.ops_growth_summary(text,text,text,integer)'::regprocedure,
 'public.ops_system_crons(text,text,text,integer)'::regprocedure,
 'public.ops_system_audit(text,text,text,integer)'::regprocedure,
 'public.ops_prepare_content_review(text,text,text,bigint,text,text,text,text)'::regprocedure,
 'public.ops_prepare_notes_moderation(text,text,text,uuid,text,text,text)'::regprocedure,
 'public.ops_action_status(text,text,text,uuid)'::regprocedure,
 'public.ops_execute_action(text,text,text,uuid)'::regprocedure
]; BEGIN
 IF current_user<>'medpruf_ops_mcp' OR EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN RAISE EXCEPTION 'Unsafe runtime role' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname !~ '^pg_' AND has_schema_privilege(current_user,oid,'CREATE')) THEN RAISE EXCEPTION 'Runtime has schema CREATE privilege' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND c.relkind IN ('r','p','v','m','f','S') AND NOT (n.nspname='extensions' AND c.relname IN ('pg_stat_statements','pg_stat_statements_info') AND c.relkind='v' AND NOT has_schema_privilege(current_user,n.oid,'USAGE') AND EXISTS(SELECT FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='pg_stat_statements')) AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR (c.relkind<>'S' AND has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) OR (c.relkind='S' AND has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE')))) THEN RAISE EXCEPTION 'Runtime has direct relation privileges' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND p.prosecdef AND NOT (p.oid=ANY(allowed))) THEN RAISE EXCEPTION 'Runtime can execute unapproved SECURITY DEFINER function' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM pg_auth_members m WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN RAISE EXCEPTION 'Runtime inherits another role' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('ok',true,'role',current_user,'project','medpruf');
END $$;
REVOKE ALL ON FUNCTION public.ops_runtime_check() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ops_runtime_check() TO medpruf_ops_mcp;
