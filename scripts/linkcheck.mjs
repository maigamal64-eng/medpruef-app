#!/usr/bin/env node
// Read-only GETs. Run from any directory; reports are explicitly located by --out.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// These two data modules have no runtime imports. Fail if that contract changes.
export function readTsExports(file) {
  const source = readFileSync(file, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports }, { filename: file, timeout: 1000 });
  return exports;
}

export function checkedUrl(value, allowLanguage = false) {
  const url = new URL(value);
  const languageQuery = allowLanguage && /^\?lang=(de|en)$/.test(url.search);
  if (url.username || url.password || (url.search && !languageQuery) || url.hash || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("URL must be HTTP(S), without credentials, query or fragment");
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Remote checks require HTTPS");
  }
  return url.href;
}

export function curlGet(value) {
  const url = checkedUrl(value, true);
  const scratch = mkdtempSync(path.join(tmpdir(), "medpruf-linkcheck-"));
  try {
    const bodyPath = path.join(scratch, "body");
    const result = spawnSync("curl", ["-sS", "-L", "-m", "30", "--connect-timeout", "10",
      "--max-redirs", "5", "--proto", "=http,https", "--proto-redir", "=http,https",
      "--output", bodyPath, "--write-out", "%{http_code}\n%{url_effective}", url],
    { encoding: "utf8", timeout: 35_000, maxBuffer: 1024 * 1024 });
    const [status, effectiveUrl] = (result.stdout ?? "").trim().split("\n");
    const body = result.status === 0 ? readFileSync(bodyPath) : Buffer.alloc(0);
    const httpStatus = Number(status) || 0;
    return { url, effectiveUrl: effectiveUrl ?? url, httpStatus, curlExit: result.status ?? 1,
      ok: result.status === 0 && httpStatus >= 200 && httpStatus < 400,
      sha256: body.length ? createHash("sha256").update(body).digest("hex") : null,
      body, error: result.status === 0 ? null : "curl transport failed" };
  } finally {
    rmSync(scratch, { recursive: true });
  }
}

export function writeReport(file, report) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
}

export function options(argv, allowed) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!argv[i]?.startsWith("--") || !allowed.includes(key) || !argv[i + 1] || argv[i + 1].startsWith("--") || key in result) {
      throw new Error("Invalid or duplicate option; expected named options with values");
    }
    result[key] = argv[i + 1];
  }
  return result;
}

export function runLinkcheck({ out }) {
  const { AUSTRIAN_RESOURCES } = readTsExports(path.join(repoRoot, "src/lib/austrian-resources.ts"));
  const links = AUSTRIAN_RESOURCES.map(({ id, url }) => {
    const check = curlGet(url);
    delete check.body;
    console.log(`${check.ok ? "PASS" : "FAIL"} resource ${id}: HTTP ${check.httpStatus}, curl ${check.curlExit}, ${url}`);
    return { id, ...check };
  });
  const report = { checkedAt: new Date().toISOString(), ok: links.every((link) => link.ok),
    total: links.length, passed: links.filter((link) => link.ok).length, links };
  writeReport(out, report);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = options(process.argv.slice(2), ["out"]);
    if (!opts.out) throw new Error("Usage: node scripts/linkcheck.mjs --out <report.json>");
    process.exitCode = runLinkcheck(opts);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
