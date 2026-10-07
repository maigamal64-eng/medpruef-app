#!/usr/bin/env python3
"""Disposable synthetic lock/constraint assessment. Never connects to production."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('fixture', Path(__file__).with_name('test-study-rpc.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

def main():
    checks=[]
    with tempfile.TemporaryDirectory(prefix='medpruf-composite-locks-',dir='/tmp') as temp:
        cluster=fixture.LocalCluster(temp,fixture.find_bin_dir(None)); holders=[]
        def hold(sql):
            p=subprocess.Popen([str(cluster.binaries/'psql'),'-X','-qAt','-h',temp,'-p',cluster.port,'-U','synthetic','-d','postgres','-v','ON_ERROR_STOP=1'],env=cluster.env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            p.stdin.write("BEGIN; "+sql+"; SELECT 'held';\n");p.stdin.flush()
            assert p.stdout.readline().strip()=='held';holders.append(p);return p
        def release(p):
            out,err=p.communicate('ROLLBACK;\n',timeout=5);assert p.returncode==0,err;holders.remove(p)
        schema=(ROOT/'supabase/migrations/20261007100000_atomic_whop_paid_grants.sql').read_text().split('CREATE FUNCTION',1)[0]
        bounded="SET LOCAL lock_timeout='20ms'; SET LOCAL statement_timeout='150ms'; LOCK TABLE subscriptions IN SHARE ROW EXCLUSIVE MODE NOWAIT; "+schema
        try:
            cluster.start()
            spec2=importlib.util.spec_from_file_location('grant',Path(__file__).with_name('test-whop-atomic-grant.py'));m=importlib.util.module_from_spec(spec2);spec2.loader.exec_module(m)
            cluster.sql(m.FIXTURE+'CREATE TABLE answers(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id));CREATE TABLE processed_webhook_events(provider text,event_id text,payload jsonb,processed_at timestamptz DEFAULT now(),PRIMARY KEY(provider,event_id));')
            busy=hold('LOCK TABLE subscriptions IN ROW EXCLUSIVE MODE')
            try: cluster.sql('BEGIN;'+bounded+'COMMIT;')
            except RuntimeError as e: assert 'could not obtain lock' in str(e)
            else: raise AssertionError('busy subscriptions lock unexpectedly admitted')
            assert cluster.sql("SELECT to_regclass('whop_paid_grant_receipts') IS NULL AND to_regclass('subscriptions_receipt_owner_key') IS NULL;").strip().endswith('t')
            checks.append('busy subscription writes cause immediate abort and zero partial schema');release(busy)
            busy=hold('LOCK TABLE users,answers IN ROW EXCLUSIVE MODE')
            installer=hold(bounded)
            locks=json.loads(cluster.sql("SELECT jsonb_agg(jsonb_build_object('relation',relation::regclass::text,'mode',mode)) FROM pg_locks WHERE pid<>pg_backend_pid() AND granted AND relation IN ('users'::regclass,'subscriptions'::regclass,'answers'::regclass);").strip().splitlines()[-1])
            cluster.sql("BEGIN; SET LOCAL lock_timeout='30ms'; LOCK TABLE users,answers IN ROW EXCLUSIVE MODE; COMMIT;")
            checks.append('schema installs alongside user/answer writes and allows new study writes')
            assert not any(x['relation'] in ('users','answers') and x['mode'] not in ('RowExclusiveLock','AccessShareLock') for x in locks)
            checks.append('no new users or answers write-blocking lock');release(installer);release(busy)
            cluster.sql('BEGIN;'+bounded+'COMMIT;')
            assert cluster.sql("SELECT convalidated AND confdeltype='c' FROM pg_constraint WHERE conname='whop_paid_grant_receipts_owner_fkey';").strip().endswith('t')
            checks.append('validated composite owner FK retains cascade semantics')
            publish=(ROOT/'reviews/atomic-composite-2026-10-07/02_publish.sql').read_text()
            publish='\n'.join(line for line in publish.splitlines() if 'SET LOCAL transaction_timeout=' not in line)
            cluster.sql('BEGIN;'+publish+'COMMIT;')
            assert cluster.sql("SELECT count(*)=3 FROM pg_proc WHERE proname IN ('grant_whop_paid_subscription','repair_whop_user_access','commit_whop_revoke') AND pronamespace='public'::regnamespace;").strip().endswith('t')
            checks.append('exact guarded package publishes all three current functions')
            print(json.dumps({'local_postgres':'16.13','checks':checks,'observed_locks':locks,'production_actions':0,'pg17_transaction_timeout':'requires native readback'},indent=2))
        finally:
            for p in list(holders):release(p)
            cluster.stop()

if __name__=='__main__':main()
