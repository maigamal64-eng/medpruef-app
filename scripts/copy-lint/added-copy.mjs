#!/usr/bin/env node
// Prints the learner-facing text added between two commits, one string per line,
// for check-dates --stdin (G05). Only string literals and JSX text count, so code
// comments, sitemap stamps and admin or API files never reach the date check.
// Usage: node scripts/copy-lint/added-copy.mjs --base <ref> [--head <ref>]
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringLiterals } from './strings.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const IN_SCOPE = /^(?:src\/app\/.*\.tsx?|src\/lib\/i18n[^/]*\.ts|src\/components\/seo\/.*\.tsx?)$/;
const OUT_OF_SCOPE = /^src\/app\/(?:admin|api)\/|\/(?:sitemap|robots|opengraph-image|twitter-image)\.tsx?$|\.(?:test|spec)\./;

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Added line numbers per path for base..head. */
export function addedLinesBetween(repo, base, head) {
  const diff = git(repo, ['diff', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=AM', base, head]);
  const added = new Map();
  let path = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) { path = line === '+++ /dev/null' ? null : line.slice(6); continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && path) {
      const start = Number(hunk[1]); const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      const set = added.get(path) ?? new Set();
      for (let i = 0; i < count; i++) set.add(start + i);
      added.set(path, set);
    }
  }
  return added;
}

export function addedCopy(repo, base, head = 'HEAD') {
  const out = [];
  for (const [path, lines] of addedLinesBetween(repo, base, head)) {
    if (!IN_SCOPE.test(path) || OUT_OF_SCOPE.test(path)) continue;
    const source = git(repo, ['show', `${head}:${path}`]);
    const sourceLines = source.split('\n');
    for (const s of stringLiterals(path, source)) {
      if (![...Array(s.endLine - s.line + 1).keys()].some(i => lines.has(s.line + i))) continue;
      // Keep the date-ok escape hatch: a marker on the string's own lines exempts it.
      const marked = sourceLines.slice(s.line - 1, s.endLine).some(l => l.includes('date-ok:'));
      out.push(`${path}:${s.line} ${s.text.replace(/\s+/g, ' ').trim()}${marked ? ' date-ok: marked in source' : ''}`);
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < argv.length; i++) {
      if (!['--base', '--head'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('-')) throw new Error(`Bad option ${argv[i]}`);
      opts[argv[i].slice(2)] = argv[++i];
    }
    if (!opts.base) throw new Error('--base is required');
    process.stdout.write(addedCopy(ROOT, opts.base, opts.head ?? 'HEAD').join('\n') + '\n');
  } catch (error) {
    console.error('added-copy:', error instanceof Error ? error.message : 'failed');
    process.exitCode = 2;
  }
}
