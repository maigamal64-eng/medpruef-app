#!/usr/bin/env python3
"""Synthetic PostgreSQL study RPC regression. Never connects to an existing DB.

Run from a repository: python3 scripts/tests/test-study-rpc.py
Or use --repo /path/to/repository and optionally --bin-dir /path/to/postgres/bin.
Requires local PostgreSQL binaries. No Python dependencies or live credentials.
Timings are observations, not pass/fail thresholds or production guarantees.
"""

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile

ORIGINAL_MIGRATION = '20260925170000_study_modes_and_answer_retry.sql'
CANDIDATE_MIGRATION = '20261007090000_study_rpc_mode_plans.sql'
ORIGINAL_FUNCTION = 'original_study_question_ids'
CANDIDATE_FUNCTION = 'get_study_question_ids'


def find_bin_dir(explicit):
    if explicit:
        directory = Path(explicit).resolve()
    elif shutil.which('postgres'):
        directory = Path(shutil.which('postgres')).resolve().parent
    elif shutil.which('pg_config'):
        directory = Path(subprocess.check_output(
            [shutil.which('pg_config'), '--bindir'], text=True,
            env={'PATH': os.defpath, 'LANG': 'C'}, timeout=10,
        ).strip())
    else:
        raise RuntimeError('Install local PostgreSQL or provide --bin-dir.')
    for name in ('postgres', 'initdb', 'pg_ctl', 'psql'):
        if not (directory / name).is_file():
            raise RuntimeError(f'Missing PostgreSQL binary: {directory / name}')
    return directory


class LocalCluster:
    def __init__(self, root, binaries):
        self.root = Path(root)
        self.binaries = binaries
        # TCP is disabled. A fresh socket directory makes this port unique to
        # this cluster even if another server happens to use the same number.
        self.port = str(49152 + secrets.randbelow(16384))
        self.started = False
        self.env = {'PATH': str(binaries) + os.pathsep + os.defpath,
                    'LANG': 'C', 'TZ': 'UTC', 'TMPDIR': str(self.root)}

    def command(self, name, *args, input=None):
        result = subprocess.run(
            [str(self.binaries / name), *map(str, args)],
            env=self.env, input=input, text=True, capture_output=True,
            timeout=55,
        )
        if result.returncode:
            raise RuntimeError(f'{name} failed: {result.stderr.strip()}')
        return result.stdout

    def start(self):
        self.command('initdb', '-D', self.root / 'cluster', '-U', 'synthetic',
                     '-A', 'trust', '--no-locale', '--encoding=UTF8')
        self.command('pg_ctl', '-D', self.root / 'cluster', '-l', self.root / 'postgres.log',
                     '-o', f"-p {self.port} -k {self.root} -c listen_addresses='' "
                     '-c shared_buffers=64MB -c max_connections=10', '-w', 'start')
        self.started = True

    def stop(self):
        # Also try after a partially failed startup. Keep the temporary data
        # alive if shutdown fails instead of deleting a running cluster's files.
        if self.started or (self.root / 'cluster' / 'postmaster.pid').exists():
            self.command('pg_ctl', '-D', self.root / 'cluster', '-m', 'fast', '-w', 'stop')
        self.started = False

    def sql(self, query):
        return self.command('psql', '-X', '-h', self.root, '-p', self.port,
                            '-U', 'synthetic', '-d', 'postgres',
                            '-v', 'ON_ERROR_STOP=1', '-At',
                            input="SET statement_timeout='4s';\n" + query)

    def explain(self, query):
        output = self.sql('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query)
        return json.loads(output[output.index('['):])[0]


fixture = '''
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE questions(id integer PRIMARY KEY, is_active boolean NOT NULL, exam_type text NOT NULL, topic text, tags text[], exam_dates text[], question text, answer text, choices jsonb);
CREATE TABLE answer_history(id bigserial PRIMARY KEY, user_id uuid NOT NULL, question_id integer NOT NULL, is_correct boolean NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE user_question_progress(user_id uuid NOT NULL, question_id integer NOT NULL, next_review_at timestamptz, UNIQUE(user_id, question_id));
INSERT INTO questions SELECT i, i % 97 <> 0, CASE WHEN i <= 10000 THEN 'kenntnispruefung' WHEN i <= 11500 THEN 'kmp_innsbruck' ELSE 'pharma' END,
 'Topic '||(i%16), ARRAY['tag'||(i%4)], ARRAY['2026-09','2026'], 'Synthetic stem '||i, 'Synthetic answer '||i, CASE WHEN i%17=0 THEN NULL ELSE '[{"text":"A"},{"text":"B"}]'::jsonb END FROM generate_series(1,12000) i;
-- Near-exhausted unseen learner: 149,250 duplicate answer attempts.
INSERT INTO answer_history(user_id,question_id,is_correct) SELECT '00000000-0000-0000-0000-000000000001', i, n%3 <> 0 FROM generate_series(1,9950) i CROSS JOIN generate_series(1,15) n;
-- Sparse wrong learner: repeated correct attempts except five wrong questions near the end.
INSERT INTO answer_history(user_id,question_id,is_correct) SELECT '00000000-0000-0000-0000-000000000002', i, NOT(i IN (9901,9921,9941,9961,9981) AND n=1) FROM generate_series(1,10000) i CROSS JOIN generate_series(1,15) n;
INSERT INTO user_question_progress SELECT '00000000-0000-0000-0000-000000000003', i, CASE WHEN i IN (9902,9922,9942,9962,9982) THEN now()-interval '1 day' ELSE now()+interval '30 days' END FROM generate_series(1,10000) i;
CREATE INDEX answer_history_user_question_id_idx ON answer_history(user_id,question_id);
CREATE INDEX idx_questions_exam_topic_active ON questions(exam_type,topic) WHERE is_active;
ANALYZE;
'''
def args_for(mode, changes=None):
    values = {'p_user_id': "'00000000-0000-0000-0000-00000000000"+str({'unseen':1,'wrong':2,'review':3}.get(mode,1))+"'::uuid", 'p_mode': "'"+mode+"'::text", 'p_exam_types': "ARRAY['kenntnispruefung']::text[]", 'p_topics': 'NULL::text[]', 'p_tags':'NULL::text[]', 'p_exam_dates':'NULL::text[]','p_exam_year':'NULL::text[]','p_search':'NULL::text','p_mcq_only':'false','p_exclude_ids':'NULL::integer[]','p_allowed_ids':'NULL::integer[]','p_limit':'20','p_offset':'0'}
    values.update(changes or {})
    return values

def function_call(name, values):
    return name+'('+','.join(values.values())+')'
combinations = [({},'default'),({'p_limit':'1'},'single'),({'p_limit':'200','p_offset':'2'},'pagination'),({'p_topics':"ARRAY['Topic 9']::text[]"},'topic'),({'p_tags':"ARRAY['tag1']::text[]"},'tag'),({'p_exam_dates':"ARRAY['2026-09']::text[]"},'date'),({'p_exam_year':"ARRAY['2026']::text[]"},'year'),({'p_search':"'Synthetic stem 99'::text"},'search'),({'p_mcq_only':'true'},'mcq'),({'p_exclude_ids':'ARRAY[9901,9902,9951,9952]::integer[]'},'exclude'),({'p_allowed_ids':'ARRAY[9901,9902,9951,9952,9981,9982]::integer[]'},'free-allowance'),({'p_topics':'ARRAY[]::text[]','p_tags':'ARRAY[]::text[]','p_allowed_ids':'ARRAY[]::integer[]'},'empty-arrays'),({'p_exam_types':"ARRAY['pharma']::text[]"},'other-exam'),({'p_limit':'-1','p_offset':'-2'},'negative-pagination'),({'p_limit':'NULL::integer','p_offset':'NULL::integer'},'null-pagination')]


def compare(cluster, values):
    left = function_call(ORIGINAL_FUNCTION, values)
    right = function_call(CANDIDATE_FUNCTION, values)
    # WITH ORDINALITY compares the returned sequence, including pagination,
    # duplicate IDs and ordering. Empty results compare as empty arrays.
    def ordered(call):
        return "COALESCE((SELECT array_agg(question_id ORDER BY ordinal) " \
               f"FROM {call} WITH ORDINALITY AS rows(question_id, ordinal)), ARRAY[]::integer[])"
    query = 'SELECT ' + ordered(left) + ' IS NOT DISTINCT FROM ' + ordered(right) + ';'
    return cluster.sql(query).strip().splitlines()[-1] == 't'


def run(cluster, repo, report):
    original_path = repo / 'supabase' / 'migrations' / ORIGINAL_MIGRATION
    candidate_path = repo / 'supabase' / 'migrations' / CANDIDATE_MIGRATION
    original = original_path.read_text().split('-- Optional client token')[0]
    # Keep the historical implementation under a private fixture-only name.
    original = original.replace('get_study_question_ids', ORIGINAL_FUNCTION)
    candidate = candidate_path.read_text()
    report['postgres_version'] = cluster.command('postgres', '--version').strip()
    report['migrations'] = [str(original_path), str(candidate_path)]
    cluster.sql(fixture + original + candidate)
    failures = []
    for mode in ('unseen', 'wrong', 'review', 'invalid'):
        for changes, label in combinations:
            equivalent = compare(cluster, args_for(mode, changes))
            report['equivalence'].append({'mode': mode, 'filter': label,
                                          'ordered_equivalent': equivalent})
            if not equivalent:
                failures.append(f'{mode}/{label}')
    if failures:
        raise AssertionError('Ordered result mismatch: ' + ', '.join(failures))

    for mode in ('unseen', 'wrong', 'review'):
        entry = {'mode': mode, 'timings_ms': {}, 'plans': {}}
        for name in (ORIGINAL_FUNCTION, CANDIDATE_FUNCTION):
            measurements = []
            for _ in range(4):
                plan = cluster.explain('SELECT * FROM ' + function_call(name, args_for(mode)))
                measurements.append(plan['Execution Time'])
            entry['timings_ms'][name] = measurements
            entry['plans'][name] = plan
        report['cases'].append(entry)

    # This deliberately degraded scenario reproduces the timeout class if the
    # planner chooses it. Variability or absence of a timeout does not fail CI.
    cluster.sql('DROP INDEX answer_history_user_question_id_idx; ANALYZE answer_history;')
    for mode in ('unseen', 'wrong'):
        for name in (ORIGINAL_FUNCTION, CANDIDATE_FUNCTION):
            entry = {'mode': mode, 'function': name}
            try:
                plan = cluster.explain('SELECT * FROM ' + function_call(name, args_for(mode)))
                entry['ms'] = plan['Execution Time']
                entry['plan'] = plan
            except RuntimeError as error:
                if 'canceling statement due to statement timeout' not in str(error):
                    raise
                entry['statement_timeout'] = True
            report['missing_history_index'].append(entry)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--bin-dir', type=Path)
    parser.add_argument('--output', type=Path, help='Optional durable JSON report, including plans')
    options = parser.parse_args()
    report = {'equivalence': [], 'cases': [], 'missing_history_index': [], 'server_stopped': False}
    status = 0
    temporary = tempfile.TemporaryDirectory(prefix='medpruf-study-perf-', dir='/tmp')
    cluster = None
    stopped = False
    try:
        cluster = LocalCluster(temporary.name, find_bin_dir(options.bin_dir))
        cluster.start()
        run(cluster, options.repo.resolve(), report)
    except Exception as error:
        report['error'] = str(error)
        status = 1
    finally:
        try:
            if cluster:
                cluster.stop()
            stopped = True
            report['server_stopped'] = True
        except Exception as error:
            report['shutdown_error'] = str(error)
            report['preserved_cluster_path'] = temporary.name
            # Avoid TemporaryDirectory's automatic deletion of a still-running
            # server. Preserve it for a manual, explicitly scoped pg_ctl stop.
            temporary._finalizer.detach()
            status = 1
        if stopped:
            temporary.cleanup()
    if options.output:
        options.output.write_text(json.dumps(report, indent=2) + '\n')
    summary = {
        'ordered_equivalence_checks': len(report['equivalence']),
        'ordered_equivalence_failures': sum(not row['ordered_equivalent'] for row in report['equivalence']),
        'timings': [{'mode': row['mode'], 'timings_ms': row['timings_ms']} for row in report['cases']],
        'missing_history_index': [{k: v for k, v in row.items() if k != 'plan'} for row in report['missing_history_index']],
        'server_stopped': report['server_stopped'],
    }
    for key in ('error', 'shutdown_error', 'preserved_cluster_path'):
        if key in report:
            summary[key] = report[key]
    print(json.dumps(summary, indent=2))
    return status


if __name__ == '__main__':
    sys.exit(main())
