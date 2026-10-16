-- a-renew-early (UNAPPLIED; the post-6 Nov window's single migration slot).
-- Rollback: scripts/sql/track-a/a-renew-early/down.sql. Proof:
-- npm run test:db:renew-early on a throwaway PostgreSQL 16.
--
-- grant_whop_paid_subscription_pinned: the atomic paid grant (same receipts,
-- locks, replay and history adoption as grant_whop_paid_subscription, which
-- stays in place untouched), but the row it writes follows the payment's
-- Whop membership:
--   1. a live Whop row pinned to this membership: extend it in place (a
--      renewal of that membership);
--   2. otherwise, when live Whop coverage pinned to ANOTHER real membership
--      exists: a NEW row pinned to this membership that starts where the
--      coverage ends (an early renewal or a switch to a longer pass). A
--      membership-only revoke of either membership then flips only its row,
--      and a refund of the older payment pulls the stacked row forward
--      (commit_whop_revoke's stacked-row rule);
--   3. otherwise (no real membership id, only unpinned live rows, a
--      non-expiring row, or no coverage): exactly today's rule, extend the
--      newest live row or insert from now.
--
-- commit_whop_revoke (replaced, same signature, ACL re-stated): one branch is
-- added. A membership-only cancellation (no payment candidates) of an active
-- STACKED row (started after its own first grant) that still runs keeps the
-- row active to its expires_at instead of flipping it: Whop bills the new
-- membership from its purchase while the row runs from the old end, so a
-- deactivation at Whop's period end would otherwise take the paid days. Every
-- other path is byte for byte 20261014110000 (rollback restores it).
-- The app calls it only while this changeset is applied
-- (src/lib/whop-grant.ts falls back to the old function while
-- WHOP_EXTENSIONS_ENABLED is off and refuses otherwise).

CREATE OR REPLACE FUNCTION public.grant_whop_paid_subscription_pinned(
  p_user_id uuid, p_tier text, p_payment_id text,
  p_amount_cents integer, p_currency text, p_duration_months integer,
  p_membership_id text DEFAULT NULL
)
RETURNS TABLE (
  mode text, subscription_id uuid, expires_at timestamptz,
  previous_expires_at timestamptz, replayed boolean, entitlement_reconciled boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  u public.users%ROWTYPE;
  s public.subscriptions%ROWTYPE;
  receipt public.whop_paid_grant_receipts%ROWTYPE;
  current_time_utc timestamptz;
  base_utc timestamp;
  final_expiry timestamptz;
  previous_expiry timestamptz;
  grant_mode text;
  is_replay boolean := false;
  pin text;
  other_pinned integer := 0;
  unbounded boolean := false;
  cover_end timestamptz;
  stack_start timestamptz;
BEGIN
  PERFORM set_config('lock_timeout','200ms',true);
  IF current_setting('transaction_timeout',true) IS NOT NULL THEN
    PERFORM set_config('transaction_timeout','2s',true);
  END IF;
  IF p_payment_id IS NULL OR btrim(p_payment_id) = '' OR
     p_duration_months IS NULL OR p_duration_months < 1 OR p_duration_months > 120 THEN
    RAISE EXCEPTION 'Invalid paid grant arguments' USING ERRCODE = '22023';
  END IF;
  -- Only a real membership (mem_) id is ever a pin (a-stability).
  pin := CASE WHEN p_membership_id ~ '^mem_[A-Za-z0-9]+$' THEN p_membership_id END;
  PERFORM pg_advisory_xact_lock(hashtextextended('whop-paid:' || p_payment_id, 0));
  SELECT * INTO STRICT u FROM public.users WHERE id = p_user_id FOR UPDATE;
  current_time_utc := clock_timestamp();

  SELECT * INTO receipt FROM public.whop_paid_grant_receipts r WHERE r.payment_id = p_payment_id;
  IF FOUND THEN
    IF receipt.user_id <> p_user_id THEN
      RAISE EXCEPTION 'Payment belongs to another user' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT receipt.grant_mode, receipt.subscription_id,
      receipt.granted_expires_at, receipt.previous_expires_at, true, true;
    RETURN;
  END IF;

  SELECT * INTO s FROM public.subscriptions sub
    WHERE sub.payment_provider = 'whop' AND
      (sub.provider_payment_id = p_payment_id OR
       sub.granted_payment_ids @> jsonb_build_array(jsonb_build_object('payment_id', p_payment_id)))
    ORDER BY sub.created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF s.user_id <> p_user_id THEN
      RAISE EXCEPTION 'Payment belongs to another user' USING ERRCODE = '22023';
    END IF;
    IF s.status <> 'active' OR (s.expires_at IS NOT NULL AND s.expires_at <= current_time_utc) THEN
      RAISE EXCEPTION 'Previously granted payment is no longer active' USING ERRCODE = '22023';
    END IF;
    IF s.expires_at IS NULL THEN
      IF u.role IS DISTINCT FROM 'admin' AND u.tier IS DISTINCT FROM 'admin' THEN
        UPDATE public.users SET tier = 'pro', tier_expires_at = NULL, updated_at = current_time_utc
          WHERE id = p_user_id;
      END IF;
      RETURN QUERY SELECT 'extended'::text, s.id, s.expires_at, s.expires_at, true, true;
      RETURN;
    END IF;
    final_expiry := s.expires_at;
    previous_expiry := s.expires_at;
    grant_mode := 'extended';
    is_replay := true;
  ELSE
    -- Lock every live Whop row of the user before deciding (user-first order,
    -- as in the months function and commit_whop_revoke).
    PERFORM 1 FROM public.subscriptions sub
      WHERE sub.user_id = p_user_id AND sub.payment_provider = 'whop' AND sub.status = 'active'
        AND (sub.expires_at IS NULL OR sub.expires_at > current_time_utc)
      ORDER BY sub.id FOR UPDATE;
    s := NULL;
    IF pin IS NOT NULL THEN
      -- (1) A renewal of this membership: its own live row.
      SELECT * INTO s FROM public.subscriptions sub
        WHERE sub.user_id = p_user_id AND sub.payment_provider = 'whop' AND sub.status = 'active'
          AND (sub.expires_at IS NULL OR sub.expires_at > current_time_utc)
          AND sub.whop_membership_id = pin
        ORDER BY sub.expires_at DESC NULLS FIRST LIMIT 1;
      IF s.id IS NULL THEN
        SELECT count(*) FILTER (WHERE sub.whop_membership_id ~ '^mem_[A-Za-z0-9]+$'),
               coalesce(bool_or(sub.expires_at IS NULL), false), max(sub.expires_at)
          INTO other_pinned, unbounded, cover_end
          FROM public.subscriptions sub
          WHERE sub.user_id = p_user_id AND sub.payment_provider = 'whop' AND sub.status = 'active'
            AND (sub.expires_at IS NULL OR sub.expires_at > current_time_utc);
      END IF;
    END IF;

    IF s.id IS NULL AND pin IS NOT NULL AND other_pinned > 0 AND NOT unbounded THEN
      -- (2) A new membership while other pinned coverage runs: its own row,
      -- starting where that coverage ends.
      stack_start := greatest(cover_end, current_time_utc);
      base_utc := stack_start AT TIME ZONE 'UTC';
      final_expiry := (date_trunc('month', base_utc) + make_interval(months => p_duration_months)
        + (base_utc - date_trunc('month', base_utc))) AT TIME ZONE 'UTC';
      previous_expiry := cover_end;
      grant_mode := 'inserted';
      INSERT INTO public.subscriptions(user_id, tier, status, payment_provider, payment_method,
        amount_cents, currency, provider_payment_id, granted_payment_ids, whop_membership_id,
        started_at, expires_at)
      VALUES (p_user_id, p_tier, 'active', 'whop', 'card', p_amount_cents, p_currency, p_payment_id,
        jsonb_build_array(jsonb_build_object('payment_id', p_payment_id, 'amount_cents', p_amount_cents,
          'added_months', p_duration_months, 'granted_at', current_time_utc)), pin,
        stack_start, final_expiry) RETURNING * INTO s;
    ELSE
      IF s.id IS NULL THEN
        -- (3) Today's rule: the newest live row, or none.
        SELECT * INTO s FROM public.subscriptions sub
          WHERE sub.user_id = p_user_id AND sub.payment_provider = 'whop' AND sub.status = 'active'
            AND (sub.expires_at IS NULL OR sub.expires_at > current_time_utc)
          ORDER BY sub.expires_at DESC NULLS FIRST LIMIT 1;
      END IF;
      previous_expiry := s.expires_at;
      base_utc := greatest(coalesce(s.expires_at, current_time_utc), current_time_utc) AT TIME ZONE 'UTC';
      final_expiry := (date_trunc('month', base_utc) + make_interval(months => p_duration_months)
        + (base_utc - date_trunc('month', base_utc))) AT TIME ZONE 'UTC';
      IF s.id IS NOT NULL THEN
        grant_mode := 'extended';
        UPDATE public.subscriptions SET expires_at = final_expiry,
          provider_payment_id = p_payment_id,
          amount_cents = coalesce(p_amount_cents, s.amount_cents),
          currency = coalesce(nullif(p_currency, ''), s.currency, 'EUR'),
          granted_payment_ids = coalesce(s.granted_payment_ids, '[]'::jsonb) ||
            jsonb_build_array(jsonb_build_object('payment_id', p_payment_id,
              'amount_cents', p_amount_cents, 'added_months', p_duration_months,
              'granted_at', current_time_utc)),
          -- Never re-pin a row to another membership (only an unpinned or
          -- legacy mber_ row takes the pin).
          whop_membership_id = CASE WHEN s.whop_membership_id ~ '^mem_[A-Za-z0-9]+$'
            THEN s.whop_membership_id ELSE coalesce(pin, s.whop_membership_id) END,
          updated_at = current_time_utc WHERE id = s.id;
      ELSE
        grant_mode := 'inserted';
        INSERT INTO public.subscriptions(user_id, tier, status, payment_provider, payment_method,
          amount_cents, currency, provider_payment_id, granted_payment_ids, whop_membership_id,
          started_at, expires_at)
        VALUES (p_user_id, p_tier, 'active', 'whop', 'card', p_amount_cents, p_currency, p_payment_id,
          jsonb_build_array(jsonb_build_object('payment_id', p_payment_id, 'amount_cents', p_amount_cents,
            'added_months', p_duration_months, 'granted_at', current_time_utc)), pin,
          current_time_utc, final_expiry) RETURNING * INTO s;
      END IF;
    END IF;
  END IF;

  IF u.role IS DISTINCT FROM 'admin' AND u.tier IS DISTINCT FROM 'admin'
      AND NOT (u.tier = 'pro' AND u.tier_expires_at IS NULL) THEN
    UPDATE public.users SET tier = 'pro',
      tier_expires_at = greatest(u.tier_expires_at, final_expiry), updated_at = current_time_utc
      WHERE id = p_user_id;
  END IF;
  INSERT INTO public.whop_paid_grant_receipts(payment_id, user_id, subscription_id,
    grant_mode, granted_expires_at, previous_expires_at)
    VALUES(p_payment_id, p_user_id, s.id, grant_mode, final_expiry, previous_expiry);
  RETURN QUERY SELECT grant_mode, s.id, final_expiry, previous_expiry, is_replay, true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.grant_whop_paid_subscription_pinned(uuid,text,text,integer,text,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_whop_paid_subscription_pinned(uuid,text,text,integer,text,integer,text)
  TO service_role;

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
 row_entries jsonb; is_affected boolean; stacked boolean; first_grant timestamptz; invalid_grants integer;
 action text; queue_end timestamptz := 'epoch'; queue_unbounded boolean := false; changed_before boolean := false;
 trial_end timestamptz; whop_cover_any boolean; whop_cover_unbounded boolean; whop_cover_end timestamptz;
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
    (sub.status='active' AND (sub.provider_payment_id=ANY(p_payment_candidates) OR
     EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(sub.granted_payment_ids,'[]')) e
      WHERE e->>'payment_id'=ANY(p_payment_candidates)))));

 -- A membership identifies the user, not proof that a payment granted time.
 -- Leave the claim unconsumed so a later corrected ledger can be retried.
 -- provider_payment_id is written by the grant, so it is proof of payment
 -- even on a pre-history row whose granted_payment_ids is empty.
 IF coalesce(cardinality(p_payment_candidates),0)>0 AND NOT EXISTS(
   SELECT 1 FROM subscriptions sub WHERE sub.id=ANY(affected_ids) AND (sub.provider_payment_id=ANY(p_payment_candidates) OR
     EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(sub.granted_payment_ids,'[]')) e
       WHERE e->>'payment_id'=ANY(p_payment_candidates)))
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
 -- An owner expiry (including NULL) explained by current Whop coverage is
 -- subscription-owned, never an independent grant, even when it outlasts the
 -- affected rows (a dependent stacked row or a non-expiring Whop row).
 SELECT count(*)>0,coalesce(bool_or(sub.expires_at IS NULL),false),max(sub.expires_at)
 INTO whop_cover_any,whop_cover_unbounded,whop_cover_end FROM subscriptions sub
 WHERE sub.user_id=p_user_id AND sub.payment_provider='whop' AND sub.status='active'
   AND (sub.expires_at IS NULL OR sub.expires_at>now_at);
 independent:=u.role='admin' OR u.tier='admin' OR (u.tier='pro' AND
   NOT (whop_cover_any AND u.tier_expires_at IS NOT DISTINCT FROM
     CASE WHEN whop_cover_unbounded THEN NULL ELSE whop_cover_end END) AND
   (u.tier_expires_at IS NULL OR (u.tier_expires_at>now_at AND u.tier_expires_at>coalesce(affected_expiry,'-infinity'))));
 INSERT INTO processed_webhook_events(provider,event_id,payload)
 VALUES('whop',p_claim_key,jsonb_build_object('claimed_at',now_at,'event',p_event,'kind',p_kind))
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS claim_count=ROW_COUNT;
 IF claim_count=0 THEN RETURN QUERY SELECT kept,flipped,false,false,false,true; RETURN; END IF;
 -- Walk affected and active Whop rows in queue order. A legacy stacked row
 -- (window starting after its own first payment) is rebuilt after the latest
 -- surviving earlier row, never after time this refund removed.
 FOR s IN SELECT * FROM subscriptions sub WHERE sub.id=ANY(affected_ids) OR
     (sub.user_id=p_user_id AND sub.payment_provider='whop' AND sub.status='active')
   ORDER BY sub.started_at NULLS FIRST,sub.id LOOP
  is_affected:=s.id=ANY(affected_ids);
  matched:=NULL;
  SELECT value->>'payment_id' INTO matched FROM jsonb_array_elements(coalesce(s.granted_payment_ids,'[]'))
    WHERE value->>'payment_id'=ANY(p_payment_candidates) LIMIT 1;
  IF matched IS NULL AND s.provider_payment_id=ANY(p_payment_candidates) AND s.status IS DISTINCT FROM p_kind THEN
   matched:=s.provider_payment_id;
  END IF;
  SELECT coalesce(jsonb_agg(e.value ORDER BY e.ord),'[]') INTO row_entries
    FROM jsonb_array_elements(coalesce(s.granted_payment_ids,'[]')) WITH ORDINALITY e(value,ord)
    WHERE nullif(e.value->>'payment_id','') IS NOT NULL;
  -- Verify-first trial rows written before trial provenance carry no
  -- zero-month entry. Reconstruct the trial from started_at only when every
  -- recorded payment came later (a paid-created row starts at its grant).
  IF s.tier='notes_pro_trial' AND s.started_at IS NOT NULL AND isfinite(s.started_at) AND NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(row_entries) e WHERE e->'added_months'='0'::jsonb OR NOT CASE
       WHEN pg_input_is_valid(e->>'granted_at','timestamptz')
       THEN (e->>'granted_at')::timestamptz>s.started_at+interval '60 seconds' ELSE false END) THEN
   row_entries:=jsonb_build_array(jsonb_build_object('payment_id','trial:'||s.id::text,'amount_cents',0,
     'added_months',0,'granted_at',s.started_at)) || row_entries;
  END IF;
  SELECT count(*) FILTER (WHERE NOT coalesce(pg_input_is_valid(e->>'granted_at','timestamptz'),false)),
    min(CASE WHEN pg_input_is_valid(e->>'granted_at','timestamptz') THEN (e->>'granted_at')::timestamptz END)
  INTO invalid_grants,first_grant FROM jsonb_array_elements(row_entries) e;
  stacked:=s.started_at IS NOT NULL AND invalid_grants=0 AND first_grant IS NOT NULL AND isfinite(first_grant)
    AND s.started_at>first_grant+interval '60 seconds';
  -- Payment revokes must not flip a sibling membership row without a match.
  -- Such a row is untouched, though it may still depend on the queue.
  IF coalesce(cardinality(p_payment_candidates),0)>0 AND matched IS NULL THEN is_affected:=false; END IF;
  action:='none';
  IF is_affected AND p_kind='cancelled' AND s.status='active' AND s.tier='notes_pro_trial'
     AND coalesce(s.amount_cents,0)=0 AND s.expires_at>now_at
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(row_entries) e
       WHERE e->'added_months' IS DISTINCT FROM '0'::jsonb) THEN
   kept:=array_append(kept,s.id);
  ELSIF is_affected AND matched IS NULL AND p_kind='cancelled' AND coalesce(cardinality(p_payment_candidates),0)=0
     AND stacked AND s.status='active' AND s.expires_at IS NOT NULL AND s.expires_at>now_at THEN
   -- a-renew-early (reviewer P1): a membership-only cancellation of a row
   -- queued behind earlier time (an early renewal or a switch) keeps its
   -- paid window. Whop bills that membership from its purchase, our row runs
   -- from the old end, so its period ends before the row does; flipping it
   -- would take the paid days. Refunds and disputes name payments and still
   -- go through the survivor rebuild below. The row ends at expires_at.
   kept:=array_append(kept,s.id);
  ELSIF is_affected AND matched IS NULL THEN
   UPDATE subscriptions SET status=p_kind,cancelled_at=now_at,granted_payment_ids=coalesce(s.granted_payment_ids,'[]'),updated_at=now_at WHERE id=s.id;
   flipped:=array_append(flipped,s.id); action:='flip';
  ELSIF is_affected OR (coalesce(cardinality(p_payment_candidates),0)>0 AND changed_before AND stacked
     AND s.status='active' AND NOT queue_unbounded AND s.expires_at IS NOT NULL) THEN
   row_grants:='{}';
   FOR entry IN SELECT value FROM jsonb_array_elements(row_entries) LOOP
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
   end_at:=CASE WHEN stacked THEN queue_end ELSE 'epoch'::timestamptz END;
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
     -- The original trial: its recorded end (within a month of the grant),
     -- else 7 days plus the 1-day floor. It never extends paid time.
     trial_end:=CASE WHEN coalesce(pg_input_is_valid(entry->>'trial_ends_at','timestamptz'),false)
       THEN (entry->>'trial_ends_at')::timestamptz END;
     IF trial_end IS NULL OR NOT isfinite(trial_end) OR trial_end<granted_at OR trial_end>granted_at+interval '31 days' THEN
      trial_end:=granted_at+interval '192 hours';
     END IF;
     end_at:=greatest(end_at,trial_end);
     CONTINUE;
    END IF;
    end_at:=(date_trunc('month',base_utc)+make_interval(months=>added)
       +(base_utc-date_trunc('month',base_utc))) AT TIME ZONE 'UTC';
   END LOOP;
   -- A refund never extends a row beyond its stored window.
   IF s.expires_at IS NOT NULL AND end_at>s.expires_at THEN end_at:=s.expires_at; END IF;
   IF is_affected THEN
    changed_before:=true;
    IF s.status='active' AND jsonb_array_length(survivors)>0 AND end_at>now_at THEN
     -- A paid renewal may have retained notes_pro_trial. Restore the zero-only
     -- survivor amount so membership deactivation preserves the original trial.
     UPDATE subscriptions SET expires_at=end_at,granted_payment_ids=survivors,
       amount_cents=CASE WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(survivors) e
         WHERE (e->>'added_months')::integer<>0) THEN 0 ELSE s.amount_cents END,
       provider_payment_id=survivors->(jsonb_array_length(survivors)-1)->>'payment_id',updated_at=now_at WHERE id=s.id;
     kept:=array_append(kept,s.id); action:='keep';
    ELSE
     -- Clean history and revoke in the SAME write, including inactive matches.
     UPDATE subscriptions SET status=p_kind,cancelled_at=now_at,granted_payment_ids=survivors,
       amount_cents=CASE WHEN jsonb_array_length(survivors)>0 AND
         NOT EXISTS(SELECT 1 FROM jsonb_array_elements(survivors) e WHERE (e->>'added_months')::integer<>0)
         THEN 0 ELSE s.amount_cents END,updated_at=now_at WHERE id=s.id;
     flipped:=array_append(flipped,s.id); action:='flip';
     -- Surviving paid time that already elapsed still precedes later queued
     -- rows; only a row with no surviving payment leaves the queue.
     IF s.status='active' AND jsonb_array_length(survivors)>0 AND end_at>queue_end THEN queue_end:=end_at; END IF;
    END IF;
   ELSIF end_at<s.expires_at THEN
    -- Untouched dependent stacked row: it loses the queue time removed above.
    UPDATE subscriptions SET expires_at=end_at,updated_at=now_at WHERE id=s.id;
    action:='keep';
   END IF;
  END IF;
  IF action<>'flip' AND s.status='active' THEN
   IF action='keep' THEN
    IF end_at>queue_end THEN queue_end:=end_at; END IF;
   ELSIF s.expires_at IS NULL THEN queue_unbounded:=true;
   ELSIF s.expires_at>queue_end THEN queue_end:=s.expires_at;
   END IF;
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
   -- Surviving coverage establishes Pro as well as its window: a preceding
   -- grant may have written the subscription but not the user.
   UPDATE users SET tier='pro',tier_expires_at=end_at,updated_at=now_at WHERE id=p_user_id;
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
