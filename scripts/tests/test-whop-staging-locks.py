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
    results = []
    with tempfile.TemporaryDirectory(prefix='medpruf-staging-locks-', dir='/tmp') as temp:
        cluster = fixture.LocalCluster(temp, fixture.find_bin_dir(None))
        holder = None
        def phase(number):
            text = next((ROOT/'reviews/atomic-staging-2026-10-07').glob(number+'*.sql')).read_text()
            # Local fixture is PG16. PG17 production transaction timeout remains
            # an explicit gate, not something this fixture claims to validate.
            return '\n'.join(line for line in text.splitlines() if 'transaction_timeout=' not in line)
        def hold(sql):
            process = subprocess.Popen([str(cluster.binaries/'psql'), '-X', '-qAt', '-h', temp,
                '-p', cluster.port, '-U', 'synthetic', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                env=cluster.env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True)
            process.stdin.write('BEGIN; '+sql+"; SELECT 'held';\n")
            process.stdin.flush()
            assert process.stdout.readline().strip() == 'held'
            return process
        def release(process):
            out, err = process.communicate('ROLLBACK;\n', timeout=5)
            assert process.returncode == 0, err
        def expect_failure(query, expected):
            try:
                cluster.sql(query)
            except RuntimeError as error:
                assert expected in str(error), str(error)
            else:
                raise AssertionError('Expected failure: '+expected)
        try:
            cluster.start()
            cluster.sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; "
                "CREATE TABLE users(id uuid PRIMARY KEY,role text,tier text,tier_expires_at timestamptz,updated_at timestamptz); "
                "CREATE TABLE subscriptions(id uuid PRIMARY KEY,user_id uuid,tier text,status text,payment_provider text,payment_method text,"
                "amount_cents integer,currency text,provider_payment_id text,granted_payment_ids jsonb,whop_membership_id text,"
                "started_at timestamptz,expires_at timestamptz,created_at timestamptz,updated_at timestamptz);")
            holder = hold('LOCK TABLE users,subscriptions IN ROW EXCLUSIVE MODE')
            cluster.sql(phase('01'))
            results.append('inaccessible stage commits while parent write locks are held')
            expect_failure(phase('02'), 'could not obtain lock')
            results.append('FK bind NOWAIT refuses active parent writes without queuing')
            expect_failure(phase('04'), 'Both expected receipt foreign keys')
            results.append('RPC publish refuses missing constraints')
            release(holder); holder = None
            assert cluster.sql("SELECT NOT has_table_privilege('service_role','whop_paid_grant_receipts','INSERT');").strip().endswith('t')
            results.append('service role cannot insert into staged table')
            holder = hold(phase('02').split('LOCK TABLE',1)[1].split('COMMIT;',1)[0].join(['LOCK TABLE','']))
            locks = cluster.sql("SELECT jsonb_agg(jsonb_build_object('relation',relation::regclass::text,'mode',mode)) "
                "FROM pg_locks WHERE pid<>pg_backend_pid() AND granted AND relation IN ('users'::regclass,'subscriptions'::regclass,'whop_paid_grant_receipts'::regclass);")
            expect_failure("BEGIN; SET LOCAL lock_timeout='30ms'; LOCK TABLE users IN ROW EXCLUSIVE MODE; COMMIT;", 'lock timeout')
            results.append('held FK-bind lock blocks newly arriving writes: still unsafe for zero disruption')
            release(holder); holder = None
            cluster.sql(phase('02'))
            expect_failure(phase('04'), 'Both expected receipt foreign keys')
            results.append('RPC publish refuses NOT VALID constraints')
            expect_failure("INSERT INTO whop_paid_grant_receipts(payment_id,user_id,subscription_id,grant_mode,granted_expires_at) "
                "VALUES ('orphan','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','inserted',now());", 'foreign key constraint')
            results.append('NOT VALID constraints already reject new orphan receipts')
            holder = hold('LOCK TABLE users,subscriptions IN ROW EXCLUSIVE MODE')
            cluster.sql(phase('03'))
            results.append('FK validation commits alongside parent write locks')
            release(holder); holder = None
            cluster.sql('ALTER TABLE whop_paid_grant_receipts DROP CONSTRAINT whop_paid_grant_receipts_user_id_fkey; '
                'ALTER TABLE whop_paid_grant_receipts ADD CONSTRAINT whop_paid_grant_receipts_user_id_fkey '
                'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;')
            expect_failure(phase('04'), 'Both expected receipt foreign keys')
            results.append('publish guard refuses changed deletion semantics')
            cluster.sql('ALTER TABLE whop_paid_grant_receipts DROP CONSTRAINT whop_paid_grant_receipts_user_id_fkey; '
                'ALTER TABLE whop_paid_grant_receipts ADD CONSTRAINT whop_paid_grant_receipts_user_id_fkey '
                'FOREIGN KEY (subscription_id) REFERENCES users(id) ON DELETE CASCADE;')
            expect_failure(phase('04'), 'Both expected receipt foreign keys')
            results.append('publish guard refuses wrong receipt FK column')
            cluster.sql('ALTER TABLE whop_paid_grant_receipts DROP CONSTRAINT whop_paid_grant_receipts_user_id_fkey; '
                'ALTER TABLE whop_paid_grant_receipts ADD CONSTRAINT whop_paid_grant_receipts_user_id_fkey '
                'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;')
            cluster.sql(phase('04'))
            assert cluster.sql("SELECT count(*)=2 FROM pg_constraint WHERE conrelid='whop_paid_grant_receipts'::regclass AND contype='f' AND convalidated AND confdeltype='c';").strip().endswith('t')
            results.append('published schema retains two validated cascading FKs and original RPC bodies')
            report={'local_postgres':'16.13','production_postgres':'17.6','checks':results,'bind_locks':json.loads(locks.splitlines()[-1]),
                'production_actions':0,'conclusion':'Stage and validation are write-compatible; FK binding remains deferred and cannot promise zero write delay.'}
            print(json.dumps(report,indent=2))
        finally:
            if holder: release(holder)
            cluster.stop()

if __name__ == '__main__': main()
