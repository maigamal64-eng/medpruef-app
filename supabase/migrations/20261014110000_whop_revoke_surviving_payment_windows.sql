-- Follow-up to 20261007110000 (published in production as 20261007032144).
-- Rebuild refunded windows from surviving grants, never stacked row starts.
-- Keep the RPC signature, user-first locking, snapshot check and service ACL.
CREATE OR REPLACE FUNCTION public.commit_whop_revoke(
  p_user_id uuid,p_claim_key text,p_kind text,p_event text,
  p_expected_subscriptions jsonb,p_payment_candidates text[],p_grace_days double precision DEFAULT 7
)
RETURNS TABLE(kept_active_ids uuid[],flipped_ids uuid[],pro_revoked boolean,
  had_other_active boolean,dunning_deferred boolean,replayed boolean)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
 u public.users%ROWTYPE; s public.subscriptions%ROWTYPE;
 expected jsonb; entry jsonb; matched text; survivors jsonb;
 owners jsonb := '{}'; canonical jsonb := '{}'; row_grants jsonb; affected_ids uuid[]; payment_id text;
 now_at timestamptz; affected_expiry timestamptz; independent boolean;
 end_at timestamptz; granted_at timestamptz; base_utc timestamp; added integer;
 kept uuid[] := '{}'; flipped uuid[] := '{}'; revoked boolean := false;
 covered boolean; dunning boolean := false; claim_count integer;
BEGIN
 PERFORM set_config('lock_timeout','200ms',true);
 IF current_setting('transaction_timeout',true) IS NOT NULL THEN
  PERFORM set_config('transaction_timeout','2s',true);
 END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('refunded','cancelled') OR p_claim_key IS NULL OR
    jsonb_typeof(p_expected_subscriptions) IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_expected_subscriptions)=0 THEN
  RAISE EXCEPTION 'Invalid revoke arguments' USING ERRCODE='22023';
 END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_expected_subscriptions)) <> jsonb_array_length(p_expected_subscriptions) THEN
  RAISE EXCEPTION 'Duplicate subscription snapshot' USING ERRCODE='22023';
 END IF;
 SELECT * INTO STRICT u FROM users usr WHERE usr.id=p_user_id FOR UPDATE;
 now_at:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM processed_webhook_events WHERE provider='whop' AND event_id=p_claim_key) THEN
  RETURN QUERY SELECT kept,flipped,false,false,false,true; RETURN;
 END IF;
 -- Lock all coverage, not just affected rows, in one consistent order.
 PERFORM sub.id FROM subscriptions sub WHERE sub.user_id=p_user_id ORDER BY sub.id FOR UPDATE;
 FOR expected IN SELECT value FROM jsonb_array_elements(p_expected_subscriptions) LOOP
  SELECT * INTO s FROM subscriptions sub WHERE sub.id=(expected->>'id')::uuid;
  IF NOT FOUND OR s.user_id IS DISTINCT FROM p_user_id OR s.payment_provider IS DISTINCT FROM 'whop' OR
    s.status IS DISTINCT FROM expected->>'status' OR
    s.tier IS DISTINCT FROM expected->>'tier' OR
    s.expires_at IS DISTINCT FROM (expected->>'expires_at')::timestamptz OR
    s.started_at IS DISTINCT FROM (expected->>'started_at')::timestamptz OR
    s.amount_cents IS DISTINCT FROM (expected->>'amount_cents')::integer OR
    s.provider_payment_id IS DISTINCT FROM expected->>'provider_payment_id' OR
    s.whop_membership_id IS DISTINCT FROM expected->>'whop_membership_id' OR
    coalesce(s.granted_payment_ids,'[]') IS DISTINCT FROM coalesce(nullif(expected->'granted_payment_ids','null'::jsonb),'[]') THEN
   RAISE EXCEPTION 'Subscription changed; retry revoke from fresh ledger' USING ERRCODE='40001';
  END IF;
 END LOOP;

 -- The caller may have found only the latest provider payment. Include every
 -- active copy of a refunded history entry under the same row locks.
 SELECT array_agg(sub.id ORDER BY sub.started_at NULLS FIRST,sub.id),max(sub.expires_at)
 INTO affected_ids,affected_expiry FROM subscriptions sub
 WHERE sub.user_id=p_user_id AND sub.payment_provider='whop' AND
   (sub.id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(p_expected_subscriptions)) OR
    (sub.status='active' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(sub.granted_payment_ids,'[]')) e
      WHERE e->>'payment_id'=ANY(p_payment_candidates))));

 -- A membership identifies the user, not proof that a payment granted time.
 -- Leave the claim unconsumed so a later corrected ledger can be retried.
 IF coalesce(cardinality(p_payment_candidates),0)>0 AND NOT EXISTS(
   SELECT 1 FROM subscriptions sub,
     LATERAL jsonb_array_elements(coalesce(sub.granted_payment_ids,'[]')) e
   WHERE sub.id=ANY(affected_ids) AND e->>'payment_id'=ANY(p_payment_candidates)
 ) THEN
  RAISE LOG 'Whop revoke % matched no granted payment for user % (candidates=%)',p_event,p_user_id,p_payment_candidates;
  INSERT INTO user_events(user_id,event_type,event_data)
  VALUES(p_user_id,'whop_revoke_unmatched',jsonb_build_object(
    'event',p_event,'kind',p_kind,'claim_key',p_claim_key,
    'payment_candidates',p_payment_candidates,'reason','no_granted_payment_match','atomic',true));
  SELECT EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.user_id=p_user_id AND sub.status='active'
    AND (sub.expires_at IS NULL OR sub.expires_at>now_at)) INTO covered;
  RETURN QUERY SELECT kept,flipped,false,covered,false,false; RETURN;
 END IF;

 -- Provider ownership takes precedence across ALL active Whop rows. History
 -- ownership is assigned only afterwards, in stable started_at/id order.
 FOR s IN SELECT * FROM subscriptions sub WHERE sub.user_id=p_user_id
   AND sub.payment_provider='whop' AND sub.status='active'
   ORDER BY sub.started_at NULLS FIRST,sub.id LOOP
  IF nullif(s.provider_payment_id,'') IS NOT NULL AND NOT owners ? s.provider_payment_id THEN
   owners:=owners || jsonb_build_object(s.provider_payment_id,s.id::text);
  END IF;
 END LOOP;
 FOR s IN SELECT * FROM subscriptions sub WHERE sub.user_id=p_user_id
   AND sub.payment_provider='whop' AND sub.status='active'
   ORDER BY sub.started_at NULLS FIRST,sub.id LOOP
  FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(s.granted_payment_ids,'[]')) LOOP
   payment_id:=entry->>'payment_id';
   IF nullif(payment_id,'') IS NOT NULL AND NOT coalesce(payment_id=ANY(p_payment_candidates),false) THEN
    IF canonical ? payment_id AND canonical->payment_id IS DISTINCT FROM entry THEN
     RAISE EXCEPTION 'Conflicting surviving payment metadata for %',payment_id USING ERRCODE='22023';
    END IF;
    canonical:=canonical || jsonb_build_object(payment_id,entry);
   END IF;
   IF nullif(payment_id,'') IS NOT NULL AND NOT owners ? payment_id THEN
    owners:=owners || jsonb_build_object(payment_id,s.id::text);
   END IF;
  END LOOP;
 END LOOP;
 independent:=u.role='admin' OR u.tier='admin' OR (u.tier='pro' AND
   (u.tier_expires_at IS NULL OR (u.tier_expires_at>now_at AND u.tier_expires_at>coalesce(affected_expiry,'-infinity'))));
 INSERT INTO processed_webhook_events(provider,event_id,payload)
 VALUES('whop',p_claim_key,jsonb_build_object('claimed_at',now_at,'event',p_event,'kind',p_kind))
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS claim_count=ROW_COUNT;
 IF claim_count=0 THEN RETURN QUERY SELECT kept,flipped,false,false,false,true; RETURN; END IF;
 FOR s IN SELECT * FROM subscriptions sub WHERE sub.id=ANY(affected_ids)
   ORDER BY sub.started_at NULLS FIRST,sub.id LOOP
  SELECT value->>'payment_id' INTO matched FROM jsonb_array_elements(coalesce(s.granted_payment_ids,'[]'))
    WHERE value->>'payment_id'=ANY(p_payment_candidates) LIMIT 1;
  -- Payment revokes must not flip a sibling membership row without a match.
  IF coalesce(cardinality(p_payment_candidates),0)>0 AND matched IS NULL THEN CONTINUE; END IF;
  IF p_kind='cancelled' AND s.status='active' AND s.tier='notes_pro_trial'
     AND coalesce(s.amount_cents,0)=0 AND s.expires_at>now_at THEN
   kept:=array_append(kept,s.id); CONTINUE;
  END IF;
  IF matched IS NULL THEN
   UPDATE subscriptions SET status=p_kind,cancelled_at=now_at,granted_payment_ids=coalesce(s.granted_payment_ids,'[]'),updated_at=now_at WHERE id=s.id;
   flipped:=array_append(flipped,s.id); CONTINUE;
  END IF;
  row_grants:='{}';
  FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(s.granted_payment_ids,'[]')) LOOP
   payment_id:=entry->>'payment_id';
   IF nullif(payment_id,'') IS NULL OR coalesce(payment_id=ANY(p_payment_candidates),false) THEN CONTINUE; END IF;
   IF canonical ? payment_id AND canonical->payment_id IS DISTINCT FROM entry THEN
    RAISE EXCEPTION 'Conflicting surviving payment metadata for %',payment_id USING ERRCODE='22023';
   END IF;
   canonical:=canonical || jsonb_build_object(payment_id,entry);
   IF NOT owners ? payment_id OR owners->>payment_id=s.id::text THEN
    row_grants:=row_grants || jsonb_build_object(payment_id,entry);
   END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(value ORDER BY
    CASE WHEN pg_input_is_valid(value->>'granted_at','timestamptz') THEN (value->>'granted_at')::timestamptz END,
    value->>'payment_id'),'[]') INTO survivors FROM jsonb_each(row_grants);
  end_at:='epoch';
  FOR entry IN SELECT value FROM jsonb_array_elements(survivors)
    ORDER BY CASE WHEN pg_input_is_valid(value->>'granted_at','timestamptz') THEN (value->>'granted_at')::timestamptz END NULLS LAST LOOP
   IF NOT coalesce(pg_input_is_valid(entry->>'granted_at','timestamptz'),false) THEN
    RAISE EXCEPTION 'Invalid surviving granted_at on subscription %',s.id USING ERRCODE='22023';
   END IF;
   granted_at:=(entry->>'granted_at')::timestamptz;
   IF NOT isfinite(granted_at) THEN
    RAISE EXCEPTION 'Invalid surviving granted_at on subscription %',s.id USING ERRCODE='22023';
   END IF;
   base_utc:=greatest(end_at,granted_at) AT TIME ZONE 'UTC';
   IF NOT coalesce(pg_input_is_valid(entry->>'added_months','integer'),false) OR (entry->>'added_months')::integer<0 THEN
    RAISE EXCEPTION 'Invalid surviving payment duration on subscription %',s.id USING ERRCODE='22023';
   END IF;
   added:=(entry->>'added_months')::integer;
   IF added=0 THEN
    -- Original 7-day trial plus 1-day floor, never extend paid time.
    end_at:=greatest(end_at,granted_at+interval '192 hours');
    CONTINUE;
   END IF;
   end_at:=(date_trunc('month',base_utc)+make_interval(months=>added)
      +(base_utc-date_trunc('month',base_utc))) AT TIME ZONE 'UTC';
  END LOOP;
  IF s.status='active' AND jsonb_array_length(survivors)>0 AND end_at>now_at THEN
   UPDATE subscriptions SET expires_at=end_at,granted_payment_ids=survivors,
     provider_payment_id=survivors->(jsonb_array_length(survivors)-1)->>'payment_id',updated_at=now_at WHERE id=s.id;
   kept:=array_append(kept,s.id);
  ELSE
   -- Clean history and revoke in the SAME write, including inactive matches.
   UPDATE subscriptions SET status=p_kind,cancelled_at=now_at,granted_payment_ids=survivors,
     updated_at=now_at WHERE id=s.id;
   flipped:=array_append(flipped,s.id);
  END IF;
 END LOOP;
 -- The kept set includes untouched coverage, even if omitted by the caller.
 SELECT coalesce(array_agg(DISTINCT id ORDER BY id),'{}') INTO kept FROM (
   SELECT unnest(kept) AS id UNION
   SELECT sub.id FROM subscriptions sub WHERE sub.user_id=p_user_id AND sub.status='active'
     AND (sub.expires_at IS NULL OR sub.expires_at>now_at)
 ) covering;
 SELECT EXISTS(SELECT 1 FROM subscriptions sub WHERE sub.user_id=p_user_id AND sub.status='active'
    AND (sub.expires_at IS NULL OR sub.expires_at>now_at)) INTO covered;
 IF NOT independent THEN
  IF cardinality(kept)>0 AND covered THEN
   SELECT CASE WHEN bool_or(sub.expires_at IS NULL) THEN NULL ELSE max(sub.expires_at) END INTO end_at
     FROM subscriptions sub WHERE sub.user_id=p_user_id AND sub.status='active'
       AND (sub.expires_at IS NULL OR sub.expires_at>now_at);
   UPDATE users SET tier_expires_at=end_at,updated_at=now_at WHERE id=p_user_id;
  ELSIF NOT covered THEN
   SELECT EXISTS(SELECT 1 FROM processed_webhook_events WHERE provider='whop'
     AND event_id LIKE 'recover:%' AND payload->>'user_id'=p_user_id::text
     AND processed_at>=now_at-make_interval(secs=>86400*CASE WHEN p_grace_days>0 THEN p_grace_days ELSE 7 END)) INTO dunning;
   IF NOT dunning THEN
    UPDATE users SET tier='free',tier_expires_at=NULL,updated_at=now_at WHERE id=p_user_id;
    revoked:=true;
   END IF;
  END IF;
 END IF;
 RETURN QUERY SELECT kept,flipped,revoked,covered,dunning,false;
END; $$;
REVOKE EXECUTE ON FUNCTION public.commit_whop_revoke(uuid,text,text,text,jsonb,text[],double precision) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_whop_revoke(uuid,text,text,text,jsonb,text[],double precision) TO service_role;
