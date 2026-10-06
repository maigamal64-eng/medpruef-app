-- P1 read-only Ops MCP catalog. No credentials, capability switches or writes
-- are provisioned here. Each entry point re-authenticates and checks current
-- principal grants, credential scopes and live delegated-user RBAC.

ALTER TABLE public.ops_grants DROP CONSTRAINT IF EXISTS ops_grants_permission_check;
ALTER TABLE public.ops_grants ADD CONSTRAINT ops_grants_permission_check CHECK (permission IN (
  'users.read','feedback.read','feedback.manage','users.entitlements.write',
  'system.read','content.read','revenue.read','users.sessions.read','users.notes.read','overview.read'
));

CREATE OR REPLACE FUNCTION public.ops_users_activity(
 p_token_hash text,p_environment text,p_audience text,p_user_id uuid,p_limit integer DEFAULT 25,p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb;
BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'users.read');
 IF NOT (a->'permissions') ? 'users.sessions.read' THEN RAISE EXCEPTION 'Permission required' USING ERRCODE='42501'; END IF;
 IF p_user_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000 THEN RAISE EXCEPTION 'Invalid query bounds' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('source','user_activity_log','items',coalesce(jsonb_agg(x.item),'[]'::jsonb)) INTO r FROM (
  SELECT jsonb_build_object('event_type',left(regexp_replace(event_type,'[^a-zA-Z0-9_.:-]','','g'),80),'question_id',question_id,'duration_ms',duration_ms,'created_at',created_at) item
  FROM public.user_activity_log WHERE user_id=p_user_id ORDER BY created_at DESC,id DESC LIMIT p_limit OFFSET p_offset
 ) x;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'users.activity'); RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.ops_content_flags_list(
 p_token_hash text,p_environment text,p_audience text,p_status text DEFAULT 'pending',p_limit integer DEFAULT 25
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb;
BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'content.read');
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_status IS NULL OR p_status NOT IN ('pending','approved','rejected','all') THEN RAISE EXCEPTION 'Invalid query bounds' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(x.item),'[]'::jsonb)) INTO r FROM (
  SELECT jsonb_build_object('id',id,'question_id',question_id,'type',left(type,40),'status',left(status,30),'created_at',created_at) item
  FROM public.question_suggestions WHERE p_status='all' OR status=p_status ORDER BY created_at DESC,id DESC LIMIT p_limit
 ) x;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'content.flags.list'); RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.ops_content_question_get(
 p_token_hash text,p_environment text,p_audience text,p_question_id integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb;
BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'content.read');
 IF p_question_id IS NULL OR p_question_id<1 THEN RAISE EXCEPTION 'Invalid question id' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object(
  'id',id,'topic',left(topic,100),'question',left(question,4000),'answer',left(answer,2000),
 'explanation',left(explanation,3000),'exam_type',left(exam_type,40),'difficulty',difficulty,
  'choices',CASE WHEN choices IS NOT NULL AND length(choices::text)<=4000 THEN choices ELSE NULL END,
  'choices_truncated',choices IS NOT NULL AND length(choices::text)>4000,
  'is_active',is_active,
  'tags',CASE WHEN coalesce(cardinality(tags),0)>20
      OR coalesce((SELECT bool_or(length(tag.value)>80) FROM unnest(tags) AS tag(value)),false)
      OR length(coalesce((SELECT jsonb_agg(tag.value)::text FROM unnest(tags) AS tag(value)),'[]'))>4000
    THEN '[]'::jsonb
    ELSE coalesce((SELECT jsonb_agg(left(tag.value,80)) FROM unnest(tags) AS tag(value)),'[]'::jsonb)
  END,
  'tags_truncated',coalesce(cardinality(tags),0)>20
    OR coalesce((SELECT bool_or(length(tag.value)>80) FROM unnest(tags) AS tag(value)),false)
    OR length(coalesce((SELECT jsonb_agg(tag.value)::text FROM unnest(tags) AS tag(value)),'[]'))>4000
 ) INTO r
 FROM public.questions WHERE id=p_question_id;
 IF r IS NULL THEN RAISE EXCEPTION 'Question not found' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'content.question.get'); RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.ops_notes_reports_list(
 p_token_hash text,p_environment text,p_audience text,p_status text DEFAULT 'open',p_limit integer DEFAULT 25
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb;
BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'users.notes.read');
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_status IS NULL OR p_status NOT IN ('open','reviewed','actioned','dismissed','all') THEN RAISE EXCEPTION 'Invalid query bounds' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(x.item),'[]'::jsonb)) INTO r FROM (
  SELECT jsonb_build_object('id',id,'note_id',note_id,'reason',left(reason,30),'status',left(status,30),'created_at',created_at,'updated_at',updated_at) item
  FROM public.note_reports WHERE p_status='all' OR status=p_status ORDER BY created_at DESC,id DESC LIMIT p_limit
 ) x;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'notes.reports.list'); RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.ops_revenue_events(
 p_token_hash text,p_environment text,p_audience text,p_event text DEFAULT NULL,p_limit integer DEFAULT 25
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb;
BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'revenue.read');
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR length(coalesce(p_event,''))>60 THEN RAISE EXCEPTION 'Invalid query bounds' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(x.item),'[]'::jsonb)) INTO r FROM (
  SELECT jsonb_build_object('event',left(event,60),'provider',left(provider,40),'tier',left(tier,40),'amount_cents',amount_cents,'currency',left(currency,12),'reason',left(reason,100),'signature_valid',signature_valid,'matched',matched,'created_at',created_at) item
  FROM public.payment_events WHERE p_event IS NULL OR event=p_event ORDER BY created_at DESC,id DESC LIMIT p_limit
 ) x;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'revenue.events.list'); RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.ops_revenue_subscriptions(
 p_token_hash text,p_environment text,p_audience text,p_status text DEFAULT 'active',p_limit integer DEFAULT 25
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb;
BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'revenue.read');
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_status IS NULL OR p_status NOT IN ('pending','active','expired','cancelled','refunded','partially_paid','failed','all') THEN RAISE EXCEPTION 'Invalid query bounds' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(x.item),'[]'::jsonb)) INTO r FROM (
  SELECT jsonb_build_object('tier',left(tier,40),'status',left(status,30),'payment_provider',left(payment_provider,40),'payment_method',left(payment_method,30),'amount_cents',amount_cents,'currency',left(currency,12),'started_at',started_at,'expires_at',expires_at,'created_at',created_at) item
  FROM public.subscriptions WHERE p_status='all' OR status=p_status ORDER BY created_at DESC,id DESC LIMIT p_limit
 ) x;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'revenue.subscriptions.list'); RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.ops_revenue_reconcile_preview(
 p_token_hash text,p_environment text,p_audience text,p_days integer DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb;
BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'revenue.read');
 -- This is a database-only aggregate preview: it never calls a payment provider
 -- and is safe in production when granted. Environment binding is still enforced
 -- by ops_authenticate; local-only describes the data/action boundary.
 IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'Invalid query bounds' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('days',p_days,'grant_failed_count',count(*) FILTER(WHERE event='grant_failed'),'unmatched_webhook_count',count(*) FILTER(WHERE event='webhook_received' AND matched IS DISTINCT FROM true),'as_of',now()) INTO r
 FROM public.payment_events WHERE created_at>=now()-make_interval(days=>p_days);
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'revenue.reconcile.preview'); RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.ops_growth_summary(
 p_token_hash text,p_environment text,p_audience text,p_days integer DEFAULT 30
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb;
BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'overview.read');
 IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'Invalid query bounds' USING ERRCODE='22023'; END IF;
 WITH real_users AS (
  SELECT u.id,u.created_at FROM public.users u
  WHERE coalesce(u.role,'')<>'admin' AND coalesce(u.tier,'')<>'admin'
   AND (u.email IS NULL OR (lower(u.email) NOT LIKE '%@medpruf.com' AND lower(u.email) NOT LIKE '%@medpruef.com'))
 ), answer_counts AS (
  SELECT h.user_id,count(*) AS n FROM public.answer_history h JOIN real_users ru ON ru.id=h.user_id GROUP BY h.user_id
 ), paying_users AS (
  SELECT DISTINCT s.user_id FROM public.subscriptions s JOIN real_users ru ON ru.id=s.user_id
  WHERE s.status='active' AND s.payment_provider IN ('whop','stripe','nowpayments')
   AND (s.expires_at IS NULL OR s.expires_at>now())
 ), recent_active AS (
  SELECT DISTINCT l.user_id FROM public.user_activity_log l JOIN real_users ru ON ru.id=l.user_id
  WHERE l.created_at>=now()-make_interval(days=>p_days)
 )
 SELECT jsonb_build_object(
  'as_of',now(),
  'all_time',jsonb_build_object(
   'signups',(SELECT count(*) FROM real_users),
   'activated',(SELECT count(*) FROM answer_counts WHERE n>=1),
   'engaged',(SELECT count(*) FROM answer_counts WHERE n>=25),
   'paying',(SELECT count(*) FROM paying_users)
  ),
  'last_days',jsonb_build_object(
   'days',p_days,
   'signups',(SELECT count(*) FROM real_users WHERE created_at>=now()-make_interval(days=>p_days)),
   'active_users',(SELECT count(*) FROM recent_active),
   'active_users_basis','Distinct real users with at least one user_activity_log event in the window'
  ),
  'basis',jsonb_build_object(
   'real_user_filter','Excludes role=admin, tier=admin, and @medpruf.com/@medpruef.com; null email is retained',
   'activated','Real users with at least one answer_history row',
   'engaged','Real users with at least 25 answer_history rows',
   'paying','Distinct real users with active, unexpired subscription on whop/stripe/nowpayments; null expiry is treated as unexpired',
   'recent_active','Distinct real users with at least one user_activity_log row in the requested window'
  )
 ) INTO r;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'growth.summary'); RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.ops_system_crons(
 p_token_hash text,p_environment text,p_audience text,p_limit integer DEFAULT 25
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb;
BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'system.read');
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(x.item),'[]'::jsonb)) INTO r FROM (
  SELECT jsonb_build_object('cron_name',left(cron_name,80),'status',left(status,20),'started_at',started_at,'finished_at',finished_at,'rows_affected',rows_affected) item FROM public.cron_runs ORDER BY started_at DESC,id DESC LIMIT p_limit
 ) x;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'system.crons.list'); RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.ops_system_audit(
 p_token_hash text,p_environment text,p_audience text,p_limit integer DEFAULT 25
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb;
BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'system.read');
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(x.item),'[]'::jsonb)) INTO r FROM (
  SELECT jsonb_build_object('action',left(action,80),'target_type',left(target_type,60),'created_at',created_at) item FROM public.admin_audit_log ORDER BY created_at DESC,id DESC LIMIT p_limit
 ) x;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'system.audit.list'); RETURN r;
END $$;

-- Runtime-only database access remains through the exact named functions.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('ops_users_activity','ops_content_flags_list','ops_content_question_get','ops_notes_reports_list','ops_revenue_events','ops_revenue_subscriptions','ops_revenue_reconcile_preview','ops_growth_summary','ops_system_crons','ops_system_audit')
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO medpruf_ops_mcp',f.signature);
 END LOOP;
END $$;

-- Extend the invoker check's exact SECURITY DEFINER allow-list. Do not weaken
-- direct relation, role-membership, schema-create or unsafe-role checks.
CREATE OR REPLACE FUNCTION public.ops_runtime_check() RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE allowed oid[]:=ARRAY[
 'public.ops_authenticate(text,text,text)'::regprocedure,
 'public.ops_users_search(text,text,text,text,integer,integer)'::regprocedure,
 'public.ops_user_get(text,text,text,uuid)'::regprocedure,
 'public.ops_feedback_list(text,text,text,text,integer)'::regprocedure,
 'public.ops_feedback_get(text,text,text,bigint)'::regprocedure,
 'public.ops_prepare_feedback(text,text,text,bigint,text,text,text)'::regprocedure,
 'public.ops_prepare_entitlement(text,text,text,uuid,integer,text,text)'::regprocedure,
 'public.ops_action_status(text,text,text,uuid)'::regprocedure,
 'public.ops_execute_action(text,text,text,uuid)'::regprocedure,
 'public.ops_users_activity(text,text,text,uuid,integer,integer)'::regprocedure,
 'public.ops_content_flags_list(text,text,text,text,integer)'::regprocedure,
 'public.ops_content_question_get(text,text,text,integer)'::regprocedure,
 'public.ops_notes_reports_list(text,text,text,text,integer)'::regprocedure,
 'public.ops_revenue_events(text,text,text,text,integer)'::regprocedure,
 'public.ops_revenue_subscriptions(text,text,text,text,integer)'::regprocedure,
 'public.ops_revenue_reconcile_preview(text,text,text,integer)'::regprocedure,
 'public.ops_growth_summary(text,text,text,integer)'::regprocedure,
 'public.ops_system_crons(text,text,text,integer)'::regprocedure,
 'public.ops_system_audit(text,text,text,integer)'::regprocedure
];
BEGIN
 IF current_user<>'medpruf_ops_mcp' OR EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN RAISE EXCEPTION 'Unsafe runtime role' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname !~ '^pg_' AND has_schema_privilege(current_user,oid,'CREATE')) THEN RAISE EXCEPTION 'Runtime has schema CREATE privilege' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND c.relkind IN ('r','p','v','m','f','S') AND NOT (n.nspname='extensions' AND c.relname IN ('pg_stat_statements','pg_stat_statements_info') AND c.relkind='v' AND NOT has_schema_privilege(current_user,n.oid,'USAGE') AND EXISTS(SELECT FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='pg_stat_statements')) AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR (c.relkind<>'S' AND has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) OR (c.relkind='S' AND has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE')))) THEN RAISE EXCEPTION 'Runtime has direct relation privileges' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND has_function_privilege(current_user,p.oid,'EXECUTE') AND p.prosecdef AND NOT (p.oid=ANY(allowed))) THEN RAISE EXCEPTION 'Runtime can execute unapproved SECURITY DEFINER function' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM pg_auth_members m WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN RAISE EXCEPTION 'Runtime inherits another role' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('ok',true,'role',current_user,'project','medpruf');
END $$;
REVOKE ALL ON FUNCTION public.ops_runtime_check() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ops_runtime_check() TO medpruf_ops_mcp;
