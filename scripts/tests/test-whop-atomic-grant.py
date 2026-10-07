#!/usr/bin/env python3
"""Disposable synthetic Whop grant concurrency and rollback regression.

No live database, credentials, network listeners or production actions.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import tempfile

SPEC = importlib.util.spec_from_file_location('study_fixture', Path(__file__).with_name('test-study-rpc.py'))
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
MIGRATION = '20261007100000_atomic_whop_paid_grants.sql'
USER = '00000000-0000-0000-0000-000000000001'
FIXTURE = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE users(id uuid PRIMARY KEY, role text DEFAULT 'user', tier text DEFAULT 'free', tier_expires_at timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id), tier text, status text,
 payment_provider text, payment_method text, amount_cents integer, currency text, provider_payment_id text,
 granted_payment_ids jsonb DEFAULT '[]', whop_membership_id text, started_at timestamptz DEFAULT now(), expires_at timestamptz,
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE FUNCTION legacy_synthetic_grant(p_payment text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE old_expiry timestamptz; old_history jsonb;
BEGIN
 SELECT expires_at, granted_payment_ids INTO old_expiry,old_history FROM subscriptions LIMIT 1;
 PERFORM pg_sleep(0.3);
 UPDATE subscriptions SET expires_at=old_expiry+interval '1 month', granted_payment_ids=old_history||jsonb_build_array(jsonb_build_object('payment_id',p_payment));
END; $$;
"""

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--bin-dir', type=Path)
    args = parser.parse_args()
    results = []
    with tempfile.TemporaryDirectory(prefix='medpruf-whop-grant-', dir='/tmp') as temp:
        cluster = module.LocalCluster(temp, module.find_bin_dir(args.bin_dir))
        def scalar(query):
            return cluster.sql(query).strip().splitlines()[-1]
        def check(name, query):
            assert scalar(query) == 't', name
            results.append(name)
        def reset(tier='free', expiry='NULL', role='user', seeded=True):
            cluster.sql("TRUNCATE whop_paid_grant_receipts,subscriptions,users;" if 'migration_loaded' in results else "TRUNCATE subscriptions,users;")
            cluster.sql(f"INSERT INTO users(id,tier,tier_expires_at,role) VALUES ('{USER}','{tier}',{expiry},'{role}');")
            if seeded:
                cluster.sql(f"INSERT INTO subscriptions(user_id,tier,status,payment_provider,amount_cents,currency,expires_at) VALUES ('{USER}','first_month_19','active','whop',1900,'EUR','2040-01-31T12:34:56.123Z');")
        def grant(payment, user=USER, months=1):
            return cluster.sql(f"SELECT * FROM grant_whop_paid_subscription('{user}','first_month_19','{payment}',1900,'EUR',{months},'membership-synthetic');")
        def concurrent(a, b):
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(a), pool.submit(b)]
                return [f.result(timeout=15) for f in futures]
        try:
            cluster.start()
            cluster.sql(FIXTURE)
            reset()
            concurrent(lambda: cluster.sql("SELECT legacy_synthetic_grant('old-A');"), lambda: cluster.sql("SELECT legacy_synthetic_grant('old-B');"))
            check('legacy race reproduced: one extension/ledger entry lost', "SELECT jsonb_array_length(granted_payment_ids)=1 AND expires_at='2040-02-29T12:34:56.123Z' FROM subscriptions;")
            # Legacy subscription write commits separately from entitlement.
            check('legacy split write leaves paid row without user entitlement', "SELECT (SELECT status='active' FROM subscriptions) AND (SELECT tier='free' FROM users);")
            cluster.sql((args.repo/'supabase'/'migrations'/MIGRATION).read_text())
            results.append('migration_loaded')
            reset()
            concurrent(lambda: grant('A'), lambda: grant('B'))
            check('different payments serialize two windows and ledger entries', "SELECT expires_at='2040-04-02T12:34:56.123Z' AND jsonb_array_length(granted_payment_ids)=2 AND granted_payment_ids @> '[{\"payment_id\":\"A\"},{\"payment_id\":\"B\"}]' FROM subscriptions;")
            check('subscription and user entitlement agree', "SELECT u.tier='pro' AND u.tier_expires_at=s.expires_at FROM users u JOIN subscriptions s ON s.user_id=u.id;")
            check('separate primary payment receipt ledger', "SELECT count(*)=2 AND count(DISTINCT payment_id)=2 FROM whop_paid_grant_receipts;")
            before = scalar("SELECT expires_at::text||granted_payment_ids::text FROM subscriptions;")
            grant('A')
            assert before == scalar("SELECT expires_at::text||granted_payment_ids::text FROM subscriptions;"), 'replay extended twice'
            results.append('same-payment replay adds no time or history')
            reset()
            concurrent(lambda: grant('same'), lambda: grant('same'))
            check('concurrent same-payment replay grants once and preserves UTC rollover', "SELECT expires_at='2040-03-02T12:34:56.123Z' AND jsonb_array_length(granted_payment_ids)=1 FROM subscriptions;")
            for tier, expiry, role in [('pro','NULL','user'),('pro',"'2050-01-01Z'",'user'),('admin','NULL','user'),('free','NULL','admin')]:
                reset(tier, expiry, role)
                before = scalar("SELECT tier||'|'||coalesce(tier_expires_at::text,'null') FROM users;")
                grant('preserved')
                assert before == scalar("SELECT tier||'|'||coalesce(tier_expires_at::text,'null') FROM users;"), 'override/admin changed'
            results.append('manual null/future and role/tier admin entitlements preserved')
            reset(seeded=False)
            grant('new')
            check('first purchase atomically inserts subscription, receipt and user Pro', "SELECT (SELECT count(*)=1 FROM subscriptions) AND (SELECT count(*)=1 FROM whop_paid_grant_receipts) AND (SELECT tier='pro' AND tier_expires_at IS NOT NULL FROM users);")
            cluster.sql("INSERT INTO users(id) VALUES('00000000-0000-0000-0000-000000000002');")
            try:
                grant('new', user='00000000-0000-0000-0000-000000000002')
                raise AssertionError('Payment reused for another user')
            except RuntimeError as error:
                assert 'belongs to another user' in str(error)
            results.append('same payment cannot grant another user')
            # Later cancellation must not be reversed by a repeated payment.
            cluster.sql("UPDATE subscriptions SET status='refunded'; UPDATE users SET tier='free',tier_expires_at=NULL;")
            grant('new')
            check('refunded receipt replay never resurrects access', f"SELECT (SELECT status='refunded' FROM subscriptions) AND (SELECT tier='free' AND tier_expires_at IS NULL FROM users WHERE id='{USER}');")
            reset()
            cluster.sql("UPDATE subscriptions SET provider_payment_id='legacy-payment',granted_payment_ids='[{\"payment_id\":\"earlier-payment\"}]';")
            grant('earlier-payment')
            check('historical ledger replay repairs entitlement without extension', "SELECT s.expires_at='2040-01-31T12:34:56.123Z' AND jsonb_array_length(s.granted_payment_ids)=1 AND u.tier_expires_at=s.expires_at FROM subscriptions s JOIN users u ON u.id=s.user_id;")
            cluster.sql("UPDATE subscriptions SET status='cancelled'; DELETE FROM whop_paid_grant_receipts;")
            try:
                grant('earlier-payment')
                raise AssertionError('Cancelled legacy payment was accepted')
            except RuntimeError as error:
                assert 'no longer active' in str(error)
            results.append('cancelled historical grant rejected without resurrection')
            reset()
            cluster.sql("CREATE FUNCTION synthetic_reject_user_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic entitlement write failure'; END $$; CREATE TRIGGER reject_user_write BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION synthetic_reject_user_write();")
            before = scalar("SELECT expires_at::text||granted_payment_ids::text FROM subscriptions;")
            try:
                grant('rollback')
                raise AssertionError('Entitlement failure not surfaced')
            except RuntimeError as error:
                assert 'synthetic entitlement write failure' in str(error)
            assert before == scalar("SELECT expires_at::text||granted_payment_ids::text FROM subscriptions;"), 'subscription survived failed transaction'
            check('user-write failure rolls subscription and receipt back', "SELECT count(*)=0 FROM whop_paid_grant_receipts;")
            cluster.sql('DROP TRIGGER reject_user_write ON users;')
            grant('rollback')
            check('retry after rolled-back failure grants exactly once', "SELECT jsonb_array_length(granted_payment_ids)=1 FROM subscriptions;")
            check('public roles cannot execute grant RPC', "SELECT NOT has_function_privilege('anon','grant_whop_paid_subscription(uuid,text,text,integer,text,integer,text)','EXECUTE') AND NOT has_function_privilege('authenticated','grant_whop_paid_subscription(uuid,text,text,integer,text,integer,text)','EXECUTE');")
            reset(seeded=False)
            cluster.sql('ALTER ROLE service_role BYPASSRLS; GRANT SELECT,INSERT,UPDATE ON users,subscriptions TO service_role;')
            cluster.sql(f"SET ROLE service_role; SELECT * FROM grant_whop_paid_subscription('{USER}','first_month_19','service-role',1900,'EUR',1,NULL); RESET ROLE;")
            check('service role can execute atomic subscription plus receipt transaction', "SELECT count(*)=1 FROM whop_paid_grant_receipts;")
        finally:
            cluster.stop()
    print(json.dumps({'tests':results,'server_stopped':True},indent=2))

if __name__ == '__main__':
    main()
