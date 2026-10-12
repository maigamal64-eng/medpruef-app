#!/usr/bin/env node
// Lists, per learner route, the source files reachable from its page.tsx that
// pick a language (getLang, getUiLang, useLang, t(, or an inline lang ternary).
// Static and read-only. Routes with zero language-aware files are flagged.
// Usage: node scripts/master-language/lang-coverage-check.mjs [--json] [--out file] [--strict]
//   --strict exits 1 when a non-admin route has zero language-aware files
//   (and is not in the DE-only allowlist).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const src = path.join(root, "src");
const allow = JSON.parse(fs.readFileSync(path.join(here, "allowlist.json"), "utf8"));

const LANG_RE = /\b(getLang|getUiLang|useLang|useUiLang)\s*\(|\bt\(\s*['"`][\w.-]+['"`]\s*,|\blang\s*===?\s*['"](de|en)['"]\s*\?|\bisDe\b\s*\?|\blang\s*===?\s*['"]ar['"]/;
const IMPORT_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function resolveImport(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(src, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base + ".tsx", base + ".ts", path.join(base, "index.tsx"), path.join(base, "index.ts"), base]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function reach(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    let text;
    try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
    for (const m of text.matchAll(IMPORT_RE)) {
      const r = resolveImport(f, m[1]);
      if (r && /\.(tsx|ts)$/.test(r) && !seen.has(r)) stack.push(r);
    }
  }
  return [...seen];
}

const pages = walk(path.join(src, "app")).filter((p) => p.endsWith(`${path.sep}page.tsx`));
const rows = pages
  .map((p) => {
    const route = "/" + path.relative(path.join(src, "app"), path.dirname(p)).split(path.sep).join("/");
    const r = route === "/." ? "/" : route;
    const files = reach(p);
    const langFiles = files.filter((f) => {
      try { return LANG_RE.test(fs.readFileSync(f, "utf8")); } catch { return false; }
    });
    return {
      route: r,
      admin: r.startsWith("/admin"),
      files_reached: files.length,
      lang_files: langFiles.map((f) => path.relative(root, f)).sort(),
    };
  })
  .sort((a, b) => a.route.localeCompare(b.route));

const deOnly = (r) => allow.routes_de_only.some((x) => r === x || r.startsWith(x + "/"));
const gaps = rows.filter((r) => !r.admin && r.lang_files.length === 0 && !deOnly(r.route)).map((r) => r.route);
const report = { generated_for: "b37-language-gate", routes: rows.length, learner_routes: rows.filter((r) => !r.admin).length, gaps, rows };

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
if (outIdx >= 0) fs.writeFileSync(args[outIdx + 1], JSON.stringify(report, null, 2) + "\n");
if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
else {
  for (const r of rows) console.log(`${r.admin ? "A" : "L"} ${r.route.padEnd(48)} lang files: ${r.lang_files.length}`);
  console.log(`\nlearner routes without any language-aware file (outside DE-only allowlist): ${gaps.length}`);
  for (const g of gaps) console.log("  GAP " + g);
}
process.exit(args.includes("--strict") && gaps.length ? 1 : 0);
