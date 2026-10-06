-- Private Ops P0. Provision no credentials, login, capability enablement or provider keys here.
-- Provision LOGIN on this exact role separately; do not add role memberships.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'medpruf_ops_mcp') THEN
    CREATE ROLE medpruf_ops_mcp NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
  END IF;
END $$;
-- Managed Postgres administrators cannot alter SUPERUSER/BYPASSRLS flags.
-- Verify existing roles fail closed rather than attempting privileged downgrades.
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='medpruf_ops_mcp' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication))
 THEN RAISE EXCEPTION 'Unsafe existing Ops role' USING ERRCODE='42501'; END IF;
END $$;
ALTER ROLE medpruf_ops_mcp NOLOGIN NOINHERIT;
GRANT USAGE ON SCHEMA public TO medpruf_ops_mcp;

CREATE TABLE public.ops_principals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 project text NOT NULL CHECK(project='medpruf'), environment text NOT NULL CHECK(environment IN ('development','staging','production')),
 audience text NOT NULL CHECK(length(audience) BETWEEN 1 AND 200),
 delegating_user_id uuid REFERENCES public.users(id), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ops_credentials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), principal_id uuid NOT NULL REFERENCES public.ops_principals(id),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'), scopes text[] NOT NULL DEFAULT '{}',
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ops_grants (
 principal_id uuid NOT NULL REFERENCES public.ops_principals(id), permission text NOT NULL
 CHECK(permission IN ('users.read','feedback.read','feedback.manage','users.entitlements.write','system.read')),
 PRIMARY KEY(principal_id,permission)
);
CREATE TABLE public.ops_settings(capability text PRIMARY KEY CHECK(capability IN ('feedback.triage','entitlement.grant')),enabled boolean NOT NULL DEFAULT false);
INSERT INTO public.ops_settings VALUES ('feedback.triage',false),('entitlement.grant',false);
CREATE TABLE public.ops_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), principal_id uuid NOT NULL REFERENCES public.ops_principals(id),
 credential_id uuid NOT NULL REFERENCES public.ops_credentials(id), operation text NOT NULL CHECK(operation IN ('feedback.triage','entitlement.grant')),
 required_permission text NOT NULL, idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 128),
 payload jsonb NOT NULL, payload_hash text NOT NULL, target_hash text NOT NULL, predicted_effect jsonb NOT NULL,
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','approved','rejected','succeeded')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(principal_id,idempotency_key)
);
CREATE TABLE public.ops_approvals (
 action_id uuid PRIMARY KEY REFERENCES public.ops_actions(id), actor_id uuid NOT NULL REFERENCES public.users(id),
 payload_hash text NOT NULL,target_hash text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ops_executions (
 action_id uuid PRIMARY KEY REFERENCES public.ops_actions(id),result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ops_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, principal_id uuid REFERENCES public.ops_principals(id),
 credential_id uuid REFERENCES public.ops_credentials(id), action_id uuid REFERENCES public.ops_actions(id),
 actor_id uuid REFERENCES public.users(id),event text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ops_rate_limits (
 credential_id uuid NOT NULL REFERENCES public.ops_credentials(id),window_start timestamptz NOT NULL,
 requests integer NOT NULL CHECK(requests>0),PRIMARY KEY(credential_id,window_start)
);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['ops_principals','ops_credentials','ops_grants','ops_settings','ops_actions','ops_approvals','ops_executions','ops_audit','ops_rate_limits'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, medpruf_ops_mcp',n);
 -- Owner UI uses named functions, never generic service-role table access.
 EXECUTE format('REVOKE ALL ON public.%I FROM service_role',n);
 END LOOP;
END $$;

CREATE FUNCTION public.ops_hash(p_value jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog
AS $$ SELECT encode(sha256(convert_to(p_value::text,'UTF8')),'hex') $$;

CREATE FUNCTION public.ops_authenticate(p_token_hash text,p_environment text,p_audience text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.ops_credentials%ROWTYPE; p public.ops_principals%ROWTYPE; perms text[]; n integer;
BEGIN
 SELECT * INTO c FROM public.ops_credentials WHERE token_hash=p_token_hash AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid credential' USING ERRCODE='28000'; END IF;
 SELECT * INTO p FROM public.ops_principals WHERE id=c.principal_id AND active AND project='medpruf' AND environment=p_environment AND audience=p_audience FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid principal binding' USING ERRCODE='28000'; END IF;
 IF p.delegating_user_id IS NOT NULL THEN
 -- Lock live delegation and existing RBAC grants so concurrent revocation serializes with execution.
 PERFORM 1 FROM public.users WHERE id=p.delegating_user_id FOR SHARE;
 PERFORM 1 FROM public.admin_user_roles ur JOIN public.admin_roles r ON r.id=ur.role_id JOIN public.admin_role_permissions rp ON rp.role_id=r.id WHERE ur.user_id=p.delegating_user_id FOR SHARE OF ur,r,rp;
 END IF;
 IF p.delegating_user_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.users WHERE id=p.delegating_user_id AND role='admin' AND NOT coalesce(is_banned,false)) THEN
 RAISE EXCEPTION 'Delegation revoked' USING ERRCODE='28000'; END IF;
 SELECT coalesce(array_agg(g.permission ORDER BY g.permission),'{}') INTO perms FROM public.ops_grants g
 WHERE g.principal_id=p.id AND g.permission=ANY(c.scopes)
 AND (p.delegating_user_id IS NULL OR public.admin_actor_has_permission(p.delegating_user_id,g.permission));
 INSERT INTO public.ops_rate_limits VALUES(c.id,date_trunc('minute',now()),1)
 ON CONFLICT(credential_id,window_start) DO UPDATE SET requests=ops_rate_limits.requests+1 RETURNING requests INTO n;
 IF n>120 THEN RAISE EXCEPTION 'Rate limit exceeded' USING ERRCODE='P0429'; END IF;
 RETURN jsonb_build_object('principal_id',p.id,'credential_id',c.id,'delegating_user_id',p.delegating_user_id,'permissions',perms,'expires_at',c.expires_at);
END $$;

CREATE FUNCTION public.ops_require(p_token_hash text,p_environment text,p_audience text,p_permission text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; BEGIN
 a:=public.ops_authenticate(p_token_hash,p_environment,p_audience);
 IF NOT (a->'permissions') ? p_permission THEN RAISE EXCEPTION 'Permission required' USING ERRCODE='42501'; END IF;
 RETURN a;
END $$;

CREATE FUNCTION public.ops_user_get(p_token_hash text,p_environment text,p_audience text,p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb; BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'users.read');
 SELECT jsonb_build_object('id',id,'name',coalesce(left(first_name,1),'')||'***','is_banned',coalesce(is_banned,false)) INTO r FROM public.users WHERE id=p_user_id;
 IF r IS NULL THEN RAISE EXCEPTION 'User not found' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'users.get'); RETURN r;
END $$;
CREATE FUNCTION public.ops_users_search(p_token_hash text,p_environment text,p_audience text,p_q text DEFAULT NULL,p_limit integer DEFAULT 25,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb; BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'users.read');
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000 OR length(coalesce(p_q,''))>100 THEN RAISE EXCEPTION 'Invalid query bounds' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(x.item),'[]'::jsonb)) INTO r FROM (
 SELECT jsonb_build_object('id',id,'name',coalesce(left(first_name,1),'')||'***','is_banned',coalesce(is_banned,false)) item
 FROM public.users WHERE coalesce(p_q,'')='' OR id::text=p_q OR strpos(lower(coalesce(first_name,'')||' '||coalesce(last_name,'')),lower(p_q))>0 ORDER BY id LIMIT p_limit OFFSET p_offset) x;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'users.search'); RETURN r;
END $$;
CREATE FUNCTION public.ops_feedback_get(p_token_hash text,p_environment text,p_audience text,p_feedback_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb; BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'feedback.read');
 SELECT jsonb_build_object('id',id,'user_id',user_id,'message',left(message,4000),'status',status,'created_at',created_at,'context_redacted',true) INTO r FROM public.user_feedback WHERE id=p_feedback_id;
 IF r IS NULL THEN RAISE EXCEPTION 'Feedback not found' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'feedback.get'); RETURN r;
END $$;
CREATE FUNCTION public.ops_feedback_list(p_token_hash text,p_environment text,p_audience text,p_status text DEFAULT 'new',p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; r jsonb; BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'feedback.read');
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_status IS NULL OR p_status NOT IN ('new','reviewed','resolved','dismissed','all') THEN RAISE EXCEPTION 'Invalid query bounds' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(x.item),'[]'::jsonb)) INTO r FROM (
 SELECT jsonb_build_object('id',id,'user_id',user_id,'message',left(message,1000),'status',status,'created_at',created_at,'context_redacted',true) item FROM public.user_feedback WHERE p_status='all' OR status=p_status ORDER BY created_at DESC,id DESC LIMIT p_limit) x;
 INSERT INTO public.ops_audit(principal_id,credential_id,event) VALUES((a->>'principal_id')::uuid,(a->>'credential_id')::uuid,'feedback.list'); RETURN r;
END $$;

CREATE FUNCTION public.ops_target_hash(p_operation text,p_payload jsonb,p_lock boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb; BEGIN
 IF p_operation='feedback.triage' THEN
 IF p_lock THEN PERFORM 1 FROM public.user_feedback WHERE id=(p_payload->>'feedback_id')::bigint FOR UPDATE; END IF;
 SELECT jsonb_build_object('id',id,'status',status,'admin_note',admin_note,'message',message,'context',context,'user_id',user_id) INTO r FROM public.user_feedback WHERE id=(p_payload->>'feedback_id')::bigint;
 ELSIF p_operation='entitlement.grant' THEN
 IF p_lock THEN PERFORM 1 FROM public.users WHERE id=(p_payload->>'user_id')::uuid FOR UPDATE; END IF;
 SELECT jsonb_build_object('id',id,'role',role,'tier',tier,'tier_expires_at',tier_expires_at,'is_banned',is_banned) INTO r FROM public.users WHERE id=(p_payload->>'user_id')::uuid;
 ELSE RAISE EXCEPTION 'Unsupported operation' USING ERRCODE='22023'; END IF;
 IF r IS NULL THEN RAISE EXCEPTION 'Target not found' USING ERRCODE='P0002'; END IF;
 RETURN public.ops_hash(r);
END $$;
CREATE FUNCTION public.ops_action_view(p_action public.ops_actions) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog
AS $$ SELECT jsonb_build_object('id',p_action.id,'principal_id',p_action.principal_id,'operation',p_action.operation,'status',CASE WHEN p_action.expires_at<=now() AND p_action.status IN ('prepared','approved') THEN 'expired' ELSE p_action.status END,'payload',p_action.payload,'payload_hash',p_action.payload_hash,'target_hash',p_action.target_hash,'predicted_effect',p_action.predicted_effect,'expires_at',p_action.expires_at,'created_at',p_action.created_at) $$;
CREATE FUNCTION public.ops_prepare_internal(p_auth jsonb,p_operation text,p_permission text,p_payload jsonb,p_prediction jsonb,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.ops_actions%ROWTYPE; h text; t text; BEGIN
 IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'Invalid idempotency key' USING ERRCODE='22023'; END IF;
 h:=public.ops_hash(p_payload); t:=public.ops_target_hash(p_operation,p_payload);
 INSERT INTO public.ops_actions(principal_id,credential_id,operation,required_permission,idempotency_key,payload,payload_hash,target_hash,predicted_effect)
 VALUES((p_auth->>'principal_id')::uuid,(p_auth->>'credential_id')::uuid,p_operation,p_permission,p_idempotency_key,p_payload,h,t,p_prediction)
 ON CONFLICT(principal_id,idempotency_key) DO NOTHING RETURNING * INTO a;
 IF NOT FOUND THEN SELECT * INTO a FROM public.ops_actions WHERE principal_id=(p_auth->>'principal_id')::uuid AND idempotency_key=p_idempotency_key;
 IF a.payload_hash<>h OR a.operation<>p_operation THEN RAISE EXCEPTION 'Idempotency payload conflict' USING ERRCODE='40001'; END IF;
 ELSE INSERT INTO public.ops_audit(principal_id,credential_id,action_id,event) VALUES(a.principal_id,a.credential_id,a.id,'action.prepared'); END IF;
 RETURN public.ops_action_view(a);
END $$;
CREATE FUNCTION public.ops_prepare_feedback(p_token_hash text,p_environment text,p_audience text,p_feedback_id bigint,p_status text,p_note text,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'feedback.manage');
 IF a->>'delegating_user_id' IS NULL THEN RAISE EXCEPTION 'Human delegation required' USING ERRCODE='42501'; END IF;
 IF p_feedback_id IS NULL OR p_status IS NULL OR p_status NOT IN ('reviewed','resolved','dismissed') OR length(coalesce(p_note,''))>500 THEN RAISE EXCEPTION 'Invalid feedback action' USING ERRCODE='22023'; END IF;
 RETURN public.ops_prepare_internal(a,'feedback.triage','feedback.manage',jsonb_build_object('feedback_id',p_feedback_id,'status',p_status,'note',p_note),jsonb_build_object('status',p_status),p_idempotency_key);
END $$;
CREATE FUNCTION public.ops_prepare_entitlement(p_token_hash text,p_environment text,p_audience text,p_user_id uuid,p_days integer,p_reason text,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a jsonb; u public.users%ROWTYPE; BEGIN
 a:=public.ops_require(p_token_hash,p_environment,p_audience,'users.entitlements.write');
 IF a->>'delegating_user_id' IS NULL THEN RAISE EXCEPTION 'Human delegation required' USING ERRCODE='42501'; END IF;
 IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 365 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'Invalid entitlement action' USING ERRCODE='22023'; END IF;
 SELECT * INTO u FROM public.users WHERE id=p_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'User not found' USING ERRCODE='P0002'; END IF;
 IF u.role='admin' OR u.tier='admin' THEN RAISE EXCEPTION 'Cannot grant administrator access' USING ERRCODE='42501'; END IF;
 RETURN public.ops_prepare_internal(a,'entitlement.grant','users.entitlements.write',jsonb_build_object('user_id',p_user_id,'days',p_days,'reason',trim(p_reason)),jsonb_build_object('tier','pro','previous_tier',u.tier,'previous_expiry',u.tier_expires_at,'predicted_expiry',greatest(coalesce(u.tier_expires_at,now()),now())+make_interval(days=>p_days),'expiry_policy','Add days to the later of existing expiry and execution time'),p_idempotency_key);
END $$;
CREATE FUNCTION public.ops_action_status(p_token_hash text,p_environment text,p_audience text,p_action_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE auth jsonb; a public.ops_actions%ROWTYPE; r jsonb; BEGIN
 auth:=public.ops_authenticate(p_token_hash,p_environment,p_audience);
 SELECT * INTO a FROM public.ops_actions WHERE id=p_action_id AND principal_id=(auth->>'principal_id')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Action not found' USING ERRCODE='P0002'; END IF;
 IF NOT (auth->'permissions') ? a.required_permission THEN RAISE EXCEPTION 'Permission required' USING ERRCODE='42501'; END IF;
 SELECT result INTO r FROM public.ops_executions WHERE action_id=a.id;
 RETURN public.ops_action_view(a)||jsonb_build_object('result',r);
END $$;
CREATE FUNCTION public.ops_require_owner(p_actor_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 PERFORM 1 FROM public.users u JOIN public.admin_user_roles ur ON ur.user_id=u.id JOIN public.admin_roles r ON r.id=ur.role_id JOIN public.admin_role_permissions rp ON rp.role_id=r.id WHERE u.id=p_actor_id FOR SHARE OF u,ur,r,rp;
 IF NOT EXISTS(SELECT FROM public.users u JOIN public.admin_user_roles ur ON ur.user_id=u.id JOIN public.admin_roles r ON r.id=ur.role_id WHERE u.id=p_actor_id AND u.role='admin' AND NOT coalesce(u.is_banned,false) AND r.role_key='owner' AND r.is_active) THEN RAISE EXCEPTION 'Current owner required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION public.ops_admin_list_actions(p_actor_id uuid,p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb; BEGIN PERFORM public.ops_require_owner(p_actor_id);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid limit' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('items',coalesce(jsonb_agg(public.ops_action_view(x)),'[]'::jsonb)) INTO r FROM (SELECT * FROM public.ops_actions ORDER BY created_at DESC,id LIMIT p_limit) x; RETURN r;
END $$;
CREATE FUNCTION public.ops_admin_approve_action(p_actor_id uuid,p_action_id uuid,p_payload_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.ops_actions%ROWTYPE; BEGIN PERFORM public.ops_require_owner(p_actor_id);
 SELECT * INTO a FROM public.ops_actions WHERE id=p_action_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Action not found' USING ERRCODE='P0002'; END IF;
 IF a.payload_hash IS DISTINCT FROM p_payload_hash OR public.ops_target_hash(a.operation,a.payload,true)<>a.target_hash THEN RAISE EXCEPTION 'Action changed' USING ERRCODE='40001'; END IF;
 IF a.status NOT IN ('prepared','approved') OR a.expires_at<=now() THEN RAISE EXCEPTION 'Action no longer approvable' USING ERRCODE='55000'; END IF;
 IF NOT public.admin_actor_has_permission(p_actor_id,a.required_permission) THEN RAISE EXCEPTION 'Approval permission required' USING ERRCODE='42501'; END IF;
 INSERT INTO public.ops_approvals VALUES(a.id,p_actor_id,a.payload_hash,a.target_hash,a.expires_at,now()) ON CONFLICT(action_id) DO NOTHING;
 UPDATE public.ops_actions SET status='approved' WHERE id=a.id RETURNING * INTO a;
 INSERT INTO public.ops_audit(action_id,actor_id,event) VALUES(a.id,p_actor_id,'action.approved'); RETURN public.ops_action_view(a);
END $$;
CREATE FUNCTION public.ops_admin_reject_action(p_actor_id uuid,p_action_id uuid,p_payload_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.ops_actions%ROWTYPE; BEGIN PERFORM public.ops_require_owner(p_actor_id);
 SELECT * INTO a FROM public.ops_actions WHERE id=p_action_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Action not found' USING ERRCODE='P0002'; END IF;
 IF a.payload_hash IS DISTINCT FROM p_payload_hash THEN RAISE EXCEPTION 'Action changed' USING ERRCODE='40001'; END IF;
 IF a.status NOT IN ('prepared','approved') OR a.expires_at<=now() THEN RAISE EXCEPTION 'Action no longer rejectable' USING ERRCODE='55000'; END IF;
 UPDATE public.ops_actions SET status='rejected' WHERE id=a.id RETURNING * INTO a;
 DELETE FROM public.ops_approvals WHERE action_id=a.id;
 INSERT INTO public.ops_audit(action_id,actor_id,event) VALUES(a.id,p_actor_id,'action.rejected'); RETURN public.ops_action_view(a);
END $$;
CREATE FUNCTION public.ops_execute_action(p_token_hash text,p_environment text,p_audience text,p_action_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE auth jsonb; a public.ops_actions%ROWTYPE; ap public.ops_approvals%ROWTYPE; r jsonb; expiry timestamptz; BEGIN
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
 IF a.operation='entitlement.grant' THEN
 IF auth->>'delegating_user_id' IS NULL THEN RAISE EXCEPTION 'Human delegation required' USING ERRCODE='42501'; END IF;
 SELECT * INTO ap FROM public.ops_approvals WHERE action_id=a.id AND payload_hash=a.payload_hash AND target_hash=a.target_hash AND expires_at>now();
 IF NOT FOUND OR a.status<>'approved' THEN RAISE EXCEPTION 'Owner approval required' USING ERRCODE='42501'; END IF;
 PERFORM public.ops_require_owner(ap.actor_id);
 IF NOT public.admin_actor_has_permission(ap.actor_id,a.required_permission) THEN RAISE EXCEPTION 'Approver permission revoked' USING ERRCODE='42501'; END IF;
 INSERT INTO public.ops_audit(principal_id,credential_id,action_id,event) VALUES(a.principal_id,(auth->>'credential_id')::uuid,a.id,'action.executing');
 expiry:=public.admin_grant_entitlement((auth->>'delegating_user_id')::uuid,(a.payload->>'user_id')::uuid,(a.payload->>'days')::integer,a.payload->>'reason',jsonb_build_object('ops_action_id',a.id));
 r:=jsonb_build_object('tier','pro','tier_expires_at',expiry);
 ELSE
 INSERT INTO public.ops_audit(principal_id,credential_id,action_id,event) VALUES(a.principal_id,(auth->>'credential_id')::uuid,a.id,'action.executing');
 UPDATE public.user_feedback SET status=a.payload->>'status',admin_note=a.payload->>'note' WHERE id=(a.payload->>'feedback_id')::bigint;
 r:=jsonb_build_object('feedback_id',a.payload->'feedback_id','status',a.payload->>'status');
 END IF;
 INSERT INTO public.ops_executions VALUES(a.id,r,now());
 UPDATE public.ops_actions SET status='succeeded' WHERE id=a.id RETURNING * INTO a;
 INSERT INTO public.ops_audit(principal_id,credential_id,action_id,event) VALUES(a.principal_id,(auth->>'credential_id')::uuid,a.id,'action.succeeded');
 RETURN public.ops_action_view(a)||jsonb_build_object('result',r);
END $$;

-- Definer helpers are not agent entry points. Default PostgreSQL PUBLIC execute is unsafe.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'ops_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp',f.signature);
 IF f.proname IN ('ops_authenticate','ops_users_search','ops_user_get','ops_feedback_list','ops_feedback_get','ops_prepare_feedback','ops_prepare_entitlement','ops_action_status','ops_execute_action') THEN
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO medpruf_ops_mcp',f.signature);
 ELSIF f.proname IN ('ops_admin_list_actions','ops_admin_approve_action','ops_admin_reject_action') THEN
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END IF;
 END LOOP;
END $$;

-- Invoker check must run as the effective dedicated role before accepting requests.
-- Existing legacy PUBLIC grants are not silently revoked on a shared database.
-- Instead, refuse activation until the owning migration fixes each leaking grant.
CREATE FUNCTION public.ops_runtime_check() RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE allowed oid[]:=ARRAY[
 'public.ops_authenticate(text,text,text)'::regprocedure,
 'public.ops_users_search(text,text,text,text,integer,integer)'::regprocedure,
 'public.ops_user_get(text,text,text,uuid)'::regprocedure,
 'public.ops_feedback_list(text,text,text,text,integer)'::regprocedure,
 'public.ops_feedback_get(text,text,text,bigint)'::regprocedure,
 'public.ops_prepare_feedback(text,text,text,bigint,text,text,text)'::regprocedure,
 'public.ops_prepare_entitlement(text,text,text,uuid,integer,text,text)'::regprocedure,
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
