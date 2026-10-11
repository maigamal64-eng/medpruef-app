#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { ROOT, POLICY, argumentsFor, hash, isMain, sourceLines } from './date-watch/truth-utils.mjs';

const TYPES = ['kenntnispruefung', 'kmp_innsbruck', 'pharma'];
const NUMBER = /(?<![\w\\])(?<prefix>over\s+|more than\s+|über\s+|mehr als\s+|at least\s+|mindestens\s+)?(?<number>\d{1,3}(?:[.,\u00a0 ]\d{3})+|\d+)(?<plus>\s*\+)?\s+(?:(?:curated|clinical|medical|practice|real|Austrian|original|official|exam|multiple[ -]choice|kuratierte[nr]?|klinische[nr]?|medizinische[nr]?|echte[nr]?|österreichische[nr]?|MCQ)[ -]+){0,5}(?:questions|exercises|Fragen|Übungsfragen|Prüfungsfragen|Übungen)\b/gi;

export function extractCounts(lines) {
  return lines.flatMap(({ path, line, text }) => [...text.replace(/\\[nrt]/g, '  ').matchAll(NUMBER)].map(m => {
    const count = Number(m.groups.number.replace(/[.,\u00a0 ]/g, ''));
    const after = text.slice(m.index + m[0].length);
    if (/^\s*(?:gratis|kostenlos|free|per\s+(?:month|day)|\/month)\b/i.test(after)
      || /\b(?:free|gratis|kostenlose?)\s*$/i.test(text.slice(0, m.index))) return null;
    const prefix = (m.groups.prefix || '').toLowerCase();
    const mode = /over|more than|über|mehr als/.test(prefix) ? 'greater-than' : (prefix || m.groups.plus) ? 'at-least' : 'approximate';
    // A literal per-track number must name the track in the same clause. Otherwise the claim is global.
    const clause = text.replace(/\\[nrt]/g, '  ').slice(0, m.index).split(/['"`]|[;.!?](?!\d)/).at(-1);
    const examType = /(?:Stichprobentest|Innsbruck)\s*[:(]?\s*$/i.test(clause) ? 'kmp_innsbruck'
      : /(?:Pharma(?:kologie|cology)?|Rezeptierkunde)\s*[:(]?\s*$/i.test(clause) ? 'pharma'
      : /(?:SIP4a|SIP5a|Wien|Vienna)\s*[:(]?\s*$/i.test(clause) ? 'kenntnispruefung' : 'total';
    if (count < 1000 && examType === 'total') return null;
    return { path, line, sha256: hash(text.trim()), raw: m[0], claimed: count, mode, exam_type: examType };
  })).filter(Boolean);
}

export function checkCounts(claims, counts, tolerance = 0.02, exclusions = []) {
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.1) throw new Error('Tolerance must be between 0 and 0.1');
  for (const key of ['total', ...TYPES]) {
    if (!Number.isSafeInteger(counts[key]) || counts[key] < 0) throw new Error('Missing or invalid count');
  }
  if (counts.total !== TYPES.reduce((sum, type) => sum + counts[type], 0)) throw new Error('Active count totals disagree');
  const results = claims.map(c => {
    const exclusion = exclusions.find(e => e.path === c.path && e.line === c.line && e.sha256 === c.sha256 && e.reason);
    if (exclusion) return { ...c, status: 'non-public-context', reason: exclusion.reason };
    const actual = counts[c.exam_type];
    if (!Number.isSafeInteger(c.claimed) || actual === undefined) throw new Error('Invalid public claim');
    const ok = c.mode === 'greater-than' ? actual > c.claimed : c.mode === 'at-least' ? actual >= c.claimed
      : Math.abs(actual - c.claimed) <= Math.ceil(c.claimed * tolerance);
    return { ...c, actual, delta: actual - c.claimed, tolerance: c.mode === 'approximate' ? tolerance : 0, status: ok ? 'OK' : 'FAIL' };
  });
  return { ok: results.every(r => r.status !== 'FAIL'), counts, claims_checked: results.length,
    failures: results.filter(r => r.status === 'FAIL').length, results };
}

// Counts only: GET selects id, never learner data or question content.
export async function readCounts({ envPath, fetchImpl = fetch }) {
  const env = envPath ? parseEnv(readFileSync(resolve(envPath), 'utf8')) : process.env;
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (url.protocol !== 'https:' || url.username || url.password || !key) throw new Error('Invalid count credentials');
  const entries = await Promise.all(['total', ...TYPES].map(async type => {
    const endpoint = new URL('/rest/v1/questions', url);
    endpoint.searchParams.set('select', 'id');
    endpoint.searchParams.set('is_active', 'eq.true');
    endpoint.searchParams.set('limit', '1');
    if (type !== 'total') endpoint.searchParams.set('exam_type', `eq.${type}`);
    const response = await fetchImpl(endpoint, { method: 'GET', headers: {
      apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0',
    }, signal: AbortSignal.timeout(30_000), redirect: 'error' });
    const range = response.headers.get('content-range') || '';
    const count = /\/(\d+)$/.exec(range)?.[1];
    if (!response.ok || !count) throw new Error('Exact count unavailable');
    await response.arrayBuffer();
    return [type, Number(count)];
  }));
  return Object.fromEntries(entries);
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const opts = argumentsFor(argv, { '--repo': 'value', '--env-file': 'value', '--report': 'value', '--tolerance': 'value', '--strict': 'flag' });
    const counts = await readCounts({ envPath: opts['--env-file'] });
    const policy = JSON.parse(readFileSync(POLICY, 'utf8'));
    const report = { ran_at: new Date().toISOString(), source: 'PostgREST GET active questions, count=exact',
      ...checkCounts(extractCounts(sourceLines(opts['--repo'] || ROOT)), counts, opts['--tolerance'] === undefined ? 0.02 : Number(opts['--tolerance']), opts['--strict'] ? [] : policy.count_exclusions || []) };
    const output = JSON.stringify(report, null, 2) + '\n';
    if (opts['--report']) writeFileSync(opts['--report'], output);
    process.stdout.write(output);
    return report.ok ? 0 : 1;
  } catch {
    // Do not serialize fetch errors or environment values into logs.
    console.error('check-public-counts: cannot verify exact active counts, repository or arguments');
    return 2;
  }
}
if (isMain(import.meta.url)) process.exitCode = await main();
