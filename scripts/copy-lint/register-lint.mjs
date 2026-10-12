#!/usr/bin/env node
// Address-form lint ([name]'s pick-copy-register B, 2026-10-11: learner, mentor and site
// copy use Sie). Flags informal second-person forms (du, dich, dir, dein*, euch, euer*)
// in German strings. The site-wide Sie rewrite is one reviewed pass owned elsewhere, so
// CI checks ADDED lines only (--base <ref>); --all reports the existing backlog.
// German strings are `de:` properties and the first branch of a `lang === 'de' ? :`
// conditional. Legal pages, admin screens and tests are out of scope.
// Exit 0 clean, 1 on a new informal form, 2 on bad arguments or a read failure.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringLiterals } from './strings.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const ALLOW = fileURLToPath(new URL('./register-allow.json', import.meta.url));
export const INFORMAL = /(?<![\p{L}\p{N}_])(?:du|dich|dir|dein(?:e[nmrs]?)?|euch|euer|eure[nmrs]?)(?![\p{L}\p{N}_])/iu;
const OUT_OF_SCOPE = /^src\/app\/(?:privacy|terms|impressum|admin)\/|^src\/components\/admin\/|\.(?:test|spec)\.|^src\/lib\/i18n-extra\.ts$/;

export function scopedFiles(repo = ROOT) {
  return execFileSync('git', ['-C', repo, 'ls-files', '-z', 'src'], { encoding: 'utf8' }).split('\0')
    .filter(path => /\.tsx?$/.test(path) && !OUT_OF_SCOPE.test(path));
}

/** Added line numbers per path between `base` and the working tree. */
export function addedLines(repo, base, files) {
  const diff = execFileSync('git', ['-C', repo, 'diff', '-U0', '--no-color', '--no-ext-diff', base, '--', ...files],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
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

export function registerHits({ repo = ROOT, files = scopedFiles(repo), added = null, allow = [], readSource } = {}) {
  const read = readSource ?? (path => readFileSync(resolve(repo, path), 'utf8'));
  const hits = [];
  for (const path of files) {
    const lines = added?.get(path);
    if (added && !lines) continue;
    for (const s of stringLiterals(path, read(path))) {
      if (!s.german) continue;
      const m = INFORMAL.exec(s.text);
      if (!m) continue;
      if (lines && ![...Array(s.endLine - s.line + 1).keys()].some(i => lines.has(s.line + i))) continue;
      if (allow.some(a => a.path === path && s.text.includes(a.match) && a.reason)) continue;
      hits.push({ path, line: s.line, word: m[0], text: s.text.slice(0, 160) });
    }
  }
  return hits;
}

function parse(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--base' || a === '--report') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value: ${a}`);
      opts[a.slice(2)] = argv[++i];
    } else throw new Error(`Unknown option: ${a}`);
  }
  if (!opts.all === !opts.base) throw new Error('Pass exactly one of --base <ref> or --all');
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = parse(process.argv.slice(2));
    const allow = JSON.parse(readFileSync(ALLOW, 'utf8')).allowlist;
    if (!Array.isArray(allow)) throw new Error('allowlist must be an array');
    const files = scopedFiles();
    const added = opts.base ? addedLines(ROOT, opts.base, files) : null;
    const hits = registerHits({ files, added, allow });
    if (opts.report) writeFileSync(opts.report, JSON.stringify({ mode: opts.all ? 'all' : 'diff', base: opts.base ?? null, hits }, null, 2) + '\n');
    if (opts.all) {
      console.log(`register-lint --all: ${hits.length} informal German strings in ${new Set(hits.map(h => h.path)).size} files (backlog for the reviewed Sie pass)`);
      process.exitCode = 0;
    } else {
      for (const h of hits) console.log(`${h.path}:${h.line} informal "${h.word}" in new German copy (use Sie): ${JSON.stringify(h.text)}`);
      console.log(`register-lint: ${hits.length} new informal German strings since ${opts.base}`);
      process.exitCode = hits.length ? 1 : 0;
    }
  } catch (error) {
    console.error('register-lint:', error instanceof Error ? error.message : 'failed');
    process.exitCode = 2;
  }
}
