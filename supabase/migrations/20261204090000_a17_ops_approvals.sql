-- a17 Ops approvals (ADM-16 A, ADM-09 A support, UX-ADM-13/14). UNAPPLIED changeset.
-- Proof: npm run test:db:a17 (throwaway PostgreSQL 16). Rollback:
-- scripts/sql/track-a/a17-ops-approvals/down.sql.
--
-- No capability switch changes here: every ops_settings row stays as it is
-- (all four are OFF in production). This file only makes the approval lane
-- safe before any switch goes on.
--
-- 1. Every Ops write needs a live owner approval of its exact payload and
--    target state, feedback triage included (it previously ran without one).
-- 2. Notes are append-only. Feedback and question-report notes are appended
--    with a dated [Ops] line, never replaced, so the zoho_msg_id marker and
--    earlier notes survive. Every execution stores a before-image.
-- 3. Feedback triage has a status precondition: only open feedback (new or
--    reviewed) can be prepared, and execution refuses if the status moved.
-- 4. Prepared actions wait 24 hours for a decision (was 15 minutes). The
--    target hash still refuses execution when the target changed meanwhile.
-- 5. Decisions record who, when and why. A reject reason is required for an
--    access change (entitlement.grant) and optional otherwise.
-- 6. Owner reads for /admin/ops: the queue with live target state, the
--    waiting count for the Inbox badge, the connections list, and Disconnect.
-- 7. Personal access tokens live at most 31 days (NOT VALID: existing rows
--    are not rechecked); the issuer purges expired records as it writes.
--
-- Grants: new owner functions run as service_role only (the signed-session
-- app routes recheck live owner membership inside each function). Nothing
-- new is executable by medpruf_ops_mcp or medpruf_ops_oauth, so both
-- runtime privilege checks keep passing unchanged.

-- 1. Columns, defaults, constraints -------------------------------------------
ALTER TABLE public.ops_actions ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES public.users(id);
ALTER TABLE public.ops_actions ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE public.ops_actions ADD COLUMN IF NOT EXISTS decision_reason text;
ALTER TABLE public.ops_actions ALTER COLUMN expires_at SET DEFAULT now() + interval '24 hours';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname = 'ops_actions_decision_reason_length') THEN
    ALTER TABLE public.ops_actions ADD CONSTRAINT ops_actions_decision_reason_length
      CHECK (decision_reason IS NULL OR length(decision_reason) BETWEEN 1 AND 300);
  END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname = 'ops_credentials_max_lifetime') THEN
    ALTER TABLE public.ops_credentials ADD CONSTRAINT ops_credentials_max_lifetime
      CHECK (expires_at <= created_at + interval '31 days') NOT VALID;
  END IF;
END $$;

-- 2. Agent-visible action view: adds the decision time and reason ----------------
CREATE OR REPLACE FUNCTION public.ops_action_view(p_action public.ops_actions) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog
AS $$ SELECT jsonb_build_object('id',p_action.id,'principal_id',p_action.principal_id,'operation',p_action.operation,'status',CASE WHEN p_action.expires_at<=now() AND p_action.status IN ('prepared','approved') THEN 'expired' ELSE p_action.status END,'payload',p_action.payload,'payload_hash',p_action.payload_hash,'target_hash',p_action.target_hash,'predicted_effect',p_action.predicted_effect,'expires_at',p_action.expires_at,'created_at',p_action.created_at,'decided_at',p_action.decided_at,'decision_reason',p_action.decision_reason) $$;

-- 3. Feedback prepare: open feedback only, records the starting status ------------
CREATE OR REPLACE FUNCTION public.ops_prepare_feedback(p_token_hash text,p_environment text,p_audience text,p_feedback_id bigint,p_status text,p_note text,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; f public.user_feedback%ROWTYPE; v_note text; BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'feedback.manage');
 IF a->>'delegating_user_id' IS NULL THEN RAISE EXCEPTION 'Human delegation required' USING ERRCODE='42501'; END IF;
 IF p_feedback_id IS NULL OR p_status IS NULL OR p_status NOT IN ('reviewed','resolved','dismissed') OR length(coalesce(p_note,''))>500 THEN RAISE EXCEPTION 'Invalid feedback action' USING ERRCODE='22023'; END IF;
 SELECT * INTO f FROM public.user_feedback WHERE id=p_feedback_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Feedback not found' USING ERRCODE='P0002'; END IF;
 IF f.status NOT IN ('new','reviewed') OR f.status=p_status THEN RAISE EXCEPTION 'Feedback is not open for this change' USING ERRCODE='55000'; END IF;
 v_note:=nullif(btrim(coalesce(p_note,'')),'');
 RETURN public.ops_prepare_internal(a,'feedback.triage','feedback.manage',
  jsonb_build_object('feedback_id',p_feedback_id,'status',p_status,'note',v_note,'from_status',f.status),
  jsonb_build_object('status',p_status,'previous_status',f.status,'note_policy','append'),p_idempotency_key);
END $$;

-- 4. P0 execution (feedback triage, entitlement grant): approval for both ---------
CREATE OR REPLACE FUNCTION public.ops_execute_action_p0(p_token_hash text,p_environment text,p_audience text,p_action_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE auth jsonb; a public.ops_actions%ROWTYPE; ap public.ops_approvals%ROWTYPE; r jsonb; expiry timestamptz;
        u public.users%ROWTYPE; f public.user_feedback%ROWTYPE; v_note text; BEGIN
 auth:=public.ops_authenticate(p_token_hash,p_environment,p_audience);
 SELECT * INTO a FROM public.ops_actions WHERE id=p_action_id AND principal_id=(auth->>'principal_id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Action not found' USING ERRCODE='P0002'; END IF;
 IF NOT (auth->'permissions') ? a.required_permission THEN RAISE EXCEPTION 'Permission required' USING ERRCODE='42501'; END IF;
 SELECT result INTO r FROM public.ops_executions WHERE action_id=a.id;
 IF FOUND THEN RETURN public.ops_action_view(a)||jsonb_build_object('result',r); END IF;
 IF NOT EXISTS(SELECT FROM public.ops_settings WHERE capability=a.operation AND enabled FOR SHARE) THEN RAISE EXCEPTION 'Capability disabled' USING ERRCODE='55000'; END IF;
 IF a.expires_at<=now() OR a.status NOT IN ('prepared','approved') THEN RAISE EXCEPTION 'Action not executable' USING ERRCODE='55000'; END IF;
 IF auth->>'delegating_user_id' IS NULL THEN RAISE EXCEPTION 'Human delegation required' USING ERRCODE='42501'; END IF;
 IF public.ops_hash(a.payload)<>a.payload_hash OR public.ops_target_hash(a.operation,a.payload,true)<>a.target_hash THEN RAISE EXCEPTION 'Action precondition changed' USING ERRCODE='40001'; END IF;
 -- a17: every operation needs a live owner approval of this exact payload and target.
 SELECT * INTO ap FROM public.ops_approvals WHERE action_id=a.id AND payload_hash=a.payload_hash AND target_hash=a.target_hash AND expires_at>now();
 IF NOT FOUND OR a.status<>'approved' THEN RAISE EXCEPTION 'Owner approval required' USING ERRCODE='42501'; END IF;
 PERFORM public.ops_require_owner(ap.actor_id);
 IF NOT public.admin_actor_has_permission(ap.actor_id,a.required_permission) THEN RAISE EXCEPTION 'Approver permission revoked' USING ERRCODE='42501'; END IF;
 INSERT INTO public.ops_audit(principal_id,credential_id,action_id,event) VALUES(a.principal_id,(auth->>'credential_id')::uuid,a.id,'action.executing');
 IF a.operation='entitlement.grant' THEN
  SELECT * INTO u FROM public.users WHERE id=(a.payload->>'user_id')::uuid;
  expiry:=public.admin_grant_entitlement((auth->>'delegating_user_id')::uuid,(a.payload->>'user_id')::uuid,(a.payload->>'days')::integer,a.payload->>'reason',jsonb_build_object('ops_action_id',a.id));
  r:=jsonb_build_object('tier','pro','tier_expires_at',expiry,'previous',jsonb_build_object('tier',u.tier,'tier_expires_at',u.tier_expires_at));
 ELSIF a.operation='feedback.triage' THEN
  SELECT * INTO f FROM public.user_feedback WHERE id=(a.payload->>'feedback_id')::bigint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Feedback not found' USING ERRCODE='P0002'; END IF;
  IF a.payload ? 'from_status' AND f.status IS DISTINCT FROM a.payload->>'from_status' THEN RAISE EXCEPTION 'Feedback status changed' USING ERRCODE='55000'; END IF;
  v_note:=nullif(btrim(coalesce(a.payload->>'note','')),'');
  -- Append-only: earlier notes and the zoho_msg_id marker are never replaced.
  UPDATE public.user_feedback SET status=a.payload->>'status',
   admin_note=CASE WHEN v_note IS NULL THEN admin_note
     ELSE concat_ws(E'\n',nullif(admin_note,''),'[Ops '||to_char(now() AT TIME ZONE 'Europe/Vienna','YYYY-MM-DD')||'] '||v_note) END
   WHERE id=f.id;
  r:=jsonb_build_object('feedback_id',f.id,'status',a.payload->>'status','note_appended',v_note IS NOT NULL,'previous',jsonb_build_object('status',f.status));
 ELSE RAISE EXCEPTION 'Unsupported operation' USING ERRCODE='22023'; END IF;
 INSERT INTO public.ops_executions VALUES(a.id,r,now());
 UPDATE public.ops_actions SET status='succeeded' WHERE id=a.id RETURNING * INTO a;
 INSERT INTO public.ops_audit(principal_id,credential_id,action_id,event) VALUES(a.principal_id,(auth->>'credential_id')::uuid,a.id,'action.succeeded');
 RETURN public.ops_action_view(a)||jsonb_build_object('result',r);
END $$;

-- 5. Content execution: append-only report note, takedown before-image ------------
CREATE OR REPLACE FUNCTION public.ops_execute_content_action(
  p_token_hash text,p_environment text,p_audience text,p_action_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE auth jsonb; a public.ops_actions%ROWTYPE; ap public.ops_approvals%ROWTYPE; r jsonb;
        nr public.note_reports%ROWTYPE; n public.notes%ROWTYPE; v_note text;
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
    v_note:=nullif(btrim(coalesce(a.payload->>'admin_note','')),'');
    UPDATE public.question_suggestions SET status=a.payload->>'status',
      admin_note=CASE WHEN v_note IS NULL THEN admin_note
        ELSE concat_ws(E'\n',nullif(admin_note,''),'[Ops '||to_char(now() AT TIME ZONE 'Europe/Vienna','YYYY-MM-DD')||'] '||v_note) END,
      resolved_by=(auth->>'delegating_user_id')::uuid,resolved_at=now()
    WHERE id=(a.payload->>'question_suggestion_id')::bigint AND status='pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'Suggestion is no longer pending' USING ERRCODE='55000'; END IF;
    INSERT INTO public.admin_audit_log(actor_id,actor_email,action,target_type,target_id,payload)
      SELECT (auth->>'delegating_user_id')::uuid,coalesce(u.email,''),'content_review',
        'question_suggestion',NULL,
        jsonb_build_object('status',a.payload->>'status','reason',a.payload->>'reason','ops_action_id',a.id,
          'question_suggestion_id',a.payload->'question_suggestion_id','approved_by',ap.actor_id)
      FROM public.users u WHERE u.id=(auth->>'delegating_user_id')::uuid;
    r:=jsonb_build_object('question_suggestion_id',a.payload->'question_suggestion_id','status',a.payload->>'status',
      'note_appended',v_note IS NOT NULL,'previous',jsonb_build_object('status','pending'));
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
      SELECT (auth->>'delegating_user_id')::uuid,coalesce(u.email,''),('note_' || (a.payload->>'decision')),
        'note_report',nr.id,jsonb_build_object('decision',a.payload->>'decision','reason',a.payload->>'reason','ops_action_id',a.id,
          'approved_by',ap.actor_id,'previous',jsonb_build_object('is_active',n.is_active,'visibility',n.visibility))
      FROM public.users u WHERE u.id=(auth->>'delegating_user_id')::uuid;
    -- The before-image is the restore path for a takedown.
    r:=jsonb_build_object('report_id',nr.id,'decision',a.payload->>'decision','note_id',n.id,
      'takedown',a.payload->>'decision'='takedown',
      'previous',jsonb_build_object('report_status',nr.status,'note_is_active',n.is_active,'note_visibility',n.visibility));
  END IF;
  INSERT INTO public.ops_executions VALUES(a.id,r,now());
  UPDATE public.ops_actions SET status='succeeded' WHERE id=a.id RETURNING * INTO a;
  INSERT INTO public.ops_audit(principal_id,credential_id,action_id,event)
    VALUES(a.principal_id,(auth->>'credential_id')::uuid,a.id,'action.succeeded');
  RETURN public.ops_action_view(a)||jsonb_build_object('result',r);
END $$;

-- 6. Owner decisions ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_admin_approve_action(p_actor_id uuid,p_action_id uuid,p_payload_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.ops_actions%ROWTYPE; BEGIN PERFORM public.ops_require_owner(p_actor_id);
 SELECT * INTO a FROM public.ops_actions WHERE id=p_action_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Action not found' USING ERRCODE='P0002'; END IF;
 IF a.payload_hash IS DISTINCT FROM p_payload_hash OR public.ops_target_hash(a.operation,a.payload,true)<>a.target_hash THEN RAISE EXCEPTION 'Action changed' USING ERRCODE='40001'; END IF;
 IF a.status NOT IN ('prepared','approved') OR a.expires_at<=now() THEN RAISE EXCEPTION 'Action no longer approvable' USING ERRCODE='55000'; END IF;
 IF NOT public.admin_actor_has_permission(p_actor_id,a.required_permission) THEN RAISE EXCEPTION 'Approval permission required' USING ERRCODE='42501'; END IF;
 INSERT INTO public.ops_approvals VALUES(a.id,p_actor_id,a.payload_hash,a.target_hash,a.expires_at,now()) ON CONFLICT(action_id) DO NOTHING;
 UPDATE public.ops_actions SET status='approved',decided_by=coalesce(decided_by,p_actor_id),decided_at=coalesce(decided_at,now()) WHERE id=a.id RETURNING * INTO a;
 INSERT INTO public.ops_audit(action_id,actor_id,event) VALUES(a.id,p_actor_id,'action.approved'); RETURN public.ops_action_view(a);
END $$;

CREATE OR REPLACE FUNCTION public.ops_admin_reject_action(p_actor_id uuid,p_action_id uuid,p_payload_hash text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.ops_actions%ROWTYPE; v_reason text; BEGIN PERFORM public.ops_require_owner(p_actor_id);
 v_reason:=nullif(btrim(coalesce(p_reason,'')),'');
 IF v_reason IS NOT NULL AND length(v_reason)>300 THEN RAISE EXCEPTION 'Invalid reason' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM public.ops_actions WHERE id=p_action_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Action not found' USING ERRCODE='P0002'; END IF;
 IF a.payload_hash IS DISTINCT FROM p_payload_hash THEN RAISE EXCEPTION 'Action changed' USING ERRCODE='40001'; END IF;
 IF a.status NOT IN ('prepared','approved') OR a.expires_at<=now() THEN RAISE EXCEPTION 'Action no longer rejectable' USING ERRCODE='55000'; END IF;
 -- Access changes need a reason (the ADM-25 rule); other actions take an optional one.
 IF a.operation='entitlement.grant' AND (v_reason IS NULL OR length(v_reason)<3) THEN RAISE EXCEPTION 'Reason required for an access change' USING ERRCODE='22023'; END IF;
 UPDATE public.ops_actions SET status='rejected',decided_by=p_actor_id,decided_at=now(),decision_reason=v_reason WHERE id=a.id RETURNING * INTO a;
 DELETE FROM public.ops_approvals WHERE action_id=a.id;
 INSERT INTO public.ops_audit(action_id,actor_id,event) VALUES(a.id,p_actor_id,'action.rejected'); RETURN public.ops_action_view(a);
END $$;

-- The 3-argument form stays callable for the previous app build and follows the same rule.
CREATE OR REPLACE FUNCTION public.ops_admin_reject_action(p_actor_id uuid,p_action_id uuid,p_payload_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN RETURN public.ops_admin_reject_action(p_actor_id,p_action_id,p_payload_hash,NULL::text); END $$;

-- 7. Owner reads ---------------------------------------------------------------------
-- Live target state so the owner decides on what the change does now, not on ids.
CREATE OR REPLACE FUNCTION public.ops_target_summary(p_operation text,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb; BEGIN
 IF p_operation='entitlement.grant' THEN
  SELECT jsonb_build_object('kind','learner','user_id',u.id,'current_tier',u.tier,'current_expiry',u.tier_expires_at,
    'is_banned',coalesce(u.is_banned,false),
    'expiry_if_run_now',greatest(coalesce(u.tier_expires_at,now()),now())+make_interval(days=>(p_payload->>'days')::integer)) INTO r
  FROM public.users u WHERE u.id=(p_payload->>'user_id')::uuid;
 ELSIF p_operation='feedback.triage' THEN
  SELECT jsonb_build_object('kind','feedback','feedback_id',f.id,'user_id',f.user_id,'current_status',f.status,
    'message_excerpt',left(f.message,280),'note_tail',right(coalesce(f.admin_note,''),200)) INTO r
  FROM public.user_feedback f WHERE f.id=(p_payload->>'feedback_id')::bigint;
 ELSIF p_operation='content.review' THEN
  SELECT jsonb_build_object('kind','question_report','suggestion_id',qs.id,'question_id',qs.question_id,'user_id',qs.user_id,
    'report_type',qs.type,'current_status',qs.status,'report_reason',left(qs.reason,200),'details_excerpt',left(qs.details,280)) INTO r
  FROM public.question_suggestions qs WHERE qs.id=(p_payload->>'question_suggestion_id')::bigint;
 ELSIF p_operation='notes.moderation' THEN
  SELECT jsonb_build_object('kind','note_report','report_id',nr.id,'report_status',nr.status,'report_reason',left(nr.reason,200),
    'report_detail',left(nr.detail,280),'note_id',n.id,'note_owner_id',n.user_id,'note_title',left(n.title,140),
    'note_excerpt',left(n.search_text,280),'note_visibility',n.visibility,'note_is_active',n.is_active) INTO r
  FROM public.note_reports nr JOIN public.notes n ON n.id=nr.note_id WHERE nr.id=(p_payload->>'report_id')::uuid;
 END IF;
 RETURN coalesce(r,jsonb_build_object('kind','missing'));
END $$;

CREATE OR REPLACE FUNCTION public.ops_admin_queue(p_actor_id uuid,p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb; BEGIN PERFORM public.ops_require_owner(p_actor_id);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(q.item ORDER BY q.live DESC,CASE WHEN q.live THEN q.expires_at END ASC,q.created_at DESC,q.id),'[]'::jsonb)) INTO r
 FROM (
  SELECT x.id,x.expires_at,x.created_at,(x.status IN ('prepared','approved') AND x.expires_at>now()) AS live,
   public.ops_action_view(x)||jsonb_build_object(
    'principal_name',pr.name,
    'principal_kind',CASE WHEN pr.oauth_client_id IS NOT NULL THEN 'oauth' ELSE 'token' END,
    'principal_active',pr.active,
    'decided_by',x.decided_by,
    'approved_by',ap.actor_id,'approved_at',ap.created_at,
    'executed_at',ex.created_at,'result',ex.result,
    'target',public.ops_target_summary(x.operation,x.payload)) AS item
  FROM public.ops_actions x
  LEFT JOIN public.ops_principals pr ON pr.id=x.principal_id
  LEFT JOIN public.ops_approvals ap ON ap.action_id=x.id
  LEFT JOIN public.ops_executions ex ON ex.action_id=x.id
  WHERE (x.status IN ('prepared','approved') AND x.expires_at>now())
     OR x.id IN (SELECT id FROM public.ops_actions ORDER BY created_at DESC,id LIMIT p_limit)
 ) q;
 RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.ops_admin_queue_summary(p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb; BEGIN PERFORM public.ops_require_owner(p_actor_id);
 SELECT jsonb_build_object(
  'waiting',count(*) FILTER (WHERE status='prepared' AND expires_at>now()),
  'approved',count(*) FILTER (WHERE status='approved' AND expires_at>now()),
  'next_expiry',min(expires_at) FILTER (WHERE status='prepared' AND expires_at>now())) INTO r
 FROM public.ops_actions WHERE status IN ('prepared','approved');
 RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.ops_admin_connections(p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb; BEGIN PERFORM public.ops_require_owner(p_actor_id);
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'name',p.name,'kind',CASE WHEN p.oauth_client_id IS NULL THEN 'token' ELSE 'oauth' END,
  'client_id',p.oauth_client_id,'environment',p.environment,'active',p.active,'created_at',p.created_at,
  'delegating_user_id',p.delegating_user_id,
  'scopes',(SELECT coalesce(jsonb_agg(g.permission ORDER BY g.permission),'[]'::jsonb) FROM public.ops_grants g WHERE g.principal_id=p.id),
  'live_credentials',(SELECT count(*) FROM public.ops_credentials c WHERE c.principal_id=p.id AND c.revoked_at IS NULL AND c.expires_at>now()),
  'credential_expires_at',(SELECT max(c.expires_at) FROM public.ops_credentials c WHERE c.principal_id=p.id AND c.revoked_at IS NULL AND c.expires_at>now()),
  'last_used_at',(SELECT max(rl.window_start) FROM public.ops_rate_limits rl JOIN public.ops_credentials c ON c.id=rl.credential_id WHERE c.principal_id=p.id)
 ) ORDER BY p.active DESC,p.created_at DESC),'[]'::jsonb)) INTO r FROM public.ops_principals p;
 RETURN r;
END $$;

-- Disconnect: one owner action replaces the SQL runbook. Revokes every credential,
-- removes OAuth grants and refresh records, and closes the connection's open actions.
-- A later consent through the browser-bound connect page can reconnect it.
CREATE OR REPLACE FUNCTION public.ops_admin_disconnect(p_actor_id uuid,p_principal_id uuid,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.ops_principals%ROWTYPE; v_reason text; revoked integer; closed integer; BEGIN
 PERFORM public.ops_require_owner(p_actor_id);
 v_reason:=nullif(btrim(coalesce(p_reason,'')),'');
 IF v_reason IS NULL OR length(v_reason)>200 THEN RAISE EXCEPTION 'Invalid reason' USING ERRCODE='22023'; END IF;
 SELECT * INTO p FROM public.ops_principals WHERE id=p_principal_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Connection not found' USING ERRCODE='P0002'; END IF;
 UPDATE public.ops_principals SET active=false WHERE id=p.id;
 UPDATE public.ops_credentials SET revoked_at=coalesce(revoked_at,now()) WHERE principal_id=p.id AND revoked_at IS NULL;
 GET DIAGNOSTICS revoked = ROW_COUNT;
 DELETE FROM public.ops_oauth_records WHERE grant_hash IN (
   SELECT t.grant_hash FROM public.ops_oauth_tokens t JOIN public.ops_credentials c ON c.id=t.credential_id WHERE c.principal_id=p.id);
 DELETE FROM public.ops_approvals WHERE action_id IN (SELECT id FROM public.ops_actions WHERE principal_id=p.id AND status IN ('prepared','approved'));
 UPDATE public.ops_actions SET status='rejected',decided_by=p_actor_id,decided_at=now(),decision_reason=left('Connection disconnected: '||v_reason,300)
  WHERE principal_id=p.id AND status IN ('prepared','approved');
 GET DIAGNOSTICS closed = ROW_COUNT;
 INSERT INTO public.ops_audit(principal_id,actor_id,event) VALUES(p.id,p_actor_id,'principal.disconnected');
 INSERT INTO public.admin_audit_log(actor_id,actor_email,action,target_type,target_id,payload)
  SELECT p_actor_id,coalesce(u.email,''),'ops_disconnect','ops_principal',p.id,
   jsonb_build_object('reason',v_reason,'name',p.name,'revoked_credentials',revoked,'closed_actions',closed)
  FROM public.users u WHERE u.id=p_actor_id;
 RETURN jsonb_build_object('principal_id',p.id,'active',false,'revoked_credentials',revoked,'closed_actions',closed);
END $$;

-- 8. Issuer write path purges a bounded batch of expired records (ADM-ops-safety-06).
CREATE OR REPLACE FUNCTION public.ops_oauth_put(p_model text,p_id_hash text,p_ciphertext text,p_expires_at timestamptz,p_uid_hash text,p_user_code_hash text,p_grant_hash text,p_binding jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.ops_principals%ROWTYPE; cid uuid; scopes text[]; BEGIN
 IF p_expires_at<=now() OR p_expires_at>now()+interval '31 days' OR p_id_hash !~ '^[a-f0-9]{64}$'
 OR (p_uid_hash IS NOT NULL AND p_uid_hash !~ '^[a-f0-9]{64}$')
 OR (p_user_code_hash IS NOT NULL AND p_user_code_hash !~ '^[a-f0-9]{64}$')
 OR (p_grant_hash IS NOT NULL AND p_grant_hash !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'Invalid issuer record' USING ERRCODE='22023'; END IF;
 DELETE FROM public.ops_oauth_records WHERE ctid IN (
   SELECT ctid FROM public.ops_oauth_records WHERE expires_at<now()-interval '1 hour' LIMIT 50);
 INSERT INTO public.ops_oauth_records(model,id_hash,ciphertext,expires_at,uid_hash,user_code_hash,grant_hash)
 VALUES(p_model,p_id_hash,p_ciphertext,p_expires_at,p_uid_hash,p_user_code_hash,p_grant_hash)
 ON CONFLICT(model,id_hash) DO UPDATE SET ciphertext=excluded.ciphertext,expires_at=excluded.expires_at,uid_hash=excluded.uid_hash,user_code_hash=excluded.user_code_hash,grant_hash=excluded.grant_hash;
 IF p_model='AccessToken' THEN
  IF p_binding IS NULL OR jsonb_typeof(p_binding)<>'object' OR p_grant_hash IS NULL
  OR p_binding->>'tokenHash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_binding->'scopes')<>'array' THEN RAISE EXCEPTION 'Invalid token binding' USING ERRCODE='22023'; END IF;
  SELECT * INTO p FROM public.ops_principals WHERE id=(p_binding->>'principalId')::uuid AND active AND oauth_client_id=p_binding->>'clientId' AND audience=p_binding->>'audience' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consent revoked' USING ERRCODE='28000'; END IF;
  PERFORM public.ops_require_owner(p.delegating_user_id);
  SELECT array_agg(value) INTO scopes FROM jsonb_array_elements_text(p_binding->'scopes');
  IF cardinality(scopes) NOT BETWEEN 1 AND 15 OR EXISTS(SELECT FROM unnest(scopes) s WHERE NOT EXISTS(SELECT FROM public.ops_grants g WHERE g.principal_id=p.id AND g.permission=s) OR NOT public.admin_actor_has_permission(p.delegating_user_id,s)) THEN RAISE EXCEPTION 'Scope not consented' USING ERRCODE='42501'; END IF;
  INSERT INTO public.ops_credentials(principal_id,token_hash,scopes,expires_at)
  VALUES(p.id,p_binding->>'tokenHash',scopes,p_expires_at)
  ON CONFLICT(token_hash) DO UPDATE SET expires_at=least(ops_credentials.expires_at,excluded.expires_at)
  RETURNING id INTO cid;
  INSERT INTO public.ops_oauth_tokens VALUES(p_id_hash,cid,p_grant_hash) ON CONFLICT(id_hash) DO NOTHING;
 ELSIF p_binding IS NOT NULL THEN RAISE EXCEPTION 'Unexpected token binding' USING ERRCODE='22023'; END IF;
 RETURN '{}'::jsonb;
END $$;

-- 9. Grants ----------------------------------------------------------------------------
-- Replaced private helpers keep their ACL; restate it so a partial stack can never
-- leave them executable. New functions start with PUBLIC (and Supabase default)
-- EXECUTE: strip it first.
REVOKE ALL ON FUNCTION public.ops_action_view(public.ops_actions) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp,medpruf_ops_oauth;
REVOKE ALL ON FUNCTION public.ops_execute_action_p0(text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp,medpruf_ops_oauth;
REVOKE ALL ON FUNCTION public.ops_execute_content_action(text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp,medpruf_ops_oauth;
REVOKE ALL ON FUNCTION public.ops_target_summary(text,jsonb) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp,medpruf_ops_oauth;
REVOKE ALL ON FUNCTION public.ops_admin_reject_action(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp,medpruf_ops_oauth;
REVOKE ALL ON FUNCTION public.ops_admin_queue(uuid,integer) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp,medpruf_ops_oauth;
REVOKE ALL ON FUNCTION public.ops_admin_queue_summary(uuid) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp,medpruf_ops_oauth;
REVOKE ALL ON FUNCTION public.ops_admin_connections(uuid) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp,medpruf_ops_oauth;
REVOKE ALL ON FUNCTION public.ops_admin_disconnect(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp,medpruf_ops_oauth;
GRANT EXECUTE ON FUNCTION public.ops_admin_reject_action(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_admin_queue(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_admin_queue_summary(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_admin_connections(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ops_admin_disconnect(uuid,uuid,text) TO service_role;
