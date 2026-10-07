#!/usr/bin/env python3
"""Disposable synthetic grant/refund ledger and ownership races. No live access."""
import importlib.util
import json
from pathlib import Path
import tempfile
from concurrent.futures import ThreadPoolExecutor

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('grant_fixture',Path(__file__).with_name('test-whop-atomic-grant.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
USER=m.USER

def main():
 checks=[]
 with tempfile.TemporaryDirectory(prefix='medpruf-revoke-atomic-',dir='/tmp') as temp:
  cluster=m.module.LocalCluster(temp,m.module.find_bin_dir(None))
  def scalar(q): return cluster.sql(q).strip().splitlines()[-1]
  def check(name,q):
   assert scalar(q)=='t',name;checks.append(name)
  def setup(tier='free',expiry='NULL',role='user'):
   cluster.sql('TRUNCATE whop_paid_grant_receipts,subscriptions,users,processed_webhook_events;')
   cluster.sql(f"INSERT INTO users(id,tier,tier_expires_at,role) VALUES('{USER}','{tier}',{expiry},'{role}');")
  def grant(payment): return cluster.sql(f"SELECT * FROM grant_whop_paid_subscription('{USER}','first_month_19','{payment}',1900,'EUR',1,'mem-synthetic');")
  def snapshot(): return scalar(f"SELECT jsonb_agg(s)::text FROM subscriptions s WHERE user_id='{USER}';")
  def revoke(payment,expected=None,kind='refunded',claim=None):
   payload=(expected or snapshot()).replace("'","''")
   return scalar(f"SELECT row_to_json(r)::text FROM commit_whop_revoke('{USER}','{claim or kind+':'+payment}','{kind}','synthetic','{payload}'::jsonb,ARRAY['{payment}'],7) r;")
  try:
   cluster.start();cluster.sql(m.FIXTURE)
   cluster.sql('CREATE TABLE processed_webhook_events(provider text,event_id text,payload jsonb,processed_at timestamptz DEFAULT now(),PRIMARY KEY(provider,event_id));')
   cluster.sql((ROOT/'supabase/migrations/20261007100000_atomic_whop_paid_grants.sql').read_text())
   cluster.sql((ROOT/'supabase/migrations/20261007110000_atomic_whop_revocations.sql').read_text())
   setup();grant('A');old=snapshot();grant('B')
   try: revoke('A',old)
   except RuntimeError as e: assert 'retry revoke from fresh ledger' in str(e)
   else: raise AssertionError('stale refund overwrote renewed ledger')
   check('stale revoke rolls back claim and retains both paid entries',"SELECT (SELECT count(*)=0 FROM processed_webhook_events) AND (SELECT jsonb_array_length(granted_payment_ids)=2 FROM subscriptions);")
   revoke('A')
   check('fresh partial refund keeps newer paid entry and valid coverage',f"SELECT s.status='active' AND s.granted_payment_ids @> '[{{\"payment_id\":\"B\"}}]' AND jsonb_array_length(s.granted_payment_ids)=1 AND u.tier='pro' AND u.tier_expires_at=s.expires_at FROM subscriptions s JOIN users u ON u.id=s.user_id;")
   revoke('B');grant('A')
   check('receipt replay does not resurrect fully refunded access',"SELECT (SELECT tier='free' FROM users) AND (SELECT count(*)=2 FROM whop_paid_grant_receipts) AND (SELECT status='refunded' FROM subscriptions);")
   assert json.loads(revoke('B'))['replayed'] is True;checks.append('duplicate revoke is idempotent')
   for tier,expiry,role in [('pro','NULL','user'),('pro',"'2050-01-01Z'",'user'),('admin','NULL','user'),('free','NULL','admin')]:
    setup(tier,expiry,role);grant('manual');before=scalar('SELECT row_to_json(u)::text FROM users u;');revoke('manual')
    assert before==scalar('SELECT row_to_json(u)::text FROM users u;')
   checks.append('manual null/future and role/tier admin overrides survive refund')
   setup();grant('malformed-A');grant('malformed-B')
   cluster.sql("UPDATE subscriptions SET granted_payment_ids=granted_payment_ids||'[{},null,{\"payment_id\":\"\"}]'::jsonb;")
   revoke('malformed-A')
   check('malformed missing/empty payment entries cannot buy extra months',"SELECT jsonb_array_length(granted_payment_ids)=1 AND granted_payment_ids->0->>'payment_id'='malformed-B' AND expires_at<started_at+interval '40 days' FROM subscriptions;")
   setup();grant('invalid-date-A');grant('invalid-date-B')
   cluster.sql("UPDATE subscriptions SET granted_payment_ids=jsonb_set(granted_payment_ids,'{1,granted_at}','\"invalid timestamp\"');")
   revoke('invalid-date-A')
   check('invalid historical grant date falls back without blocking revoke or buying extra months',"SELECT status='active' AND jsonb_array_length(granted_payment_ids)=1 AND expires_at<started_at+interval '40 days' FROM subscriptions;")
   setup();grant('rollback');before=snapshot()
   cluster.sql("CREATE FUNCTION reject_revoke() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tier='free' THEN RAISE EXCEPTION 'synthetic user write failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_revoke BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION reject_revoke();")
   try: revoke('rollback')
   except RuntimeError as e: assert 'synthetic user write failure' in str(e)
   else: raise AssertionError('expected rollback')
   assert before==snapshot();check('failed user reconciliation rolls back sub and idempotency claim',"SELECT count(*)=0 FROM processed_webhook_events;")
   cluster.sql('DROP TRIGGER reject_revoke ON users; DROP FUNCTION reject_revoke();');revoke('rollback')
   check('retry after rollback completes exactly once',"SELECT (SELECT count(*)=1 FROM processed_webhook_events) AND (SELECT tier='free' FROM users);")
   setup();grant('grace');cluster.sql(f"INSERT INTO processed_webhook_events VALUES('whop','recover:grace',jsonb_build_object('user_id','{USER}'),now());")
   result=json.loads(revoke('grace',kind='cancelled'));assert result['dunning_deferred'] and not result['pro_revoked'];checks.append('user-scoped existing dunning downgrade grace preserved')
   setup('pro',"now()+interval '8 days'")
   cluster.sql(f"INSERT INTO subscriptions(user_id,tier,status,payment_provider,amount_cents,expires_at) VALUES('{USER}','notes_pro_trial','active','whop',0,now()+interval '8 days');")
   result=json.loads(revoke('unpaid',kind='cancelled'));assert len(result['kept_active_ids'])==1 and not result['pro_revoked'];checks.append('unpaid card-trial cancellation keeps stored grace window')
   setup();grant('race-A');old=snapshot()
   def refund():
    try: return revoke('race-A',old)
    except RuntimeError as e:
     assert 'retry revoke from fresh ledger' in str(e);return None
   with ThreadPoolExecutor(max_workers=2) as pool:
    futures=[pool.submit(grant,'race-B'),pool.submit(refund)];answers=[f.result(timeout=10) for f in futures]
   if answers[1] is None: revoke('race-A')
   check('concurrent renewal/refund preserves new payment and valid Pro',"SELECT (SELECT tier='pro' AND tier_expires_at>now() FROM users) AND EXISTS(SELECT 1 FROM subscriptions WHERE status='active' AND granted_payment_ids @> '[{\"payment_id\":\"race-B\"}]');")
   cluster.sql(f"INSERT INTO users(id) VALUES('00000000-0000-0000-0000-000000000002');")
   try:
    cluster.sql("INSERT INTO whop_paid_grant_receipts(payment_id,user_id,subscription_id,grant_mode,granted_expires_at) SELECT 'wrong-owner','00000000-0000-0000-0000-000000000002',id,'inserted',now() FROM subscriptions LIMIT 1;")
   except RuntimeError as e: assert 'foreign key constraint' in str(e)
   else: raise AssertionError('composite receipt owner mismatch accepted')
   checks.append('composite FK rejects existing but incorrect receipt owner')
   print(json.dumps({'checks':checks,'production_actions':0,'local_postgres':'16.13','pg17_transaction_timeout':'compatibility-gated; conditional in fixture'},indent=2))
  finally: cluster.stop()

if __name__=='__main__':main()
