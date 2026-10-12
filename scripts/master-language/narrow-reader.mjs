#!/usr/bin/env node
// Narrow-reader ratchet (LX-19, a10). A "narrow reader" picks German or English
// only: a getLang() call, or an inline `lang === 'de' ? ... : ...` ternary.
// Such a file can never render a reviewed ru/uk/tr/ar overlay. The baseline
// (narrow-reader-baseline.json) records today's debt per learner file; the unit
// test tests/unit/master-locale/storage-glossary.test.ts ("LX-19 narrow-reader ratchet") fails when a file that
// is not in the baseline starts using getLang(), or when a file's ternary count
// grows. Counts may only go down; lower the baseline with --write.
// Usage: node scripts/master-language/narrow-reader.mjs [--write] [--json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../..");
export const BASELINE_PATH = path.join(here, "narrow-reader-baseline.json");

const GETLANG_RE = /\bgetLang\s*\(\s*\)/g;
const TERNARY_RE = /\b(?:lang|l|activeLang|uiLang|language)\s*===?\s*["']de["']\s*\?/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Learner source files only: admin, API routes and the i18n modules are out of scope. */
function inScope(rel) {
  if (rel.startsWith("src/app/admin/") || rel.startsWith("src/app/api/") || rel.startsWith("src/components/admin/")) return false;
  if (/^src\/lib\/(i18n|language-model|master-locale\/)/.test(rel)) return false;
  return true;
}

export function scan(root = ROOT) {
  const files = {};
  for (const abs of walk(path.join(root, "src"))) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (!inScope(rel)) continue;
    const text = fs.readFileSync(abs, "utf8");
    const getLang = (text.match(GETLANG_RE) || []).length;
    const ternaries = (text.match(TERNARY_RE) || []).length;
    if (getLang || ternaries) files[rel] = { getLang, ternaries };
  }
  return files;
}

export function compare(current, baseline) {
  const problems = [];
  for (const [file, c] of Object.entries(current)) {
    const b = baseline[file] ?? { getLang: 0, ternaries: 0 };
    if (c.getLang > b.getLang) problems.push(`${file}: getLang() calls ${c.getLang} > baseline ${b.getLang} (use useLang() + t())`);
    if (c.ternaries > b.ternaries) problems.push(`${file}: inline lang ternaries ${c.ternaries} > baseline ${b.ternaries} (add i18n keys and use t())`);
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const current = scan();
  const args = process.argv.slice(2);
  if (args.includes("--write")) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify({ note: "Narrow-reader debt per learner file. Lower only (node scripts/master-language/narrow-reader.mjs --write).", files: current }, null, 2) + "\n");
  }
  const totals = Object.values(current).reduce((a, c) => ({ getLang: a.getLang + c.getLang, ternaries: a.ternaries + c.ternaries }), { getLang: 0, ternaries: 0 });
  if (args.includes("--json")) console.log(JSON.stringify({ totals, files: current }, null, 2));
  else console.log(`files: ${Object.keys(current).length}  getLang(): ${totals.getLang}  inline ternaries: ${totals.ternaries}`);
}
