-- OAuth issuer storage is isolated from business tables and the Ops runtime login.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='medpruf_ops_oauth') THEN
  CREATE ROLE medpruf_ops_oauth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
 END IF;
END $$;

CREATE FUNCTION public.ops_oauth_runtime_check() RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE allowed oid[]:=ARRAY[
 'public.ops_oauth_put(text,text,text,timestamp with time zone,text,text,text,jsonb)'::regprocedure,
 'public.ops_oauth_get(text,text,text)'::regprocedure,
 'public.ops_oauth_consume(text,text,bigint)'::regprocedure,
 'public.ops_oauth_destroy(text,text)'::regprocedure,
 'public.ops_oauth_revoke_grant(text)'::regprocedure,
 'public.ops_oauth_account(uuid)'::regprocedure
]; BEGIN
 IF current_user<>'medpruf_ops_oauth' OR EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN RAISE EXCEPTION 'Unsafe issuer role' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN RAISE EXCEPTION 'Issuer role membership forbidden' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname !~ '^pg_' AND has_schema_privilege(current_user,oid,'CREATE')) THEN RAISE EXCEPTION 'Issuer CREATE forbidden' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' AND c.relkind IN ('r','p','v','m','f','S') AND NOT (n.nspname='extensions' AND c.relname IN ('pg_stat_statements','pg_stat_statements_info') AND c.relkind='v' AND NOT has_schema_privilege(current_user,n.oid,'USAGE') AND EXISTS(SELECT FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='pg_stat_statements')) AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR (c.relkind<>'S' AND has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) OR (c.relkind='S' AND has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE')))) THEN RAISE EXCEPTION 'Issuer direct relation privilege forbidden' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prosecdef AND has_function_privilege(current_user,p.oid,'EXECUTE') AND NOT(p.oid=ANY(allowed))) THEN RAISE EXCEPTION 'Issuer unexpected definer privilege' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('ok',true,'role',current_user);
END $$;
REVOKE ALL ON FUNCTION public.ops_oauth_runtime_check() FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp;
GRANT EXECUTE ON FUNCTION public.ops_oauth_runtime_check() TO medpruf_ops_oauth;
-- Managed Postgres administrators cannot alter SUPERUSER/BYPASSRLS flags.
-- Verify existing roles fail closed rather than attempting privileged downgrades.
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='medpruf_ops_oauth' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication))
 THEN RAISE EXCEPTION 'Unsafe existing Ops role' USING ERRCODE='42501'; END IF;
END $$;
ALTER ROLE medpruf_ops_oauth NOLOGIN NOINHERIT;
GRANT USAGE ON SCHEMA public TO medpruf_ops_oauth;
ALTER TABLE public.ops_principals ADD COLUMN oauth_client_id text;
CREATE UNIQUE INDEX ops_oauth_principal_identity ON public.ops_principals(delegating_user_id,oauth_client_id,environment,audience) WHERE oauth_client_id IS NOT NULL;
CREATE TABLE public.ops_oauth_records(
 model text NOT NULL CHECK(model IN ('Session','Interaction','Grant','AuthorizationCode','AccessToken','RefreshToken','Client','RegistrationAccessToken')),
 id_hash text NOT NULL CHECK(id_hash ~ '^[a-f0-9]{64}$'), ciphertext text NOT NULL CHECK(length(ciphertext) BETWEEN 24 AND 100000),
 expires_at timestamptz NOT NULL, consumed_at bigint, uid_hash text, user_code_hash text, grant_hash text,
 PRIMARY KEY(model,id_hash)
);
CREATE INDEX ops_oauth_uid ON public.ops_oauth_records(model,uid_hash);
CREATE INDEX ops_oauth_grant ON public.ops_oauth_records(grant_hash);
CREATE TABLE public.ops_oauth_tokens(
 id_hash text PRIMARY KEY,credential_id uuid NOT NULL REFERENCES public.ops_credentials(id),grant_hash text NOT NULL
);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['ops_oauth_records','ops_oauth_tokens'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp,medpruf_ops_oauth',n);
 END LOOP;
END $$;

-- Only the MedPruf app's signed-session owner route calls this function.
-- The issuer login cannot create principals or expand consented grants.
CREATE FUNCTION public.ops_oauth_owner_consent(p_actor_id uuid,p_client_id text,p_environment text,p_audience text,p_scopes text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.ops_principals%ROWTYPE; s text; BEGIN
 PERFORM public.ops_require_owner(p_actor_id);
 IF p_client_id IS NULL OR p_environment IS NULL OR p_audience IS NULL OR p_scopes IS NULL
 OR array_position(p_scopes,NULL) IS NOT NULL OR cardinality(p_scopes)<>(SELECT count(DISTINCT x) FROM unnest(p_scopes) x)
 OR p_client_id !~ '^https://chatgpt[.]com/oauth(/[-A-Za-z0-9_]+)?/client[.]json$'
 OR p_environment NOT IN ('development','staging','production')
 OR (p_audience !~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/mcp$' AND NOT(p_environment='development' AND p_audience ~ '^http://(localhost|127[.]0[.]0[.]1):[0-9]{1,5}/mcp$'))
 OR cardinality(p_scopes) NOT BETWEEN 1 AND 15 THEN RAISE EXCEPTION 'Invalid consent' USING ERRCODE='22023'; END IF;
 FOREACH s IN ARRAY p_scopes LOOP
  IF s NOT IN ('users.read','users.sessions.read','users.notes.read','content.read','content.moderate','feedback.read','feedback.manage','users.entitlements.write','revenue.read','overview.read','system.read')
  OR NOT public.admin_actor_has_permission(p_actor_id,s) THEN RAISE EXCEPTION 'Scope not permitted' USING ERRCODE='42501'; END IF;
 END LOOP;
 INSERT INTO public.ops_principals(name,project,environment,audience,delegating_user_id,oauth_client_id)
 VALUES('ChatGPT owner delegation','medpruf',p_environment,p_audience,p_actor_id,p_client_id)
 ON CONFLICT(delegating_user_id,oauth_client_id,environment,audience) WHERE oauth_client_id IS NOT NULL
 DO UPDATE SET active=true RETURNING * INTO p;
 -- Changing consent revokes previous tokens before replacing grants.
 UPDATE public.ops_credentials SET revoked_at=coalesce(revoked_at,now()) WHERE principal_id=p.id;
 DELETE FROM public.ops_oauth_records WHERE grant_hash IN (
   SELECT t.grant_hash FROM public.ops_oauth_tokens t JOIN public.ops_credentials c ON c.id=t.credential_id WHERE c.principal_id=p.id
 );
 DELETE FROM public.ops_grants WHERE principal_id=p.id;
 INSERT INTO public.ops_grants SELECT p.id,unnest(p_scopes) ON CONFLICT DO NOTHING;
 INSERT INTO public.ops_audit(principal_id,actor_id,event) VALUES(p.id,p_actor_id,'oauth.consent');
 RETURN jsonb_build_object('principal_id',p.id,'scopes',p_scopes);
END $$;

CREATE FUNCTION public.ops_oauth_put(p_model text,p_id_hash text,p_ciphertext text,p_expires_at timestamptz,p_uid_hash text,p_user_code_hash text,p_grant_hash text,p_binding jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.ops_principals%ROWTYPE; cid uuid; scopes text[]; BEGIN
 IF p_expires_at<=now() OR p_expires_at>now()+interval '31 days' OR p_id_hash !~ '^[a-f0-9]{64}$'
 OR (p_uid_hash IS NOT NULL AND p_uid_hash !~ '^[a-f0-9]{64}$')
 OR (p_user_code_hash IS NOT NULL AND p_user_code_hash !~ '^[a-f0-9]{64}$')
 OR (p_grant_hash IS NOT NULL AND p_grant_hash !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'Invalid issuer record' USING ERRCODE='22023'; END IF;
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
CREATE FUNCTION public.ops_oauth_get(p_model text,p_kind text,p_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.ops_oauth_records%ROWTYPE; BEGIN
 IF p_kind NOT IN ('id','uid','user_code') OR p_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid issuer lookup' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM public.ops_oauth_records WHERE model=p_model AND expires_at>now() AND
 CASE p_kind WHEN 'id' THEN id_hash=p_hash WHEN 'uid' THEN uid_hash=p_hash ELSE user_code_hash=p_hash END;
 IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
 RETURN jsonb_build_object('idHash',r.id_hash,'ciphertext',r.ciphertext,'expiresAt',extract(epoch FROM r.expires_at)::bigint,'consumedAt',r.consumed_at);
END $$;
CREATE FUNCTION public.ops_oauth_consume(p_model text,p_id_hash text,p_consumed_at bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.ops_oauth_records SET consumed_at=p_consumed_at WHERE model=p_model AND id_hash=p_id_hash AND consumed_at IS NULL AND expires_at>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'Issuer artifact already consumed' USING ERRCODE='40001'; END IF;
 RETURN '{}'::jsonb;
END $$;
CREATE FUNCTION public.ops_oauth_destroy(p_model text,p_id_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_model='AccessToken' THEN UPDATE public.ops_credentials SET revoked_at=coalesce(revoked_at,now()) WHERE id IN (SELECT credential_id FROM public.ops_oauth_tokens WHERE id_hash=p_id_hash); END IF;
 DELETE FROM public.ops_oauth_records WHERE model=p_model AND id_hash=p_id_hash;
 RETURN '{}'::jsonb;
END $$;
CREATE FUNCTION public.ops_oauth_revoke_grant(p_grant_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.ops_credentials SET revoked_at=coalesce(revoked_at,now()) WHERE id IN (SELECT credential_id FROM public.ops_oauth_tokens WHERE grant_hash=p_grant_hash);
 DELETE FROM public.ops_oauth_records WHERE grant_hash=p_grant_hash;
 RETURN '{}'::jsonb;
END $$;
CREATE FUNCTION public.ops_oauth_account(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.ops_principals%ROWTYPE; BEGIN
 SELECT * INTO p FROM public.ops_principals WHERE id=p_id AND active AND oauth_client_id IS NOT NULL;
 IF NOT FOUND THEN RETURN 'null'::jsonb; END IF;
 PERFORM public.ops_require_owner(p.delegating_user_id);
 RETURN jsonb_build_object('principal_id',p.id,'audience',p.audience,'environment',p.environment,'client_id',p.oauth_client_id,'scopes',coalesce((SELECT jsonb_agg(permission) FROM public.ops_grants WHERE principal_id=p.id),'[]'::jsonb));
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'ops_oauth_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,medpruf_ops_mcp,medpruf_ops_oauth',f.signature);
  IF f.proname='ops_oauth_owner_consent' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  ELSE EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO medpruf_ops_oauth',f.signature); END IF;
 END LOOP;
END $$;
