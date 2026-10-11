\set ON_ERROR_STOP on
\if :{?old_function}
\else
\set old_function false
\endif
-- SCRATCH DATABASE ONLY. Requires the users/subscriptions/webhook/user_events
-- shapes from origin/main, the original revoke migration, then the follow-up.
-- Run with -v old_function=true BEFORE the follow-up to demonstrate failure.
-- Fixtures roll back; all identifiers below are synthetic.
BEGIN;
SET TIME ZONE 'UTC';
CREATE TEMP TABLE fixture_clock AS SELECT
  date_trunc('month',clock_timestamp())+interval '9 hours 51 minutes' AS card_grant;
CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
 RAISE NOTICE 'PASS: %',label;
END $$;
CREATE FUNCTION pg_temp.snapshot(ids uuid[] DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_agg(to_jsonb(s) ORDER BY s.started_at,s.id) FROM subscriptions s
 WHERE s.user_id='00000000-0000-4000-8000-000000000004' AND s.payment_provider='whop'
   AND (ids IS NULL OR s.id=ANY(ids))
$$;
CREATE FUNCTION pg_temp.reset_munir() RETURNS void LANGUAGE plpgsql AS $$
DECLARE g timestamptz; history jsonb;
BEGIN
 TRUNCATE subscriptions,users,processed_webhook_events,user_events;
 SELECT card_grant INTO g FROM fixture_clock;
 history:=jsonb_build_array(
  jsonb_build_object('payment_id','pay_card','amount_cents',1900,'added_months',1,'granted_at',g),
  jsonb_build_object('payment_id','pay_bank','amount_cents',1900,'added_months',1,'granted_at',g+interval '2 hours 23 minutes'));
 INSERT INTO users(id,tier,role,tier_expires_at)
 VALUES('00000000-0000-4000-8000-000000000004','pro','user',g+interval '2 months 2 hours 23 minutes');
 -- Munir's shape: card 09:51 Sep 17 -> Oct 17; bank grant 12:14 Sep 17,
 -- stacked started_at Oct 17 -> Nov 17; BOTH rows list BOTH payments.
 -- Use day 1 of this month: coverage remains future and SQL month clamping
 -- agrees with the JavaScript rollover oracle used by these assertions.
 INSERT INTO subscriptions(id,user_id,tier,status,payment_provider,payment_method,
   amount_cents,started_at,expires_at,provider_payment_id,whop_membership_id,granted_payment_ids)
 VALUES
 ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000004',
  'first_month_19','active','whop','card',1900,g,g+interval '1 month','pay_card','mem_fixture',history),
 ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000004',
  'first_month_19','active','whop','bank_transfer',1900,g+interval '1 month 2 hours 23 minutes',
  g+interval '2 months 2 hours 23 minutes','pay_bank','mem_fixture',history);
END $$;
CREATE FUNCTION pg_temp.assert_munir() RETURNS void LANGUAGE plpgsql AS $$
DECLARE g timestamptz;
BEGIN
 SELECT card_grant INTO g FROM fixture_clock;
 RAISE NOTICE 'Munir actual rows: %, user expiry: %, expected card expiry: %',
  (SELECT jsonb_agg(jsonb_build_object('id',id,'status',status,'expires_at',expires_at) ORDER BY id) FROM subscriptions),
  (SELECT tier_expires_at FROM users),g+interval '1 month';
 PERFORM pg_temp.assert_true((SELECT status='refunded' AND granted_payment_ids='[]' FROM subscriptions
  WHERE id='00000000-0000-4000-8000-000000000102'),'Munir stacked row revoked with cleaned history');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM subscriptions WHERE status='active'),'Munir exactly one active row');
 PERFORM pg_temp.assert_true((SELECT expires_at=g+interval '1 month' AND provider_payment_id='pay_card'
  AND jsonb_array_length(granted_payment_ids)=1 FROM subscriptions
  WHERE id='00000000-0000-4000-8000-000000000101'),'Munir card retains one month');
 PERFORM pg_temp.assert_true((SELECT tier='pro' AND tier_expires_at=g+interval '1 month' FROM users),
  'Munir user expiry is card month, not stacked month');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM subscriptions s,
  LATERAL jsonb_array_elements(s.granted_payment_ids) e WHERE e->>'payment_id'='pay_bank'),
  'Munir refunded payment removed from every history');
END $$;
CREATE TEMP TABLE revoke_failures(mode text);
CREATE FUNCTION pg_temp.fail_revoke_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='subscriptions' THEN
  IF NEW.granted_payment_ids IS DISTINCT FROM OLD.granted_payment_ids AND EXISTS(SELECT 1 FROM revoke_failures WHERE mode='history') THEN
   RAISE EXCEPTION 'injected revoke history failure' USING ERRCODE='P0001';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND EXISTS(SELECT 1 FROM revoke_failures WHERE mode='status') THEN
   RAISE EXCEPTION 'injected revoke status failure' USING ERRCODE='P0001';
  END IF;
 ELSIF EXISTS(SELECT 1 FROM revoke_failures WHERE mode='user') THEN
  RAISE EXCEPTION 'injected revoke user failure' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_revoke_status BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_revoke_write();
CREATE TRIGGER test_revoke_user BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_revoke_write();
CREATE FUNCTION pg_temp.fail_revoke_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM revoke_failures WHERE mode='receipt') THEN
  RAISE EXCEPTION 'injected revoke receipt failure' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_revoke_receipt AFTER INSERT ON processed_webhook_events
 FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_revoke_receipt();
GRANT ALL ON fixture_clock,revoke_failures TO service_role;
SET LOCAL ROLE service_role;
SELECT pg_temp.reset_munir();
SELECT * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:munir','refunded',
 'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
-- Identical assertion for old and new functions. Old exits nonzero here.
SELECT pg_temp.assert_munir();

\if :old_function
\else
-- Function discovers the history-only card row even when omitted by caller.
SELECT pg_temp.reset_munir();
SELECT * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:omitted','refunded',
 'refund.created',pg_temp.snapshot(ARRAY['00000000-0000-4000-8000-000000000102']::uuid[]),ARRAY['pay_bank'],7);
SELECT pg_temp.assert_munir();

-- An affected provider-id row without a matching history must not be flipped
-- when a different row does carry the refund. SQL keeps the kept>0 rule.
SELECT pg_temp.reset_munir();
UPDATE subscriptions SET provider_payment_id='pay_bank',granted_payment_ids=granted_payment_ids->0 || '[]'::jsonb
 WHERE id='00000000-0000-4000-8000-000000000101';
DO $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:sibling','refunded',
  'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
 PERFORM pg_temp.assert_true((SELECT status='active' AND jsonb_array_length(granted_payment_ids)=1 FROM subscriptions
  WHERE id='00000000-0000-4000-8000-000000000101') AND cardinality(r.flipped_ids)=1,
  'mixed match leaves unmatched sibling row paid');
 PERFORM pg_temp.assert_true(cardinality(r.kept_active_ids)=1 AND r.had_other_active
  AND (SELECT tier_expires_at=card_grant+interval '1 month' FROM users,fixture_clock),
  'SQL reconciles surviving coverage with kept>0 AND covered');
END $$;

-- A duplicate must return its receipt even with a stale caller snapshot.
SELECT pg_temp.reset_munir();
SELECT * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:omitted','refunded',
 'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
DO $$
DECLARE before_rows jsonb; before_user jsonb; r record;
BEGIN
 before_rows:=pg_temp.snapshot(); SELECT to_jsonb(u) INTO before_user FROM users u;
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:omitted','refunded',
  'refund.created','[{"id":"00000000-0000-4000-8000-000000000102"}]',ARRAY['pay_bank'],7);
 PERFORM pg_temp.assert_true(r.replayed AND before_rows=pg_temp.snapshot()
  AND before_user=(SELECT to_jsonb(u) FROM users u),'duplicate delivery makes no writes');
END $$;

-- Full refund removes every candidate, clears history and downgrades.
SELECT pg_temp.reset_munir();
DO $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:full','refunded',
  'refund.created',pg_temp.snapshot(),ARRAY['pay_card','pay_bank'],7);
 PERFORM pg_temp.assert_true(cardinality(r.flipped_ids)=2 AND r.pro_revoked,'full refund revokes both rows');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM subscriptions WHERE status='active' OR granted_payment_ids<>'[]'),
  'full refund drops all candidate entries on flipped rows');
 PERFORM pg_temp.assert_true((SELECT tier='free' AND tier_expires_at IS NULL FROM users),'full refund downgrades user');
END $$;

-- Global unmatched rule includes legacy provider-only and membership pins.
SELECT pg_temp.reset_munir();
DO $$
DECLARE before_rows jsonb; before_user jsonb; r record;
BEGIN
 before_rows:=pg_temp.snapshot(); SELECT to_jsonb(u) INTO before_user FROM users u;
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:unknown','refunded',
  'refund.created',pg_temp.snapshot(),ARRAY['pay_never_granted'],7);
 PERFORM pg_temp.assert_true(cardinality(r.flipped_ids)=0 AND cardinality(r.kept_active_ids)=0
  AND NOT r.pro_revoked AND before_rows=pg_temp.snapshot() AND before_user=(SELECT to_jsonb(u) FROM users u),
  'unmatched refund preserves all paid rows and user');
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM user_events WHERE event_type='whop_revoke_unmatched'
  AND event_data->>'reason'='no_granted_payment_match') AND NOT EXISTS(SELECT 1 FROM processed_webhook_events),
  'unmatched refund logs user_event without consuming claim');
 UPDATE subscriptions SET granted_payment_ids='[]';
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:legacy','refunded',
  'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
 PERFORM pg_temp.assert_true(cardinality(r.flipped_ids)=0 AND (SELECT count(*)=2 FROM subscriptions WHERE status='active'),
  'provider id without matching grant history is unmatched');
END $$;

-- Three rows share copied history; provider owners override history owners.
-- Refund TWO ids, pass only one row, and count the third payment exactly once.
SELECT pg_temp.reset_munir();
DO $$
DECLARE g timestamptz; shared jsonb; r record;
BEGIN
 SELECT card_grant INTO g FROM fixture_clock;
 shared:=(SELECT granted_payment_ids FROM subscriptions LIMIT 1)||jsonb_build_array(
  jsonb_build_object('payment_id','pay_third','added_months',1,'granted_at',g+interval '3 hours'));
 UPDATE subscriptions SET granted_payment_ids=shared;
 INSERT INTO subscriptions(id,user_id,tier,status,payment_provider,amount_cents,started_at,expires_at,
   provider_payment_id,granted_payment_ids)
 VALUES('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000004',
   'first_month_19','active','whop',1900,g+interval '2 months',g+interval '3 months','pay_third',shared);
 UPDATE users SET tier_expires_at=g+interval '3 months';
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:multi','refunded',
  'refund.created',pg_temp.snapshot(ARRAY['00000000-0000-4000-8000-000000000102']::uuid[]),ARRAY['pay_card','pay_bank'],7);
 PERFORM pg_temp.assert_true(cardinality(r.flipped_ids)=2 AND cardinality(r.kept_active_ids)=1,'multi-row discovers all copied candidates');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM subscriptions WHERE status='active')
  AND (SELECT tier_expires_at=g+interval '1 month 3 hours' FROM users),'multi-row survivor counted once from grant date');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM subscriptions s,
  LATERAL jsonb_array_elements(s.granted_payment_ids) e WHERE e->>'payment_id'='pay_third'),
  'provider ownership wins over earlier history-only copies');
END $$;

-- History-only duplicate ownership is stable by started_at then id.
SELECT pg_temp.reset_munir();
UPDATE subscriptions SET provider_payment_id='pay_bank',started_at=(SELECT card_grant FROM fixture_clock);
SELECT * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:history-owner','refunded',
 'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
SELECT pg_temp.assert_munir();

-- An exclusive survivor starts from granted_at; multiple grants chain.
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
DO $$
DECLARE g timestamptz; r record;
BEGIN
 SELECT card_grant INTO g FROM fixture_clock;
 UPDATE subscriptions SET granted_payment_ids=granted_payment_ids||jsonb_build_array(
  jsonb_build_object('payment_id','pay_later','added_months',1,'granted_at',g+interval '1 day'));
 UPDATE users SET tier_expires_at=(SELECT expires_at FROM subscriptions);
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:chain','refunded',
  'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
 PERFORM pg_temp.assert_true(cardinality(r.kept_active_ids)=1 AND
  (SELECT expires_at=g+interval '2 months' FROM subscriptions),'exclusive survivors chain greatest(end, granted_at)');
END $$;

-- Invalid surviving dates roll back claim AND every write, never guess.
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
DO $$
DECLARE invalid text; before_rows jsonb; failed boolean;
BEGIN
 FOREACH invalid IN ARRAY ARRAY['invalid',NULL,'infinity'] LOOP
  UPDATE subscriptions SET granted_payment_ids=jsonb_set(granted_payment_ids,'{0,granted_at}',coalesce(to_jsonb(invalid),'null'));
  before_rows:=pg_temp.snapshot(); failed:=false;
  BEGIN
   PERFORM * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:invalid','refunded',
    'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
  EXCEPTION WHEN SQLSTATE '22023' THEN failed:=true;
  END;
  PERFORM pg_temp.assert_true(failed AND before_rows=pg_temp.snapshot()
   AND NOT EXISTS(SELECT 1 FROM processed_webhook_events),'invalid grant rolls back ('||coalesce(invalid,'null')||')');
 END LOOP;
END $$;

-- Dunning membership full revoke keeps finite expiry; no covering row remains.
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000102';
UPDATE users SET tier_expires_at=(SELECT expires_at FROM subscriptions);
INSERT INTO processed_webhook_events(provider,event_id,processed_at,payload)
 VALUES('whop','recover:renewal',clock_timestamp()-interval '1 day',
  '{"user_id":"00000000-0000-4000-8000-000000000004"}');
DO $$
DECLARE r record; original_expiry timestamptz;
BEGIN
 SELECT tier_expires_at INTO original_expiry FROM users;
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','cancel:dunning','cancelled',
  'membership.deactivated',pg_temp.snapshot(),'{}',7);
 PERFORM pg_temp.assert_true(r.dunning_deferred AND NOT r.pro_revoked
  AND (SELECT tier='pro' AND tier_expires_at=original_expiry FROM users),'dunning full revoke preserves finite expiry');
END $$;

-- Preserve non-expiring coverage and independent owner grants.
SELECT pg_temp.reset_munir();
INSERT INTO subscriptions(user_id,tier,status,payment_provider,expires_at)
 VALUES('00000000-0000-4000-8000-000000000004','pro','active','manual',NULL);
SELECT * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:unlimited','refunded',
 'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
SELECT pg_temp.assert_true((SELECT tier='pro' AND tier_expires_at IS NULL FROM users),'null expiry only with real unlimited coverage');
SELECT pg_temp.reset_munir();
UPDATE users SET tier_expires_at=clock_timestamp()+interval '1 year';
SELECT * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:manual','refunded',
 'refund.created',pg_temp.snapshot(),ARRAY['pay_card','pay_bank'],7);
SELECT pg_temp.assert_true((SELECT tier='pro' AND tier_expires_at>clock_timestamp()+interval '11 months' FROM users),
 'independent manual Pro preserved');

-- REVIEW2: trial-before-expiry
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
DO $$
DECLARE g timestamptz:=clock_timestamp()-interval '2 days'; r record;
BEGIN
 UPDATE subscriptions SET started_at=g,expires_at=g+interval '1 month 8 days',
  granted_payment_ids=jsonb_build_array(
   jsonb_build_object('payment_id','pay_trial','amount_cents',0,'added_months',0,'granted_at',g),
   jsonb_build_object('payment_id','pay_bank','amount_cents',1900,'added_months',1,'granted_at',g+interval '1 day'));
 UPDATE users SET tier_expires_at=g+interval '1 month 8 days';
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:trial-before','refunded',
  'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
 PERFORM pg_temp.assert_true(cardinality(r.kept_active_ids)=1 AND NOT r.pro_revoked
  AND (SELECT expires_at=g+interval '8 days' AND jsonb_array_length(granted_payment_ids)=1 FROM subscriptions)
  AND (SELECT tier='pro' AND tier_expires_at=g+interval '8 days' FROM users),'zero-month survivor preserves original eight-day trial');
END $$;

-- REVIEW2: trial-after-expiry
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
DO $$
DECLARE g timestamptz:=clock_timestamp()-interval '10 days'; r record;
BEGIN
 UPDATE subscriptions SET started_at=g,expires_at=g+interval '1 month 8 days',
  granted_payment_ids=jsonb_build_array(
   jsonb_build_object('payment_id','pay_trial','amount_cents',0,'added_months',0,'granted_at',g),
   jsonb_build_object('payment_id','pay_bank','amount_cents',1900,'added_months',1,'granted_at',g+interval '7 days'));
 UPDATE users SET tier_expires_at=g+interval '1 month 8 days';
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:trial-after','refunded',
  'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
 PERFORM pg_temp.assert_true(r.pro_revoked AND cardinality(r.flipped_ids)=1
  AND (SELECT status='refunded' AND jsonb_array_length(granted_payment_ids)=1 FROM subscriptions)
  AND (SELECT tier='free' AND tier_expires_at IS NULL FROM users),'expired zero-month trial cannot grant a month');
END $$;

-- REVIEW2: identical-survivor-duplicates
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
UPDATE subscriptions SET granted_payment_ids=jsonb_build_array(granted_payment_ids->0,granted_payment_ids->0,granted_payment_ids->1);
SELECT * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:duplicate-survivor','refunded',
 'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
SELECT pg_temp.assert_true((SELECT jsonb_array_length(granted_payment_ids)=1 AND expires_at=card_grant+interval '1 month'
 FROM subscriptions,fixture_clock) AND (SELECT tier_expires_at=card_grant+interval '1 month' FROM users,fixture_clock),
 'identical survivor duplicates are counted and persisted once');

-- REVIEW2: conflicting-survivor-duplicates
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
DO $$
DECLARE field text; original jsonb; conflict jsonb; before_rows jsonb; before_user jsonb; failed boolean;
BEGIN
 SELECT granted_payment_ids INTO original FROM subscriptions;
 FOREACH field IN ARRAY ARRAY['amount_cents','added_months','granted_at'] LOOP
  conflict:=jsonb_set(original->0,ARRAY[field],CASE WHEN field='granted_at' THEN to_jsonb('2026-01-01T00:00:00Z'::text) ELSE '2'::jsonb END);
  UPDATE subscriptions SET granted_payment_ids=jsonb_build_array(original->0,conflict,original->1);
  before_rows:=pg_temp.snapshot(); SELECT to_jsonb(u) INTO before_user FROM users u; failed:=false;
  BEGIN
   PERFORM * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:conflict','refunded',
    'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
  EXCEPTION WHEN SQLSTATE '22023' THEN failed:=true;
  END;
  PERFORM pg_temp.assert_true(failed AND before_rows=pg_temp.snapshot() AND before_user=(SELECT to_jsonb(u) FROM users u)
   AND NOT EXISTS(SELECT 1 FROM processed_webhook_events),'conflicting survivor '||field||' rejected atomically');
 END LOOP;
END $$;

-- REVIEW2: omitted-untouched-coverage
SELECT pg_temp.reset_munir();
UPDATE subscriptions SET granted_payment_ids=jsonb_build_array(granted_payment_ids->0)
 WHERE id='00000000-0000-4000-8000-000000000101';
UPDATE subscriptions SET granted_payment_ids=jsonb_build_array(granted_payment_ids->1)
 WHERE id='00000000-0000-4000-8000-000000000102';
DO $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:untouched','refunded',
  'refund.created',pg_temp.snapshot(ARRAY['00000000-0000-4000-8000-000000000102']::uuid[]),ARRAY['pay_bank'],7);
 PERFORM pg_temp.assert_true(cardinality(r.kept_active_ids)=1 AND cardinality(r.flipped_ids)=1 AND r.had_other_active
  AND (SELECT tier_expires_at=card_grant+interval '1 month' FROM users,fixture_clock),
  'omitted untouched coverage joins kept set and shortens user expiry');
END $$;

-- REVIEW2: atomic-failure-redelivery
-- Inject failures at status and user reconciliation writes. Every failed SQL
-- statement (including a read failure) aborts this transaction, so no pending
-- receipt is needed. A later delivery must still match the original history.
DO $$
DECLARE mode text; before_rows jsonb; before_user jsonb; failed boolean; r record; candidates text[];
BEGIN
 FOREACH mode IN ARRAY ARRAY['status','partial','full'] LOOP
  PERFORM pg_temp.reset_munir();
  INSERT INTO revoke_failures VALUES(CASE WHEN mode='status' THEN 'status' ELSE 'user' END);
  candidates:=CASE WHEN mode='partial' THEN ARRAY['pay_bank'] ELSE ARRAY['pay_card','pay_bank'] END;
  before_rows:=pg_temp.snapshot(); SELECT to_jsonb(u) INTO before_user FROM users u; failed:=false;
  BEGIN
   PERFORM * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:failure','refunded',
    'refund.created',pg_temp.snapshot(),candidates,7);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN failed:=true;
  END;
  PERFORM pg_temp.assert_true(failed AND before_rows=pg_temp.snapshot() AND before_user=(SELECT to_jsonb(u) FROM users u)
    AND NOT EXISTS(SELECT 1 FROM processed_webhook_events),mode||' failure rolls back status, history, user and receipt');
  DELETE FROM revoke_failures;
  SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:failure','refunded',
    'refund.created',pg_temp.snapshot(),candidates,7);
  PERFORM pg_temp.assert_true(NOT r.replayed AND EXISTS(SELECT 1 FROM processed_webhook_events)
    AND (SELECT CASE WHEN mode='partial' THEN tier='pro' AND tier_expires_at=card_grant+interval '1 month'
      ELSE tier='free' AND tier_expires_at IS NULL END FROM users,fixture_clock),mode||' redelivery completes reconciliation');
 END LOOP;
END $$;


-- REVIEW3: purchase-after-rollback
-- SQL receipt, ledger and entitlement writes are one transaction. The
-- fallback's failed-ledger and failed-phase cases both roll back here.
DO $$
DECLARE mode text; g timestamptz; failed boolean; before_rows jsonb; stale jsonb; r record;
BEGIN
 FOREACH mode IN ARRAY ARRAY['history','receipt'] LOOP
  PERFORM pg_temp.reset_munir();
  DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
  SELECT card_grant INTO g FROM fixture_clock;
  before_rows:=pg_temp.snapshot();
  INSERT INTO revoke_failures VALUES(mode); failed:=false;
  BEGIN
   PERFORM * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:later','refunded',
    'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN failed:=true;
  END;
  PERFORM pg_temp.assert_true(failed AND before_rows=pg_temp.snapshot()
   AND NOT EXISTS(SELECT 1 FROM processed_webhook_events),mode||' failure rolls back before later purchase');
  DELETE FROM revoke_failures;
  stale:=pg_temp.snapshot();
  UPDATE subscriptions SET granted_payment_ids=granted_payment_ids||jsonb_build_array(
   jsonb_build_object('payment_id','pay_later','amount_cents',1900,'added_months',1,'granted_at',g+interval '1 day')),
   provider_payment_id='pay_later',expires_at=g+interval '3 months';
  UPDATE users SET tier_expires_at=g+interval '3 months';
  failed:=false;
  BEGIN
   PERFORM * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:later','refunded',
    'refund.created',stale,ARRAY['pay_bank'],7);
  EXCEPTION WHEN SQLSTATE '40001' THEN failed:=true;
  END;
  PERFORM pg_temp.assert_true(failed AND NOT EXISTS(SELECT 1 FROM processed_webhook_events),
   mode||' stale purchase snapshot rejected before writes');
  SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:later','refunded',
   'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
  PERFORM pg_temp.assert_true((SELECT jsonb_array_length(granted_payment_ids)=2 AND expires_at=g+interval '2 months'
   AND granted_payment_ids->0->>'payment_id'='pay_card' AND granted_payment_ids->1->>'payment_id'='pay_later' FROM subscriptions)
   AND (SELECT tier_expires_at=g+interval '2 months' FROM users),mode||' retry preserves and recomputes later purchase');
 END LOOP;
END $$;

-- REVIEW3: interleaved-refunds
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
DO $$
DECLARE g timestamptz; failed boolean:=false;
BEGIN
 SELECT card_grant INTO g FROM fixture_clock;
 UPDATE subscriptions SET granted_payment_ids=granted_payment_ids||jsonb_build_array(
  jsonb_build_object('payment_id','pay_third','amount_cents',1900,'added_months',1,'granted_at',g+interval '1 day')),
  provider_payment_id='pay_third',expires_at=g+interval '3 months';
 UPDATE users SET tier_expires_at=g+interval '3 months';
 INSERT INTO revoke_failures VALUES('history');
 BEGIN
  PERFORM * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:first','refunded',
   'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN failed:=true;
 END;
 PERFORM pg_temp.assert_true(failed,'first refund failed before second delivery');
 DELETE FROM revoke_failures;
 PERFORM * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:third','refunded',
  'refund.created',pg_temp.snapshot(),ARRAY['pay_third'],7);
 PERFORM * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:first','refunded',
  'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
 PERFORM pg_temp.assert_true((SELECT jsonb_array_length(granted_payment_ids)=1 AND
  granted_payment_ids->0->>'payment_id'='pay_card' AND expires_at=g+interval '1 month' FROM subscriptions)
  AND (SELECT tier_expires_at=g+interval '1 month' FROM users),'first retry never restores the separately refunded third payment');
END $$;

-- REVIEW3: intervening-manual-grants
DO $$
DECLARE mode text; unlimited boolean; grant_end timestamptz; failed boolean; candidates text[];
BEGIN
 FOREACH mode IN ARRAY ARRAY['partial','full'] LOOP
  FOREACH unlimited IN ARRAY ARRAY[false,true] LOOP
   PERFORM pg_temp.reset_munir();
   DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
   candidates:=CASE WHEN mode='partial' THEN ARRAY['pay_bank'] ELSE ARRAY['pay_card','pay_bank'] END;
   INSERT INTO revoke_failures VALUES('user'); failed:=false;
   BEGIN
    PERFORM * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:manual-retry','refunded',
     'refund.created',pg_temp.snapshot(),candidates,7);
   EXCEPTION WHEN SQLSTATE 'P0001' THEN failed:=true;
   END;
   PERFORM pg_temp.assert_true(failed AND NOT EXISTS(SELECT 1 FROM processed_webhook_events),mode||' user error leaves no receipt');
   DELETE FROM revoke_failures;
   grant_end:=CASE WHEN unlimited THEN NULL ELSE clock_timestamp()+interval '1 year' END;
   UPDATE users SET tier='pro',tier_expires_at=grant_end,updated_at=clock_timestamp();
   PERFORM * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:manual-retry','refunded',
    'refund.created',pg_temp.snapshot(),candidates,7);
   PERFORM pg_temp.assert_true((SELECT tier='pro' AND tier_expires_at IS NOT DISTINCT FROM grant_end FROM users),
    mode||' retry preserves intervening '||CASE WHEN unlimited THEN 'unlimited' ELSE 'finite' END||' manual grant');
  END LOOP;
 END LOOP;
END $$;

-- REVIEW3: trial-refund-then-deactivation
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
DO $$
DECLARE g timestamptz:=clock_timestamp()-interval '7 days 12 hours'; r record;
BEGIN
 UPDATE subscriptions SET tier='notes_pro_trial',amount_cents=1900,started_at=g,expires_at=g+interval '1 month 8 days',
  granted_payment_ids=jsonb_build_array(
   jsonb_build_object('payment_id','pay_trial','amount_cents',0,'added_months',0,'granted_at',g),
   jsonb_build_object('payment_id','pay_bank','amount_cents',1900,'added_months',1,'granted_at',g+interval '7 days'));
 UPDATE users SET tier_expires_at=g+interval '1 month 8 days';
 PERFORM * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:trial-renewal','refunded',
  'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
 PERFORM pg_temp.assert_true((SELECT tier='notes_pro_trial' AND amount_cents=0 AND status='active' AND
  expires_at=g+interval '8 days' AND jsonb_array_length(granted_payment_ids)=1 FROM subscriptions),
  'refunded renewal restores zero-only notes_pro_trial provenance');
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','cancel:trial','cancelled',
  'membership.deactivated',pg_temp.snapshot(),'{}',7);
 PERFORM pg_temp.assert_true(NOT r.pro_revoked AND cardinality(r.flipped_ids)=0 AND
  (SELECT status='active' AND expires_at=g+interval '8 days' FROM subscriptions) AND
  (SELECT tier='pro' AND tier_expires_at=g+interval '8 days' FROM users),
  'membership deactivation keeps the original trial after refund');
END $$;

-- REVIEW3: paid-months-on-trial-tier
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000102';
UPDATE subscriptions SET tier='notes_pro_trial',amount_cents=0;
UPDATE users SET tier_expires_at=(SELECT expires_at FROM subscriptions);
SELECT * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','cancel:paid-trial','cancelled',
 'membership.deactivated',pg_temp.snapshot(),'{}',7);
SELECT pg_temp.assert_true((SELECT status='cancelled' FROM subscriptions) AND (SELECT tier='free' FROM users),
 'paid months are never mistaken for a free trial despite tier and amount');

-- REVIEW4: surviving-paid-owner-free
-- A grant whose user write failed leaves the owner free. Surviving paid
-- coverage after a partial refund must establish Pro, and a redelivery
-- must not undo it.
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
UPDATE users SET tier='free',tier_expires_at=NULL;
DO $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:owner-free','refunded',
  'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
 PERFORM pg_temp.assert_true(cardinality(r.kept_active_ids)=1 AND (SELECT tier='pro' AND tier_expires_at=card_grant+interval '1 month'
  FROM users,fixture_clock),'surviving paid coverage reconciles a free owner to Pro');
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:owner-free','refunded',
  'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
 PERFORM pg_temp.assert_true(r.replayed AND (SELECT tier='pro' AND tier_expires_at=card_grant+interval '1 month'
  FROM users,fixture_clock),'owner-free redelivery keeps reconciled Pro');
END $$;

-- REVIEW4: profile-edit-between-attempts
-- The P1 retry state is fallback-only: a failed atomic attempt rolls back
-- everything, so a profile-only edit before redelivery cannot strand access.
DO $$
DECLARE mode text; failed boolean; candidates text[];
BEGIN
 FOREACH mode IN ARRAY ARRAY['partial','full'] LOOP
  PERFORM pg_temp.reset_munir();
  DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
  candidates:=CASE WHEN mode='partial' THEN ARRAY['pay_bank'] ELSE ARRAY['pay_card','pay_bank'] END;
  INSERT INTO revoke_failures VALUES('user'); failed:=false;
  BEGIN
   PERFORM * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:profile','refunded',
    'refund.created',pg_temp.snapshot(),candidates,7);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN failed:=true;
  END;
  DELETE FROM revoke_failures;
  UPDATE users SET first_name='Edited',updated_at=clock_timestamp();
  PERFORM * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:profile','refunded',
   'refund.created',pg_temp.snapshot(),candidates,7);
  PERFORM pg_temp.assert_true(failed AND (SELECT CASE WHEN mode='partial' THEN tier='pro' AND tier_expires_at=card_grant+interval '1 month'
    ELSE tier='free' AND tier_expires_at IS NULL END FROM users,fixture_clock),
   mode||' redelivery after a profile-only edit reconciles the refund');
 END LOOP;
END $$;

-- REVIEW4: last-unlimited-whop-row
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
UPDATE subscriptions SET expires_at=NULL,granted_payment_ids=jsonb_build_array(granted_payment_ids->1);
UPDATE users SET tier_expires_at=NULL;
DO $$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:unlimited-whop','refunded',
  'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
 PERFORM pg_temp.assert_true(r.pro_revoked AND (SELECT status='refunded' FROM subscriptions)
  AND (SELECT tier='free' AND tier_expires_at IS NULL FROM users),'refunding the last non-expiring Whop row downgrades');
END $$;

-- REVIEW4: unlimited-untouched-row
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
UPDATE subscriptions SET expires_at=NULL,granted_payment_ids=jsonb_build_array(granted_payment_ids->1);
UPDATE users SET tier_expires_at=NULL;
INSERT INTO subscriptions(user_id,tier,status,payment_provider,expires_at)
 VALUES('00000000-0000-4000-8000-000000000004','pro','active','manual',NULL);
SELECT * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:unlimited-kept','refunded',
 'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
SELECT pg_temp.assert_true((SELECT tier='pro' AND tier_expires_at IS NULL FROM users),
 'untouched unlimited subscription keeps NULL access');

-- REVIEW4: unlimited-manual-user-grant
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
UPDATE subscriptions SET granted_payment_ids=jsonb_build_array(granted_payment_ids->1);
UPDATE users SET tier_expires_at=NULL;
SELECT * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:unlimited-manual','refunded',
 'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
SELECT pg_temp.assert_true((SELECT status='refunded' FROM subscriptions) AND (SELECT tier='pro' AND tier_expires_at IS NULL FROM users),
 'explicit unlimited manual grant not explained by Whop coverage is kept');

-- REVIEW4: separate-history-stacked
-- Card row [pay_card] ends one month after its grant; bank row [pay_bank]
-- was queued after it. Refunding the card leaves one month from the bank grant.
SELECT pg_temp.reset_munir();
UPDATE subscriptions SET granted_payment_ids=jsonb_build_array(granted_payment_ids->0)
 WHERE id='00000000-0000-4000-8000-000000000101';
UPDATE subscriptions SET granted_payment_ids=jsonb_build_array(granted_payment_ids->1)
 WHERE id='00000000-0000-4000-8000-000000000102';
DO $$
DECLARE r record; g timestamptz;
BEGIN
 SELECT card_grant INTO g FROM fixture_clock;
 SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:card-first','refunded',
  'refund.created',pg_temp.snapshot(ARRAY['00000000-0000-4000-8000-000000000101']::uuid[]),ARRAY['pay_card'],7);
 PERFORM pg_temp.assert_true((SELECT status='refunded' FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101')
  AND (SELECT status='active' AND expires_at=g+interval '2 hours 23 minutes'+interval '1 month'
   FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000102')
  AND (SELECT tier='pro' AND tier_expires_at=g+interval '2 hours 23 minutes'+interval '1 month' FROM users),
  'dependent stacked row loses the refunded queue month');
END $$;

-- REVIEW4: three-queued-rows
DO $$
DECLARE g timestamptz; refund text; r record;
BEGIN
 FOREACH refund IN ARRAY ARRAY['pay_c','pay_a'] LOOP
  PERFORM pg_temp.reset_munir();
  DELETE FROM subscriptions;
  SELECT card_grant INTO g FROM fixture_clock;
  INSERT INTO subscriptions(id,user_id,tier,status,payment_provider,amount_cents,started_at,expires_at,provider_payment_id,granted_payment_ids)
  SELECT v.id::uuid,'00000000-0000-4000-8000-000000000004','first_month_19','active','whop',1900,g+v.start_off,g+v.end_off,v.pay,
    jsonb_build_array(jsonb_build_object('payment_id',v.pay,'amount_cents',1900,'added_months',1,'granted_at',g+v.grant_off))
  FROM (VALUES
   ('00000000-0000-4000-8000-000000000201','pay_a',interval '0',interval '0',interval '1 month'),
   ('00000000-0000-4000-8000-000000000202','pay_b',interval '10 minutes',interval '1 month',interval '2 months'),
   ('00000000-0000-4000-8000-000000000203','pay_c',interval '20 minutes',interval '2 months',interval '3 months')
  ) v(id,pay,grant_off,start_off,end_off);
  UPDATE users SET tier_expires_at=g+interval '3 months';
  SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:'||refund,'refunded',
   'refund.created',pg_temp.snapshot(),ARRAY[refund],7);
  IF refund='pay_c' THEN
   PERFORM pg_temp.assert_true((SELECT array_agg(status ORDER BY id)=ARRAY['active','active','refunded']
     AND array_agg(expires_at ORDER BY id)=ARRAY[g+interval '1 month',g+interval '2 months',g+interval '3 months'] FROM subscriptions)
     AND (SELECT tier_expires_at=g+interval '2 months' FROM users),
    'refunding the last queued row keeps earlier queue positions');
  ELSE
   PERFORM pg_temp.assert_true((SELECT array_agg(status ORDER BY id)=ARRAY['refunded','active','active']
     AND array_agg(expires_at ORDER BY id)=ARRAY[g+interval '1 month',g+interval '1 month 10 minutes',g+interval '2 months 10 minutes']
     FROM subscriptions) AND (SELECT tier_expires_at=g+interval '2 months 10 minutes' FROM users),
    'later rows queue behind the rebuilt surviving row');
  END IF;
 END LOOP;
END $$;

-- REVIEW4: verify-first-trial
-- trial/verify rows before trial provenance: started_at is the trial start
-- and only the paid renewal is recorded. Recorded provenance carries the
-- membership trial end, which wins over the eight-day fallback.
CREATE FUNCTION pg_temp.plus_month(t timestamptz) RETURNS timestamptz LANGUAGE sql AS $$
 SELECT (date_trunc('month',t AT TIME ZONE 'UTC')+interval '1 month'
  +((t AT TIME ZONE 'UTC')-date_trunc('month',t AT TIME ZONE 'UTC'))) AT TIME ZONE 'UTC'
$$;
DO $$
DECLARE shape text; t0 timestamptz; history jsonb; r record; trial jsonb; renewal jsonb;
BEGIN
 FOREACH shape IN ARRAY ARRAY['legacy-before','recorded-before','legacy-after','recorded-after','legacy-floor','recorded-floor'] LOOP
  PERFORM pg_temp.reset_munir();
  DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
  t0:=clock_timestamp()-CASE WHEN shape LIKE '%after' THEN interval '9 days' ELSE interval '7 days 12 hours' END;
  trial:=jsonb_build_object('payment_id','mem_fixture','amount_cents',0,'added_months',0,
   'granted_at',t0+interval '5 minutes','trial_ends_at',t0+interval '8 days');
  renewal:=jsonb_build_object('payment_id','pay_bank','amount_cents',1900,'added_months',1,'granted_at',t0+interval '7 days');
  history:=CASE WHEN shape LIKE 'recorded%' THEN jsonb_build_array(trial,renewal) ELSE jsonb_build_array(renewal) END;
  IF shape LIKE '%floor' THEN
   history:=history||jsonb_build_array(jsonb_build_object('payment_id','pay_early','amount_cents',1900,'added_months',1,
    'granted_at',t0+interval '7 days 6 hours'));
  END IF;
  UPDATE subscriptions SET tier='notes_pro_trial',amount_cents=1900,started_at=t0,
   expires_at=CASE WHEN shape LIKE '%floor' THEN pg_temp.plus_month(pg_temp.plus_month(t0+interval '8 days'))
     ELSE pg_temp.plus_month(t0+interval '8 days') END,
   provider_payment_id=CASE WHEN shape LIKE '%floor' THEN 'pay_early' ELSE 'pay_bank' END,granted_payment_ids=history;
  UPDATE users SET tier_expires_at=(SELECT expires_at FROM subscriptions);
  SELECT * INTO r FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:'||shape,'refunded',
   'refund.created',pg_temp.snapshot(),ARRAY[CASE WHEN shape LIKE '%floor' THEN 'pay_early' ELSE 'pay_bank' END],7);
  IF shape LIKE '%before' THEN
   PERFORM pg_temp.assert_true((SELECT status='active' AND amount_cents=0 AND expires_at=t0+interval '8 days'
     AND jsonb_array_length(granted_payment_ids)=1 AND granted_payment_ids->0->>'added_months'='0'
     AND granted_payment_ids->0->>'payment_id'=CASE WHEN shape LIKE 'legacy%' THEN 'trial:'||id::text ELSE 'mem_fixture' END
     FROM subscriptions) AND (SELECT tier='pro' AND tier_expires_at=t0+interval '8 days' FROM users),
    shape||': renewal refund keeps the verify-first trial window');
  ELSIF shape LIKE '%after' THEN
   PERFORM pg_temp.assert_true(r.pro_revoked AND (SELECT status='refunded' FROM subscriptions)
     AND (SELECT tier='free' FROM users),shape||': renewal refund after the trial revokes');
  ELSE
   PERFORM pg_temp.assert_true((SELECT status='active' AND expires_at=pg_temp.plus_month(t0+interval '8 days')
     AND provider_payment_id='pay_bank' FROM subscriptions)
     AND (SELECT tier_expires_at=pg_temp.plus_month(t0+interval '8 days') FROM users),
    shape||': surviving paid window keeps the original trial floor');
  END IF;
 END LOOP;
END $$;

-- REVIEW4: paid-created-trial-tier
SELECT pg_temp.reset_munir();
DELETE FROM subscriptions WHERE id='00000000-0000-4000-8000-000000000101';
UPDATE subscriptions SET tier='notes_pro_trial',started_at=(SELECT card_grant+interval '2 hours 23 minutes' FROM fixture_clock),
 expires_at=(SELECT card_grant+interval '1 month 2 hours 23 minutes' FROM fixture_clock),
 granted_payment_ids=jsonb_build_array(granted_payment_ids->1);
UPDATE users SET tier_expires_at=(SELECT expires_at FROM subscriptions);
SELECT * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:paid-trial-tier','refunded',
 'refund.created',pg_temp.snapshot(),ARRAY['pay_bank'],7);
SELECT pg_temp.assert_true((SELECT status='refunded' FROM subscriptions) AND (SELECT tier='free' FROM users),
 'no trial is invented for a trial-tier row created by its paid renewal');

-- Snapshot mismatch must release all mutations by aborting before claim.
SELECT pg_temp.reset_munir();
DO $$
DECLARE stale jsonb; failed boolean:=false;
BEGIN
 stale:=pg_temp.snapshot(); UPDATE subscriptions SET amount_cents=2000;
 BEGIN
  PERFORM * FROM commit_whop_revoke('00000000-0000-4000-8000-000000000004','refund:stale','refunded',
   'refund.created',stale,ARRAY['pay_bank'],7);
 EXCEPTION WHEN SQLSTATE '40001' THEN failed:=true;
 END;
 PERFORM pg_temp.assert_true(failed AND NOT EXISTS(SELECT 1 FROM processed_webhook_events),'stale snapshot rejected before claim');
END $$;
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.commit_whop_revoke(uuid,text,text,text,jsonb,text[],double precision)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.commit_whop_revoke(uuid,text,text,text,jsonb,text[],double precision)','EXECUTE')
 AND has_function_privilege('service_role','public.commit_whop_revoke(uuid,text,text,text,jsonb,text[],double precision)','EXECUTE'),
 'service-only execute ACL preserved');
SELECT pg_temp.assert_true((SELECT NOT prosecdef AND pronargs=7 AND proconfig=ARRAY['search_path=public, pg_temp']
 FROM pg_proc WHERE oid='public.commit_whop_revoke(uuid,text,text,text,jsonb,text[],double precision)'::regprocedure),
 'seven-argument SECURITY INVOKER and search_path preserved');
\echo NEW FUNCTION: ALL REGRESSIONS PASSED
\endif
ROLLBACK;
