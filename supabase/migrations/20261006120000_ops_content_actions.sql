-- P1 content safety actions. These are deliberately separate from the P0
-- entitlement/feedback actions: they only review suggestions and moderate
-- reported notes, and never edit question answers or clinical content.

ALTER TABLE public.ops_grants DROP CONSTRAINT IF EXISTS ops_grants_permission_check;
ALTER TABLE public.ops_grants ADD CONSTRAINT ops_grants_permission_check CHECK (permission IN (
  'users.read','feedback.read','feedback.manage','users.entitlements.write',
  'system.read','content.read','revenue.read','users.sessions.read','users.notes.read',
  'overview.read','content.moderate'
));

ALTER TABLE public.ops_settings DROP CONSTRAINT IF EXISTS ops_settings_capability_check;
ALTER TABLE public.ops_settings ADD CONSTRAINT ops_settings_capability_check CHECK (capability IN (
  'feedback.triage','entitlement.grant','content.review','notes.moderation'
));
INSERT INTO public.ops_settings(capability,enabled) VALUES
  ('content.review',false),('notes.moderation',false)
ON CONFLICT (capability) DO NOTHING;

ALTER TABLE public.ops_actions DROP CONSTRAINT IF EXISTS ops_actions_operation_check;
ALTER TABLE public.ops_actions ADD CONSTRAINT ops_actions_operation_check CHECK (operation IN (
  'feedback.triage','entitlement.grant','content.review','notes.moderation'
));

-- Keep the P0 implementation byte-for-byte available behind a private helper.
ALTER FUNCTION public.ops_target_hash(text,jsonb,boolean) RENAME TO ops_target_hash_p0;
ALTER FUNCTION public.ops_execute_action(text,text,text,uuid) RENAME TO ops_execute_action_p0;

CREATE OR REPLACE FUNCTION public.ops_target_hash(
  p_operation text,p_payload jsonb,p_lock boolean DEFAULT false
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb; BEGIN
  IF p_operation IN ('feedback.triage','entitlement.grant') THEN
    RETURN public.ops_target_hash_p0(p_operation,p_payload,p_lock);
  ELSIF p_operation='content.review' THEN
    IF p_lock THEN
      PERFORM 1 FROM public.question_suggestions
       WHERE id=(p_payload->>'question_suggestion_id')::bigint FOR UPDATE;
    END IF;
    SELECT jsonb_build_object(
      'id',qs.id,'question_id',qs.question_id,'status',qs.status,
      'reason',qs.reason,'admin_note',qs.admin_note,
      'suggested_changes',qs.suggested_changes,'details',qs.details,'context',qs.context,'type',qs.type,'user_id',qs.user_id
    ) INTO r
    FROM public.question_suggestions qs
    WHERE qs.id=(p_payload->>'question_suggestion_id')::bigint;
  ELSIF p_operation='notes.moderation' THEN
    IF p_lock THEN
      PERFORM 1 FROM public.note_reports nr
       WHERE nr.id=(p_payload->>'report_id')::uuid FOR UPDATE;
      PERFORM 1 FROM public.notes n
       WHERE n.id=(SELECT note_id FROM public.note_reports WHERE id=(p_payload->>'report_id')::uuid) FOR UPDATE;
    END IF;
    SELECT jsonb_build_object(
      'report_id',nr.id,'report_status',nr.status,'report_reason',nr.reason,
      'report_detail',nr.detail,'note_id',n.id,'note_is_active',n.is_active,'note_visibility',n.visibility,'note_content_hash',public.ops_hash(n.content)
    ) INTO r
    FROM public.note_reports nr JOIN public.notes n ON n.id=nr.note_id
    WHERE nr.id=(p_payload->>'report_id')::uuid;
  ELSE
    RAISE EXCEPTION 'Unsupported operation' USING ERRCODE='22023';
  END IF;
  IF r IS NULL THEN RAISE EXCEPTION 'Target not found' USING ERRCODE='P0002'; END IF;
  RETURN public.ops_hash(r);
END $$;

CREATE OR REPLACE FUNCTION public.ops_prepare_content_review(
  p_token_hash text,p_environment text,p_audience text,
  p_question_suggestion_id bigint,p_status text,p_reason text,p_admin_note text,
  p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; qs public.question_suggestions%ROWTYPE;
BEGIN
  a:=public.ops_require(p_token_hash,p_environment,p_audience,'content.moderate');
  IF a->>'delegating_user_id' IS NULL THEN RAISE EXCEPTION 'Human delegation required' USING ERRCODE='42501'; END IF;
  IF p_question_suggestion_id IS NULL OR p_status IS NULL OR p_status NOT IN ('approved','rejected')
     OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 500
     OR length(coalesce(p_admin_note,''))>500 THEN
    RAISE EXCEPTION 'Invalid content review action' USING ERRCODE='22023';
  END IF;
  SELECT * INTO qs FROM public.question_suggestions WHERE id=p_question_suggestion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Suggestion not found' USING ERRCODE='P0002'; END IF;
  IF qs.status<>'pending' THEN RAISE EXCEPTION 'Suggestion is no longer pending' USING ERRCODE='55000'; END IF;
  RETURN public.ops_prepare_internal(
    a,'content.review','content.moderate',
    jsonb_build_object('question_suggestion_id',p_question_suggestion_id,'status',p_status,
      'reason',trim(p_reason),'admin_note',nullif(trim(coalesce(p_admin_note,'')),'')),
    jsonb_build_object('question_suggestion_id',p_question_suggestion_id,'status',p_status,
      'review_only',true),p_idempotency_key);
END $$;

CREATE OR REPLACE FUNCTION public.ops_prepare_notes_moderation(
  p_token_hash text,p_environment text,p_audience text,
  p_report_id uuid,p_decision text,p_reason text,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; nr public.note_reports%ROWTYPE; n public.notes%ROWTYPE;
BEGIN
  a:=public.ops_require(p_token_hash,p_environment,p_audience,'content.moderate');
  IF NOT (a->'permissions') ? 'users.notes.read' THEN RAISE EXCEPTION 'Permission required' USING ERRCODE='42501'; END IF;
  IF a->>'delegating_user_id' IS NULL THEN RAISE EXCEPTION 'Human delegation required' USING ERRCODE='42501'; END IF;
  IF p_report_id IS NULL OR p_decision IS NULL OR p_decision NOT IN ('takedown','dismiss')
     OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid notes moderation action' USING ERRCODE='22023';
  END IF;
  SELECT * INTO nr FROM public.note_reports WHERE id=p_report_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Note report not found' USING ERRCODE='P0002'; END IF;
  IF nr.status<>'open' THEN RAISE EXCEPTION 'Note report is no longer open' USING ERRCODE='55000'; END IF;
  SELECT * INTO n FROM public.notes WHERE id=nr.note_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reported note not found' USING ERRCODE='P0002'; END IF;
  RETURN public.ops_prepare_internal(
    a,'notes.moderation','content.moderate',
    jsonb_build_object('report_id',p_report_id,'decision',p_decision,'reason',trim(p_reason)),
    jsonb_build_object('report_id',p_report_id,'decision',p_decision,
      'takedown_effect',CASE WHEN p_decision='takedown' THEN jsonb_build_object('is_active',false,'visibility','private') ELSE '{}'::jsonb END),
    p_idempotency_key);
END $$;

CREATE OR REPLACE FUNCTION public.ops_execute_content_action(
  p_token_hash text,p_environment text,p_audience text,p_action_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE auth jsonb; a public.ops_actions%ROWTYPE; ap public.ops_approvals%ROWTYPE; r jsonb;
        nr public.note_reports%ROWTYPE; n public.notes%ROWTYPE;
BEGIN
  auth:=public.ops_authenticate(p_token_hash,p_environment,p_audience);
  SELECT * INTO a FROM public.ops_actions WHERE id=p_action_id
    AND principal_id=(auth->>'principal_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Action not found' USING ERRCODE='P0002'; END IF;
  IF a.operation NOT IN ('content.review','notes.moderation') THEN RAISE EXCEPTION 'Unsupported content action' USING ERRCODE='22023'; END IF;
  IF NOT (auth->'permissions') ? a.required_permission THEN RAISE EXCEPTION 'Permission required' USING ERRCODE='42501'; END IF;
  IF a.operation='notes.moderation' AND NOT (auth->'permissions') ? 'users.notes.read' THEN RAISE EXCEPTION 'Permission required' USING ERRCODE='42501'; END IF;
  SELECT result INTO r FROM public.ops_executions WHERE action_id=a.id;
  IF FOUND THEN RETURN public.ops_action_view(a)||jsonb_build_object('result',r); END IF;
  IF NOT EXISTS(SELECT FROM public.ops_settings WHERE capability=a.operation AND enabled FOR SHARE) THEN RAISE EXCEPTION 'Capability disabled' USING ERRCODE='55000'; END IF;
  IF a.expires_at<=now() OR a.status NOT IN ('prepared','approved') THEN RAISE EXCEPTION 'Action not executable' USING ERRCODE='55000'; END IF;
  IF auth->>'delegating_user_id' IS NULL THEN RAISE EXCEPTION 'Human delegation required' USING ERRCODE='42501'; END IF;
  IF public.ops_hash(a.payload)<>a.payload_hash OR public.ops_target_hash(a.operation,a.payload,true)<>a.target_hash THEN RAISE EXCEPTION 'Action precondition changed' USING ERRCODE='40001'; END IF;
  SELECT * INTO ap FROM public.ops_approvals WHERE action_id=a.id AND payload_hash=a.payload_hash
    AND target_hash=a.target_hash AND expires_at>now();
  IF NOT FOUND OR a.status<>'approved' THEN RAISE EXCEPTION 'Owner approval required' USING ERRCODE='42501'; END IF;
  PERFORM public.ops_require_owner(ap.actor_id);
  IF NOT public.admin_actor_has_permission(ap.actor_id,a.required_permission) THEN RAISE EXCEPTION 'Approver permission revoked' USING ERRCODE='42501'; END IF;
  INSERT INTO public.ops_audit(principal_id,credential_id,action_id,event)
    VALUES(a.principal_id,(auth->>'credential_id')::uuid,a.id,'action.executing');
  IF a.operation='content.review' THEN
    UPDATE public.question_suggestions SET status=a.payload->>'status',admin_note=a.payload->>'admin_note',
      resolved_by=(auth->>'delegating_user_id')::uuid,resolved_at=now()
    WHERE id=(a.payload->>'question_suggestion_id')::bigint AND status='pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'Suggestion is no longer pending' USING ERRCODE='55000'; END IF;
    INSERT INTO public.admin_audit_log(actor_id,actor_email,action,target_type,target_id,payload)
      SELECT (auth->>'delegating_user_id')::uuid,coalesce(u.email,''),'content_review',
        'question_suggestion',NULL,
        jsonb_build_object('status',a.payload->>'status','reason',a.payload->>'reason','ops_action_id',a.id)
      FROM public.users u WHERE u.id=(auth->>'delegating_user_id')::uuid;
    r:=jsonb_build_object('question_suggestion_id',a.payload->'question_suggestion_id','status',a.payload->>'status');
  ELSE
    SELECT * INTO nr FROM public.note_reports WHERE id=(a.payload->>'report_id')::uuid FOR UPDATE;
    IF NOT FOUND OR nr.status<>'open' THEN RAISE EXCEPTION 'Note report is no longer open' USING ERRCODE='55000'; END IF;
    SELECT * INTO n FROM public.notes WHERE id=nr.note_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Reported note not found' USING ERRCODE='P0002'; END IF;
    IF a.payload->>'decision'='takedown' THEN
      UPDATE public.notes SET is_active=false,visibility='private',updated_at=now() WHERE id=n.id;
    END IF;
    UPDATE public.note_reports SET status=CASE WHEN a.payload->>'decision'='takedown' THEN 'actioned' ELSE 'dismissed' END,
      updated_at=now() WHERE id=nr.id;
    INSERT INTO public.admin_audit_log(actor_id,actor_email,action,target_type,target_id,payload)
      SELECT (auth->>'delegating_user_id')::uuid,coalesce(u.email,('')),('note_' || (a.payload->>'decision')),
        'note_report',nr.id,jsonb_build_object('decision',a.payload->>'decision','reason',a.payload->>'reason','ops_action_id',a.id)
      FROM public.users u WHERE u.id=(auth->>'delegating_user_id')::uuid;
    r:=jsonb_build_object('report_id',nr.id,'decision',a.payload->>'decision','note_id',n.id,
      'takedown',a.payload->>'decision'='takedown');
  END IF;
  INSERT INTO public.ops_executions VALUES(a.id,r,now());
  UPDATE public.ops_actions SET status='succeeded' WHERE id=a.id RETURNING * INTO a;
  INSERT INTO public.ops_audit(principal_id,credential_id,action_id,event)
    VALUES(a.principal_id,(auth->>'credential_id')::uuid,a.id,'action.succeeded');
  RETURN public.ops_action_view(a)||jsonb_build_object('result',r);
END $$;

CREATE OR REPLACE FUNCTION public.ops_execute_action(
  p_token_hash text,p_environment text,p_audience text,p_action_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE operation text;
BEGIN
  SELECT a.operation INTO operation FROM public.ops_actions a WHERE a.id=p_action_id;
  IF operation IN ('content.review','notes.moderation') THEN
    RETURN public.ops_execute_content_action(p_token_hash,p_environment,p_audience,p_action_id);
  END IF;
  RETURN public.ops_execute_action_p0(p_token_hash,p_environment,p_audience,p_action_id);
END $$;

-- Definer helpers are private. Revoke only the renamed P0 helpers and the new
-- content helper. Existing P0/P1/OAuth entrypoint grants are intentionally
-- preserved because this migration is additive.
REVOKE ALL ON FUNCTION public.ops_target_hash_p0(text,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp;
REVOKE ALL ON FUNCTION public.ops_target_hash(text,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp;
REVOKE ALL ON FUNCTION public.ops_execute_action_p0(text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp;
REVOKE ALL ON FUNCTION public.ops_execute_content_action(text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp;
REVOKE ALL ON FUNCTION public.ops_prepare_content_review(text,text,text,bigint,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_oauth,medpruf_ops_mcp;
REVOKE ALL ON FUNCTION public.ops_prepare_notes_moderation(text,text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_oauth,medpruf_ops_mcp;
REVOKE ALL ON FUNCTION public.ops_execute_action(text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_oauth,medpruf_ops_mcp;
GRANT EXECUTE ON FUNCTION public.ops_prepare_content_review(text,text,text,bigint,text,text,text,text) TO medpruf_ops_mcp;
GRANT EXECUTE ON FUNCTION public.ops_prepare_notes_moderation(text,text,text,uuid,text,text,text) TO medpruf_ops_mcp;
GRANT EXECUTE ON FUNCTION public.ops_execute_action(text,text,text,uuid) TO medpruf_ops_mcp;

CREATE OR REPLACE FUNCTION public.ops_runtime_check() RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE allowed oid[]:=ARRAY[
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
