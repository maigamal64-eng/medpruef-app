#!/usr/bin/env node
// UX-GLOBAL-07 copy rules on learner-facing strings in the i18n catalogues, the
// changelog, paywall and billing copy, the email templates and every file that sends
// mail through Zoho:
//   dash           no U+2013 or U+2014
//   internal-term  no internal process terms (W1-B, NOTES.md, SoT, raw exam keys)
// Admin-tagged changelog entries, comments, console/Sentry output and machine error
// codes are not copy and are ignored. Exit 0 clean, 1 on any hit, 2 on a read failure.
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringLiterals } from './strings.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXED = [/^src\/lib\/i18n[^/]*\.ts$/, /^src\/lib\/changelog\.ts$/, /^src\/lib\/paywall-copy\.ts$/, /^src\/lib\/billing-copy\.ts$/, /^src\/lib\/email\/[^/]+\.tsx?$/];
const SENDS_MAIL = /from\s+["']@\/lib\/email\/zoho["']/;
export const RULES = [
  { id: 'dash', pattern: /[–—]/ },
  { id: 'internal-term', pattern: /\bW1-B\b|CLAUDE\.md|\bSoT\b|\bkmp_innsbruck\b|\bdecisions\.json\b/ },
];

export function scopedFiles(repo = ROOT) {
  const tracked = execFileSync('git', ['-C', repo, 'ls-files', '-z', 'src'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  return tracked.filter(path => /\.tsx?$/.test(path) && !/\.(?:test|spec)\./.test(path)
    && (FIXED.some(re => re.test(path)) || SENDS_MAIL.test(readFileSync(resolve(repo, path), 'utf8'))));
}

// Line ranges of changelog entries tagged "admin" (hidden from learners).
function adminRanges(path, source) {
  if (!/changelog\.ts$/.test(path)) return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const line = pos => file.getLineAndCharacterOfPosition(pos).line + 1;
  const ranges = [];
  const visit = node => {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(p => ts.isPropertyAssignment(p)
      && ts.isIdentifier(p.name) && p.name.text === 'tag' && ts.isStringLiteral(p.initializer) && p.initializer.text === 'admin')) {
      ranges.push([line(node.getStart(file)), line(node.getEnd())]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return ranges;
}

/** Public copy in JSON registers: every string under a `de` or `en` key. */
export const JSON_COPY = ['src/lib/guidance-data/learning-claims.copy.json', 'src/lib/guidance-data/bank-provenance.data.json', 'src/lib/guidance-data/wien-deadlines.data.json'];
export function jsonCopyHits(repo = ROOT, files = JSON_COPY, read = path => readFileSync(resolve(repo, path), 'utf8')) {
  const hits = [];
  const walk = (node, path, trail) => {
    if (Array.isArray(node)) node.forEach((v, i) => walk(v, path, `${trail}[${i}]`));
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, path, `${trail}.${k}`);
    else if (typeof node === 'string' && /\.(?:de|en)$/.test(trail)) {
      for (const rule of RULES) if (rule.pattern.test(node)) hits.push({ path, line: trail, rule: rule.id, text: node.slice(0, 160) });
    }
  };
  for (const path of files) walk(JSON.parse(read(path)), path, '$');
  return hits;
}

export function copyHits(repo = ROOT, files = scopedFiles(repo), readSource = path => readFileSync(resolve(repo, path), 'utf8')) {
  const hits = [];
  for (const path of files) {
    const source = readSource(path);
    const admin = adminRanges(path, source);
    for (const s of stringLiterals(path, source)) {
      if (admin.some(([a, b]) => s.line >= a && s.line <= b)) continue;
      for (const rule of RULES) if (rule.pattern.test(s.text)) hits.push({ path, line: s.line, rule: rule.id, text: s.text.slice(0, 160) });
    }
  }
  return hits;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const files = scopedFiles();
    const hits = [...copyHits(ROOT, files), ...jsonCopyHits()];
    for (const h of hits) console.log(`${h.path}:${h.line} ${h.rule}: ${JSON.stringify(h.text)}`);
    console.log(`copy-lint: ${files.length} files, ${hits.length} hits`);
    process.exitCode = hits.length ? 1 : 0;
  } catch (error) {
    console.error('copy-lint: unable to read repository', error instanceof Error ? error.message : '');
    process.exitCode = 2;
  }
}
