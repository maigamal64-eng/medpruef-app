#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { ROOT, POLICY, argumentsFor, isMain, logicalBlocks, sourceLocation, sourceLines } from './date-watch/truth-utils.mjs';

export const RULES = [
  { id: 'unverified-pass-rate-translation', pattern: /["']landing_pass_rate["']\s*:\s*["'][^"'\n]*\d+\s*%/gi },
  { id: 'unverified-pass-rate', pattern: /\b\d+(?:[.,]\d+)?\s*%\s*(?:pass(?:ing)?\s+rate|success\s+rate|Bestehensquote|Erfolgsquote)/gi },
  { id: 'guaranteed-pass', pattern: /(?:\b(?:guaranteed|guarantees?|100%)\s+(?:exam\s+)?(?:pass(?:ing)?|success)|\b(?:bestehen|Prüfungserfolg)\s+garantiert|garantiert(?:es)?\s+Bestehen)/gi },
  { id: 'official-questions', pattern: /\b(?:(?:real|original|official|actual)\s+(?:Austrian\s+)?(?:exam|test)\s+questions|(?:echte[nr]?|originale[nr]?|offizielle[nr]?)\s+(?:österreichische[nr]?\s+)?Prüfungsfragen)/gi },
  { id: 'complete-simulation', pattern: /\b(?:(?:full|complete|exact|100%)\s+(?:official\s+)?exam\s+simulation|vollständig(?:e[nr]?)?\s+Prüfungssimulation|vollständig(?:e[nr]?)?\s+Simulation\s+unter\s+den\s+echten\s+Bedingungen)/gi },
  { id: 'complete-coverage', pattern: /\b(?:(?:all|every)\s+(?:official\s+)?exam\s+questions|complete\s+(?:exam|curriculum)\s+coverage|alle\s+(?:offiziellen\s+)?Prüfungsfragen|vollständige\s+(?:Prüfungs|Curriculum)[ -]?abdeckung)/gi },
  { id: 'official-affiliation', pattern: /\b(?:official\s+(?:MedUni|university|exam)\s+partner|offizieller?\s+Partner\s+(?:der\s+)?(?:MedUni|Universität)|endorsed\s+by\s+(?:MedUni|the\s+university))/gi },
];

// Negation belongs to the matched clause, never to a different sentence on the same line.
function negated(text, start) {
  const before = text.slice(0, start).split(/[.!?;]|['"`]/).at(-1);
  return /\b(?:not|no|never|keine?[nrs]?|nicht)\s+(?:(?:fully|a|an|eine?|mehr)\s+)?$/i.test(before);
}

export function checkClaims(lines, allowlist = [], { strict = false } = {}) {
  const results = [];
  for (const block of logicalBlocks(lines)) {
    const { text } = block;
    for (const rule of RULES) {
      for (const match of text.matchAll(rule.pattern)) {
        if (negated(text, match.index)) continue;
        const { path, line, sha256: fingerprint } = sourceLocation(block, match.index, match[0].length);
        const entry = allowlist.find(a => a.path === path && a.rule === rule.id && a.sha256 === fingerprint && a.reason);
        // The occurrence index prevents a repeated new claim on an otherwise unchanged line passing.
        const allowed = entry && line === entry.line;
        const matched = rule.id === 'unverified-pass-rate-translation'
          ? `landing_pass_rate: ${/\d+\s*%/.exec(match[0])[0]}` : match[0];
        results.push({ path, line, rule: rule.id, match: matched, sha256: fingerprint,
          status: allowed ? 'existing-needs-track-a' : 'FAIL', reason: allowed ? entry.reason : 'Unreviewed public claim',
          blocking: strict || !allowed });
      }
    }
  }
  return { ok: lines.length > 0 && !results.some(r => r.blocking), files_scanned: new Set(lines.map(l => l.path)).size,
    hits: results.length, failures: results.filter(r => r.blocking).length, results };
}

export function main(argv = process.argv.slice(2)) {
  try {
    const opts = argumentsFor(argv, { '--repo': 'value', '--allowlist': 'value', '--report': 'value', '--strict': 'flag' });
    const policy = JSON.parse(readFileSync(opts['--allowlist'] || POLICY, 'utf8'));
    if (!Array.isArray(policy.allowlist)) throw new Error('Policy requires an allowlist array');
    const report = { ran_at: new Date().toISOString(), ...checkClaims(sourceLines(opts['--repo'] || ROOT), policy.allowlist, { strict: opts['--strict'] }) };
    const output = JSON.stringify(report, null, 2) + '\n';
    if (opts['--report']) writeFileSync(opts['--report'], output);
    process.stdout.write(output);
    return report.ok ? 0 : 1;
  } catch {
    console.error('claims-check: unable to read repository or policy, or invalid arguments');
    return 2;
  }
}
if (isMain(import.meta.url)) process.exitCode = main();
